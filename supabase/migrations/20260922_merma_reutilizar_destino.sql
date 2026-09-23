-- ════════════════════════════════════════════════════════════════════════
-- Producto reutilizado con destino (22-sep-2026, fase 1)
--
-- Hueco que cierra (sobre 20260921_merma_producto_preparado.sql):
--  * Cocina sólo podía decir "ya estaba hecho" o "no se hizo". Si el plato se
--    reutilizó en otra orden, lo honesto era "ya estaba hecho" → gana cocina →
--    quedaba MERMA, y la orden destino lo descontaba otra vez al cobrarse:
--    doble descuento (caso Venecia 22-sep, Royal Truffle Combo mesa 7).
--  * "Se usó en otra orden" era una etiqueta sin destino: nadie sabía a qué
--    orden fue, y si no se usaba en ninguna, el producto desaparecía sin rastro.
--
-- Ahora:
--  * Cocina tiene una tercera respuesta: 'reutilizado'. No es merma.
--  * Una merma 'reutilizado' se vincula a UNA línea de una orden abierta de la
--    misma sucursal que lleva exactamente ese mismo producto, en cualquier canal
--    (se compara el plato del catálogo, no el ítem de menú: el Freakie Dog del
--    menú local y el de PeYa son ítems distintos pero el mismo plato). Una línea
--    destino sólo puede recibir un producto reutilizado.
--    Combos a medias (reutilizar una parte) quedan para la fase 2.
--  * La fila de cocina de la orden destino muestra "♻️ Usar el ya hecho de …"
--    (columna nueva reutiliza_de) para que no se cocine otro.
--  * Si cocina después dice que se botó o que no se hizo, el vínculo se borra.
--  * El inventario no cambia de lógica: el origen reutilizado no descarga nada
--    y la orden destino descarga normal al cobrarse → una sola vez.
--
-- Todo es aditivo: la versión actual de las pantallas sigue funcionando igual.
-- ════════════════════════════════════════════════════════════════════════

alter table public.pos_mermas_producto drop constraint if exists pos_mermas_producto_respuesta_cocina_check;
alter table public.pos_mermas_producto add constraint pos_mermas_producto_respuesta_cocina_check
  check (respuesta_cocina in ('preparado','no_preparado','reutilizado'));

alter table public.pos_mermas_producto
  add column if not exists destino_cuenta_id  uuid,
  add column if not exists destino_item_id    uuid,
  add column if not exists destino_ref        text,
  add column if not exists destino_producto   text,
  add column if not exists destino_por_nombre text,
  add column if not exists destino_at         timestamptz;

create unique index if not exists pos_mermas_producto_destino_item_uq
  on public.pos_mermas_producto (destino_item_id) where destino_item_id is not null;

comment on column public.pos_mermas_producto.destino_item_id is
  'Línea de la orden que recibió el producto reutilizado. Única: una línea no recibe dos.';

alter table public.pos_cocina_queue add column if not exists reutiliza_de text;
comment on column public.pos_cocina_queue.reutiliza_de is
  'Aviso para cocina: esta línea se arma con un producto ya hecho de otra orden (no cocinar otro).';


