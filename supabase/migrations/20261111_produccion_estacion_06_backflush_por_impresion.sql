-- ═══════════════════════════════════════════════════════════════════════
-- Estación de etiquetado → kardex · M6: backflush por IMPRESIÓN (11-nov-2026)
-- docs/PLAN-ESTACION-ETIQUETADO-ERP.md · memoria.md 11/13-oct y 11-nov
--
-- Decisión Jose (11-nov): el kardex se mueve por receta en cada impresión
-- registrada; lo que la persona declara en /preparacion.html queda como
-- contraste (merma = declarado − receta). La pantalla de la tablet NO cambia.
--
-- Cómo: fn_etiqueta_registrar_v3 (la que llama la tablet por cada par de
-- etiquetas) sigue haciendo exactamente lo mismo y, al final, llama a
-- _etiqueta_backflush(impresion). Esa función arma una tanda cerrada en
-- produccion_diaria (una por impresión, lote LOT-aaaammdd-NNN, con la
-- impresión y el lote de preparación como referencia), registra sus unidades
-- con el peso real y cierra con produccion_tanda_cerrar → kardex 'consumo'
-- por receta + 'produccion' del producto terminado. Cualquier error queda en
-- produccion_backflush_errores y NUNCA frena la impresión; un cron reintenta.
--
-- Nuevo: etiquetado_productos.unidades_catalogo = cuántas unidades del
-- producto de catálogo hay en una unidad impresa (carne: bolsa de 6 bolitas,
-- receta rinde 667 bolitas). Materias primas por peso real y empaques por
-- unidades, como antes, pero en unidades de catálogo.
-- Aplicada en la base en 6 partes (06a esquema+cerrar, 06b backflush, 06f recetas,
-- 06e vincular, 06c v3 en vivo, 06d reintento+cron), cada una probada con rollback.
-- ═══════════════════════════════════════════════════════════════════════

-- ── A. Esquema ────────────────────────────────────────────────────────────
alter table public.produccion_diaria add column if not exists impresion_id uuid;
alter table public.produccion_diaria add column if not exists prep_lote text;
create unique index if not exists produccion_diaria_impresion_uq on public.produccion_diaria (impresion_id) where impresion_id is not null;

alter table public.etiquetado_productos add column if not exists unidades_catalogo numeric not null default 1;
comment on column public.etiquetado_productos.unidades_catalogo is 'Unidades del producto de catálogo que contiene una unidad impresa (bolsa de 6 bolitas = 6). La receta rinde en unidades de catálogo.';

