-- ════════════════════════════════════════════════════════════════════════
-- Merma de producto preparado (21-sep-2026, pedido Cesar)
--
-- Problema: anular en caja un ítem que ya estaba en cocina borraba la fila del
-- KDS y no descargaba nada. Si cocina ya lo había hecho, el producto salía del
-- inventario sin rastro y aparecía de noche como faltante (caso mesa 17 → mesa 6,
-- Cafetalón 20-sep, 4-5 salchichas).
--
-- Ahora:
--  * Al anular un ítem que está en cocina, la caja responde "¿se preparó?"
--    (preparado / no_preparado / reutilizado) y queda un registro POR PRODUCTO
--    en pos_mermas_producto ("2× Freakie Dog · Mesa 17 · anuló Jazmín").
--  * Si se preparó, el kardex descarga los insumos como merma, con
--    referencia_tipo='pos_merma_producto' (NO 'merma': el candado del conteo
--    nocturno sólo mira esa firma, así que esto no bloquea el reporte de merma).
--  * La fila del KDS no se borra: queda en estado 'anulado' para que cocina la
--    vea y confirme ("ya estaba hecho" / "no se hizo"). Si cocina contradice a
--    la caja, gana cocina y el kardex se corrige solo.
--  * Si la cuenta ya se había descontado como venta (delivery/web descuentan al
--    entrar), se devuelve lo de esa línea para que no quede como venta.
-- ════════════════════════════════════════════════════════════════════════

-- Nuevo estado de la cola de cocina: 'anulado' (tachado en el KDS hasta que cocina confirme)
alter table public.pos_cocina_queue drop constraint if exists pos_cocina_queue_estado_check;
alter table public.pos_cocina_queue add constraint pos_cocina_queue_estado_check
  check (estado = any (array['pendiente','preparando','en_preparacion','listo','completado','cancelado','anulado']));