-- ── Referencia legible de una orden: "Mesa 6", "Para llevar · Ana", "PeYa 2719" ──
create or replace function public._pos_ref_cuenta(p_cuenta_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when c.mesa_ref ~ '^\s*\d+\s*$' then 'Mesa ' || btrim(c.mesa_ref)
    when nullif(btrim(c.mesa_ref),'') is not null then btrim(c.mesa_ref)
    when nullif(btrim(c.delivery_referencia),'') is not null
      then coalesce(case m.canal when 'pedidos_ya' then 'PeYa' when 'delivery_propio' then 'Delivery' else null end, 'Pedido')
           || ' ' || btrim(c.delivery_referencia)
    else coalesce(case m.canal
                    when 'para_llevar' then 'Para llevar'
                    when 'drive_through' then 'Drive thru'
                    when 'delivery_propio' then 'Delivery'
                    when 'pedidos_ya' then 'PeYa'
                    else 'Orden' end, 'Orden')
         || coalesce(' · ' || nullif(btrim(c.cliente_nombre),''), '')
  end
  from public.pos_cuentas c left join public.pos_menus m on m.id = c.menu_id
  where c.id = p_cuenta_id
$function$;


-- ── Órdenes que pueden recibir el producto reutilizado ──
-- Sólo órdenes no canceladas de la misma sucursal, de las últimas 12 horas, con una
-- línea que lleve el MISMO plato (cualquier canal), que todavía esté esperando
-- en cocina y que no tenga ya otro reutilizado.
create or replace function public.pos_merma_destinos_posibles(p_cuenta_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_o public.pos_cuenta_items%rowtype; v_store text; v_res jsonb; v_plato uuid;
begin
  select * into v_o from public.pos_cuenta_items where id = p_cuenta_item_id;
  if not found then raise exception 'Ese producto ya no existe'; end if;
  select store_code into v_store from public.pos_cuentas where id = v_o.cuenta_id;
  select producto_id into v_plato from public.pos_menu_items where id = v_o.menu_item_id;

  select coalesce(jsonb_agg(d order by d->>'recibido_at'), '[]'::jsonb) into v_res
  from (
    select jsonb_build_object(
             'item_id',       ci.id,
             'cuenta_id',     c.id,
             'ref',           public._pos_ref_cuenta(c.id),
             'canal',         m.canal,
             'producto',      ci.nombre,
             'cantidad',      ci.cantidad,
             'estado_cocina', case when bool_or(q.estado in ('preparando','en_preparacion')) then 'en_preparacion' else 'pendiente' end,
             'recibido_at',   min(q.recibido_at)) d
      from public.pos_cuenta_items ci
      join public.pos_cuentas c on c.id = ci.cuenta_id
      left join public.pos_menus m on m.id = c.menu_id
      join public.pos_cocina_queue q on q.cuenta_item_id = ci.id
                                    and q.estado in ('pendiente','preparando','en_preparacion')
     where c.store_code = v_store
       and c.estado <> 'cancelada'   -- cobrada sirve: ya descontó una vez y el origen no descuenta
       and c.created_at > now() - interval '12 hours'
       and ci.id <> v_o.id
       and ci.cancelado_motivo is null
       and (ci.menu_item_id = v_o.menu_item_id
            or (v_plato is not null and exists (
                  select 1 from public.pos_menu_items md
                   where md.id = ci.menu_item_id and md.producto_id = v_plato)))
       and not exists (select 1 from public.pos_mermas_producto mp where mp.destino_item_id = ci.id)
     group by ci.id, c.id, m.canal
  ) s;

  return v_res;
end $function$;


-- ── Quita el vínculo de una merma con su orden destino (interna) ──
create or replace function public._pos_merma_quitar_destino(p_merma_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_dest uuid;
begin
  select destino_item_id into v_dest from public.pos_mermas_producto where id = p_merma_id;
  if v_dest is null then return; end if;
  update public.pos_cocina_queue set reutiliza_de = null
   where cuenta_item_id = v_dest and reutiliza_de is not null;
  update public.pos_mermas_producto
     set destino_cuenta_id = null, destino_item_id = null, destino_ref = null,
         destino_producto = null, destino_por_nombre = null, destino_at = null
   where id = p_merma_id;
end $function$;


-- ── Asignar el producto reutilizado a una orden ──
create or replace function public.pos_merma_asignar_destino(
  p_merma_id uuid, p_destino_item_id uuid, p_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_m public.pos_mermas_producto%rowtype;
  v_o public.pos_cuenta_items%rowtype;
  v_d public.pos_cuenta_items%rowtype;
  v_ref text; v_origen text; v_aviso text;
begin
  select * into v_m from public.pos_mermas_producto where id = p_merma_id for update;
  if not found then raise exception 'Ese registro de anulación no existe'; end if;
  if coalesce(v_m.respuesta_cocina, v_m.respuesta_caja) <> 'reutilizado' then
    raise exception 'Sólo se puede elegir destino si se marcó que se usó en otra orden';
  end if;

  -- Reasignar: primero se suelta el destino anterior.
  perform public._pos_merma_quitar_destino(p_merma_id);

  if not exists (select 1 from jsonb_array_elements(public.pos_merma_destinos_posibles(v_m.cuenta_item_id)) e
                  where e->>'item_id' = p_destino_item_id::text) then
    raise exception 'Esa orden ya no puede recibir este producto (se canceló, ya salió de cocina o ya tiene otro reutilizado)';
  end if;

  select * into v_o from public.pos_cuenta_items where id = v_m.cuenta_item_id;
  select * into v_d from public.pos_cuenta_items where id = p_destino_item_id;
  v_ref    := public._pos_ref_cuenta(v_d.cuenta_id);
  v_origen := coalesce(nullif(v_m.mesa_ref,''), public._pos_ref_cuenta(v_m.cuenta_id));
  v_aviso  := '♻️ Usar el ya hecho de ' || v_origen || ' (' || trim(to_char(v_m.cantidad, 'FM999990.##')) || '× '
              || coalesce(v_o.nombre, v_m.producto_nombre) || ')';

  update public.pos_mermas_producto
     set destino_cuenta_id = v_d.cuenta_id, destino_item_id = v_d.id, destino_ref = v_ref,
         destino_producto = v_d.nombre,
         destino_por_nombre = coalesce(nullif(btrim(p_nombre),''), 'POS'),
         destino_at = now()
   where id = p_merma_id;

  -- Aviso en cocina en todas las filas de esa línea (un combo entra como una
  -- fila por componente; todas comparten cuenta_item_id).
  update public.pos_cocina_queue q
     set reutiliza_de = v_aviso
   where q.cuenta_item_id = v_d.id
     and q.estado in ('pendiente','preparando','en_preparacion');

  return jsonb_build_object('ok', true, 'destino_ref', v_ref, 'destino_producto', v_d.nombre);
end $function$;


-- ── Cocina confirma desde el KDS (ahora con 'reutilizado') ──
create or replace function public.pos_merma_confirmar_cocina(
  p_cuenta_item_id uuid, p_respuesta text, p_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_id uuid; v_caja text; v_sync jsonb; v_dest uuid;
begin
  if p_respuesta not in ('preparado','no_preparado','reutilizado') then
    raise exception 'Respuesta no válida: preparado, no_preparado o reutilizado';
  end if;

  update public.pos_mermas_producto
     set respuesta_cocina = p_respuesta,
         confirmado_por_nombre = coalesce(nullif(btrim(p_nombre),''), 'Cocina'),
         confirmado_at = now()
   where cuenta_item_id = p_cuenta_item_id
  returning id, respuesta_caja, destino_item_id into v_id, v_caja, v_dest;

  if v_id is not null then
    -- Si cocina dice que se botó o que no se hizo, no hay nada que reutilizar.
    if p_respuesta <> 'reutilizado' and v_dest is not null then
      perform public._pos_merma_quitar_destino(v_id);
      v_dest := null;
    end if;
    v_sync := public._pos_merma_producto_sync(v_id, null);
  end if;

  -- El registro vive en pos_mermas_producto; la fila de cocina ya no hace falta.
  delete from public.pos_cocina_queue
   where cuenta_item_id = p_cuenta_item_id and estado = 'anulado';

  return jsonb_build_object('ok', true, 'merma_id', v_id,
    'coincide', v_caja is null or v_caja = p_respuesta
                or (v_caja = 'reutilizado' and p_respuesta = 'no_preparado'),
    'necesita_destino', v_id is not null and p_respuesta = 'reutilizado' and v_dest is null,
    'kardex', v_sync);
end $function$;

grant execute on function public.pos_merma_destinos_posibles(uuid) to anon, authenticated;
grant execute on function public.pos_merma_asignar_destino(uuid, uuid, text) to anon, authenticated;
grant execute on function public.pos_merma_confirmar_cocina(uuid, text, text) to anon, authenticated;
revoke execute on function public._pos_merma_quitar_destino(uuid) from anon, authenticated, public;
grant execute on function public._pos_ref_cuenta(uuid) to anon, authenticated;
