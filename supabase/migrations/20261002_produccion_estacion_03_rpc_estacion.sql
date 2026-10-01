-- ═══════════════════════════════════════════════════════════════════════
-- Estación de pesaje y etiquetado → kardex · M3: los RPC de la estación
-- docs/PLAN-ESTACION-ETIQUETADO-ERP.md §2 (M3)
--
-- Todo lo que escribe la tablet pasa por acá (SECURITY DEFINER). Cada RPC que
-- escribe recibe p_client_key: la tablet lo genera ANTES de mandar y lo reusa
-- al reintentar; si llega repetido se devuelve lo ya hecho en vez de duplicar.
--
-- Ciclo: abrir → N × unidad_registrar (+ impresa) → cerrar.
--   abrir     crea la produccion_diaria en 'abierta' con lote de servidor.
--   unidad    una fila por bolsa (peso, vence, QR). No toca kardex.
--   cerrar    consume por backflush (materias por PESO real, empaques por
--             UNIDADES) y da de alta N unidades, en una transacción.
--   anular    unidad (antes/después del cierre) o tanda entera (reversa kardex).
--   vigilante pg_cron 23:30 SV: cierra las abandonadas con unidades, anula las vacías.
-- Fase 2 (pistola) agrega produccion_pick_* sin tocar lo de acá: cerrar ya
-- salta los productos con items origen='scan'.
-- ═══════════════════════════════════════════════════════════════════════

-- ── helpers ────────────────────────────────────────────────────────────
create or replace function public._produccion_fecha_sv()
returns date language sql stable as $$ select (now() at time zone 'America/El_Salvador')::date $$;

create or replace function public._produccion_fecha_txt(p date)
returns text language sql immutable as $$
  select lpad(extract(day from p)::int::text, 2, '0') || '-' ||
         (array['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])[extract(month from p)::int]
         || '-' || extract(year from p)::int
$$;

-- El payload de una tanda para la tablet (se usa en abrir, abierta y cerrar).
create or replace function public._produccion_tanda_json(p_id uuid)
returns jsonb
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'produccion_id', pd.id, 'lote', pd.lote, 'estado', pd.estado, 'es_prueba', pd.es_prueba,
    'fecha', pd.fecha, 'abierta_at', pd.abierta_at, 'cerrada_at', pd.cerrada_at,
    'producto_id', pd.producto_id, 'producto', cp.nombre, 'unidad', cp.unidad_medida,
    'receta_id', pd.receta_id, 'receta', r.nombre, 'rendimiento', r.rendimiento,
    'base_consumo', pd.base_consumo, 'cantidad_planificada', pd.cantidad_planificada,
    'responsable_id', pd.responsable_id, 'dispositivo', pd.dispositivo,
    'nombre_etiqueta', pe.nombre_etiqueta, 'requiere_peso', pe.requiere_peso,
    'peso_nominal_g', pe.peso_nominal_g, 'banda_g', pe.banda_g, 'tara_g', pe.tara_g,
    'vida_util_dias', pe.vida_util_dias, 'vida_util_estado', pe.vida_util_estado,
    'conservacion', pe.conservacion,
    'unidades_producidas', pd.unidades_producidas, 'peso_total_g', pd.peso_total_g,
    'tandas_equiv', pd.tandas_equiv, 'costo_total', pd.costo_total,
    'orden_id', (select o.id from public.ordenes_produccion o where o.produccion_id = pd.id limit 1),
    'unidades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unidad_id', u.id, 'numero', u.numero, 'gramos', u.gramos, 'fuera_banda', u.fuera_banda,
        'vence', u.vence, 'impresa', u.impresa, 'impresiones', u.impresiones, 'estado', u.estado,
        'pesado_por', u.pesado_por, 'created_at', u.created_at, 'etiqueta', u.etiqueta,
        'codigo_corto', u.codigo_corto) order by u.numero)
      from public.produccion_unidades u where u.produccion_id = pd.id), '[]'::jsonb)
  )
  from public.produccion_diaria pd
  join public.recetas r on r.id = pd.receta_id
  left join public.catalogo_productos cp on cp.id = pd.producto_id
  left join public.produccion_etiquetado_productos pe on pe.producto_id = pd.producto_id
  where pd.id = p_id
$$;

