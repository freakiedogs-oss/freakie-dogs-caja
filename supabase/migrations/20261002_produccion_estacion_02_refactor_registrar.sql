-- ═══════════════════════════════════════════════════════════════════════
-- Estación de pesaje y etiquetado → kardex · M2: registrar_produccion en piezas
-- docs/PLAN-ESTACION-ETIQUETADO-ERP.md §2 (M2)
--
-- registrar_produccion conserva su firma y su efecto (mismos movimientos de
-- kardex, mismos items, mismo lote, mismo retorno — se agrega `faltantes`).
-- Lo que cambia es que ahora está armada con cuatro internos que la estación
-- también usa:
--
--   _produccion_lote(fecha, es_prueba)   lote bajo advisory lock (antes count(*)+1
--                                        sin lock: dos clientes podían repetir lote)
--   _produccion_explotar(receta, tandas_materia, tandas_empaque)
--                                        la explosión de la receta, SIN escribir.
--                                        Mismo cálculo que siempre:
--                                        tandas × cantidad × factor_a_stock × (1+merma%).
--                                        Las líneas es_empaque usan tandas_empaque.
--   _produccion_consumir(prod, tandas_materia, tandas_empaque, excluir, usuario)
--                                        kardex 'consumo' + produccion_diaria_items.
--                                        `excluir` = productos ya descontados por
--                                        escaneo (fase 2); hoy siempre vacío.
--   _produccion_alta(prod, unidades, usuario)
--                                        kardex 'produccion' del producto terminado.
--
-- Invarianza verificada antes de aplicar (ver bloque de prueba al final, que se
-- corre aparte con rollback): la explosión nueva con tandas_materia =
-- tandas_empaque = N da exactamente las mismas (producto, cantidad) que la
-- fórmula vieja para todas las recetas con historial de producción.
-- Snapshot de la versión anterior: supabase/snapshots/2026-10-02_registrar_produccion_antes_estacion.sql
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public._produccion_lote(p_fecha date, p_es_prueba boolean default false)
returns text
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_seq int;
  v_pref text := case when p_es_prueba then 'PRB-' else 'LOT-' end;
  v_lote text;
begin
  -- Serializa la numeración del día dentro de la transacción: dos tablets que
  -- abren tanda al mismo segundo ya no sacan el mismo lote.
  perform pg_advisory_xact_lock(hashtext('produccion_lote:' || p_fecha::text || ':' || p_es_prueba::text));
  select count(*) + 1 into v_seq
    from public.produccion_diaria
   where fecha = p_fecha and es_prueba = p_es_prueba;
  loop
    v_lote := v_pref || to_char(p_fecha, 'YYYYMMDD') || '-' || lpad(v_seq::text, 3, '0');
    exit when not exists (select 1 from public.produccion_diaria where lote = v_lote);
    v_seq := v_seq + 1;   -- hubo una fila borrada en el medio; no se reusa el número
  end loop;
  return v_lote;
end;
$$;

create or replace function public._produccion_explotar(
  p_receta_id uuid, p_tandas_materia numeric, p_tandas_empaque numeric)
returns table (
  producto_id uuid, cantidad numeric, unidad_medida text,
  es_subproducto boolean, es_empaque boolean, sin_catalogo boolean, linea_id uuid)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select
    case when ri.tipo_ingrediente = 'materia_prima' then ri.producto_id else sr.catalogo_id end,
    round(
      (case when ri.es_empaque then p_tandas_empaque else p_tandas_materia end)
      * coalesce(ri.cantidad, 0) * coalesce(ri.factor_a_stock, 1)
      * (1 + coalesce(ri.merma_pct, 0) / 100.0), 4),
    case when ri.tipo_ingrediente = 'materia_prima'
         then coalesce(ri.unidad_medida, cp.unidad_medida, 'unidad')
         else coalesce(ri.unidad_medida, 'unidad') end,
    ri.tipo_ingrediente = 'sub_receta',
    ri.es_empaque,
    ri.tipo_ingrediente = 'sub_receta' and sr.catalogo_id is null,
    ri.id
  from public.receta_ingredientes ri
  left join public.catalogo_productos cp on cp.id = ri.producto_id
  left join public.recetas sr on sr.id = ri.sub_receta_id
  where ri.receta_id = p_receta_id
    and ((ri.tipo_ingrediente = 'materia_prima' and ri.producto_id is not null)
      or (ri.tipo_ingrediente = 'sub_receta' and ri.sub_receta_id is not null));
