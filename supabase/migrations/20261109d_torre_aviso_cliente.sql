-- ════════════════════════════════════════════════════════════════════
-- Torre · «Avisar al cliente» (9-nov-2026, pedido de Cesar)
-- Karina pone/quita el aviso amarillo del tracking (aviso_cliente, aviso_tel).
-- El teléfono se llena con el del motorista (empleados.telefono); si no está,
-- lo escribe y puede guardarlo para la próxima.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.torre_aviso_cliente_datos(p_token uuid, p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ignore record; r record;
begin
  select * into v_ignore from _staff_valida(p_token);
  select d.numero_orden, d.estado, d.cliente_nombre, d.aviso_cliente, d.aviso_tel, d.aviso_at,
         d.motorista_id, e.nombre_completo motorista, e.telefono motorista_tel
    into r
    from delivery_clientes d left join empleados e on e.id = d.motorista_id
   where d.id = p_delivery_id;
  if not found then raise exception 'Ese pedido no existe'; end if;
  return jsonb_build_object('ok', true, 'numero_orden', r.numero_orden, 'estado', r.estado,
    'cliente', split_part(btrim(coalesce(r.cliente_nombre,'')), ' ', 1),
    'aviso', r.aviso_cliente, 'aviso_tel', r.aviso_tel, 'aviso_at', r.aviso_at,
    'motorista_id', r.motorista_id, 'motorista', split_part(btrim(coalesce(r.motorista,'')), ' ', 1)
       || coalesce(' ' || nullif(split_part(btrim(coalesce(r.motorista,'')), ' ', 2), ''), ''),
    'motorista_tel', r.motorista_tel);
end;
$function$;

create or replace function public.torre_aviso_cliente(p_token uuid, p_delivery_id uuid, p_texto text,
                                                      p_tel text default null, p_guardar_tel_motorista boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_ignore record; v_mot uuid; v_tel text;
begin
  select * into v_ignore from _staff_valida(p_token);
  v_tel := nullif(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), '');
  if v_tel is not null and v_tel !~ '^(503)?[267][0-9]{7}$' then raise exception 'Revisá el teléfono: 8 dígitos que empiezan con 2, 6 o 7'; end if;
  update delivery_clientes
     set aviso_cliente = nullif(left(btrim(coalesce(p_texto, '')), 300), ''),
         aviso_tel = case when nullif(btrim(coalesce(p_texto, '')), '') is null then null else v_tel end,
         aviso_at = case when nullif(btrim(coalesce(p_texto, '')), '') is null then null else now() end
   where id = p_delivery_id
   returning motorista_id into v_mot;
  if not found then raise exception 'Ese pedido no existe'; end if;
  if p_guardar_tel_motorista and v_tel is not null and v_mot is not null then
    update empleados set telefono = right(v_tel, 8) where id = v_mot;
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;
grant execute on function public.torre_aviso_cliente_datos(uuid, uuid) to anon, authenticated;
grant execute on function public.torre_aviso_cliente(uuid, uuid, text, text, boolean) to anon, authenticated;
