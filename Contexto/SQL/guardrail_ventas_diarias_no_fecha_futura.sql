-- Copia documental de la migración aplicada 2026-07-29 a Supabase (btboxlwfqcbrdfrlnwln, public).
-- Guardrail: un cierre (ventas_diarias) nunca puede tener fecha en el futuro.
-- Raíz del bug de "mes equivocado" (M001/S002 jul-2026): al ponerse al día con el
-- mes anterior, el date-picker de iOS dejaba el mes actual -> fecha futura -> cierre duplicado.
-- Complementa el guardrail de frontend en src/components/caja/CierreForm.jsx
-- (max={today()} en el <input type="date"> + check en handleSubmit).
-- Usa la fecha real de El Salvador (UTC-6) para no depender del TZ de la sesión de Postgres.

create or replace function public.fn_vd_no_fecha_futura()
returns trigger
language plpgsql
as $$
declare
  hoy_sv date := (now() at time zone 'America/El_Salvador')::date;
begin
  if new.fecha > hoy_sv then
    raise exception 'No se puede guardar un cierre con fecha futura (% ). La fecha del cierre no puede ser posterior a hoy (%).',
      new.fecha, hoy_sv
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vd_no_fecha_futura on public.ventas_diarias;
create trigger trg_vd_no_fecha_futura
  before insert or update of fecha on public.ventas_diarias
  for each row execute function public.fn_vd_no_fecha_futura();