create table if not exists public.pos_mermas_producto (
  id                    uuid primary key default gen_random_uuid(),
  sucursal_id           uuid not null references public.sucursales(id),
  store_code            text,
  cuenta_id             uuid not null,
  cuenta_item_id        uuid not null unique,
  menu_item_id          uuid,
  producto_nombre       text not null,
  cantidad              numeric not null,
  valor_venta           numeric,
  canal                 text,
  mesa_ref              text,
  respuesta_caja        text not null check (respuesta_caja in ('preparado','no_preparado','reutilizado')),
  respuesta_cocina      text check (respuesta_cocina in ('preparado','no_preparado')),
  -- Lo que vale al final: cocina manda sobre la caja.
  es_merma              boolean generated always as (coalesce(respuesta_cocina, respuesta_caja) = 'preparado') stored,
  motivo                text,
  anulado_por           uuid,
  anulado_por_nombre    text,
  confirmado_por_nombre text,
  confirmado_at         timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists pos_mermas_producto_suc_fecha on public.pos_mermas_producto (sucursal_id, created_at desc);

alter table public.pos_mermas_producto enable row level security;
drop policy if exists pos_mermas_producto_select on public.pos_mermas_producto;
create policy pos_mermas_producto_select on public.pos_mermas_producto for select to anon, authenticated using (true);
-- Escritura sólo vía las funciones SECURITY DEFINER de abajo.

comment on table public.pos_mermas_producto is
  'Merma de producto ya preparado: un registro por plato anulado después de entrar a cocina. El kardex de insumos queda con referencia_tipo=pos_merma_producto.';


-- ── Insumos de UNA línea de cuenta (misma explosión que pos_deducir_inventario) ──
-- OJO: si cambia la lógica de pos_deducir_inventario, cambiar también acá.
create or replace function public.pos_explotar_linea(p_linea_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_canal text; v_items jsonb;
begin
  select m.canal into v_canal
    from pos_cuenta_items ci join pos_cuentas c on c.id = ci.cuenta_id
    left join pos_menus m on m.id = c.menu_id
   where ci.id = p_linea_id;

  with recursive lineas as (
    select ci.id as linea_id, ci.cantidad::numeric qty, ci.menu_item_id, ci.componentes, ci.modificadores
      from pos_cuenta_items ci where ci.id = p_linea_id),
  sin_por_linea as (
    select l.linea_id,
           upper(btrim(coalesce(m->>'quitar', regexp_replace(m->>'nombre','^SIN\s+','')))) as quitar
      from lineas l
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.modificadores)='array' then l.modificadores else '[]'::jsonb end) m
     where upper(coalesce(m->>'grupo_nombre','')) = 'SIN'
    union
    select l.linea_id,
           upper(btrim(coalesce(m->>'quitar', regexp_replace(m->>'nombre','^SIN\s+',''))))
      from lineas l
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.componentes)='array' then l.componentes else '[]'::jsonb end) c
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(c->'modificadores')='array' then c->'modificadores' else '[]'::jsonb end) m
     where upper(coalesce(m->>'grupo_nombre','')) = 'SIN'),
  padre as (
    select l.linea_id, l.qty, mi.producto_id as plato_id, r.id as receta_id
      from lineas l join pos_menu_items mi on mi.id = l.menu_item_id
      left join recetas r on r.catalogo_id = mi.producto_id and coalesce(r.activo,true)
     where mi.producto_id is not null),
  comp as (
    select l.linea_id, l.qty * coalesce((c->>'cantidad')::numeric,1) as qty,
           mi.producto_id as plato_id, r.id as receta_id
      from lineas l
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.componentes)='array' then l.componentes else '[]'::jsonb end) c
      join pos_menu_items mi on mi.id = (c->>'item_id')::uuid
      left join recetas r on r.catalogo_id = mi.producto_id and coalesce(r.activo,true)
     where mi.producto_id is not null),
  base as (select * from padre union all select * from comp),
  mods_elegidos as (
    select l.qty, coalesce(m->>'id', m->>'opcion_id') as mod_id
      from lineas l
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.modificadores)='array' then l.modificadores else '[]'::jsonb end) m
    union all
    select l.qty * coalesce((c->>'cantidad')::numeric,1), coalesce(m->>'id', m->>'opcion_id')
      from lineas l
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(l.componentes)='array' then l.componentes else '[]'::jsonb end) c
      cross join lateral jsonb_array_elements(
             case when jsonb_typeof(c->'modificadores')='array' then c->'modificadores' else '[]'::jsonb end) m),
  mod_insumos as (
    select me.qty * pmi.cantidad as qty, pmi.producto_id, pmi.receta_id
      from mods_elegidos me
      join pos_modificador_insumos pmi on pmi.modificador_id = me.mod_id::uuid
     where me.mod_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and (pmi.canales is null or v_canal = any(pmi.canales))),
  raiz as (
    select b.linea_id, b.receta_id, b.qty from base b where b.receta_id is not null
    union all
    select null::uuid, mi.receta_id, mi.qty from mod_insumos mi where mi.receta_id is not null),
  expl as (
    select z.linea_id, z.receta_id, ri.tipo_ingrediente, ri.producto_id, ri.sub_receta_id,
           sr.catalogo_id as sub_cat,
           z.qty * ri.cantidad * coalesce(ri.factor_a_stock,1) * (1 + coalesce(ri.merma_pct,0)/100.0) as qty, 1 as depth
      from raiz z join receta_ingredientes ri on ri.receta_id = z.receta_id
      left join recetas sr on sr.id = ri.sub_receta_id
     where not (ri.removible and z.linea_id is not null and exists (
             select 1 from sin_por_linea s
              where s.linea_id = z.linea_id
                and s.quitar = upper(btrim(coalesce(nullif(ri.etiqueta,''),
                      (select cp.nombre from catalogo_productos cp where cp.id = ri.producto_id),
                      (select r2.nombre from recetas r2 where r2.id = ri.sub_receta_id))))))
    union all
    select e.linea_id, e.receta_id, ri.tipo_ingrediente, ri.producto_id, ri.sub_receta_id, sr.catalogo_id,
           e.qty * ri.cantidad * coalesce(ri.factor_a_stock,1) * (1 + coalesce(ri.merma_pct,0)/100.0) / coalesce(nullif(r.rendimiento,0),1),
           e.depth + 1
      from expl e join recetas r on r.id = e.sub_receta_id
      join receta_ingredientes ri on ri.receta_id = e.sub_receta_id
      left join recetas sr on sr.id = ri.sub_receta_id
     where e.tipo_ingrediente = 'sub_receta' and e.sub_receta_id is not null
       and e.sub_cat is null and e.depth < 8
       and not (ri.removible and e.linea_id is not null and exists (
             select 1 from sin_por_linea s
              where s.linea_id = e.linea_id
                and s.quitar = upper(btrim(coalesce(nullif(ri.etiqueta,''),
                      (select cp.nombre from catalogo_productos cp where cp.id = ri.producto_id),
                      (select r2.nombre from recetas r2 where r2.id = ri.sub_receta_id))))))),
  ded as (
    select producto_id, sum(qty) as qty from expl
      where tipo_ingrediente='materia_prima' and producto_id is not null group by producto_id
    union all
    select sub_cat, sum(qty) from expl
      where tipo_ingrediente='sub_receta' and sub_cat is not null group by sub_cat
    union all
    select plato_id, sum(qty) from base where receta_id is null group by plato_id
    union all
    select producto_id, sum(qty) from mod_insumos where producto_id is not null group by producto_id),
  agg as (select producto_id, sum(qty) as qty from ded group by producto_id having sum(qty) > 0)
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', qty)), '[]'::jsonb)
    into v_items from agg;

  return v_items;
