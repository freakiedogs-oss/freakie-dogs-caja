-- Ola 0 del plan de ejecución (docs/planes/PLAN_EJECUCION_2026-11-10.md)
-- W0-04: dte-service aceptaba cualquier X-API-Key porque esta función devolvía '{}'
--        (objeto vacío, "verdadero" en JS) cuando la llave no existía. Ahora devuelve NULL,
--        y lib/auth.ts (`if (error || !data)`) responde 401. También exige negocio activo.
create or replace function public.dte_authenticate_key(p_api_key text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_key_hash text;
  v_result jsonb;
begin
  if p_api_key is null or length(p_api_key) = 0 then
    return null;
  end if;
  v_key_hash := encode(digest(p_api_key, 'sha256'), 'hex');

  select jsonb_build_object(
    'business_id', b.id,
    'business_slug', b.business_id,
    'permissions', ak.permissions,
    'biz_active', b.is_active
  ) into v_result
  from dte_service.api_keys ak
  join dte_service.businesses b on ak.business_id = b.id
  where ak.key_hash = v_key_hash
    and ak.is_active = true
    and b.is_active = true
    and (ak.expires_at is null or ak.expires_at > now())
  limit 1;

  if v_result is null or (v_result->>'business_id') is null then
    return null;  -- antes: '{}' → el servicio lo tomaba como llave válida
  end if;

  update dte_service.api_keys set last_used_at = now() where key_hash = v_key_hash;
  return v_result;
end;
$function$;

-- N-9: el proxy DTE no podía escribir su bitácora (403 en cada intento).
grant usage, select on sequence public.pos_dte_proxy_log_id_seq to service_role;

-- B-1: el archivado de la cola de cocina fallaba porque la tabla histórica
--      se quedó sin 4 columnas nuevas y el INSERT usaba SELECT *.
alter table public.pos_cocina_queue_historico
  add column if not exists peya_motorista_at timestamptz,
  add column if not exists peya_motorista_espera boolean,
  add column if not exists peya_motorista_cobro_at timestamptz,
  add column if not exists reutiliza_de text;

drop function if exists public.pos_cocina_queue_archivar(integer);
create function public.pos_cocina_queue_archivar(p_dias integer default 90, p_limite integer default 50000)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_movidas int;
begin
  with viejas as (
    select ctid from public.pos_cocina_queue
    where estado = 'completado'
      and recibido_at < now() - make_interval(days => p_dias)
    limit p_limite
  ), movidas as (
    delete from public.pos_cocina_queue q
    using viejas v where q.ctid = v.ctid
    returning q.*
  )
  insert into public.pos_cocina_queue_historico
    (id,cuenta_id,cuenta_item_id,sucursal_id,estacion,prioridad,estado,recibido_at,iniciado_at,completado_at,
     preparado_por,comanda_numero,store_code,canal,mesa_ref,nombre_item,cantidad,nota,pager,modificadores,
     precio_modificadores,mesero,comanda_uid,linea,cliente,total,nota_pedido,atencion_especial,destino,
     peya_motorista_at,peya_motorista_espera,peya_motorista_cobro_at,reutiliza_de)
  select
     id,cuenta_id,cuenta_item_id,sucursal_id,estacion,prioridad,estado,recibido_at,iniciado_at,completado_at,
     preparado_por,comanda_numero,store_code,canal,mesa_ref,nombre_item,cantidad,nota,pager,modificadores,
     precio_modificadores,mesero,comanda_uid,linea,cliente,total,nota_pedido,atencion_especial,destino,
     peya_motorista_at,peya_motorista_espera,peya_motorista_cobro_at,reutiliza_de
  from movidas;
  get diagnostics v_movidas = row_count;
  return v_movidas;
end;
$function$;
revoke all on function public.pos_cocina_queue_archivar(integer, integer) from public, anon, authenticated;

-- B-1: el refresco CONCURRENTLY fallaba a diario (el índice único es sobre una expresión).
--      La vista es chica y el job corre a las 6:00 am: refresco normal.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'refresh_mv_vista_top_productos'),
  command := 'REFRESH MATERIALIZED VIEW public.mv_vista_top_productos'
);
