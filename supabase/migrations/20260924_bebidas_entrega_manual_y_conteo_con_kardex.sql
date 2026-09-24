-- 24-sep-2026 · Bebidas de La Constancia: entrega manual + conteo que ajusta inventario
-- (pedido de Frank, Yasmín y Jose)
--
-- Situación que lo motiva:
--  * La ingesta automática por correo no registra nada desde el 04-sep, y el
--    "+ Manual" de Recepción BEES (OCR + INSERT directo) lo bloquea RLS para anon.
--    Resultado: ninguna entrega de La Constancia entraba al inventario.
--  * El conteo de bebidas no tocaba el kardex; el stock de bebidas vivía muy en
--    negativo (Coca PET −1,078 en Cafetalón).
--  * bees_recepcionar sumaba CAJAS al kardex, pero el stock de bebidas vive en
--    UNIDADES (botella/lata) desde el 01-sep: 80 cajas entraban como 80 botellas.
--
-- Qué agrega:
--  1. bebida_factor_caja(producto): cuántas unidades trae la caja (una sola fuente
--     para la pantalla y el servidor).
--  2. bees_catalogo_entrega(sucursal): lista de bebidas para registrar la entrega.
--  3. bees_registrar_entrega(...): entrega manual con foto del recibo. Crea la
--     compra ya recibida y suma al kardex en unidades, todo en una transacción,
--     idempotente por client_token, y pide confirmación si ya hubo otra entrega hoy.
--  4. bees_recepcionar: convierte cajas → unidades y no deja recibir pedidos de
--     hace más de 10 días (sumarían al inventario algo que ya se vendió).
--  5. conteo_bebidas_aplicar(...): el conteo de bebidas guardado deja el
--     inventario igual a lo contado (kardex conteo_fisico, referencia conteo_bebidas).

alter table public.compras_bees add column if not exists client_token text;
create unique index if not exists compras_bees_client_token_uq
  on public.compras_bees (client_token) where client_token is not null;

alter table public.inventario_conteo_bebidas
  add column if not exists aplicado_inventario_at timestamptz,
  add column if not exists resultado jsonb;

-- 1 ──────────────────────────────────────────────────────────────────────────
create or replace function public.bebida_factor_caja(p_producto_id uuid)
returns numeric language sql stable set search_path = public as $$
  select case when coalesce(conteo_factor, 0) > 1 then conteo_factor
              when coalesce(factor_compra, 0) > 1 then factor_compra
              else 1 end
    from public.catalogo_productos where id = p_producto_id
$$;

-- 2 ──────────────────────────────────────────────────────────────────────────
create or replace function public.bees_catalogo_entrega(p_sucursal_id uuid)
returns table (producto_id uuid, nombre text, grupo text, grupo_orden int, factor numeric,
               unidad_caja text, unidad_suelta text, en_sucursal boolean, orden int)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, g.grupo, g.orden,
         public.bebida_factor_caja(p.id),
         case when public.bebida_factor_caja(p.id) > 1
              then coalesce(p.conteo_unidad, 'Caja de ' || public.bebida_factor_caja(p.id)::int || ' unidades')
              else 'Unidad' end,
         coalesce(p.conteo_unidad_suelta,
                  case when p.nombre ilike '%lata%' then 'latas' else 'botellas' end),
         exists (select 1 from public.inventario i where i.producto_id = p.id and i.sucursal_id = p_sucursal_id),
         coalesce(p.conteo_orden, 999)
    from public.catalogo_productos p
    cross join lateral (select case
        when p.nombre ilike 'nescaf%' or p.nombre ilike '%nescaf%' then 'Nescafé'
        when p.nombre ilike 'cerveza%' then 'Cervezas'
        when p.nombre ilike 'agua%' then 'Agua'
        when p.nombre ilike '%lata%' then 'Latas'
        when p.nombre ilike '%pet%' then 'Plástico (PET)'
        else 'Vidrio' end as grupo) g0
    cross join lateral (select g0.grupo, case g0.grupo
        when 'Plástico (PET)' then 1 when 'Vidrio' then 2 when 'Latas' then 3
        when 'Agua' then 4 when 'Cervezas' then 5 else 6 end as orden) g
   where p.activo and p.conteo_modo = 'bebidas'
   order by g.orden, coalesce(p.conteo_orden, 999), p.nombre
$$;