create table if not exists public.produccion_backflush_errores (
  id bigserial primary key,
  impresion_id uuid not null,
  error text not null,
  detalle jsonb,
  resuelto boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.produccion_backflush_errores enable row level security;

-- ── B. Cierre con unidades_catalogo ───────────────────────────────────────
create or replace function public.produccion_tanda_cerrar(
  p_produccion_id uuid, p_usuario_id uuid default null, p_peso_insumo_g numeric default null,
  p_auto boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pd record; e record;
  v_unid numeric; v_peso numeric; v_rend numeric; v_f numeric;
  v_t_unid numeric; v_t_peso numeric; v_excluir uuid[];
  v_cons jsonb := jsonb_build_object('consumidos', 0, 'sub_sin_catalogo', 0, 'faltantes', '[]'::jsonb);
  v_alta jsonb := jsonb_build_object('alta', false);
  v_costo numeric := 0; v_yield numeric; v_merma numeric; v_avisos jsonb := '[]'::jsonb;
  v_consumos jsonb; v_mueve boolean;
begin
  select * into pd from public.produccion_diaria where id = p_produccion_id for update;
  if not found then raise exception 'La tanda no existe'; end if;
  if pd.estado in ('cerrada', 'cerrada_auto') then
    return public._produccion_tanda_json(pd.id) || jsonb_build_object('ya_cerrada', true);
  end if;
  if pd.estado = 'anulada' then raise exception 'La tanda % está anulada', pd.lote; end if;

  select count(*), coalesce(sum(gramos), 0) into v_unid, v_peso
    from public.produccion_unidades where produccion_id = pd.id and estado = 'activa';
  if v_unid = 0 then raise exception 'La tanda % no tiene unidades: anulala en vez de cerrarla', pd.lote; end if;

  select * into e from public.etiquetado_productos where id = pd.etiquetado_id;
  v_f := coalesce(nullif(e.unidades_catalogo, 0), 1);          -- unidades de catálogo por unidad impresa
  v_mueve := (not pd.es_prueba) and pd.receta_id is not null;
  select coalesce(nullif(rc.rendimiento, 0), 1) into v_rend from public.recetas rc where rc.id = pd.receta_id;
  v_rend := coalesce(v_rend, 1);

  -- tandas de receta: por unidades (empaques) y por peso real (materias primas)
  v_t_unid := round(v_unid * v_f / v_rend, 6);
  if pd.base_consumo = 'peso' and coalesce(e.gramos, 0) > 0 and v_peso > 0 then
    v_t_peso := round(v_peso * v_f / (v_rend * e.gramos), 6);   -- e.gramos = peso de UNA unidad impresa
  else
    v_t_peso := v_t_unid;
  end if;

  select coalesce(array_agg(distinct producto_id), '{}') into v_excluir
    from public.produccion_diaria_items where produccion_id = pd.id and origen = 'scan';

  if v_mueve then
    v_cons := public._produccion_consumir(pd.id, v_t_peso, v_t_unid, v_excluir, p_usuario_id);
    v_alta := public._produccion_alta(pd.id, v_unid * v_f, p_usuario_id);
    select coalesce(sum(costo_linea), 0) into v_costo from public.produccion_diaria_items where produccion_id = pd.id;
    if not (v_alta->>'alta')::boolean then v_avisos := v_avisos || to_jsonb(v_alta->>'aviso'); end if;
    if (v_cons->>'sub_sin_catalogo')::int > 0 then
      v_avisos := v_avisos || to_jsonb((v_cons->>'sub_sin_catalogo') || ' sub-receta(s) sin producto de catálogo: su consumo no se descontó.');
    end if;
  elsif not pd.es_prueba then
    v_avisos := v_avisos || to_jsonb('«' || e.nombre || '» no tiene receta vinculada: las unidades quedaron registradas pero NO se descontó inventario. Vinculá la receta en Producción → Etiquetado.');
  end if;

  if p_peso_insumo_g is not null and p_peso_insumo_g > 0 then
    v_yield := round(v_peso / p_peso_insumo_g, 4);
    v_merma := p_peso_insumo_g - v_peso;
  end if;

  update public.produccion_diaria
     set estado = case when p_auto then 'cerrada_auto' else 'cerrada' end,
         cantidad_producida = v_t_peso, tandas_equiv = v_t_peso,
         unidades_producidas = v_unid, peso_total_g = nullif(v_peso, 0),
         peso_insumo_g = p_peso_insumo_g, yield_real = v_yield, merma_real_g = v_merma,
         costo_total = v_costo, cerrada_at = now(), cerrada_por = p_usuario_id
   where id = pd.id;

  update public.ordenes_produccion set estado = 'completada', updated_at = now()
   where produccion_id = pd.id and estado not in ('cancelada', 'completada');

  select coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', i.producto_id, 'nombre', cp.nombre, 'cantidad', i.cantidad_consumida,
      'unidad', i.unidad_medida, 'costo_linea', i.costo_linea, 'es_empaque',
      exists (select 1 from public.receta_ingredientes ri where ri.receta_id = pd.receta_id
                and ri.producto_id = i.producto_id and ri.es_empaque)) order by cp.nombre), '[]'::jsonb)
    into v_consumos
    from public.produccion_diaria_items i join public.catalogo_productos cp on cp.id = i.producto_id
   where i.produccion_id = pd.id;

  return public._produccion_tanda_json(pd.id) || jsonb_build_object(
    'ya_cerrada', false, 'movio_inventario', v_mueve, 'consumos', v_consumos,
    'faltantes', v_cons->'faltantes', 'avisos', v_avisos, 'alta', v_alta,
    'tandas_peso', v_t_peso, 'tandas_unidades', v_t_unid, 'unidades_catalogo', v_unid * v_f);
end;
$$;

