-- PeYa: el webhook pisaba el globalEntityId bueno con la platformKey.
--
-- 14-oct-2026. El import de catálogo por la ruta de global-entity empezó a dar
-- 404 «No matching platform vendor found for pVID: 478876, gEID: "PY"». El
-- valor correcto es `PY_AR` (lo devuelve el GET de availability de DH en
-- `globalEntityId`). El primer pedido real trajo `localInfo.platformKey = "PY"`
-- y el plugin lo guardó encima: la platformKey es la plataforma a secas, el
-- globalEntityId es plataforma + país. No son lo mismo.
--
-- Dos candados, sin tocar el plugin:
--   · `peya_guardar_global_entity` ya no reemplaza un valor con país
--     («PY_AR») por uno sin país («PY»). Sí lo llena si estaba vacío, y sí lo
--     cambia si el nuevo trae país.
--   · `peya_guardar_plataformas` (lo llama el responder tras consultar
--     availability) guarda el `globalEntityId` que DH declara ahí. Es la fuente
--     más confiable y se actualiza sola cada vez que se abre o cierra la tienda.

create or replace function public.peya_guardar_global_entity(p_remote_id text, p_global_entity_id text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_nuevo text := btrim(coalesce(p_global_entity_id, ''));
begin
  if p_remote_id is null or v_nuevo = '' then
    return false;
  end if;
  update public.peya_vendor_map
     set global_entity_id = v_nuevo
   where remote_id = p_remote_id
     and global_entity_id is distinct from v_nuevo
     -- Un «PY» pelado no pisa un «PY_AR»: sólo entra si no había nada, si el
     -- nuevo trae país, o si el viejo era un prefijo peor (sin país).
     and (global_entity_id is null
          or position('_' in v_nuevo) > 0
          or position('_' in coalesce(global_entity_id, '')) = 0);
  return found;
end $function$;

create or replace function public.peya_guardar_plataformas(p_remote_id text, p_plataformas jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_n    int;
  v_geid text;
begin
  -- El globalEntityId que DH declara en availability manda sobre lo que haya.
  select nullif(btrim(p->>'globalEntityId'), '') into v_geid
    from jsonb_array_elements(coalesce(p_plataformas, '[]'::jsonb)) p
   where nullif(btrim(p->>'globalEntityId'), '') is not null
   limit 1;

  update public.peya_vendor_map
     set plataformas = coalesce(p_plataformas, '[]'::jsonb),
         plataformas_at = now(),
         global_entity_id = coalesce(v_geid, global_entity_id)
   where remote_id = p_remote_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'vendor_no_mapeado');
  end if;
  return jsonb_build_object('ok', true,
    'plataformas', jsonb_array_length(coalesce(p_plataformas, '[]'::jsonb)),
    'global_entity_id', v_geid);
end $function$;
