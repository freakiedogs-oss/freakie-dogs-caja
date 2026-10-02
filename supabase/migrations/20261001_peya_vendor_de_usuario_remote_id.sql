-- peya_vendor_de_usuario: la tienda sandbox de Delivery Hero
-- (AR-PRUEBAS-INTEGRACION-0001, es_pruebas) estaba excluida SIEMPRE, así que
-- abrir/cerrar «la tienda» nunca pudo apuntar a la de homologación. Ahora un
-- rol de todas las tiendas puede nombrar el remote_id (incluida la sandbox);
-- un rol de tienda sigue derivándolo de su sucursal, sin la sandbox.
--
-- Datos que se corrigieron a mano el 1-oct junto con esto (peya_vendor_map,
-- fila AR-PRUEBAS-INTEGRACION-0001):
--   chain_code       = 'SVFREAKIEDOGSTEST0001'   (estaba null → toda URL rota)
--   vendor_code      = remote_id                 (el posVendorId del contrato es
--                                                 NUESTRO id, no el platformRestaurantId;
--                                                 con 478876 DH contesta «Vendor does not exist»)
--   global_entity_id = 'PY_AR'                    (lo devolvió el GET de availability)
create or replace function public.peya_vendor_de_usuario(p_pin text, p_remote_id text default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_user record; v_v record; v_todas boolean;
begin
  select u.rol, u.store_code, u.nombre into v_user
  from public.usuarios_erp u where u.pin = btrim(p_pin) and u.activo limit 1;
  if v_user.store_code is null then
    return jsonb_build_object('ok', false, 'error', 'pin_invalido');
  end if;
  if v_user.rol not in ('gerente','jefe_casa_matriz','admin','superadmin','ejecutivo') then
    return jsonb_build_object('ok', false, 'error', 'rol_sin_permiso',
      'message', 'Tu rol no puede abrir ni cerrar la tienda en PedidosYa');
  end if;
  v_todas := v_user.rol in ('jefe_casa_matriz','admin','superadmin','ejecutivo');

  if nullif(btrim(coalesce(p_remote_id, '')), '') is not null then
    if not v_todas then
      return jsonb_build_object('ok', false, 'error', 'tienda_ajena',
        'message', 'Tu PIN sólo puede operar la tienda de tu sucursal.');
    end if;
    select v.remote_id, v.chain_code, v.plataformas, v.es_pruebas into v_v
    from public.peya_vendor_map v
    where v.remote_id = btrim(p_remote_id) and v.activo
    limit 1;
  else
    select v.remote_id, v.chain_code, v.plataformas, v.es_pruebas into v_v
    from public.peya_vendor_map v
    join public.sucursales s on s.id = v.sucursal_id
    where s.store_code = v_user.store_code and v.activo and not v.es_pruebas
    limit 1;
  end if;

  if v_v.remote_id is null then
    return jsonb_build_object('ok', false, 'error', 'sin_vendor',
      'message', 'Esta sucursal todavía no tiene tienda mapeada en PedidosYa.');
  end if;
  if v_v.chain_code is null then
    return jsonb_build_object('ok', false, 'error', 'sin_chain_code',
      'message', 'Falta el ChainCode de esta tienda. Sin él la URL de PedidosYa no se arma.');
  end if;

  return jsonb_build_object('ok', true, 'remote_id', v_v.remote_id,
    'chain_code', v_v.chain_code, 'plataformas', v_v.plataformas, 'es_pruebas', v_v.es_pruebas,
    'por', v_user.nombre, 'sucursal', v_user.store_code, 'rol', v_user.rol);
end $function$;
