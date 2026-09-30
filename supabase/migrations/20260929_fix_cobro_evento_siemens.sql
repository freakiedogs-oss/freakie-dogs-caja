-- Corrige el cobro del 29-sep en Cafetalón (130 Coca-Cola Combo, $519.20, link de pago,
-- crédito fiscal): era el pago del Evento Siemens del 30-sep. Se marca como cobro de
-- evento y se devuelve al inventario lo que descontó, sin cambiar el stock de hoy:
-- el conteo de esa noche ya había dejado el stock en lo físico, así que la devolución
-- se registra justo después de la venta y el conteo se recalcula (su diferencia baja).
-- La factura no se toca.
do $fix$
declare
  v_cuenta uuid := 'edcf87c7-2297-45f0-a491-a1697ac64b20';
  v_evento uuid;
  v_suc uuid; v_t timestamptz; r record; v_conteo record; v_nota text;
begin
  select id into v_evento from public.eventos where nombre = 'Evento Siemens' and fecha_evento = '2026-09-30';
  if v_evento is null then raise exception 'No se encontró el Evento Siemens'; end if;
  select sucursal_id, max(created_at) into v_suc, v_t from public.kardex_movimientos
   where referencia_tipo='pos_cuenta' and referencia_id=v_cuenta and tipo='venta' group by sucursal_id;
  if v_suc is null then raise exception 'La cuenta no tiene venta en kardex'; end if;
  if exists (select 1 from public.kardex_movimientos where referencia_id=v_cuenta and tipo='devolucion') then
    raise exception 'Ya se corrigió antes';
  end if;

  update public.pos_cuentas set tipo='evento', evento_id=v_evento where id=v_cuenta;
  v_nota := 'Cobro de evento (Evento Siemens 30-sep): se cobró y facturó en Cafetalón pero no salió de su inventario. Corrección OK Frank 29-sep';

  for r in select producto_id, -sum(cantidad) q from public.kardex_movimientos
            where referencia_tipo='pos_cuenta' and referencia_id=v_cuenta and tipo='venta' group by 1 loop
    -- primer conteo físico de ese producto después de la venta (el que absorbió la diferencia)
    select id, created_at, referencia_tipo into v_conteo from public.kardex_movimientos
     where sucursal_id=v_suc and producto_id=r.producto_id and tipo='conteo_fisico' and created_at > v_t
     order by created_at limit 1;

    -- movimientos entre la venta y ese conteo: su stock sube en q
    update public.kardex_movimientos set stock_anterior = stock_anterior + r.q, stock_posterior = stock_posterior + r.q
     where sucursal_id=v_suc and producto_id=r.producto_id and created_at > v_t
       and (v_conteo.id is null or created_at < v_conteo.created_at);

    insert into public.kardex_movimientos (producto_id, sucursal_id, tipo, cantidad, stock_anterior, stock_posterior, referencia_tipo, referencia_id, notas, usuario_id, created_at)
    select r.producto_id, v_suc, 'devolucion', r.q, k.stock_posterior, k.stock_posterior + r.q, 'pos_cuenta', v_cuenta, v_nota,
           '55691a58-21cb-4918-af9c-4b77d96d6b39', v_t + interval '1 second'
      from public.kardex_movimientos k
     where k.referencia_id=v_cuenta and k.tipo='venta' and k.producto_id=r.producto_id
     order by k.created_at desc limit 1;

    if v_conteo.id is not null then
      -- el conteo deja el stock donde estaba: su diferencia baja en q
      update public.kardex_movimientos set cantidad = cantidad - r.q, stock_anterior = stock_anterior + r.q where id = v_conteo.id;
      update public.inventario_conteo_nocturno set cantidad_teorica = cantidad_teorica + r.q
       where sucursal_id=v_suc and producto_id=r.producto_id and fecha='2026-09-29' and v_conteo.referencia_tipo='conteo_nocturno';
    else
      -- producto que no se cuenta: el stock actual sube en q
      update public.inventario set stock_actual = stock_actual + r.q, ultima_actualizacion = now()
       where sucursal_id=v_suc and producto_id=r.producto_id;
    end if;
  end loop;
end $fix$;
