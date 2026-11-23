-- N-17 / W1-12 del plan de ejecución. fn_agrandados_panel() era la consulta más cara de la base
-- (recorre 2 meses de pos_cocina_queue; 1–2 s por llamada) y cada tablet la calculaba por su
-- cuenta: al coincidir varias se agotaba el tiempo (≈556 errores 500 al día).
-- Ahora el cálculo corre una vez por minuto (pg_cron) y las tablets leen la copia.
-- Las pantallas ya consultaban cada 2 minutos, así que no ven datos más viejos que antes.
alter function public.fn_agrandados_panel() rename to fn_agrandados_panel_calc;
revoke all on function public.fn_agrandados_panel_calc() from public, anon, authenticated;

create table public.agrandados_panel_cache as
  select * from public.fn_agrandados_panel_calc() with no data;
alter table public.agrandados_panel_cache add column actualizado_at timestamptz not null default now();
alter table public.agrandados_panel_cache enable row level security;  -- sin políticas: solo vía función
revoke all on table public.agrandados_panel_cache from public, anon, authenticated;

create or replace function public.agrandados_panel_refrescar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  -- Si ya hay un refresco en curso, este no hace nada (evita filas duplicadas).
  if not pg_try_advisory_xact_lock(hashtext('agrandados_panel_refrescar')) then
    return 0;
  end if;
  -- delete + insert en la misma transacción: los lectores siguen viendo la copia anterior hasta el commit.
  delete from public.agrandados_panel_cache;
  insert into public.agrandados_panel_cache
    select c.*, now() from public.fn_agrandados_panel_calc() c;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.agrandados_panel_refrescar() from public, anon, authenticated;

select public.agrandados_panel_refrescar();

-- Mismo nombre, mismas columnas y mismo orden que antes: el front no cambia.
create function public.fn_agrandados_panel()
 returns table(store_code text, sucursal text, mesero text, bloque_tam integer, valor_unit numeric, activo_desde date, ya_arranco boolean, dia_del_mes integer, dias_del_mes integer, hoy numeric, mes numeric, cuentas_mes integer, tasa_actual numeric, bloques integer, dinero numeric, resto numeric, faltan numeric, dinero_siguiente numeric, mes_anterior_tasa numeric, meta_pct numeric, tasa_7d numeric, proyeccion_unid numeric, proyeccion_dinero numeric, proyeccion_tasa numeric, mejor_dia integer, mejor_dia_fecha date, tocino_valor numeric, tocino_desde date, tocino_hoy integer, tocino_mes integer, tocino_dinero numeric, unid_hoy integer, unid_mes integer, pb_hoy integer, pb_mes integer, papa_hoy integer, papa_mes integer, beb_hoy integer, beb_mes integer, valor_pb numeric, valor_papa numeric, valor_beb numeric)
 language sql
 stable
 security definer
 set search_path = public
as $$
  select store_code, sucursal, mesero, bloque_tam, valor_unit, activo_desde, ya_arranco, dia_del_mes, dias_del_mes,
         hoy, mes, cuentas_mes, tasa_actual, bloques, dinero, resto, faltan, dinero_siguiente, mes_anterior_tasa,
         meta_pct, tasa_7d, proyeccion_unid, proyeccion_dinero, proyeccion_tasa, mejor_dia, mejor_dia_fecha,
         tocino_valor, tocino_desde, tocino_hoy, tocino_mes, tocino_dinero, unid_hoy, unid_mes, pb_hoy, pb_mes,
         papa_hoy, papa_mes, beb_hoy, beb_mes, valor_pb, valor_papa, valor_beb
  from public.agrandados_panel_cache
  order by mes desc;
$$;
grant execute on function public.fn_agrandados_panel() to anon, authenticated, service_role;

-- Cada minuto en horario de servicio (10:00–22:59 hora de El Salvador = 16–04 UTC); cada hora el resto.
select cron.schedule('agrandados-panel-refrescar', '* 16-23,0-4 * * *', 'select public.agrandados_panel_refrescar()');
select cron.schedule('agrandados-panel-refrescar-fuera-horario', '7 5-15 * * *', 'select public.agrandados_panel_refrescar()');
notify pgrst, 'reload schema';
