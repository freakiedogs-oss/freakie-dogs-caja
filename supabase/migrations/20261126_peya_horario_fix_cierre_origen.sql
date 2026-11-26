-- PeYa cierre por horario: arreglo tras la primera corrida (25-nov-2026, 21:00 SV).
--
-- 1) El check de `cierre_origen` sólo aceptaba 'plataforma' y 'pos', así que
--    `peya_horario_marcar` fallaba al anotar 'horario', la transacción se
--    deshacía y el cron volvía a llamar a `peya-horario` cada minuto.
-- 2) A las 21:00 PedidosYa ya había cerrado la tienda por su propio horario
--    (CLOSED, changeable:false). En ese caso no se pisa el estado local: sólo se
--    anota que el cierre de hoy ya está hecho. El estado local pasa a 'horario'
--    únicamente si nosotros mandamos un PUT y PedidosYa lo aceptó.

alter table public.peya_vendor_map drop constraint if exists peya_vendor_map_cierre_origen_check;
alter table public.peya_vendor_map add constraint peya_vendor_map_cierre_origen_check
  check (cierre_origen is null or cierre_origen = any (array['plataforma', 'pos', 'horario']));

create or replace function public.peya_horario_marcar(
  p_remote_id text, p_accion text, p_ok boolean,
  p_cierre_hasta timestamptz default null, p_detalle jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_ahora timestamptz := now();
  -- ¿Hubo al menos un PUT aceptado? Si PedidosYa ya la tenía cerrada (por su propio
  -- horario o un cierre suyo no cambiable) no se pisa el estado local.
  v_cerramos boolean := exists (
    select 1 from jsonb_array_elements(coalesce(p_detalle->'resultados', '[]'::jsonb)) r
     where (r->>'ok')::boolean is true);
begin
  update public.peya_vendor_map
     set horario_intento_at = v_ahora,
         horario_ultimo = jsonb_build_object('accion', p_accion, 'ok', p_ok, 'at', v_ahora,
                                             'detalle', p_detalle)
   where remote_id = p_remote_id;

  if not p_ok then
    return jsonb_build_object('ok', false);
  end if;

  if p_accion = 'cerrar' then
    update public.peya_vendor_map set cierre_horario_fecha = v_hoy where remote_id = p_remote_id;
    if v_cerramos then
      update public.peya_vendor_map
         set cierres = jsonb_build_array(jsonb_build_object(
               'reason', 'CLOSED',
               'start', to_char(v_ahora at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'end', case when p_cierre_hasta is not null
                           then to_char(p_cierre_hasta at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
               'changeable', true)),
             disponible = false, disponible_at = v_ahora,
             cierre_origen = 'horario', cierre_motivo = 'CLOSED',
             cerrada_hasta = p_cierre_hasta, cierre_changeable = true
       where remote_id = p_remote_id;
    end if;
  elsif p_accion = 'abrir' then
    update public.peya_vendor_map set apertura_horario_fecha = v_hoy where remote_id = p_remote_id;
    update public.peya_vendor_map
       set cierres = '[]'::jsonb, disponible = true, disponible_at = v_ahora,
           cierre_origen = null, cierre_motivo = null, cerrada_hasta = null
     where remote_id = p_remote_id and cierre_origen = 'horario'
       and coalesce((p_detalle->>'reabierta')::boolean, false);
  end if;
  return jsonb_build_object('ok', true, 'cerramos', v_cerramos);
end;
$$;

revoke all on function public.peya_horario_marcar(text, text, boolean, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.peya_horario_marcar(text, text, boolean, timestamptz, jsonb) to service_role;
grant execute on function public.peya_horario_pendientes() to service_role;
