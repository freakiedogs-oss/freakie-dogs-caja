-- 27-sep-2026 (Frank): transferencias de BEBIDAS entre sucursales, hechas por los encargados
-- desde «Bebidas La Constancia» (Recepción BEES). Solo dos rutas y en un solo sentido:
--   Plaza Cafetalón (M001, Santa Tecla) → Metrocentro (S006)
--   Plaza Mundo Soyapango (S001)        → Plaza Mundo Usulután (S002)
-- Solo bebidas de La Constancia (conteo_modo='bebidas', sin Nescafé).
-- Va montado sobre el mismo flujo de transferencias del 31-ago (despachos_sucursal con
-- origen_sucursal_id): sale del kardex del origen al crearla (traslado) y entra al destino
-- cuando el encargado de destino la confirma (despacho_confirmar). Sin motorista obligatorio.

create table if not exists public.transferencia_rutas (
  id bigint generated always as identity primary key,
  origen_sucursal_id uuid not null references public.sucursales(id),
  destino_sucursal_id uuid not null references public.sucursales(id),
  tipo text not null default 'bebidas' check (tipo in ('bebidas')),
  activa boolean not null default true,
  nota text,
  created_at timestamptz not null default now(),
  unique (origen_sucursal_id, destino_sucursal_id, tipo),
  check (origen_sucursal_id <> destino_sucursal_id)
);
alter table public.transferencia_rutas enable row level security;
create policy transferencia_rutas_select on public.transferencia_rutas for select to anon, authenticated using (true);
grant select on public.transferencia_rutas to anon, authenticated;

insert into public.transferencia_rutas (origen_sucursal_id, destino_sucursal_id, tipo, nota)
select o.id, d.id, 'bebidas', x.nota
  from (values ('M001','S006','Frank 27-sep: Tecla (Cafetalón) → Metrocentro'),
               ('S001','S002','Frank 27-sep: Plaza Mundo Soyapango → Plaza Mundo Usulután')) x(o, d, nota)
  join public.sucursales o on o.store_code = x.o
  join public.sucursales d on d.store_code = x.d
on conflict (origen_sucursal_id, destino_sucursal_id, tipo) do nothing;