-- ── abrir ──────────────────────────────────────────────────────────────
create or replace function public.produccion_tanda_abrir(
  p_producto_id uuid, p_cantidad_planificada numeric, p_responsable_id uuid,
  p_client_key uuid, p_dispositivo text default null, p_bascula_codigo text default null,
  p_es_prueba boolean default false, p_orden_id uuid default null,
  p_usuario_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid; pe record; v_receta record; v_fecha date := public._produccion_fecha_sv();
  v_lote text; v_turno text; v_hora int;
begin
  if p_client_key is null then raise exception 'p_client_key es obligatorio'; end if;
  select id into v_id from public.produccion_diaria where client_key = p_client_key;
  if v_id is not null then return public._produccion_tanda_json(v_id); end if;   -- reintento

  select * into pe from public.produccion_etiquetado_productos where producto_id = p_producto_id and activo;
  if not found then raise exception 'Ese producto no está configurado para la estación de etiquetado'; end if;
  select * into v_receta from public.recetas where id = pe.receta_id;
  if not found or not v_receta.activo then raise exception 'La receta de % está inactiva', pe.nombre_etiqueta; end if;
  if v_receta.catalogo_id is distinct from p_producto_id then
    raise exception 'La receta % no produce el producto configurado (catalogo_id distinto)', v_receta.nombre;
  end if;
  if coalesce(p_cantidad_planificada, 0) <= 0 then raise exception 'Indicá cuántas unidades vas a pesar'; end if;
  if pe.requiere_peso and coalesce(pe.peso_nominal_g, 0) <= 0 and not p_es_prueba then
    raise exception '% no tiene peso nominal cargado: pesá una tanda en modo prueba y cargalo en Producción → Etiquetado', pe.nombre_etiqueta;
  end if;

  if p_orden_id is not null then
    perform 1 from public.ordenes_produccion o
     where o.id = p_orden_id and o.receta_id = pe.receta_id
       and o.estado in ('aprobada','asignada') and o.produccion_id is null
     for update;
    if not found then raise exception 'La orden de producción no está disponible para esta receta'; end if;
  end if;

  v_hora := extract(hour from (now() at time zone 'America/El_Salvador'))::int;
  v_turno := case when v_hora < 13 then 'mañana' else 'tarde' end;
  v_lote := public._produccion_lote(v_fecha, p_es_prueba);

  insert into public.produccion_diaria
    (fecha, receta_id, producto_id, cantidad_producida, cantidad_enviada, turno, lote,
     responsable_id, created_by, created_by_id, estado, origen, modo_consumo, base_consumo,
     es_prueba, cantidad_planificada, abierta_at, dispositivo, bascula_codigo, client_key,
     notas)
  values
    (v_fecha, pe.receta_id, p_producto_id, 0, 0, v_turno, v_lote,
     p_responsable_id, coalesce(p_usuario_nombre, 'Estación etiquetado'), p_responsable_id,
     'abierta', case when p_orden_id is null then 'estacion' else 'orden' end, 'backflush',
     case when pe.requiere_peso then 'peso' else 'unidades' end,
     p_es_prueba, p_cantidad_planificada, now(), p_dispositivo, p_bascula_codigo, p_client_key,
     case when p_es_prueba then 'TANDA DE PRUEBA: no toca inventario' else null end)
  returning id into v_id;

  if p_orden_id is not null then
    update public.ordenes_produccion set produccion_id = v_id, updated_at = now() where id = p_orden_id;
  end if;
  return public._produccion_tanda_json(v_id);
end;
$$;

-- ── unidad: registrar ──────────────────────────────────────────────────
create or replace function public.produccion_unidad_registrar(
  p_produccion_id uuid, p_gramos numeric, p_client_key uuid,
  p_pesado_por_id uuid default null, p_pesado_por text default null,
  p_bascula_codigo text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  u record; pd record; pe record; cp record;
  v_num int; v_vence date; v_fuera boolean := false; v_cod text; v_hoy date;
  v_etq jsonb; v_quien text; v_id uuid;
begin
  if p_client_key is null then raise exception 'p_client_key es obligatorio'; end if;
  select * into u from public.produccion_unidades where client_key = p_client_key;
  if found then
    return jsonb_build_object('unidad_id', u.id, 'numero', u.numero, 'etiqueta', u.etiqueta,
      'codigo_corto', u.codigo_corto, 'vence', u.vence, 'fuera_banda', u.fuera_banda, 'repetida', true);
  end if;

  select * into pd from public.produccion_diaria where id = p_produccion_id for update;
  if not found then raise exception 'La tanda no existe'; end if;
  if pd.estado <> 'abierta' then raise exception 'La tanda % ya está % — abrí una nueva', pd.lote, pd.estado; end if;
  select * into pe from public.produccion_etiquetado_productos where producto_id = pd.producto_id;
  select * into cp from public.catalogo_productos where id = pd.producto_id;
  if pe.requiere_peso and coalesce(p_gramos, 0) <= 0 then raise exception 'Falta el peso de la unidad'; end if;

  select coalesce(max(numero), 0) + 1 into v_num from public.produccion_unidades where produccion_id = pd.id;
  v_hoy := public._produccion_fecha_sv();
  v_vence := v_hoy + pe.vida_util_dias;
  if pe.requiere_peso and pe.peso_nominal_g is not null and pe.banda_g is not null then
    v_fuera := abs(p_gramos - pe.peso_nominal_g) > pe.banda_g;
  end if;
  loop
    v_cod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.produccion_unidades where codigo_corto = v_cod);
  end loop;
  v_quien := coalesce(p_pesado_por,
    (select nombre || ' ' || coalesce(apellido, '') from public.usuarios_erp where id = p_pesado_por_id), '');

  -- Lo que va impreso, congelado: reimprimir da exactamente lo mismo aunque
  -- después cambien los parámetros del producto.
  v_etq := jsonb_build_object(
    'producto', pe.nombre_etiqueta, 'lote', pd.lote, 'numero', v_num,
    'gramos', p_gramos, 'libras', case when p_gramos is null then null else round(p_gramos / 453.59237, 2) end,
    'vence', v_vence, 'vence_txt', public._produccion_fecha_txt(v_vence),
    'elaborado', v_hoy, 'elaborado_txt', public._produccion_fecha_txt(v_hoy),
    'hora', to_char(now() at time zone 'America/El_Salvador', 'HH24:MI'),
    'quien', btrim(v_quien), 'conservacion', pe.conservacion, 'es_prueba', pd.es_prueba,
    'codigo_corto', v_cod,
    'qr', 'https://freakie-dogs-caja.vercel.app/unidad.html?c=' || v_cod);

  insert into public.produccion_unidades
    (produccion_id, numero, gramos, fuera_banda, vence, pesado_por_id, pesado_por,
     bascula_codigo, etiqueta, codigo_corto, client_key)
  values (pd.id, v_num, p_gramos, v_fuera, v_vence, p_pesado_por_id, btrim(v_quien),
     coalesce(p_bascula_codigo, pd.bascula_codigo), v_etq, v_cod, p_client_key)
  returning id into v_id;

  return jsonb_build_object('unidad_id', v_id, 'numero', v_num, 'etiqueta', v_etq,
    'codigo_corto', v_cod, 'vence', v_vence, 'fuera_banda', v_fuera, 'repetida', false);
end;
$$;

create or replace function public.produccion_unidad_impresa(p_unidad_id uuid, p_ok boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.produccion_unidades
     set impresa = impresa or p_ok, impresiones = impresiones + case when p_ok then 1 else 0 end
   where id = p_unidad_id;
  if not found then raise exception 'La unidad no existe'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── unidad: anular ─────────────────────────────────────────────────────
-- Antes del cierre solo se marca (no hubo kardex). Después del cierre la bolsa
-- ya está dada de alta: sale como merma (se rompió, se tiró) o como ajuste
-- (error de registro), con motivo. Nunca se borra la fila.
create or replace function public.produccion_unidad_anular(
  p_unidad_id uuid, p_motivo text, p_usuario_id uuid default null, p_tipo text default 'merma')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  u record; pd record; v_cm uuid := '584aee3c-a842-496f-9f2b-1e3bac6e6b23';
begin
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Decí por qué se anula (mínimo 5 caracteres)'; end if;
  if p_tipo not in ('merma', 'ajuste_manual') then raise exception 'p_tipo debe ser merma o ajuste_manual'; end if;
  select * into u from public.produccion_unidades where id = p_unidad_id for update;
  if not found then raise exception 'La unidad no existe'; end if;
  if u.estado = 'anulada' then return jsonb_build_object('ok', true, 'ya_estaba', true); end if;
  select * into pd from public.produccion_diaria where id = u.produccion_id for update;

  update public.produccion_unidades
     set estado = 'anulada', anulada_motivo = btrim(p_motivo), anulada_por = p_usuario_id, anulada_at = now()
   where id = p_unidad_id;

  if pd.estado in ('cerrada', 'cerrada_auto') and not pd.es_prueba then
    if p_tipo = 'ajuste_manual' and p_usuario_id is null then
      raise exception 'Anular por error de registro requiere usuario';
    end if;
    perform public.kardex_mover(pd.producto_id, v_cm, p_tipo, -1, 'produccion_unidad', u.id,
      'Unidad #' || u.numero || ' del lote ' || pd.lote || ' anulada: ' || btrim(p_motivo), p_usuario_id, true);
    update public.produccion_diaria
       set unidades_producidas = coalesce(unidades_producidas, 0) - 1,
           peso_total_g = coalesce(peso_total_g, 0) - coalesce(u.gramos, 0)
     where id = pd.id;
  end if;
  return jsonb_build_object('ok', true, 'kardex', pd.estado in ('cerrada', 'cerrada_auto') and not pd.es_prueba);
end;
$$;

-- ── cerrar ─────────────────────────────────────────────────────────────
create or replace function public.produccion_tanda_cerrar(
  p_produccion_id uuid, p_usuario_id uuid default null, p_peso_insumo_g numeric default null,
  p_auto boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pd record; pe record;
  v_unid numeric; v_peso numeric; v_rend numeric;
  v_t_unid numeric; v_t_peso numeric; v_excluir uuid[];
  v_cons jsonb := jsonb_build_object('consumidos', 0, 'sub_sin_catalogo', 0, 'faltantes', '[]'::jsonb);
  v_alta jsonb := jsonb_build_object('alta', false);
  v_costo numeric := 0; v_yield numeric; v_merma numeric; v_avisos jsonb := '[]'::jsonb;
  v_consumos jsonb;
begin
  select * into pd from public.produccion_diaria where id = p_produccion_id for update;
  if not found then raise exception 'La tanda no existe'; end if;
  if pd.estado in ('cerrada', 'cerrada_auto') then
    return public._produccion_tanda_json(pd.id) || jsonb_build_object('ya_cerrada', true);   -- reintento
  end if;
  if pd.estado = 'anulada' then raise exception 'La tanda % está anulada', pd.lote; end if;

  select count(*), coalesce(sum(gramos), 0) into v_unid, v_peso
    from public.produccion_unidades where produccion_id = pd.id and estado = 'activa';
  if v_unid = 0 then raise exception 'La tanda % no tiene unidades: anulala en vez de cerrarla', pd.lote; end if;

  select * into pe from public.produccion_etiquetado_productos where producto_id = pd.producto_id;
  select coalesce(nullif(rc.rendimiento, 0), 1) into v_rend from public.recetas rc where rc.id = pd.receta_id;

  -- Dos bases: empaques por unidades reales; materias por el peso real producido.
  v_t_unid := round(v_unid / v_rend, 6);
  if pd.base_consumo = 'peso' and coalesce(pe.peso_nominal_g, 0) > 0 and v_peso > 0 then
    v_t_peso := round(v_peso / (v_rend * pe.peso_nominal_g), 6);
  else
    v_t_peso := v_t_unid;
  end if;

  -- Fase 2: lo que ya se descontó por escaneo no se vuelve a descontar.
  select coalesce(array_agg(distinct producto_id), '{}') into v_excluir
    from public.produccion_diaria_items where produccion_id = pd.id and origen = 'scan';

  if not pd.es_prueba then
    v_cons := public._produccion_consumir(pd.id, v_t_peso, v_t_unid, v_excluir, p_usuario_id);
    v_alta := public._produccion_alta(pd.id, v_unid, p_usuario_id);
    select coalesce(sum(costo_linea), 0) into v_costo from public.produccion_diaria_items where produccion_id = pd.id;
    if not (v_alta->>'alta')::boolean then v_avisos := v_avisos || to_jsonb(v_alta->>'aviso'); end if;
    if (v_cons->>'sub_sin_catalogo')::int > 0 then
      v_avisos := v_avisos || to_jsonb((v_cons->>'sub_sin_catalogo') || ' sub-receta(s) sin producto de catálogo: su consumo no se descontó.');
    end if;
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
    'ya_cerrada', false, 'consumos', v_consumos, 'faltantes', v_cons->'faltantes',
    'avisos', v_avisos, 'alta', v_alta, 'tandas_peso', v_t_peso, 'tandas_unidades', v_t_unid);
end;
$$;

-- ── anular tanda ───────────────────────────────────────────────────────
create or replace function public.produccion_tanda_anular(
  p_produccion_id uuid, p_motivo text, p_usuario_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare pd record; m record; v_rev int := 0;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Decí por qué se anula (mínimo 5 caracteres)'; end if;
  select * into pd from public.produccion_diaria where id = p_produccion_id for update;
  if not found then raise exception 'La tanda no existe'; end if;
  if pd.estado = 'anulada' then return jsonb_build_object('ok', true, 'ya_estaba', true); end if;

  if pd.estado in ('cerrada', 'cerrada_auto') and not pd.es_prueba then
    if p_usuario_id is null then raise exception 'Anular una tanda cerrada requiere usuario'; end if;
    -- Reversa movimiento por movimiento, con signo contrario y referencia propia:
    -- el kardex queda contando la historia completa, no se borra nada.
    for m in select * from public.kardex_movimientos
              where referencia_tipo = 'produccion' and referencia_id = pd.id loop
      perform public.kardex_mover(m.producto_id, m.sucursal_id, m.tipo, -m.cantidad,
        'produccion_anulacion', pd.id, 'Anulación ' || pd.lote || ': ' || btrim(p_motivo), p_usuario_id, true);
      v_rev := v_rev + 1;
    end loop;
  end if;

  update public.produccion_unidades
     set estado = 'anulada', anulada_motivo = coalesce(anulada_motivo, 'Tanda anulada: ' || btrim(p_motivo)),
         anulada_por = coalesce(anulada_por, p_usuario_id), anulada_at = coalesce(anulada_at, now())
   where produccion_id = pd.id and estado = 'activa';
  update public.produccion_diaria
     set estado = 'anulada', notas = coalesce(notas || ' · ', '') || 'ANULADA: ' || btrim(p_motivo),
         cerrada_at = coalesce(cerrada_at, now()), cerrada_por = coalesce(cerrada_por, p_usuario_id)
   where id = pd.id;
  update public.ordenes_produccion set produccion_id = null, estado = 'asignada', updated_at = now()
   where produccion_id = pd.id and estado = 'completada';
  return jsonb_build_object('ok', true, 'movimientos_revertidos', v_rev);
end;
$$;

-- ── retomar: la tanda abierta de esta tablet ───────────────────────────
create or replace function public.produccion_tanda_abierta(p_dispositivo text default null)
returns jsonb
language sql stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public._produccion_tanda_json(id)
    from public.produccion_diaria
   where estado = 'abierta' and (p_dispositivo is null or dispositivo = p_dispositivo)
   order by abierta_at desc limit 1
$$;

create or replace function public.produccion_tanda_ver(p_produccion_id uuid)
returns jsonb
language sql stable
security definer
set search_path to 'public', 'pg_temp'
as $$ select public._produccion_tanda_json(p_produccion_id) $$;

-- ── vigilante (pg_cron, 23:30 SV = 05:30 UTC) ──────────────────────────
create or replace function public.produccion_tandas_vigilante()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare pd record; v_cerradas int := 0; v_anuladas int := 0; v_err jsonb := '[]'::jsonb;
begin
  for pd in
    select p.id, p.lote,
           (select count(*) from public.produccion_unidades u where u.produccion_id = p.id and u.estado = 'activa') n,
           greatest(p.abierta_at, (select max(created_at) from public.produccion_unidades u where u.produccion_id = p.id)) ultima
      from public.produccion_diaria p where p.estado = 'abierta'
  loop
    if pd.ultima > now() - interval '90 minutes' then continue; end if;   -- alguien sigue trabajando
    begin
      if pd.n > 0 then
        perform public.produccion_tanda_cerrar(pd.id, null, null, true);
        v_cerradas := v_cerradas + 1;
      else
        perform public.produccion_tanda_anular(pd.id, 'Abandonada sin unidades (cierre automático)', null);
        v_anuladas := v_anuladas + 1;
      end if;
    exception when others then
      v_err := v_err || jsonb_build_object('lote', pd.lote, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('cerradas', v_cerradas, 'anuladas', v_anuladas, 'errores', v_err);
end;
$$;

select cron.schedule('produccion-tandas-vigilante', '30 5 * * *', $cron$select public.produccion_tandas_vigilante()$cron$);

-- ── lecturas para la tablet y el ERP ───────────────────────────────────
-- Operarios de Casa Matriz, sin exponer la tabla usuarios_erp (tiene el PIN).
create or replace function public.produccion_estacion_operarios()
returns table (id uuid, nombre text)
language sql stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select id, btrim(nombre || ' ' || coalesce(apellido, ''))
    from public.usuarios_erp
   where store_code = 'CM001' and es_productor and activo
   order by nombre, apellido
$$;

-- La ficha pública de una unidad (lo que abre el QR).
create or replace function public.produccion_unidad_ficha(p_codigo text)
returns jsonb
language sql stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'codigo', u.codigo_corto, 'numero', u.numero, 'estado', u.estado, 'gramos', u.gramos,
    'vence', u.vence, 'etiqueta', u.etiqueta, 'impresa', u.impresa, 'created_at', u.created_at,
    'lote', pd.lote, 'tanda_estado', pd.estado, 'es_prueba', pd.es_prueba, 'fecha', pd.fecha,
    'producto', cp.nombre, 'receta', r.nombre, 'unidades_lote', pd.unidades_producidas,
    'anulada_motivo', u.anulada_motivo)
  from public.produccion_unidades u
  join public.produccion_diaria pd on pd.id = u.produccion_id
  join public.recetas r on r.id = pd.receta_id
  left join public.catalogo_productos cp on cp.id = pd.producto_id
  where u.codigo_corto = upper(btrim(p_codigo))
$$;

-- Parámetros de etiquetado: alta/edición desde Producción → Etiquetado.
create or replace function public.produccion_etiquetado_guardar(p jsonb, p_usuario_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_prod uuid := (p->>'producto_id')::uuid; v_rec uuid := (p->>'receta_id')::uuid; v_cat uuid;
begin
  if v_prod is null or v_rec is null then raise exception 'producto_id y receta_id son obligatorios'; end if;
  select catalogo_id into v_cat from public.recetas where id = v_rec;
  if v_cat is distinct from v_prod then raise exception 'La receta elegida no produce ese producto (catalogo_id distinto)'; end if;
  insert into public.produccion_etiquetado_productos as pe
    (producto_id, receta_id, nombre_etiqueta, requiere_peso, peso_nominal_g, banda_g, tara_g,
     vida_util_dias, vida_util_estado, conservacion, orden, activo, updated_by, updated_at)
  values
    (v_prod, v_rec, p->>'nombre_etiqueta', coalesce((p->>'requiere_peso')::boolean, true),
     (p->>'peso_nominal_g')::numeric, (p->>'banda_g')::numeric, coalesce((p->>'tara_g')::numeric, 0),
     (p->>'vida_util_dias')::int, coalesce(p->>'vida_util_estado', 'provisional'), p->>'conservacion',
     coalesce((p->>'orden')::int, 0), coalesce((p->>'activo')::boolean, true), p_usuario_id, now())
  on conflict (producto_id) do update set
     receta_id = excluded.receta_id, nombre_etiqueta = excluded.nombre_etiqueta,
     requiere_peso = excluded.requiere_peso, peso_nominal_g = excluded.peso_nominal_g,
     banda_g = excluded.banda_g, tara_g = excluded.tara_g, vida_util_dias = excluded.vida_util_dias,
     vida_util_estado = excluded.vida_util_estado, conservacion = excluded.conservacion,
     orden = excluded.orden, activo = excluded.activo, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true, 'producto_id', v_prod);
end;
$$;

grant execute on function
  public.produccion_tanda_abrir(uuid, numeric, uuid, uuid, text, text, boolean, uuid, text),
  public.produccion_unidad_registrar(uuid, numeric, uuid, uuid, text, text),
  public.produccion_unidad_impresa(uuid, boolean),
  public.produccion_unidad_anular(uuid, text, uuid, text),
  public.produccion_tanda_cerrar(uuid, uuid, numeric, boolean),
  public.produccion_tanda_anular(uuid, text, uuid),
  public.produccion_tanda_abierta(text),
  public.produccion_tanda_ver(uuid),
  public.produccion_estacion_operarios(),
  public.produccion_unidad_ficha(text),
  public.produccion_etiquetado_guardar(jsonb, uuid)
to anon, authenticated;
revoke all on function public.produccion_tandas_vigilante() from public, anon, authenticated;
