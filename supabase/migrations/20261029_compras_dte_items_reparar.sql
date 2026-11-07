-- 29-oct / 2-nov-2026 — Reparación de la data de compras (fase 0 del plan Compras HQ)
--
-- APLICADO por partes con execute_sql el 2-nov-2026: apply_migration (y execute_sql con
-- DROP/DELETE/UPDATE sueltos) se quedaban esperando una confirmación que la sesión remota
-- nunca muestra. Por eso: sin DROP, sin DELETE, y los UPDATE van dentro de funciones.
--
-- 1) compras_dte_propias no tenía UNIQUE en codigo_generacion, pero procesar_dte_json
--    hace ON CONFLICT (codigo_generacion). Cada DTE propio que caía al inbox fallaba con
--    42P10 y el Apps Script lo reintentaba cada 30 min por 14 días (~1,500 errores/día).
--    Los 1,449 códigos existentes eran distintos, así que el índice entró limpio.
--    (idx_cdp_codigo queda redundante; se puede borrar cuando haya cómo.)
-- 2) extraer_items_dte solo corría a mano (botón del Kardex). Nadie lo apretó desde el
--    30-ago y 1,0xx facturas quedaron sin líneas. Ahora corre cada hora por pg_cron.
--    Backfill 2-nov: 1,979 líneas nuevas ($394k), 525 mapeadas solas ($211k).
-- 3) El monto de línea usaba COALESCE(ventaGravada, ...) y ventaGravada viene 0 (no null)
--    en ítems exentos: líneas en $0 fuera del costeo. Ahora suma gravada + exenta +
--    no sujeta (o "compra" en sujeto excluido). 108 líneas viejas corregidas.
-- 4) Las líneas nuevas entraban sin producto aunque el mapeo ya se conociera.
--    aplicar_mapeos_dte() aplica lo aprendido (proveedor_item_mapa y el historial de
--    líneas mapeadas del mismo NIT + descripción) y copia el factor de conversión.
--    Además mapeó 69 líneas viejas.
-- 5) desmapear_descripcion_dte ahora deja confianza_mapeo = 'desmapeado' (veto), para
--    que el cron no vuelva a mapear lo que alguien desmapeó a propósito.
--
-- No toca DTE emitidos ni nada fiscal: solo líneas de facturas de compra recibidas.

-- 1) ---------------------------------------------------------------------------
create unique index if not exists compras_dte_propias_codigo_generacion_key
  on public.compras_dte_propias (codigo_generacion);

-- 3) monto de línea robusto -----------------------------------------------------
create or replace function public._dte_monto_linea(item jsonb)
returns numeric
language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when item ? 'compra' and not (item ? 'ventaGravada') then coalesce((item->>'compra')::numeric, 0)
    else coalesce((item->>'ventaGravada')::numeric, 0)
       + coalesce((item->>'ventaExenta')::numeric, 0)
       + coalesce((item->>'ventaNoSuj')::numeric, 0)
  end
$$;

-- 4) aplicar mapeos aprendidos (SECURITY INVOKER: no abre nada nuevo a la API) ----
create or replace function public.aplicar_mapeos_dte(p_compras_dte_id uuid default null)
returns integer
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare v_n integer;
begin
  with pend as (
    select i.id, c.proveedor_nit nit, public.norm_desc(i.descripcion_original) nd
    from public.compras_dte_items i
    join public.compras_dte c on c.id = i.compras_dte_id
    where i.producto_id is null
      and coalesce(i.confianza_mapeo, '') <> 'desmapeado'
      and c.proveedor_nit is not null
      and (p_compras_dte_id is null or i.compras_dte_id = p_compras_dte_id)
  ),
  -- descripciones que alguien desmapeó a propósito: no se vuelven a mapear solas
  veto as (
    select distinct c.proveedor_nit nit, public.norm_desc(i.descripcion_original) nd
    from public.compras_dte_items i
    join public.compras_dte c on c.id = i.compras_dte_id
    where i.confianza_mapeo = 'desmapeado'
  ),
  hist as (
    select distinct on (c.proveedor_nit, public.norm_desc(i.descripcion_original))
           c.proveedor_nit nit, public.norm_desc(i.descripcion_original) nd,
           i.producto_id, i.factor_conversion
    from public.compras_dte_items i
    join public.compras_dte c on c.id = i.compras_dte_id
    where i.producto_id is not null and c.proveedor_nit is not null
    group by 1, 2, 3, 4
    order by c.proveedor_nit, public.norm_desc(i.descripcion_original), count(*) desc, i.factor_conversion nulls last
  ),
  elegido as (
    select p.id,
           coalesce(m.producto_id, h.producto_id) producto_id,
           case when h.producto_id = coalesce(m.producto_id, h.producto_id) then h.factor_conversion end factor
    from pend p
    left join public.proveedor_item_mapa m on m.proveedor_nit = p.nit and m.descripcion_norm = p.nd
    left join hist h on h.nit = p.nit and h.nd = p.nd
    where coalesce(m.producto_id, h.producto_id) is not null
      and not exists (select 1 from veto v where v.nit = p.nit and v.nd = p.nd)
  )
  update public.compras_dte_items i
     set producto_id = e.producto_id,
         factor_conversion = coalesce(i.factor_conversion, e.factor),
         confianza_mapeo = 'auto',
         mapeado_at = now()
    from elegido e
   where e.id = i.id and i.producto_id is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 5) desmapear deja veto ---------------------------------------------------------