end $function$;


-- ── Deja el kardex de una merma de producto en el valor que corresponde ──
-- Mira lo ya movido con referencia pos_merma_producto/<id> y mueve sólo la
-- diferencia: se puede llamar las veces que sea (caja responde, cocina corrige).
create or replace function public._pos_merma_producto_sync(p_merma_id uuid, p_usuario uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_m public.pos_mermas_producto%rowtype;
  v_exp jsonb; v_menos jsonb; v_mas jsonb; v_nota text;
begin
  select * into v_m from public.pos_mermas_producto where id = p_merma_id for update;
  if not found then raise exception 'merma de producto % no existe', p_merma_id; end if;

  v_exp := case when v_m.es_merma then public.pos_explotar_linea(v_m.cuenta_item_id) else '[]'::jsonb end;

  with objetivo as (
    select (e->>'producto_id')::uuid producto_id, -(e->>'cantidad')::numeric qty
      from jsonb_array_elements(v_exp) e),
  actual as (
    select k.producto_id, sum(k.cantidad) qty from public.kardex_movimientos k
     where k.referencia_tipo = 'pos_merma_producto' and k.referencia_id = p_merma_id
     group by k.producto_id),
  delta as (
    select coalesce(o.producto_id, a.producto_id) producto_id,
           coalesce(o.qty,0) - coalesce(a.qty,0) d
      from objetivo o full join actual a on a.producto_id = o.producto_id)
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', d)) filter (where d < -0.000001), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'cantidad', d)) filter (where d >  0.000001), '[]'::jsonb)
    into v_menos, v_mas
    from delta;

  v_nota := 'Merma de producto preparado: ' || trim(to_char(v_m.cantidad, 'FM999990.##')) || '× ' || v_m.producto_nombre
            || coalesce(' · ' || nullif(v_m.mesa_ref,''), '')
            || ' · anuló ' || coalesce(v_m.anulado_por_nombre, '—')
            || case when v_m.respuesta_cocina is not null
                    then ' · cocina: ' || case when v_m.respuesta_cocina='preparado' then 'ya estaba hecho' else 'no se hizo' end
                    else '' end;

  if v_menos <> '[]'::jsonb then
    perform public.kardex_mover_lote(v_menos, 'merma', 'pos_merma_producto', p_merma_id,
      v_nota, p_usuario, v_m.sucursal_id, true);
  end if;
  if v_mas <> '[]'::jsonb then
    perform public.kardex_mover_lote(v_mas, 'devolucion', 'pos_merma_producto', p_merma_id,
      'Corrección: ' || v_nota, p_usuario, v_m.sucursal_id, true);
  end if;

  return jsonb_build_object('es_merma', v_m.es_merma,
    'descontados', jsonb_array_length(v_menos), 'devueltos', jsonb_array_length(v_mas));
end $function$;


-- ── Anular un ítem desde la caja ──
-- p_respuesta: null si el ítem no está en cocina; si está en cocina es obligatoria.
create or replace function public.pos_anular_item(
  p_item_id uuid, p_respuesta text default null, p_motivo text default null,
  p_usuario_id uuid default null, p_usuario_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_it public.pos_cuenta_items%rowtype;
  v_c  public.pos_cuentas%rowtype;
  v_suc uuid; v_canal text; v_en_cocina boolean; v_deducida boolean;
  v_merma uuid; v_exp jsonb; v_rev jsonb; v_sync jsonb; v_nombre text;
begin
  select * into v_it from public.pos_cuenta_items where id = p_item_id for update;
  if not found then raise exception 'Ese ítem ya no existe'; end if;
  if v_it.cancelado_motivo is not null then
    return jsonb_build_object('ok', true, 'ya_anulado', true);
  end if;

  select * into v_c from public.pos_cuentas where id = v_it.cuenta_id for update;
  if v_c.estado = 'cobrada' or v_c.dte_uuid is not null then
    raise exception 'Esta cuenta ya se cobró y facturó. Para devolver un producto usá "Devolución" en Historial de cobros.';
  end if;

  select id into v_suc from public.sucursales where store_code = v_c.store_code limit 1;
  select m.canal into v_canal from public.pos_menus m where m.id = v_c.menu_id;
  v_nombre := coalesce(nullif(btrim(p_usuario_nombre),''), 'POS');

  v_en_cocina := exists (select 1 from public.pos_cocina_queue q
                          where q.cuenta_item_id = p_item_id and q.estado <> 'anulado');
  if v_en_cocina and (p_respuesta is null or p_respuesta not in ('preparado','no_preparado','reutilizado')) then
    raise exception 'Este producto ya está en cocina: indicá si se preparó, no se preparó o se usó en otra orden';
  end if;

  -- ¿La cuenta ya se descontó como venta? (delivery/web descuentan al entrar)
  v_deducida := exists (select 1 from public.kardex_movimientos k
                         where k.referencia_tipo = 'pos_cuenta' and k.referencia_id = v_it.cuenta_id
                           and k.tipo = 'venta');

  -- La explosión se calcula ANTES de marcar la línea como anulada (da igual,
  -- pos_explotar_linea no filtra anuladas, pero así queda claro el orden).
  if v_deducida then
    v_exp := public.pos_explotar_linea(p_item_id);
  end if;

  update public.pos_cuenta_items
     set cancelado_motivo = left('Anulado en POS (' || v_nombre || ')'
                              || case p_respuesta
                                   when 'preparado'    then ' · ya preparado → merma'
                                   when 'no_preparado' then ' · no se preparó'
                                   when 'reutilizado'  then ' · se usó en otra orden'
                                   else '' end
                              || coalesce(' · ' || nullif(btrim(p_motivo),''), ''), 500),
         cancelado_por = p_usuario_id
   where id = p_item_id;

  -- Si ya se había descontado como venta, esa línea deja de ser venta.
  if v_deducida and v_exp is not null and v_exp <> '[]'::jsonb then
    select jsonb_agg(jsonb_build_object('producto_id', e->>'producto_id', 'cantidad', (e->>'cantidad')::numeric))
      into v_rev from jsonb_array_elements(v_exp) e;
    perform public.kardex_mover_lote(v_rev, 'devolucion', 'pos_cuenta_item', p_item_id,
      'Reversa de venta: ' || trim(to_char(v_it.cantidad, 'FM999990.##')) || '× ' || coalesce(v_it.nombre,'ítem')
        || ' anulado en caja (' || v_nombre || ')',
      p_usuario_id, v_suc, true);
  end if;

  if not v_en_cocina then
    return jsonb_build_object('ok', true, 'en_cocina', false, 'venta_revertida', v_deducida);
  end if;

  insert into public.pos_mermas_producto (
    sucursal_id, store_code, cuenta_id, cuenta_item_id, menu_item_id, producto_nombre,
    cantidad, valor_venta, canal, mesa_ref, respuesta_caja, motivo, anulado_por, anulado_por_nombre)
  values (
    v_suc, v_c.store_code, v_c.id, p_item_id, v_it.menu_item_id, coalesce(v_it.nombre, 'Producto'),
    v_it.cantidad, round((coalesce(v_it.precio_unitario,0) + coalesce(v_it.precio_modificadores,0)) * v_it.cantidad, 2),
    v_canal,
    case when v_c.mesa_ref ~ '^\s*\d+\s*$'
         then 'Mesa ' || btrim(v_c.mesa_ref) else nullif(v_c.mesa_ref,'') end,
    p_respuesta, nullif(btrim(p_motivo),''), p_usuario_id, v_nombre)
  on conflict (cuenta_item_id) do nothing
  returning id into v_merma;

  -- Cocina se entera: la fila queda tachada hasta que confirme.
  update public.pos_cocina_queue
     set estado = 'anulado', completado_at = null
   where cuenta_item_id = p_item_id;

  if v_merma is not null then
    v_sync := public._pos_merma_producto_sync(v_merma, p_usuario_id);
  end if;

  return jsonb_build_object('ok', true, 'en_cocina', true, 'merma_id', v_merma,
    'venta_revertida', v_deducida, 'kardex', v_sync);
end $function$;


-- ── Cocina confirma desde el KDS ──
create or replace function public.pos_merma_confirmar_cocina(
  p_cuenta_item_id uuid, p_respuesta text, p_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid; v_caja text; v_sync jsonb;
begin
  if p_respuesta not in ('preparado','no_preparado') then
    raise exception 'Respuesta no válida: preparado o no_preparado';
  end if;

  update public.pos_mermas_producto
     set respuesta_cocina = p_respuesta,
         confirmado_por_nombre = coalesce(nullif(btrim(p_nombre),''), 'Cocina'),
         confirmado_at = now()
   where cuenta_item_id = p_cuenta_item_id
  returning id, respuesta_caja into v_id, v_caja;

  if v_id is not null then
    v_sync := public._pos_merma_producto_sync(v_id, null);
  end if;

  -- El registro vive en pos_mermas_producto; la fila de cocina ya no hace falta.
  delete from public.pos_cocina_queue
   where cuenta_item_id = p_cuenta_item_id and estado = 'anulado';

  return jsonb_build_object('ok', true, 'merma_id', v_id,
    'coincide', v_caja is null or v_caja = p_respuesta
                or (v_caja = 'reutilizado' and p_respuesta = 'no_preparado'),
    'kardex', v_sync);
end $function$;


-- ── Anular una orden completa (Órdenes activas) ──
create or replace function public.pos_anular_cuenta(
  p_cuenta_id uuid, p_respuesta text default null, p_motivo text default null,
  p_usuario_id uuid default null, p_usuario_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare r record; v_n int := 0; v_m int := 0; v_res jsonb; v_c public.pos_cuentas%rowtype;
begin
  select * into v_c from public.pos_cuentas where id = p_cuenta_id for update;
  if not found then raise exception 'La orden no existe'; end if;
  if v_c.estado = 'cobrada' then raise exception 'La orden ya está cobrada: no se puede anular acá'; end if;
  if v_c.estado = 'cancelada' then return jsonb_build_object('ok', true, 'ya_cancelada', true); end if;

  for r in select id from public.pos_cuenta_items
            where cuenta_id = p_cuenta_id and cancelado_motivo is null loop
    v_res := public.pos_anular_item(
      r.id,
      case when exists (select 1 from public.pos_cocina_queue q where q.cuenta_item_id = r.id and q.estado <> 'anulado')
           then p_respuesta else null end,
      p_motivo, p_usuario_id, p_usuario_nombre);
    v_n := v_n + 1;
    if (v_res->>'merma_id') is not null then v_m := v_m + 1; end if;
  end loop;

  update public.pos_cuentas
     set estado = 'cancelada',
         cancelada_motivo = left(coalesce(nullif(btrim(p_motivo),''), 'Sin motivo')
                              || ' · autorizó ' || coalesce(p_usuario_nombre, ''), 500),
         cancelada_por = p_usuario_id,
         updated_at = now()
   where id = p_cuenta_id and estado <> 'cobrada';

  return jsonb_build_object('ok', true, 'items', v_n, 'mermas', v_m);
end $function$;


-- ── Filas 'anulado' no bloquean "listo para retirar" de PedidosYa ──
create or replace function public.peya_listo_para_retirar(p_orden_id bigint)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  o          record;
  v_total    int;
  v_pend     int;
begin
  select id, pos_cuenta_id, short_code, code, remote_order_id
    into o from peya_ordenes where id = p_orden_id;
  if not found then
    return jsonb_build_object('listo', false, 'motivo', 'El pedido no existe');
  end if;

  if o.pos_cuenta_id is null then
    return jsonb_build_object('listo', true, 'sin_cocina', true,
                              'motivo', 'Este pedido no bajó a cocina');
  end if;

  select count(*), count(*) filter (where estado not in ('completado','anulado'))
    into v_total, v_pend
    from pos_cocina_queue where cuenta_id = o.pos_cuenta_id and estado <> 'anulado';

  if v_total = 0 then
    return jsonb_build_object('listo', true, 'sin_cocina', true,
                              'motivo', 'La comanda ya salió de la cola');
  end if;

  return jsonb_build_object(
    'listo', v_pend = 0,
    'lineas', v_total,
    'pendientes', v_pend,
    'motivo', case when v_pend = 0
      then 'Cocina marcó la comanda lista'
      else 'Cocina todavía tiene ' || v_pend || ' de ' || v_total || ' líneas sin marcar' end
  );
end;
$function$;


-- ── La limpieza de la cola también saca anulados viejos que nadie confirmó ──
-- (el registro queda en pos_mermas_producto con la respuesta de la caja)
create or replace function public.limpiar_cola_cocina_colgada(p_horas integer default 3)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_n int; v_a int;
begin
  with viejos as (
    select q.id
    from public.pos_cocina_queue q
    join public.pos_cuentas c on c.id = q.cuenta_id
    where q.estado not in ('completado','anulado')
      and c.estado = 'cobrada'
      and coalesce(c.cobrada_at, q.recibido_at) < now() - make_interval(hours => p_horas)
  )
  update public.pos_cocina_queue q
     set estado = 'completado', completado_at = now()
    from viejos v
   where q.id = v.id;
  get diagnostics v_n = row_count;

  delete from public.pos_cocina_queue
   where estado = 'anulado' and recibido_at < now() - make_interval(hours => p_horas);
  get diagnostics v_a = row_count;

  return jsonb_build_object('ok', true, 'limpiadas', v_n, 'anulados_sin_confirmar', v_a);
end;
$function$;

grant execute on function public.pos_anular_item(uuid, text, text, uuid, text) to anon, authenticated;
grant execute on function public.pos_anular_cuenta(uuid, text, text, uuid, text) to anon, authenticated;
grant execute on function public.pos_merma_confirmar_cocina(uuid, text, text) to anon, authenticated;
revoke execute on function public._pos_merma_producto_sync(uuid, uuid) from anon, authenticated, public;
