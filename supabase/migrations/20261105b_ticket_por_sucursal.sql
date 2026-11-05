-- Ticket promedio por persona POR SUCURSAL (pedido de Jose, 5-nov-2026).
-- Usa la misma base que Desempeño Meseros (_extras_cuentas): sin ventas a empleados.
-- Mesa: venta ÷ personas sentadas (pax). Para llevar / drive thru: venta ÷ ticket.
-- ejecutivo/superadmin/admin ven todas; gerente solo la suya.
create or replace function public.fn_ticket_sucursales(p_usuario_id uuid, p_desde date, p_hasta date)
returns table (
  store_code text, sucursal text,
  mesas bigint, personas_mesa bigint, venta_mesa numeric, ticket_persona numeric, ticket_mesa numeric, extras_persona numeric,
  tickets_llevar bigint, venta_llevar numeric, ticket_llevar numeric, extras_ticket_llevar numeric,
  ventas_empleado bigint
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rol text; v_store text;
begin
  select u.rol, u.store_code into v_rol, v_store from public.usuarios_erp u where u.id = p_usuario_id and u.activo limit 1;
  if v_rol is null then raise exception 'Usuario inválido o inactivo' using errcode = '28000'; end if;
  if v_rol not in ('ejecutivo','superadmin','admin','gerente') then
    raise exception 'Tu rol (%) no tiene acceso a esta pantalla', v_rol using errcode = '42501';
  end if;
  if p_hasta - p_desde > 120 then raise exception 'Rango máximo: 120 días'; end if;
  return query
  select s.store_code, s.nombre,
         count(*) filter (where x.tipo = 'mesa' and not x.es_empleado),
         coalesce(sum(x.personas) filter (where x.tipo = 'mesa' and not x.es_empleado),0)::bigint,
         round(coalesce(sum(x.venta) filter (where x.tipo = 'mesa' and not x.es_empleado),0),2),
         round(sum(x.venta) filter (where x.tipo = 'mesa' and not x.es_empleado)
               / nullif(sum(x.personas) filter (where x.tipo = 'mesa' and not x.es_empleado),0),2),
         round(avg(x.venta) filter (where x.tipo = 'mesa' and not x.es_empleado),2),
         round(sum(x.extras) filter (where x.tipo = 'mesa' and not x.es_empleado)
               / nullif(sum(x.personas) filter (where x.tipo = 'mesa' and not x.es_empleado),0),2),
         count(*) filter (where x.tipo <> 'mesa' and not x.es_empleado),
         round(coalesce(sum(x.venta) filter (where x.tipo <> 'mesa' and not x.es_empleado),0),2),
         round(avg(x.venta) filter (where x.tipo <> 'mesa' and not x.es_empleado),2),
         round(avg(x.extras) filter (where x.tipo <> 'mesa' and not x.es_empleado),2),
         count(*) filter (where x.es_empleado)
  from public.sucursales s
  cross join lateral public._extras_cuentas(s.store_code, p_desde, p_hasta) x
  where s.activa and s.tipo in ('restaurante','food_court','drive_thru') and s.store_code <> 'EVT001'
    and (v_rol <> 'gerente' or s.store_code = v_store)
  group by s.store_code, s.nombre
  order by s.store_code;
end $$;
grant execute on function public.fn_ticket_sucursales(uuid,date,date) to anon, authenticated;
