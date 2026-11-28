-- PeYa: mejoras de la reunión con empleados (28-nov-2026, aprobadas por Jose).
--
-- 1) Horario propio de PedidosYa por tienda (`peya_vendor_map.horario_peya`).
--    Lourdes (S003) sigue vendiendo por el drive thru después de que cierra la caja
--    general: su tienda en PedidosYa cierra a las 22:00 (el turno del drive cierra
--    entre 22:20 y 23:15 todos los días), no a las 21:00 de `horarios_sucursal`.
--    Formato: {"cierre":"22:00"} para todos los días, o por día de semana
--    {"5":{"cierre":"23:00"}} (0 = domingo). También acepta "apertura".
--    La aceptación automática ya usaba cualquier turno abierto (general o drive).
--
-- 2) Devolución de pedidos PeYa: el combo volvió a la sucursal (el cliente canceló
--    después del retiro, no lo encontraron, etc.). La registra un gerente (PIN), con
--    foto OBLIGATORIA del motorista con el combo. La API de PedidosYa no tiene un
--    estado de «devuelto»: esto queda como evidencia para el reclamo y para cuadrar
--    la liquidación (`v_peya_devoluciones`). No toca facturación.

alter table public.peya_vendor_map
  add column if not exists horario_peya jsonb;

update public.peya_vendor_map v
   set horario_peya = '{"cierre":"22:00"}'::jsonb
  from public.sucursales s
 where s.id = v.sucursal_id and s.store_code = 'S003';

