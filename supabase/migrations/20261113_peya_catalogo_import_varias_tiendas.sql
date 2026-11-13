-- PeYa: un mismo import de catálogo puede cubrir varias tiendas.
--
-- 13-nov-2026, en la sesión de homologación PedidosYa pidió probar dos tiendas
-- de prueba con un menú unificado: un solo PUT /v2/chains/{chain}/catalog con
-- `vendors: [tienda1, tienda2]` y un solo catalogImportId. El responder abre una
-- fila de `peya_catalogo_import` por tienda con el mismo catalog_import_id.
--
-- `peya_catalogo_import_estado` hacía `update … returning … into v`, que en
-- PL/pgSQL revienta si actualiza más de una fila: el callback de DH habría
-- devuelto 500 y DH reintentando para siempre. Ahora actualiza todas y
-- devuelve cuántas.

create or replace function public.peya_catalogo_import_estado(
  p_catalog_import_id text, p_estado text, p_mensaje text default null, p_detalles jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v jsonb;
begin
  if p_catalog_import_id is null or btrim(p_catalog_import_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'sin_catalog_import_id');
  end if;
  if p_estado not in ('in_progress','done','done_with_errors','failed') then
    return jsonb_build_object('ok', false, 'error', 'estado_invalido',
                              'recibido', p_estado);
  end if;

  with u as (
    update public.peya_catalogo_import
       set estado         = p_estado,
           mensaje        = left(coalesce(p_mensaje, mensaje), 2000),
           detalles       = coalesce(p_detalles, detalles),
           actualizado_at = now()
     where catalog_import_id = p_catalog_import_id
    returning id, remote_id
  )
  select jsonb_build_object('filas', count(*), 'ids', jsonb_agg(id), 'tiendas', jsonb_agg(remote_id))
    into v from u;

  if coalesce((v->>'filas')::int, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'import_desconocido',
                              'catalog_import_id', p_catalog_import_id);
  end if;
  return jsonb_build_object('ok', true, 'import', v);
end $function$;
