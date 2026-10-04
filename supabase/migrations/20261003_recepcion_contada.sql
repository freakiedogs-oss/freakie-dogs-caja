-- 3-Oct-2026 — Recepción contada en la sucursal.
-- Por qué: el 2-oct Cafetalón confirmó 10 paquetes de salchicha cuando solo
-- llegaron 5 (la pantalla venía llena con lo despachado y se le dio
-- «Todo completo» sin contar). Además el RPC aceptaba cualquier cantidad
-- recibida, aunque fuera MAYOR a lo despachado, sin ninguna explicación.
-- Qué cambia en despacho_confirmar:
--   1) En la vía humana (p_auto=false) no se puede recibir más de lo
--      despachado si ese producto no trae una nota en p_items[].nota.
--   2) La nota de cada producto se guarda en despacho_items.notas dentro de la
--      misma transacción (antes la app la escribía aparte, después del RPC).
--   3) Sin cambios para el cron reconciliador (p_auto) ni para clientes viejos:
--      si un producto no trae cantidad_recibida se toma la despachada.
CREATE OR REPLACE FUNCTION public.despacho_confirmar(p_despacho_id uuid, p_usuario uuid DEFAULT NULL::uuid, p_foto_url text DEFAULT NULL::text, p_items jsonb DEFAULT NULL::jsonb, p_auto boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_d record; di record; v_x jsonb; v_rec numeric; v_nota text; v_n int := 0; v_dif int := 0;
begin
  -- Firma obligatoria en la vía humana (auditoría 22-ago: 92% de despachos sin recibido_por).
  if not p_auto and p_usuario is null then
    raise exception 'Falta la firma de recepción: p_usuario es obligatorio (quién recibe el despacho)';
  end if;
  -- p_auto es SOLO para el cron reconciliador (corre por SQL directo, sin JWT de PostgREST)
  if p_auto and coalesce(current_setting('request.jwt.claims', true), '') <> '' then
    raise exception 'p_auto es exclusivo del cron reconciliador';
  end if;

  select * into v_d from public.despachos_sucursal where id = p_despacho_id for update;
  if not found then raise exception 'despacho no existe'; end if;
  if v_d.estado = 'recibido' then return jsonb_build_object('ok', true, 'ya_recibido', true); end if;

  for di in select * from public.despacho_items where despacho_id = p_despacho_id loop
    v_x := (select x from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x
             where nullif(x->>'despacho_item_id','')::uuid = di.id
                or nullif(x->>'producto_id','')::uuid = di.producto_id limit 1);
    v_rec  := coalesce((v_x->>'cantidad_recibida')::numeric, di.cantidad_despachada);
    v_nota := nullif(btrim(coalesce(v_x->>'nota','')), '');

    if v_rec < 0 then
      raise exception 'Cantidad recibida negativa en %', coalesce(di.descripcion, di.producto_id::text);
    end if;
    -- Recepción contada (3-oct-2026): recibir MÁS de lo despachado exige explicarlo.
    if not p_auto and v_rec > coalesce(di.cantidad_despachada,0) and v_nota is null then
      raise exception 'No se puede recibir más de lo despachado sin una nota que explique por qué (%: despachado %, recibido %)',
        coalesce(di.descripcion, di.producto_id::text), di.cantidad_despachada, v_rec;
    end if;

    if di.producto_id is not null and coalesce(v_rec,0) <> 0 then
      perform public.kardex_mover(di.producto_id, v_d.sucursal_id, 'traslado', v_rec,
        'despacho', p_despacho_id,
        case when p_auto then 'Recepción de despacho AUTO-CONFIRMADA por cron (sin firma humana)'
             else 'Recepción de despacho en sucursal' end,
        p_usuario, true);
    end if;
    update public.despacho_items
       set cantidad_recibida = v_rec,
           notas = case when v_nota is null then notas
                        else concat_ws(' | ', nullif(notas,''), v_nota) end
     where id = di.id;
    if coalesce(v_rec,0) <> coalesce(di.cantidad_despachada,0) then v_dif := v_dif + 1; end if;
    v_n := v_n + 1;
  end loop;

  update public.despachos_sucursal
     set estado = 'recibido', fecha_recepcion = now(),
         hora_recepcion = now(),
         recibido_por = coalesce(p_usuario, recibido_por),
         foto_recepcion_url = coalesce(p_foto_url, foto_recepcion_url),
         notas_recepcion = case when p_auto
           then concat_ws(' | ', nullif(notas_recepcion,''), 'AUTO-CONFIRMADO por cron (sin firma humana)')
           else notas_recepcion end,
         updated_at = now()
   where id = p_despacho_id;
  if v_d.pedido_id is not null then
    update public.pedidos_sucursal set estado = 'recibido' where id = v_d.pedido_id;
  end if;
  return jsonb_build_object('ok', true, 'items', v_n, 'con_diferencia', v_dif, 'auto', p_auto);
end;
$function$;