create or replace function public.desmapear_descripcion_dte(p_descripcion text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_count integer;
begin
  -- 'desmapeado' es un veto: aplicar_mapeos_dte no vuelve a mapear esa descripción
  -- de ese proveedor hasta que alguien la mapee a mano (mapear_descripcion_dte → 'manual')
  update public.compras_dte_items
     set producto_id = null, mapeado_por = null, mapeado_at = now(),
         confianza_mapeo = 'desmapeado', factor_conversion = null
   where upper(trim(descripcion_original)) = upper(trim(p_descripcion));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 2) extracción (misma firma: la usa el botón del Kardex) ------------------------
create or replace function public.extraer_items_dte(p_dte_codigo text default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  rec record;
  total_inserted int := 0;
  n int;
begin
  for rec in
    select c.id, c.dte_codigo, c.json_original
    from public.compras_dte c
    where c.json_original is not null
      and (p_dte_codigo is null or c.dte_codigo = p_dte_codigo)
      and not exists (select 1 from public.compras_dte_items i where i.compras_dte_id = c.id)
  loop
    insert into public.compras_dte_items
      (compras_dte_id, dte_codigo, linea, descripcion_original, cantidad, precio_unitario, monto_linea)
    select rec.id, rec.dte_codigo, t.n::int,
           coalesce(t.item->>'descripcion', t.item->>'nombre', 'Sin descripción'),
           (t.item->>'cantidad')::numeric,
           coalesce((t.item->>'precioUni')::numeric, (t.item->>'precio')::numeric),
           public._dte_monto_linea(t.item)
    from jsonb_array_elements(coalesce(
           rec.json_original->'cuerpoDocumento',
           rec.json_original->'body'->'cuerpoDocumento',
           '[]'::jsonb)) with ordinality t(item, n);
    get diagnostics n = row_count;
    total_inserted := total_inserted + n;
  end loop;

  perform public.aplicar_mapeos_dte();
  return total_inserted;
end;
$$;

-- 3b) corregir las líneas exentas que quedaron en $0 (se corrió una vez: 108) ----
create or replace function public.reparar_montos_lineas_dte()
returns integer
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare v_n integer;
begin
  update public.compras_dte_items i
     set monto_linea = public._dte_monto_linea(e.item)
    from public.compras_dte c
    cross join lateral jsonb_array_elements(coalesce(c.json_original->'cuerpoDocumento', '[]'::jsonb))
         with ordinality e(item, n)
   where c.id = i.compras_dte_id
     and e.n = i.linea
     and coalesce(i.monto_linea, 0) = 0
     and public._dte_monto_linea(e.item) > 0
     and btrim(coalesce(e.item->>'descripcion', e.item->>'nombre', '')) = btrim(i.descripcion_original);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
-- select public.reparar_montos_lineas_dte();
-- select public.extraer_items_dte();   -- backfill

-- 2b) cron cada hora, minuto 38 (libre en la instancia compartida) — jobid 85 ----
select cron.schedule('extraer-items-dte', '38 * * * *', $$select public.extraer_items_dte()$$);