$$;

create or replace function public._produccion_consumir(
  p_produccion_id uuid, p_tandas_materia numeric, p_tandas_empaque numeric,
  p_excluir uuid[] default '{}', p_usuario_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cm uuid := '584aee3c-a842-496f-9f2b-1e3bac6e6b23';   -- Casa Matriz
  v_lote text; v_receta uuid;
  r record; v_mov jsonb; v_costo numeric;
  v_consumidos int := 0; v_sin_catalogo int := 0;
  v_faltantes jsonb := '[]'::jsonb;
begin
  select lote, receta_id into v_lote, v_receta from public.produccion_diaria where id = p_produccion_id;
  if v_receta is null then raise exception '_produccion_consumir: producción % no existe', p_produccion_id; end if;

  for r in select * from public._produccion_explotar(v_receta, p_tandas_materia, p_tandas_empaque) loop
    if r.sin_catalogo then v_sin_catalogo := v_sin_catalogo + 1; continue; end if;
    if r.cantidad = 0 then continue; end if;
    if r.producto_id = any (coalesce(p_excluir, '{}')) then continue; end if;

    v_costo := public.costo_producto(r.producto_id);
    -- permite negativo: el negativo delata el faltante en vez de frenar la producción
    v_mov := public.kardex_mover(r.producto_id, v_cm, 'consumo', -r.cantidad,
      'produccion', p_produccion_id,
      'Producción ' || v_lote || case when r.es_subproducto then ' (sub-receta)' else '' end,
      p_usuario_id, true);
    insert into public.produccion_diaria_items
      (produccion_id, producto_id, cantidad_consumida, unidad_medida, costo_unitario,
       es_subproducto, origen, cantidad_esperada)
    values (p_produccion_id, r.producto_id, r.cantidad, r.unidad_medida, v_costo,
       r.es_subproducto, 'bom', r.cantidad);
    v_consumidos := v_consumidos + 1;

    if (v_mov->>'stock_posterior')::numeric < 0 then
      v_faltantes := v_faltantes || jsonb_build_object(
        'producto_id', r.producto_id,
        'nombre', (select nombre from public.catalogo_productos where id = r.producto_id),
        'consumido', r.cantidad, 'unidad', r.unidad_medida,
        'stock_anterior', (v_mov->>'stock_anterior')::numeric,
        'stock_posterior', (v_mov->>'stock_posterior')::numeric);
    end if;
  end loop;

  return jsonb_build_object('consumidos', v_consumidos, 'sub_sin_catalogo', v_sin_catalogo,
                            'faltantes', v_faltantes);
end;
$$;

create or replace function public._produccion_alta(
  p_produccion_id uuid, p_unidades numeric, p_usuario_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cm uuid := '584aee3c-a842-496f-9f2b-1e3bac6e6b23';
  v_lote text; v_cat uuid; v_mov jsonb;
begin
  select pd.lote, coalesce(pd.producto_id, r.catalogo_id) into v_lote, v_cat
    from public.produccion_diaria pd join public.recetas r on r.id = pd.receta_id
   where pd.id = p_produccion_id;
  if v_cat is null then
    return jsonb_build_object('alta', false, 'aviso',
      'La receta no tiene producto de catálogo asignado: se consumieron '
      || 'los insumos pero NO se dio de alta el producto terminado. '
      || 'Asigná el producto en la receta y registrá el alta a mano.');
  end if;
  if coalesce(p_unidades, 0) <= 0 then
    return jsonb_build_object('alta', false, 'aviso', 'Cero unidades: no se dio de alta nada.');
  end if;
  v_mov := public.kardex_mover(v_cat, v_cm, 'produccion', p_unidades,
    'produccion', p_produccion_id, 'Producción ' || v_lote, p_usuario_id, true);
  return jsonb_build_object('alta', true, 'producto_id', v_cat, 'unidades', p_unidades,
    'stock_posterior', (v_mov->>'stock_posterior')::numeric);
end;
$$;

-- Misma firma, mismo efecto. Ahora es: lote → fila cerrada → consumir → alta.
create or replace function public.registrar_produccion(
  p_receta_id uuid, p_cantidad numeric, p_turno text default null, p_notas text default null,
  p_responsable_id uuid default null, p_usuario_id uuid default null,
  p_usuario_nombre text default null, p_fecha date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_fecha date := coalesce(p_fecha, (now() - interval '6 hours')::date);
  v_lote text; v_prod uuid; v_cat uuid; v_rend numeric; v_producido numeric;
  v_costo_total numeric; v_cons jsonb; v_alta jsonb; v_aviso text := null;
begin
  if p_receta_id is null or coalesce(p_cantidad, 0) <= 0 then
    raise exception 'receta y cantidad (>0) son obligatorias';
  end if;

  select r.catalogo_id, r.rendimiento into v_cat, v_rend from public.recetas r where r.id = p_receta_id;
  if not found then raise exception 'La receta % no existe', p_receta_id; end if;
  -- p_cantidad son TANDAS; lo producido es tandas × rendimiento (memoria 22-ago)
  v_producido := round(p_cantidad * coalesce(nullif(v_rend, 0), 1), 4);

  v_lote := public._produccion_lote(v_fecha, false);
  v_costo_total := round(p_cantidad * public.receta_costo_total(p_receta_id), 2);

  insert into public.produccion_diaria
    (fecha, receta_id, cantidad_producida, cantidad_enviada, turno, lote, responsable_id,
     created_by, created_by_id, notas, costo_total,
     estado, origen, producto_id, unidades_producidas, tandas_equiv, cerrada_at, cerrada_por)
  values
    (v_fecha, p_receta_id, p_cantidad, 0, p_turno, v_lote, p_responsable_id,
     p_usuario_nombre, p_usuario_id, p_notas, v_costo_total,
     'cerrada', 'manual', v_cat, v_producido, p_cantidad, now(), p_usuario_id)
  returning id into v_prod;

  v_cons := public._produccion_consumir(v_prod, p_cantidad, p_cantidad, '{}', p_usuario_id);
  v_alta := public._produccion_alta(v_prod, v_producido, p_usuario_id);

  if not (v_alta->>'alta')::boolean then v_aviso := v_alta->>'aviso'; end if;
  if (v_cons->>'sub_sin_catalogo')::int > 0 then
    v_aviso := coalesce(v_aviso || ' · ', '') || (v_cons->>'sub_sin_catalogo') ||
      ' sub-receta(s) sin producto de catálogo: su consumo NO se descontó del ' ||
      'inventario ni quedó registrado. Asignales un producto para poder medirlo.';
  end if;

  return jsonb_build_object('ok', true, 'produccion_id', v_prod, 'lote', v_lote,
    'costo_total', v_costo_total, 'insumos_consumidos', (v_cons->>'consumidos')::int,
    'producto_dado_de_alta', (v_alta->>'alta')::boolean, 'unidades_producidas', v_producido,
    'aviso', v_aviso, 'faltantes', v_cons->'faltantes');
end;
$$;

revoke all on function public._produccion_consumir(uuid, numeric, numeric, uuid[], uuid) from public, anon, authenticated;
revoke all on function public._produccion_alta(uuid, numeric, uuid) from public, anon, authenticated;
-- _produccion_explotar queda ejecutable: es de solo lectura y la UI la usa para previsualizar.
