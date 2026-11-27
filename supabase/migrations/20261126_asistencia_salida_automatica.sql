-- Asistencia: salida automática cuando el empleado se olvida de marcarla.
--
-- 26-nov-2026, pedido de Jose. Todas las noches a las 3:00 (hora de El Salvador)
-- se cierran las marcaciones de días anteriores que tienen entrada y no salida:
--
--   · Con turno cargado en Horarios (`horarios_turno`, tipo 'trabaja') → la salida
--     es la hora de salida del turno. Si el turno cruza la medianoche, cae al día
--     siguiente.
--   · Sin turno (o turno 'libre', o la salida del turno queda antes de su entrada
--     real) → entrada + 8 horas, la jornada ordinaria.
--
-- Nunca se pone una salida en el futuro: si todavía no llegó esa hora, se deja
-- para la corrida siguiente. Nunca se toca una salida que el empleado sí marcó.
-- Cada cierre queda anotado en `notas` y con `alerta_rrhh` para que RRHH lo revise
-- en Asistencia Digital (filtro «Sin salida / alertas») y lo corrija si hace falta.

create or replace function public.asistencia_cerrar_olvidadas(p_hasta date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hoy   date := coalesce(p_hasta, (now() at time zone 'America/El_Salvador')::date);
  v_n_turno int := 0;
  v_n_8h    int := 0;
  v_pend    int := 0;
begin
  with c as (
    select a.id, a.hora_entrada,
           -- Salida según el turno del día, si hay uno de trabajo con hora de salida.
           case when t.tipo = 'trabaja' and t.hora_salida is not null then
             ((a.fecha + t.hora_salida)::timestamp
               + case when t.hora_entrada is not null and t.hora_salida <= t.hora_entrada
                      then interval '1 day' else interval '0' end)
             at time zone 'America/El_Salvador'
           end as salida_turno,
           t.hora_salida as turno_salida
      from public.asistencia a
      left join lateral (
        select ht.tipo, ht.hora_entrada, ht.hora_salida
          from public.horarios_turno ht
         where ht.usuario_id = a.usuario_id and ht.fecha = a.fecha
         order by ht.updated_at desc nulls last
         limit 1) t on true
     where a.hora_entrada is not null
       and a.hora_salida is null
       and a.fecha < v_hoy
       and a.fecha >= v_hoy - 7
  ), d as (
    select c.id,
           case when c.salida_turno is not null and c.salida_turno > c.hora_entrada
                then c.salida_turno else c.hora_entrada + interval '8 hours' end as salida,
           (c.salida_turno is not null and c.salida_turno > c.hora_entrada) as por_turno,
           c.turno_salida
      from c
  ), u as (
    update public.asistencia a
       set hora_salida = d.salida,
           alerta_rrhh = true,
           notas = concat_ws(' · ', nullif(a.notas, ''),
             case when d.por_turno
                  then 'Salida automática: no marcó salida (hora de salida del turno ' || to_char(d.turno_salida, 'HH24:MI') || ')'
                  else 'Salida automática: no marcó salida (sin turno cargado: entrada + 8 h)' end)
      from d
     where a.id = d.id
       and a.hora_salida is null
       and d.salida <= now()
    returning d.por_turno
  )
  select count(*) filter (where por_turno), count(*) filter (where not por_turno)
    into v_n_turno, v_n_8h from u;

  select count(*) into v_pend
    from public.asistencia a
   where a.hora_entrada is not null and a.hora_salida is null
     and a.fecha < v_hoy and a.fecha >= v_hoy - 7;

  return jsonb_build_object('cerradas_por_turno', v_n_turno, 'cerradas_8h', v_n_8h,
                            'quedan_abiertas', v_pend, 'hasta', v_hoy);
end;
$$;

revoke all on function public.asistencia_cerrar_olvidadas(date) from public, anon, authenticated;
grant execute on function public.asistencia_cerrar_olvidadas(date) to service_role;

-- 03:00 en El Salvador (UTC-6, sin horario de verano) = 09:00 UTC.
select cron.schedule('asistencia-salida-automatica', '0 9 * * *',
                     'select public.asistencia_cerrar_olvidadas();');