create or replace function public.peya_horario_pendientes()
returns table(remote_id text, accion text, store_code text, hora time, cierre_hasta timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with ahora as (
    select (now() at time zone 'America/El_Salvador') as t
  ), v0 as (
    select v.remote_id, v.sucursal_id, s.store_code, v.cierre_horario_fecha, v.apertura_horario_fecha,
           v.horario_intento_at, v.horario_peya, a.t,
           extract(dow from a.t)::int as dow,
           h.hora_apertura as ap_base, h.hora_cierre as ci_base
      from public.peya_vendor_map v
      join public.sucursales s on s.id = v.sucursal_id
      cross join ahora a
      join public.horarios_sucursal h
        on h.sucursal_id = v.sucursal_id and h.activo
       and h.dia_semana = extract(dow from a.t)::int
     where v.activo and not v.es_pruebas
       and jsonb_array_length(coalesce(v.plataformas, '[]'::jsonb)) > 0
       and (v.horario_intento_at is null or v.horario_intento_at < now() - interval '2 minutes')
  ), v as (
    select v0.*,
           coalesce((v0.horario_peya -> v0.dow::text ->> 'apertura')::time,
                    (v0.horario_peya ->> 'apertura')::time, v0.ap_base) as hora_apertura,
           coalesce((v0.horario_peya -> v0.dow::text ->> 'cierre')::time,
                    (v0.horario_peya ->> 'cierre')::time, v0.ci_base) as hora_cierre,
           (select ((v0.t::date + 1) + coalesce(
                      (v0.horario_peya -> extract(dow from v0.t::date + 1)::int::text ->> 'apertura')::time,
                      (v0.horario_peya ->> 'apertura')::time,
                      h2.hora_apertura, v0.ap_base))
                     at time zone 'America/El_Salvador'
              from public.horarios_sucursal h2
             where h2.sucursal_id = v0.sucursal_id and h2.activo
               and h2.dia_semana = extract(dow from v0.t::date + 1)::int
             limit 1) as proxima_apertura
      from v0
  )
  select v.remote_id, 'cerrar', v.store_code, v.hora_cierre,
         coalesce(v.proxima_apertura, now() + interval '12 hours')
    from v
   where v.t::time >= v.hora_cierre
     and v.cierre_horario_fecha is distinct from v.t::date
  union all
  select v.remote_id, 'abrir', v.store_code, v.hora_apertura, null
    from v
   where v.t::time >= v.hora_apertura and v.t::time < v.hora_cierre
     and v.cierre_horario_fecha is not null
     and v.cierre_horario_fecha < v.t::date
     and v.apertura_horario_fecha is distinct from v.t::date;
$$;

alter table public.peya_ordenes
  add column if not exists devuelto_at          timestamptz,
  add column if not exists devuelto_por         text,
  add column if not exists devolucion_motivo    text,
  add column if not exists devolucion_nota      text,
  add column if not exists devolucion_foto_url  text;

create or replace function public.peya_registrar_devolucion(
  p_pin text, p_orden_id bigint, p_foto_url text, p_motivo text, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user record; v_suc_id uuid; v_o record; v_foto text; v_motivo text;
begin
  select u.rol, u.store_code, u.nombre, u.apellido into v_user
    from public.usuarios_erp u where u.pin = btrim(p_pin) and u.activo limit 1;
  if v_user.store_code is null then raise exception 'PIN inválido'; end if;
  if v_user.rol not in ('gerente','jefe_casa_matriz','admin','superadmin','ejecutivo') then
    raise exception 'Sólo el gerente puede registrar una devolución de PedidosYa';
  end if;

  select id into v_suc_id from public.sucursales where store_code = v_user.store_code;
  select o.id, o.sucursal_id, o.estado, o.devuelto_at, o.pos_cuenta_id, o.short_code
    into v_o from public.peya_ordenes o where o.id = p_orden_id;
  if v_o.id is null then raise exception 'Pedido no encontrado'; end if;
  if v_o.sucursal_id is distinct from v_suc_id
     and v_user.rol not in ('admin','superadmin','ejecutivo') then
    raise exception 'Ese pedido es de otra sucursal';
  end if;
  if v_o.devuelto_at is not null then raise exception 'Esa devolución ya está registrada'; end if;
  if v_o.estado in ('recibido','rechazado') then
    raise exception 'Ese pedido nunca salió de la tienda';
  end if;

  v_foto := nullif(btrim(coalesce(p_foto_url, '')), '');
  if v_foto is null then raise exception 'Falta la foto del motorista con el combo'; end if;
  if v_foto !~ '^https://' then raise exception 'URL de foto inválida'; end if;
  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then raise exception 'Falta el motivo de la devolución'; end if;

  update public.peya_ordenes
     set devuelto_at = now(),
         devuelto_por = btrim(concat_ws(' ', v_user.nombre, v_user.apellido)),
         devolucion_motivo = left(v_motivo, 120),
         devolucion_nota = left(nullif(btrim(coalesce(p_nota, '')), ''), 500),
         devolucion_foto_url = v_foto,
         actualizado_at = now()
   where id = p_orden_id;

  -- Que se vea también en la cuenta del POS (historial / cierre / finanzas).
  if v_o.pos_cuenta_id is not null then
    update public.pos_cuentas
       set notas_internas = concat_ws(E'\n', nullif(notas_internas, ''),
             format('↩️ Devolución PeYa #%s (%s) — %s, %s', v_o.short_code, v_motivo,
                    btrim(concat_ws(' ', v_user.nombre, v_user.apellido)),
                    to_char(now() at time zone 'America/El_Salvador', 'DD/MM HH24:MI')))
     where id = v_o.pos_cuenta_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.peya_registrar_devolucion(text, bigint, text, text, text) from public;
grant execute on function public.peya_registrar_devolucion(text, bigint, text, text, text) to anon, authenticated, service_role;

-- Para el reclamo a PedidosYa y para cuadrar la liquidación: cruza con el CSV del
-- portal (`pedidos_peya`, por número de pedido) para ver si PedidosYa lo canceló y
-- si lo resarció.
create or replace view public.v_peya_devoluciones as
select o.id, s.store_code, s.nombre as sucursal,
       (o.devuelto_at at time zone 'America/El_Salvador') as devuelto_sv,
       (o.recibido_at at time zone 'America/El_Salvador') as pedido_sv,
       o.short_code, o.code as nro_pedido_peya, o.estado,
       (o.payload->'price'->>'grandTotal')::numeric as total_pedido,
       o.devolucion_motivo, o.devolucion_nota, o.devuelto_por, o.devolucion_foto_url,
       o.pos_cuenta_id,
       p.estado as estado_en_portal, p.resarcimientos as resarcido_por_peya
  from public.peya_ordenes o
  left join public.sucursales s on s.id = o.sucursal_id
  left join lateral (
    select pp.estado, pp.resarcimientos from public.pedidos_peya pp
     where pp.nro_pedido::text = o.code limit 1) p on true
 where o.devuelto_at is not null;

revoke all on public.v_peya_devoluciones from anon, authenticated;
grant select on public.v_peya_devoluciones to service_role;

-- El panel devuelve la devolución y todos los pedidos de hoy (no sólo las últimas 3 h).
create or replace function public.peya_panel(p_pin text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user record; v_suc_id uuid; v_todas boolean;
  v_pedidos jsonb; v_tienda jsonb; v_rid text;
begin
  select u.rol, u.store_code, u.nombre into v_user
  from public.usuarios_erp u where u.pin = btrim(p_pin) and u.activo limit 1;

  if v_user.store_code is null then raise exception 'PIN inválido'; end if;
  if v_user.rol not in ('cocina','gerente','cajero','cajera','jefe_casa_matriz',
                        'admin','superadmin','ejecutivo','telefono') then
    raise exception 'Tu rol no puede ver los pedidos de PedidosYa';
  end if;

  v_todas := v_user.rol in ('admin','superadmin','ejecutivo','telefono');
  select id into v_suc_id from public.sucursales where store_code = v_user.store_code;

  select v.remote_id into v_rid from public.peya_vendor_map v
  where v.sucursal_id = v_suc_id and v.activo and not v.es_pruebas limit 1;

  if v_rid is not null then
    v_tienda := public.peya_disponibilidad(v_rid)
      || jsonb_build_object('puede_cambiar',
           v_user.rol in ('gerente','jefe_casa_matriz','admin','superadmin','ejecutivo'));
  end if;

  select coalesce(jsonb_agg(p order by p.orden_prio, p.recibido_at), '[]'::jsonb)
    into v_pedidos
  from (
    select
      o.id, o.remote_order_id, o.order_token, o.estado, o.tipo_orden,
      o.expedition_type, o.es_prueba, o.code, o.short_code, o.expiry_date,
      o.recibido_at, o.aceptado_at, o.preparado_at, o.actualizado_at,
      o.motivo_rechazo, o.respuesta_http, o.notas,
      s.nombre as sucursal, s.store_code,
      case when o.estado = 'recibido' and o.expiry_date is not null
           then greatest(0, floor(extract(epoch from (o.expiry_date - now()))))::int
      end as segundos_restantes,
      public.peya_listo_para_retirar(o.id) as cocina,
      c.numero_orden as numero_orden,
      (select max(q.comanda_numero) from public.pos_cocina_queue q
        where q.cuenta_id = o.pos_cuenta_id) as comanda_numero,
      o.motorista_llego_at,
      o.motorista_esperando,
      o.motorista_cobro_at,
      o.entregado_at, o.entregado_por, o.entrega_foto_url, o.retirado_at,
      o.devuelto_at, o.devuelto_por, o.devolucion_motivo, o.devolucion_nota, o.devolucion_foto_url,
      case when o.entregado_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.entregado_at))))::int
      end as entregado_segundos,
      case when o.retirado_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.retirado_at))))::int
      end as retirado_segundos,
      greatest(0, floor(extract(epoch from (now() - o.recibido_at))))::int as recibido_segundos,
      case when o.motorista_llego_at is not null
           then greatest(0, floor(extract(epoch from (now() - o.motorista_llego_at))))::int
      end as motorista_segundos,
      case when o.motorista_cobro_at is not null
           then floor(extract(epoch from (o.motorista_cobro_at - now())))::int
      end as motorista_segundos_para_cobro,
      o.payload->'customer'  as cliente,
      o.payload->'products'  as productos,
      o.payload->'delivery'  as delivery,
      o.payload->'pickup'    as pickup,
      o.payload->'price'     as precio,
      o.payload->'discounts' as descuentos,
      o.payload->'comments'  as comentarios,
      case when o.estado = 'recibido' then 0
           when o.estado = 'retirado' and o.tipo_orden = 'own_delivery'
                and o.retirado_at > now() - interval '3 minutes' then 1
           when o.estado = 'aceptado' then 2
           when o.estado = 'preparado' then 3 else 4 end as orden_prio
    from public.peya_ordenes o
    left join public.sucursales s on s.id = o.sucursal_id
    left join public.pos_cuentas c on c.id = o.pos_cuenta_id
    where (v_todas or o.sucursal_id = v_suc_id)
      and (o.estado in ('recibido','aceptado','preparado')
           or o.actualizado_at > now() - interval '3 hours'
           -- Todo lo de hoy, para poder registrar una devolución horas después.
           or o.recibido_at >= ((now() at time zone 'America/El_Salvador')::date::timestamp
                                at time zone 'America/El_Salvador')
           or (o.estado = 'retirado' and o.tipo_orden = 'own_delivery'
               and o.entregado_at is null and o.retirado_at > now() - interval '3 hours'))
  ) p;

  return jsonb_build_object('ok', true, 'usuario', v_user.nombre, 'rol', v_user.rol,
    've_todas', v_todas, 'sucursal', v_user.store_code, 'tienda', v_tienda,
    'servidor_ahora', now(), 'pedidos', v_pedidos);
end;
$$;

-- La bandeja PeYa pide el PIN del gerente para rechazar, cerrar a mano o registrar
-- una devolución. Sólo dice si el PIN es de gerencia y de qué tienda.
create or replace function public.peya_es_gerente(p_pin text)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select jsonb_build_object('ok', true, 'nombre', u.nombre, 'store_code', u.store_code)
       from public.usuarios_erp u
      where u.pin = btrim(p_pin) and u.activo
        and u.rol in ('gerente','jefe_casa_matriz','admin','superadmin','ejecutivo')
      limit 1),
    jsonb_build_object('ok', false));
$$;
revoke all on function public.peya_es_gerente(text) from public;
grant execute on function public.peya_es_gerente(text) to anon, authenticated, service_role;