-- ── C. Backflush de UNA impresión (idempotente por impresion_id) ──────────
create or replace function public._etiqueta_backflush(p_impresion_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  imp record; e record; rc record;
  v_id uuid; v_receta_id uuid; v_cat uuid; v_notas text; v_lote text; v_turno text;
  v_n int; v_g_unidad numeric; v_i int; v_cierre jsonb; v_est boolean := false;
begin
  select * into imp from public.etiqueta_impresiones where id = p_impresion_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'impresión no existe'); end if;

  -- ya procesada (reintento, buzón, cron)
  select id into v_id from public.produccion_diaria where impresion_id = imp.id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'repetida', true, 'produccion_id', v_id);
  end if;

  -- la tablet guarda la CLAVE del producto en producto_id (a veces el uuid)
  select * into e from public.etiquetado_productos p
   where p.clave = imp.producto_id or p.id::text = imp.producto_id
   order by (p.clave = imp.producto_id) desc limit 1;
  if not found then
    insert into public.produccion_backflush_errores (impresion_id, error, detalle)
    values (imp.id, 'Producto de etiquetado no encontrado', jsonb_build_object('producto_id', imp.producto_id, 'producto', imp.producto));
    return jsonb_build_object('ok', false, 'error', 'producto no encontrado');
  end if;

  if e.receta_id is not null then
    select * into rc from public.recetas where id = e.receta_id;
    if found and rc.activo and rc.catalogo_id is not null then
      v_receta_id := rc.id; v_cat := rc.catalogo_id;
    else
      v_notas := 'Receta ' || coalesce(rc.nombre, '?') || ' inactiva o sin producto: la tanda no descuenta inventario';
    end if;
  else
    v_notas := 'Producto sin receta: la tanda no descuenta inventario';
  end if;
  v_notas := concat_ws(' · ', 'Tablet', 'lote ' || imp.lote, 'impresión ' || left(imp.id::text, 8), v_notas);

  v_n := greatest(coalesce(imp.unidades, 1), 1);
  if imp.gramos is not null and imp.gramos > 0 then
    v_g_unidad := round(imp.gramos / v_n, 1);           -- la tablet manda la suma neta de las unidades impresas
  elsif coalesce(e.gramos, 0) > 0 then
    v_g_unidad := e.gramos; v_est := true;                -- impresión vieja sin gramos: peso objetivo
    v_notas := v_notas || ' · peso estimado (objetivo)';
  else
    v_g_unidad := null;
  end if;

  v_turno := case when extract(hour from coalesce(imp.impreso_at, now()) at time zone 'America/El_Salvador')::int < 13 then 'mañana' else 'tarde' end;
  v_lote := public._produccion_lote(imp.fecha, false);

  insert into public.produccion_diaria
    (fecha, receta_id, producto_id, etiquetado_id, cantidad_producida, cantidad_enviada, turno, lote,
     responsable_id, created_by, created_by_id, estado, origen, modo_consumo, base_consumo,
     es_prueba, cantidad_planificada, abierta_at, dispositivo, client_key, notas, impresion_id, prep_lote)
  values
    (imp.fecha, v_receta_id, v_cat, e.id, 0, 0, v_turno, v_lote,
     imp.usuario_id, coalesce(imp.usuario_nombre, 'Tablet etiquetado'), imp.usuario_id,
     'abierta', 'estacion', 'backflush',
     case when e.requiere_peso and coalesce(e.gramos, 0) > 0 and v_g_unidad is not null and not v_est then 'peso' else 'unidades' end,
     false, v_n, coalesce(imp.impreso_at, now()), 'tablet', imp.id, v_notas, imp.id, imp.lote)
  returning id into v_id;

  for v_i in 1..v_n loop
    if v_g_unidad is null then
      -- sin peso de ningún lado: se registra la unidad igual (consumo por unidades)
      insert into public.produccion_unidades (produccion_id, numero, gramos, pesado_por_id, pesado_por, client_key,
        etiqueta, codigo_corto)
      values (v_id, v_i, null, imp.usuario_id, imp.usuario_nombre, md5(imp.id::text || '-' || v_i)::uuid,
        jsonb_build_object('producto', e.nombre, 'lote', v_lote, 'numero', v_i, 'quien', imp.usuario_nombre, 'origen', 'tablet'),
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
    else
      perform public.produccion_unidad_registrar(v_id, v_g_unidad, md5(imp.id::text || '-' || v_i)::uuid,
        imp.usuario_id, imp.usuario_nombre, null, null);
    end if;
  end loop;

  v_cierre := public.produccion_tanda_cerrar(v_id, imp.usuario_id, null, true);
  return jsonb_build_object('ok', true, 'produccion_id', v_id, 'lote', v_lote,
    'movio_inventario', v_cierre->'movio_inventario', 'consumos', v_cierre->'consumos',
    'alta', v_cierre->'alta', 'faltantes', v_cierre->'faltantes', 'avisos', v_cierre->'avisos');
exception when others then
  insert into public.produccion_backflush_errores (impresion_id, error, detalle)
  values (p_impresion_id, sqlerrm, jsonb_build_object('sqlstate', sqlstate, 'producto_id', imp.producto_id));
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public._etiqueta_backflush(uuid) from public, anon, authenticated;

-- ── D. La tablet: misma función, mismo retorno (+ 'kardex') ──────────────
-- Copia exacta de la v3 de Cesar (20261004_prep_endurecer.sql) + la llamada
-- al backflush protegida: si algo falla, la impresión se registra igual.
create or replace function public.fn_etiqueta_registrar_v3(p_usuario uuid, p_lote_id uuid, p_producto_id text, p_producto text,
                                                           p_unidades int default 1, p_gramos numeric default null, p_clave text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_lote record; v_prev record; v_nuevo jsonb;
  v_redir boolean := false; v_filas int := 0;
  v_imp uuid; v_kardex jsonb;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  perform pg_advisory_xact_lock(hashtext('prep_imp_' || p_usuario::text));
  if p_clave is not null then
    select e.lote_id, e.lote into v_prev from public.etiqueta_impresiones e where e.clave_idem = p_clave limit 1;
    if found then
      return jsonb_build_object('duplicada', true, 'con_insumos', false, 'deuda_nueva', false, 'lote_id', v_prev.lote_id, 'lote', v_prev.lote);
    end if;
  end if;
  select * into v_lote from public.prep_lotes where id = p_lote_id;
  if not found or v_lote.estado = 'cerrado' then
    v_nuevo := public.fn_prep_lote_del_dia(p_usuario);
    select * into v_lote from public.prep_lotes where id = (v_nuevo->>'id')::uuid;
    v_redir := true;
  end if;
  insert into public.etiqueta_impresiones(lote_id, lote, fecha, producto_id, producto, unidades, usuario_id, usuario_nombre, con_insumos, gramos, clave_idem)
  values (v_lote.id, v_lote.lote, v_lote.fecha, p_producto_id, p_producto, greatest(coalesce(p_unidades,1),1), p_usuario, n, false, p_gramos, p_clave)
  returning id into v_imp;
  insert into public.prep_deudas(lote_id, lote, fecha, usuario_id, usuario_nombre) values (v_lote.id, v_lote.lote, v_lote.fecha, p_usuario, n)
  on conflict (lote_id, usuario_id) where estado = 'abierta' do nothing;
  get diagnostics v_filas = row_count;
  if v_filas > 0 then
    insert into public.prep_bitacora(accion, actor_id, actor, detalle) values ('deuda_abierta', p_usuario, n, jsonb_build_object('lote', v_lote.lote, 'producto', p_producto, 'redirigida', v_redir));
  end if;

  -- 11-nov-2026: kardex por receta en cada impresión. Nunca frena la impresión.
  begin
    v_kardex := public._etiqueta_backflush(v_imp);
  exception when others then
    v_kardex := jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object('con_insumos', false, 'deuda_nueva', v_filas > 0, 'redirigida', v_redir, 'lote_id', v_lote.id, 'lote', v_lote.lote,
                            'kardex', v_kardex);
end $function$;

-- ── E. Reintento (buzón, errores, impresiones que entraron por otro camino) ─
-- Solo desde la FECHA DE CORTE (11-nov-2026, día en que se encendió el
-- backflush): no se rellena hacia atrás; eso se decide con el conteo físico.
create or replace function public.produccion_backflush_reintentar(p_desde date default null, p_max int default 500)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare r record; v_ok int := 0; v_err int := 0; v_res jsonb;
        v_corte date := '2026-11-11';
        v_desde date := greatest(coalesce(p_desde, public._produccion_fecha_sv() - 2), v_corte);
begin
  for r in
    select i.id from public.etiqueta_impresiones i
     where i.fecha >= v_desde
       and not exists (select 1 from public.produccion_diaria p where p.impresion_id = i.id)
     order by i.impreso_at nulls last, i.id
     limit p_max
  loop
    v_res := public._etiqueta_backflush(r.id);
    if (v_res->>'ok')::boolean then v_ok := v_ok + 1; else v_err := v_err + 1; end if;
  end loop;
  update public.produccion_backflush_errores x set resuelto = true
   where not resuelto and exists (select 1 from public.produccion_diaria p where p.impresion_id = x.impresion_id);
  return jsonb_build_object('desde', v_desde, 'procesadas', v_ok, 'con_error', v_err);
end;
$$;
revoke all on function public.produccion_backflush_reintentar(date, int) from public, anon, authenticated;

select cron.schedule('produccion-backflush-reintento', '*/30 * * * *',
  $$select public.produccion_backflush_reintentar()$$);

-- ── F. Vincular receta con unidades_catalogo (firma vieja → _obsoleta_) ──
alter function public.fn_etiquetado_vincular_receta(uuid, uuid, boolean, text, uuid) rename to _obsoleta_fn_etiquetado_vincular_receta;

create or replace function public.fn_etiquetado_vincular_receta(
  p_id uuid, p_receta_id uuid, p_requiere_peso boolean default true,
  p_vida_util_estado text default 'provisional', p_usuario_id uuid default null,
  p_unidades_catalogo numeric default 1)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_cat uuid; v_antes jsonb; v_nombre text;
begin
  select to_jsonb(e) into v_antes from public.etiquetado_productos e where e.id = p_id;
  if v_antes is null then raise exception 'El producto no existe'; end if;
  if p_receta_id is not null then
    select catalogo_id into v_cat from public.recetas where id = p_receta_id;
    if not found then raise exception 'La receta no existe'; end if;
    if v_cat is null then raise exception 'Esa receta no tiene producto de catálogo: no puede dar de alta nada'; end if;
  end if;
  if coalesce(p_unidades_catalogo, 0) <= 0 then raise exception 'Unidades de catálogo por unidad impresa debe ser mayor que 0'; end if;
  select btrim(nombre || ' ' || coalesce(apellido, '')) into v_nombre from public.usuarios_erp where id = p_usuario_id;
  update public.etiquetado_productos
     set receta_id = p_receta_id, producto_id = v_cat, requiere_peso = coalesce(p_requiere_peso, true),
         vida_util_estado = coalesce(p_vida_util_estado, 'provisional'),
         unidades_catalogo = coalesce(p_unidades_catalogo, 1),
         editado_nombre = coalesce(v_nombre, editado_nombre), updated_at = now()
   where id = p_id;
  insert into public.etiquetado_productos_bitacora (producto_id, clave, accion, antes, despues, actor_id, actor_nombre)
  select e.id, e.clave, 'vinculo_receta', v_antes, to_jsonb(e), p_usuario_id, coalesce(v_nombre, 'ERP')
    from public.etiquetado_productos e where e.id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.fn_etiquetado_vincular_receta(uuid, uuid, boolean, text, uuid, numeric) to anon, authenticated;

-- ── G. Recetas: las que ya estaban trabajadas, replicadas para que el cierre cuadre ──
-- G1. Queso frito: la "cáscara vacía" (porcionado) se vuelve la receta de la
--     estación: 1 bolsita de 0.30 lb ← 0.3 lb de Queso para dorar (misma línea
--     que la receta Queso Frito del menú y que el catálogo de la estación).
--     Da de alta «Queso para dorar bolsita 0.30 lb», que es lo que CM despacha
--     (2,901 bolsitas oct-nov; stock CM −5,203).
update public.recetas
   set activo = true, catalogo_id = '60ea83c3-ce3b-40c0-9fd2-6a5ddd7a230c', rendimiento = 1, unidad_rendimiento = 'bolsita',
       notas = coalesce(notas, '') || ' [11-nov] Receta de la estación de etiquetado: 1 bolsita 0.30 lb ← 0.3 lb queso para dorar (igual que Queso Frito del menú).'
 where id = '095aac30-fa05-49ee-9424-603cb870a083';
insert into public.receta_ingredientes (receta_id, producto_id, tipo_ingrediente, cantidad, unidad_medida, merma_pct, es_empaque, removible, poco_comun)
select '095aac30-fa05-49ee-9424-603cb870a083', '287ba92f-8335-4a83-b2a6-686b22895261', 'materia_prima', 0.3, 'lb', 0, false, false, false
 where not exists (select 1 from public.receta_ingredientes where receta_id = '095aac30-fa05-49ee-9424-603cb870a083');

-- G2. Carne: bolsa de 6 bolitas de la receta Mezcla de Carne Smash (rinde 667
--     bolitas). La línea de bolsas de vacío decía 33.35 por tanda (bolsas de
--     20 bolitas, presentación vieja): con bolsas de 6 son 667/6 = 111.17.
update public.receta_ingredientes set cantidad = 111.17
 where id = '6c7afe41-dfa2-40ce-8014-bf7c4c0a62e5' and cantidad = 33.35;

-- G3. Mermelada de Tocino: la receta (misma lista de insumos) pasa a rendir en
--     BOLSAS, que es lo que CM despacha (239 bolsas oct-nov; stock −116) y lo
--     que las sucursales cuentan: 12 bolsas por tanda (= las 12 bolsas de vacío
--     8x12 de la receta; en la estación salen 1.06 bolsas por unidad impresa,
--     ~723 g c/u). Antes rendía «4 tanda» de un producto intermedio que las
--     sucursales no tienen. Las 5 consumidoras pasan de tanda a bolsa:
--     1 tanda = 3 bolsas → 0.014337 × 3 = 0.043011 bolsa por oz (23.25 oz/bolsa,
--     coherente con los 723 g medidos). La equivalencia tanda→bolsa se apaga.
update public.recetas
   set catalogo_id = 'd4627645-fa6e-48a6-b7de-865d34f280c4', rendimiento = 12, unidad_rendimiento = 'bolsa',
       notas = coalesce(notas, '') || ' [11-nov] Rinde 12 bolsas (antes 4 "tanda"); da de alta Mermelada bolsa. Mismos insumos.'
 where id = '93347334-ef6f-45a3-adb4-0e34eb12ea4b';
update public.receta_ingredientes set factor_a_stock = 0.043011
 where sub_receta_id = '93347334-ef6f-45a3-adb4-0e34eb12ea4b' and factor_a_stock = 0.014337;
update public.inventario_equivalencias set activo = false, updated_at = now(),
       nota = coalesce(nota, '') || ' [11-nov] Apagada: la receta ya rinde bolsas.'
 where producto_origen = '6399f9e9-1f0e-4215-a7dc-08fcfc9464fd' and producto_destino = 'd4627645-fa6e-48a6-b7de-865d34f280c4';

-- G4. Salsa Truffa: el rendimiento estaba invertido (0.2125 = 1/4.7). Una
--     preparación (1 bote de mayo + 62.5 ml aceite + 3 cdas Dijon + limón) da
--     ~4.7 bolsas de 2 lb (consumidoras ya asumen bolsa de 32 oz; medido en
--     la estación: 910 g por bolsa). Mayo y Dijon sin factor contra stock en oz:
--     bote de mayo = galón = 128 oz; 1 cucharada ≈ 0.5 oz.
update public.recetas set rendimiento = 4.7, unidad_rendimiento = 'bolsa',
       notas = coalesce(notas, '') || ' [11-nov] Rendimiento 4.7 bolsas (antes 0.2125, invertido). Factores mayo 128 oz/bote y Dijon 0.5 oz/cda.'
 where id = 'f30c5efb-a459-4834-bedc-ebf5f913a07e';
update public.receta_ingredientes set factor_a_stock = 128 where id = '76663818-55b4-4dcd-bb35-8ecfeb2e15e4' and factor_a_stock is null;
update public.receta_ingredientes set factor_a_stock = 0.5 where id = 'f37a0682-0dda-47ab-a057-116814b75750' and factor_a_stock is null;

-- G5. Pepinillos: en la estación se declaró siempre «1 pepinillos por bote»;
--     en el ERP «228941 Pepinillos» se compra y se guarda en oz (stock CM
--     17,500 oz). Se consume por PESO real del bote (1 oz = 28.35 g): rebanado
--     ~1,469 g = 51.8 oz; triturado objetivo 1,900 g = 67 oz. Dan de alta los
--     botes que CM despacha (Pepinillo para burguer bote −857; triturado −277).
update public.recetas set activo = true, catalogo_id = 'f9981d1e-1c1f-49db-b4e1-5849cbedbe0e', rendimiento = 1, unidad_rendimiento = 'bote',
       notas = coalesce(notas, '') || ' [11-nov] Receta de la estación: 1 bote (~1,469 g) ← 51.8 oz de 228941 Pepinillos, por peso real.'
 where id = 'a775d7f6-5c72-4159-811f-0b61a764e754';
insert into public.receta_ingredientes (receta_id, producto_id, tipo_ingrediente, cantidad, unidad_medida, merma_pct, es_empaque, removible, poco_comun)
select 'a775d7f6-5c72-4159-811f-0b61a764e754', '6b97ab93-966d-49c6-afaa-ead21d1c9b80', 'materia_prima', 51.8, 'oz', 0, false, false, false
 where not exists (select 1 from public.receta_ingredientes where receta_id = 'a775d7f6-5c72-4159-811f-0b61a764e754');
update public.recetas set activo = true, rendimiento = 1, unidad_rendimiento = 'bote',
       notas = coalesce(notas, '') || ' [11-nov] Receta de la estación: 1 bote (1,900 g) ← 67 oz de 228941 Pepinillos, por peso real.'
 where id = '7583e9e6-52b8-4f9c-ae19-ebad9a597500';
insert into public.receta_ingredientes (receta_id, producto_id, tipo_ingrediente, cantidad, unidad_medida, merma_pct, es_empaque, removible, poco_comun)
select '7583e9e6-52b8-4f9c-ae19-ebad9a597500', '6b97ab93-966d-49c6-afaa-ead21d1c9b80', 'materia_prima', 67, 'oz', 0, false, false, false
 where not exists (select 1 from public.receta_ingredientes where receta_id = '7583e9e6-52b8-4f9c-ae19-ebad9a597500');

-- G6. Pesos objetivo mal cargados en la tablet (Cesar 10-oct: «parecen lb o kg»).
--     Medidos en 538 y 35 impresiones: rebanado 1,469 g, jalapeño 3,099 g.
update public.etiquetado_productos set gramos = 1469, banda = 150, updated_at = now(), editado_nombre = 'ERP (11-nov, medido)'
 where clave = 'pepinillorebanad' and gramos < 10;
update public.etiquetado_productos set gramos = 3099, banda = 300, updated_at = now(), editado_nombre = 'ERP (11-nov, medido)'
 where clave = 'botedejalapeno' and gramos < 10;

-- G7. Vínculos estación → receta
update public.etiquetado_productos e set receta_id = r.id, producto_id = r.catalogo_id, requiere_peso = true, unidades_catalogo = v.f, updated_at = now()
  from (values
    ('quesofrito',       '095aac30-fa05-49ee-9424-603cb870a083'::uuid, 1::numeric),
    ('carne',            'b8bce72b-4aea-447f-b07a-3f748f9e92e1', 6),
    ('mermelada',        '93347334-ef6f-45a3-adb4-0e34eb12ea4b', 1),
    ('truffa',           'f30c5efb-a459-4834-bedc-ebf5f913a07e', 1),
    ('pepinillorebanad', 'a775d7f6-5c72-4159-811f-0b61a764e754', 1),
    ('pepinillotritura', '7583e9e6-52b8-4f9c-ae19-ebad9a597500', 1)
  ) as v(clave, receta_id, f)
  join public.recetas r on r.id = v.receta_id
 where e.clave = v.clave;

-- Sin vincular (decisión pendiente, ver memoria 11-nov): condimentopara10 (la
-- Mezcla ya descuenta las especias: vincularlo las descontaría dos veces) y
-- botedejalapeno (no hay producto de catálogo activo para la lata de entrada).