-- ── Crear: el encargado del ORIGEN manda cajas + sueltas ──
create or replace function public.transferencia_bebidas_crear(
  p_usuario_id uuid, p_origen_sucursal_id uuid, p_items jsonb, p_notas text default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_u record; v_origen record; v_destino record; v_despacho uuid;
  it jsonb; v_p record; v_factor numeric; v_cajas numeric; v_sueltas numeric; v_qty numeric;
  v_n int := 0; v_unid numeric := 0; v_costo numeric := 0; v_resumen jsonb := '[]'::jsonb;
begin
  select id, nombre, rol, store_code into v_u from public.usuarios_erp where id = p_usuario_id and activo;
  if not found then raise exception 'Usuario no válido'; end if;

  select id, nombre, store_code into v_origen from public.sucursales where id = p_origen_sucursal_id;
  if not found then raise exception 'Sucursal de origen no existe'; end if;

  -- Encargado (gerente) de la sucursal que manda, o administración.
  if not (v_u.rol in ('admin','superadmin','ejecutivo','jefe_casa_matriz')
          or (v_u.rol = 'gerente' and v_u.store_code = v_origen.store_code)) then
    raise exception 'Solo el encargado de % puede mandar bebidas desde esa sucursal', v_origen.nombre;
  end if;

  -- La ruta define el destino: no se elige libremente.
  select s.id, s.nombre, s.store_code into v_destino
    from public.transferencia_rutas r join public.sucursales s on s.id = r.destino_sucursal_id
   where r.origen_sucursal_id = p_origen_sucursal_id and r.tipo = 'bebidas' and r.activa
   limit 1;
  if not found then
    raise exception '% no tiene transferencias de bebidas habilitadas', v_origen.nombre;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos una bebida';
  end if;

  insert into public.despachos_sucursal
    (sucursal_id, origen_sucursal_id, pedido_id, fecha_despacho, estado,
     preparado_por, hora_salida, notas_despacho)
  values
    (v_destino.id, v_origen.id, null, (now() at time zone 'America/El_Salvador')::date, 'despachado',
     v_u.id, now(),
     'TRANSFERENCIA BEBIDAS desde ' || v_origen.nombre || ' (' || v_u.nombre || ')'
       || coalesce(' — ' || nullif(btrim(p_notas),''), ''))
  returning id into v_despacho;

  for it in select * from jsonb_array_elements(p_items) loop
    select id, nombre, unidad_medida, precio_referencia, conteo_modo into v_p
      from public.catalogo_productos where id = nullif(it->>'producto_id','')::uuid and activo;
    if not found then raise exception 'Producto % no existe', it->>'producto_id'; end if;
    if v_p.conteo_modo is distinct from 'bebidas' or v_p.nombre ilike '%nescaf%' then
      raise exception '«%» no es bebida de La Constancia: solo se transfieren bebidas', v_p.nombre;
    end if;

    v_factor  := greatest(coalesce(public.bebida_factor_caja(v_p.id), 1), 1);
    v_cajas   := greatest(coalesce((it->>'cajas')::numeric, 0), 0);
    v_sueltas := greatest(coalesce((it->>'sueltas')::numeric, 0), 0);
    if v_cajas <> trunc(v_cajas) or v_sueltas <> trunc(v_sueltas) then
      raise exception 'Cajas y sueltas van en números enteros (%)', v_p.nombre;
    end if;
    v_qty := v_cajas * v_factor + v_sueltas;
    if v_qty <= 0 then continue; end if;

    insert into public.despacho_items
      (despacho_id, producto_id, descripcion, cantidad_despachada, unidad_medida, costo_unitario)
    values (v_despacho, v_p.id, v_p.nombre, v_qty, coalesce(v_p.unidad_medida,'unidad'),
            coalesce(v_p.precio_referencia,0));

    perform public.kardex_mover(v_p.id, v_origen.id, 'traslado', -v_qty, 'despacho', v_despacho,
      'Salida por transferencia de bebidas a ' || v_destino.nombre, v_u.id, true);

    v_n := v_n + 1; v_unid := v_unid + v_qty;
    v_costo := v_costo + v_qty * coalesce(v_p.precio_referencia,0);
    v_resumen := v_resumen || jsonb_build_object('nombre', v_p.nombre, 'cajas', v_cajas,
                                                 'sueltas', v_sueltas, 'unidades', v_qty);
  end loop;

  if v_n = 0 then raise exception 'Ninguna bebida con cantidad mayor a cero'; end if;
  update public.despachos_sucursal set costo_total = v_costo where id = v_despacho;

  return jsonb_build_object('ok', true, 'despacho_id', v_despacho, 'productos', v_n,
    'unidades', v_unid, 'origen', v_origen.nombre, 'destino', v_destino.nombre, 'resumen', v_resumen);
end $function$;

-- ── Recibir: el encargado del DESTINO confirma lo que llegó (lo que no toca, llegó completo) ──
create or replace function public.transferencia_bebidas_recibir(
  p_usuario_id uuid, p_despacho_id uuid, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_u record; v_d record; v_dest text;
begin
  select id, nombre, rol, store_code into v_u from public.usuarios_erp where id = p_usuario_id and activo;
  if not found then raise exception 'Usuario no válido'; end if;

  select * into v_d from public.despachos_sucursal where id = p_despacho_id;
  if not found or v_d.origen_sucursal_id is null then raise exception 'Esa transferencia no existe'; end if;
  if v_d.estado = 'recibido' then return jsonb_build_object('ok', true, 'ya_recibido', true); end if;

  select store_code into v_dest from public.sucursales where id = v_d.sucursal_id;
  if not (v_u.rol in ('admin','superadmin','ejecutivo','jefe_casa_matriz')
          or (v_u.store_code = v_dest and v_u.rol in ('gerente','cocina','cajera','cajero'))) then
    raise exception 'Solo el personal de la sucursal que recibe puede confirmarla';
  end if;

  return public.despacho_confirmar(p_despacho_id, p_usuario_id, null, p_items, false);
end $function$;

revoke all on function public.transferencia_bebidas_crear(uuid, uuid, jsonb, text) from public;
revoke all on function public.transferencia_bebidas_recibir(uuid, uuid, jsonb) from public;
grant execute on function public.transferencia_bebidas_crear(uuid, uuid, jsonb, text) to anon, authenticated;
grant execute on function public.transferencia_bebidas_recibir(uuid, uuid, jsonb) to anon, authenticated;
