-- Lote del día de cada persona: todo lo que imprime hoy cae aquí y al final del turno registra los insumos una sola vez.
-- Si ya tiene uno abierto de hoy lo reutiliza; si lo cerró (registró insumos), abre uno nuevo.
create or replace function public.fn_prep_lote_del_dia(p_usuario uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  n text := public._prep_nombre(p_usuario);
  v_fecha date := (now() at time zone 'America/El_Salvador')::date;
  v_id uuid; v_lote text;
begin
  if n is null then raise exception 'Usuario no valido.'; end if;
  perform pg_advisory_xact_lock(hashtext('prep_dia_' || p_usuario::text));
  select id, lote into v_id, v_lote from public.prep_lotes
   where fecha = v_fecha and creado_por = p_usuario and sin_preparacion and estado = 'abierto'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', v_id, 'lote', v_lote, 'fecha', v_fecha, 'reutilizado', true);
  end if;
  return public.fn_prep_lote_abrir(p_usuario, '[]'::jsonb, true);
end $function$;

grant execute on function public.fn_prep_lote_del_dia(uuid) to anon, authenticated;