-- 3 ──────────────────────────────────────────────────────────────────────────
create or replace function public.bees_registrar_entrega(
  p_sucursal_id uuid,
  p_usuario_id uuid,
  p_items jsonb,                       -- [{producto_id, cajas, sueltas}]
  p_foto_url text,
  p_numero_documento text default null,
  p_monto_total numeric default null,
  p_notas text default null,
  p_client_token text default null,
  p_confirmar_repetida boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_suc record; v_usr record; v_prod record; it jsonb;
  v_id uuid; v_exist uuid;
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_cajas numeric; v_sueltas numeric; v_factor numeric; v_unid numeric;
  v_kardex jsonb := '[]'::jsonb; v_resumen jsonb := '[]'::jsonb;
  v_linea int := 0; v_total_unid numeric := 0; v_cuenta text; v_doc text;
  v_previas jsonb; v_monto numeric := greatest(coalesce(p_monto_total, 0), 0);
begin
  -- Reintento del mismo envío (doble tap, señal que se cae): no duplica.
  if nullif(p_client_token, '') is not null then
    select id into v_exist from public.compras_bees where client_token = p_client_token;
    if found then
      return jsonb_build_object('ok', true, 'ya_registrado', true, 'id', v_exist);
    end if;
  end if;

  select id, nombre, store_code into v_suc from public.sucursales where id = p_sucursal_id;
  if not found then raise exception 'Sucursal no encontrada'; end if;

  select id, nombre, apellido, rol, store_code, activo into v_usr
    from public.usuarios_erp where id = p_usuario_id;
  if not found or not v_usr.activo then raise exception 'Usuario no válido'; end if;
  if v_usr.rol not in ('gerente','cajero','cajera','cocina','jefe_casa_matriz','admin','ejecutivo','superadmin') then
    raise exception 'Tu usuario no puede registrar entregas de bebidas';
  end if;
  if v_usr.rol in ('gerente','cajero','cajera','cocina') and coalesce(v_usr.store_code, '') <> v_suc.store_code then
    raise exception 'Solo podés registrar entregas de tu sucursal';
  end if;

  if nullif(btrim(coalesce(p_foto_url, '')), '') is null then
    raise exception 'Falta la foto del recibo o de la captura de La Constancia';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay bebidas en la entrega';
  end if;

  -- ¿Ya se registró otra entrega hoy en esta sucursal? Puede ser legítimo (dos
  -- camiones), pero lo normal es un doble registro: se pide confirmar.
  select jsonb_agg(jsonb_build_object('hora', to_char(created_at at time zone 'America/El_Salvador', 'HH24:MI'),
                                      'items', items_count, 'doc', id_factura))
    into v_previas
    from public.compras_bees
   where sucursal_id = p_sucursal_id and origen = 'manual_sucursal'
     and fecha_recepcion_real = v_hoy and estado_recepcion = 'recepcionado';
  if v_previas is not null and not p_confirmar_repetida then
    return jsonb_build_object('ok', false, 'requiere_confirmacion', true, 'previas', v_previas);
  end if;

  select numero_cuenta into v_cuenta from public.compras_bees
   where sucursal_id = p_sucursal_id and numero_cuenta is not null and numero_cuenta <> '0'
   order by fecha desc limit 1;

  v_doc := nullif(btrim(coalesce(p_numero_documento, '')), '');
  if v_doc is not null and exists (select 1 from public.compras_bees where id_factura = v_doc) then
    raise exception 'La factura % ya está registrada. Revisá en «Recibidos».', v_doc;
  end if;

  insert into public.compras_bees (
    id_factura, numero_pedido, numero_cuenta, sucursal_id, store_code, proveedor_nombre,
    fecha, sucursal_header, subtotal, impuestos, ahorro, monto_total, items_count,
    categoria, subcategoria, estado_recepcion, fecha_recepcion_real, recepcionado_por,
    foto_recepcion_url, notas_recepcion, inventariado, creado_por, origen, client_token)
  values (
    coalesce(v_doc, 'ENTREGA-' || v_suc.store_code || '-' ||
             to_char(now() at time zone 'America/El_Salvador', 'YYMMDD-HH24MISS')),
    v_doc, coalesce(v_cuenta, '0'), p_sucursal_id, v_suc.store_code, 'LA CONSTANCIA (BEES)',
    v_hoy, v_suc.nombre, round(v_monto / 1.13, 2), v_monto - round(v_monto / 1.13, 2), 0, v_monto, 0,
    'costo_comida', 'bebidas', 'recepcionado', v_hoy, p_usuario_id,
    p_foto_url, nullif(btrim(coalesce(p_notas, '')), ''), false, p_usuario_id, 'manual_sucursal',
    nullif(p_client_token, ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_items) loop
    select id, nombre, activo, conteo_modo into v_prod
      from public.catalogo_productos where id = nullif(it->>'producto_id', '')::uuid;
    if not found or not v_prod.activo or v_prod.conteo_modo is distinct from 'bebidas' then
      raise exception 'Producto no válido para entrega de bebidas: %', it->>'producto_id';
    end if;
    v_cajas   := coalesce(nullif(it->>'cajas', '')::numeric, 0);
    v_sueltas := coalesce(nullif(it->>'sueltas', '')::numeric, 0);
    if v_cajas < 0 or v_sueltas < 0 then raise exception 'Cantidad negativa en %', v_prod.nombre; end if;
    if v_cajas > 500 then raise exception '% cajas de % parece un error de digitación', v_cajas, v_prod.nombre; end if;
    v_factor := public.bebida_factor_caja(v_prod.id);
    v_unid := v_cajas * v_factor + v_sueltas;
    if v_unid <= 0 then continue; end if;

    v_linea := v_linea + 1;
    insert into public.compras_bees_items (
      compra_bees_id, linea, descripcion, empaque, cantidad, cantidad_recibida, total,
      producto_id, confianza_mapeo, notas_item)
    values (
      v_id, v_linea, v_prod.nombre,
      case when v_factor > 1 then 'Caja de ' || v_factor::int else 'Unidad' end,
      round(v_unid / v_factor, 4), round(v_unid / v_factor, 4), 0,
      v_prod.id, 'manual',
      case when v_factor > 1
           then format('%s caja(s) + %s suelta(s) = %s unidades', v_cajas, v_sueltas, v_unid)
           else format('%s unidades', v_unid) end);

    v_kardex := v_kardex || jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', v_unid));
    v_resumen := v_resumen || jsonb_build_array(jsonb_build_object(
      'nombre', v_prod.nombre, 'cajas', v_cajas, 'sueltas', v_sueltas, 'unidades', v_unid));
    v_total_unid := v_total_unid + v_unid;
  end loop;

  if v_linea = 0 then raise exception 'Todas las cantidades están en cero'; end if;

  perform public.kardex_mover_lote(
    v_kardex, 'recepcion', 'compras_bees', v_id,
    'Entrega La Constancia (registro manual)' || coalesce(' · Doc ' || v_doc, ''),
    p_usuario_id, p_sucursal_id, true);

  update public.compras_bees
     set items_count = v_linea, inventariado = true, fecha_inventariado = now(), updated_at = now()
   where id = v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'productos', v_linea,
                            'unidades', v_total_unid, 'resumen', v_resumen);
end;
$$;

-- 4 ──────────────────────────────────────────────────────────────────────────
create or replace function public.bees_recepcionar(
  p_compra_id uuid, p_items jsonb default null, p_usuario_id uuid default null,
  p_foto_url text default null, p_notas text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_compra public.compras_bees%rowtype;
  it jsonb;
  v_kardex jsonb := '[]'::jsonb;
  v_n int := 0;
  r record;
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  select * into v_compra from public.compras_bees where id = p_compra_id for update;
  if not found then
    raise exception 'Compra BEES % no encontrada', p_compra_id;
  end if;
  if v_compra.inventariado then
    return jsonb_build_object('ok', true, 'ya_recepcionado', true, 'items_kardex', 0);
  end if;
  -- Un pedido de hace semanas ya se vendió: sumarlo hoy inflaría el inventario
  -- justo después del conteo. Se cierra desde administración.
  if v_compra.fecha < v_hoy - 10 then
    raise exception 'Este pedido es del % (hace % días). No lo confirmes aquí: pedile a administración que lo cierre.',
      to_char(v_compra.fecha, 'DD-MM-YYYY'), v_hoy - v_compra.fecha;
  end if;

  if jsonb_typeof(p_items) = 'array' then
    for it in select * from jsonb_array_elements(p_items) loop
      update public.compras_bees_items
         set cantidad_recibida = (it->>'cantidad_recibida')::numeric
       where id = (it->>'id')::uuid and compra_bees_id = p_compra_id;
    end loop;
  end if;

  -- BEES factura CAJAS; el stock de bebidas vive en UNIDADES (botella/lata).
  -- Factor: el "N un." de la descripción de BEES (lo que de verdad trae esa
  -- caja) y si no lo trae, el de la caja del producto.
  for r in
    select i.producto_id,
           coalesce(i.cantidad_recibida, i.cantidad)
             * coalesce(nullif((regexp_match(i.descripcion, '(\d+)\s*un\.?(\s|$)', 'i'))[1], '')::numeric,
                        public.bebida_factor_caja(i.producto_id), 1) as qty
      from public.compras_bees_items i
     where i.compra_bees_id = p_compra_id
       and i.producto_id is not null
       and coalesce(i.cantidad_recibida, i.cantidad) > 0
  loop
    v_kardex := v_kardex || jsonb_build_array(jsonb_build_object('producto_id', r.producto_id, 'cantidad', r.qty));
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    perform public.kardex_mover_lote(
      v_kardex, 'recepcion', 'compras_bees', p_compra_id,
      'Recepción BEES — La Constancia' || coalesce(' · Fact ' || v_compra.id_factura, ''),
      p_usuario_id, v_compra.sucursal_id, true);
  end if;

  update public.compras_bees set
    estado_recepcion     = 'recepcionado',
    fecha_recepcion_real = v_hoy,
    recepcionado_por     = p_usuario_id,
    foto_recepcion_url   = coalesce(p_foto_url, foto_recepcion_url),
    notas_recepcion      = coalesce(nullif(btrim(coalesce(p_notas,'')), ''), notas_recepcion),
    inventariado         = (v_n > 0),
    fecha_inventariado   = case when v_n > 0 then now() else fecha_inventariado end,
    updated_at           = now()
  where id = p_compra_id;

  return jsonb_build_object('ok', true, 'items_kardex', v_n);
end;
$$;

-- 5 ──────────────────────────────────────────────────────────────────────────
create or replace function public.conteo_bebidas_aplicar(
  p_sucursal_id uuid,
  p_usuario_id uuid,
  p_items jsonb)                       -- [{producto_id, cantidad_real, cerrados, sueltas}]
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_suc record; v_usr record; it jsonb; v_prod record;
  v_hoy date := (now() at time zone 'America/El_Salvador')::date;
  v_k jsonb := '[]'::jsonb; v_res jsonb; v_det jsonb; v_items jsonb := '[]'::jsonb;
  v_cant numeric; v_n int := 0; d jsonb;
begin
  select id, store_code into v_suc from public.sucursales where id = p_sucursal_id;
  if not found then raise exception 'Sucursal no encontrada'; end if;
  select id, nombre, activo into v_usr from public.usuarios_erp where id = p_usuario_id;
  if not found or not v_usr.activo then raise exception 'Usuario no válido'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay bebidas contadas';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select id, conteo_modo into v_prod from public.catalogo_productos
     where id = nullif(it->>'producto_id', '')::uuid;
    if not found or v_prod.conteo_modo is distinct from 'bebidas' then
      raise exception 'Producto fuera del conteo de bebidas: %', it->>'producto_id';
    end if;
    v_cant := nullif(it->>'cantidad_real', '')::numeric;
    if v_cant is null then raise exception 'Hay bebidas sin contar'; end if;
    if v_cant < 0 then raise exception 'Cantidad negativa en el conteo'; end if;
    v_k := v_k || jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', v_cant));
    v_n := v_n + 1;
  end loop;

  v_res := public.kardex_ajustar_absoluto(
    v_k, 'conteo_fisico', 'conteo_bebidas', null,
    'Conteo de bebidas ' || v_hoy, p_usuario_id, p_sucursal_id);

  -- Guarda lo contado con lo que decía el sistema al momento de contar.
  for it in select * from jsonb_array_elements(p_items) loop
    d := null;
    select x.value into d from jsonb_array_elements(coalesce(v_res->'detalle', '[]'::jsonb)) as x(value)
     where x.value->>'producto_id' = it->>'producto_id' limit 1;
    v_items := v_items || jsonb_build_array(it || jsonb_build_object(
      'sistema',    coalesce((d->>'sistema')::numeric, (it->>'cantidad_real')::numeric),
      'diferencia', coalesce((d->>'diferencia')::numeric, 0)));
  end loop;

  insert into public.inventario_conteo_bebidas as c (
    sucursal_id, store_code, fecha, contado_por, contado_por_nombre, items, total_items,
    guardado_at, guardado_por, guardado_por_nombre, updated_at, aplicado_inventario_at, resultado)
  values (
    p_sucursal_id, v_suc.store_code, v_hoy, p_usuario_id, v_usr.nombre, v_items, v_n,
    now(), p_usuario_id, v_usr.nombre, now(), now(), v_res)
  on conflict (sucursal_id, fecha) do update set
    items = excluded.items, total_items = excluded.total_items,
    guardado_at = excluded.guardado_at, guardado_por = excluded.guardado_por,
    guardado_por_nombre = excluded.guardado_por_nombre, updated_at = excluded.updated_at,
    aplicado_inventario_at = excluded.aplicado_inventario_at, resultado = excluded.resultado;

  return v_res || jsonb_build_object('contadas', v_n, 'aplicado_at', now());
end;
$$;

grant execute on function public.bebida_factor_caja(uuid) to anon, authenticated;
grant execute on function public.bees_catalogo_entrega(uuid) to anon, authenticated;
grant execute on function public.bees_registrar_entrega(uuid, uuid, jsonb, text, text, numeric, text, text, boolean) to anon, authenticated;
grant execute on function public.bees_recepcionar(uuid, jsonb, uuid, text, text) to anon, authenticated;
grant execute on function public.conteo_bebidas_aplicar(uuid, uuid, jsonb) to anon, authenticated;
