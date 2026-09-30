-- Cobro de evento: la caja de una sucursal (hoy Cafetalón) cobra y factura un evento
-- (p. ej. crédito fiscal del Evento Siemens) pero NO descarga el inventario de la
-- sucursal: lo que se usa en el evento sale del pedido del evento desde Casa Matriz.
-- La venta queda aparte del corte de la sucursal y se reporta como ingreso de eventos.

-- 1) La cuenta sabe a qué evento pertenece
alter table public.pos_cuentas add column if not exists evento_id uuid references public.eventos(id);
create index if not exists pos_cuentas_evento_idx on public.pos_cuentas(evento_id) where evento_id is not null;

-- 2) Menú que usa el cobro de evento: el mismo que "para llevar" de cada tipo de sucursal
insert into public.pos_contexto_servicio (tipo_sucursal, tipo_orden, canal, incluye_bebida, destino_default, destino_editable, nota)
select v.ts, 'evento', v.canal, v.beb, 'llevar', false, 'Cobro de evento: solo cobra y factura, no descarga inventario.'
  from (values ('restaurante','local',false), ('food_court','para_llevar',true), ('drive_thru','drive_through',true), (null,'para_llevar',true)) v(ts,canal,beb)
 where not exists (select 1 from public.pos_contexto_servicio c where c.tipo_orden='evento' and c.tipo_sucursal is not distinct from v.ts);

-- 3) pos_deducir_inventario: una venta de evento no descarga nada
do $mig$
declare v_def text; v_new text;
  v_anchor text := E'  SELECT m.canal INTO v_canal FROM pos_cuentas c\n    LEFT JOIN pos_menus m ON m.id = c.menu_id WHERE c.id = p_cuenta_id;\n';
begin
  v_def := pg_get_functiondef('public.pos_deducir_inventario(uuid,text,text)'::regprocedure);
  if position('cobro de evento' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'pos_deducir_inventario: no se encontró el punto de inserción'; end if;
  v_new := replace(v_def, v_anchor, v_anchor ||
    E'\n  -- Cobro de evento: se cobra y factura en la sucursal, pero lo que se usa sale del\n' ||
    E'  -- pedido del evento (Casa Matriz). No descarga el inventario de la sucursal.\n' ||
    E'  IF p_tipo = ''venta'' AND EXISTS (SELECT 1 FROM pos_cuentas x WHERE x.id = p_cuenta_id\n' ||
    E'                                      AND (x.tipo = ''evento'' OR x.evento_id IS NOT NULL)) THEN\n' ||
    E'    RETURN jsonb_build_object(''ok'',true,''n'',0,''evento'',true,''nota'',''cobro de evento: no descarga inventario de la sucursal'');\n' ||
    E'  END IF;\n');
  execute v_new;
end $mig$;

-- 4) El barrido de cuentas sin descarga no toca los cobros de evento
do $mig$
declare v_def text; v_anchor text := E'and c.estado = ''cobrada'' and c.store_code is not null';
begin
  v_def := pg_get_functiondef('public.barrer_cuentas_sin_descarga(integer)'::regprocedure);
  if position('evento' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'barrer: no se encontró el punto de inserción'; end if;
  execute replace(v_def, v_anchor, v_anchor || E'\n       and c.tipo <> ''evento'' and c.evento_id is null');
end $mig$;

-- 5) Corte de caja: los cobros de evento van aparte (no inflan las ventas de la sucursal)
CREATE OR REPLACE FUNCTION public.pos_corte(p_store_code text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_turno_id uuid DEFAULT NULL::uuid, p_caja text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  WITH base AS (
    SELECT c.id, c.total, c.propina, c.estado, c.dte_tipo, (c.tipo = 'evento' OR c.evento_id IS NOT NULL) AS es_evento
    FROM public.pos_cuentas c
    WHERE c.store_code = p_store_code
      AND c.cobrada_at >= p_desde AND c.cobrada_at < p_hasta
      AND (p_turno_id IS NULL OR c.turno_id = p_turno_id OR c.turno_id IS NULL)
      AND c.estado = 'cobrada'
      AND (p_caja IS NULL OR c.turno_id IN (SELECT t.id FROM public.pos_turnos t WHERE t.caja = p_caja))
  ),
  cuentas AS (SELECT * FROM base WHERE NOT es_evento),
  eventos AS (SELECT * FROM base WHERE es_evento),
  pagos AS (
    SELECT lower(pg.metodo) AS metodo, SUM(pg.monto) AS monto
    FROM public.pos_cuenta_pagos pg
    JOIN cuentas c ON c.id = pg.cuenta_id
    WHERE pg.anulado = false
    GROUP BY 1
  ),
  canc AS (
    SELECT count(*) n FROM public.pos_cuentas c
    WHERE c.store_code = p_store_code
      AND c.updated_at >= p_desde AND c.updated_at < p_hasta
      AND c.estado = 'cancelada' AND c.tipo <> 'evento'
      AND (p_turno_id IS NULL OR c.turno_id = p_turno_id OR c.turno_id IS NULL)
      AND (p_caja IS NULL OR c.turno_id IN (SELECT t.id FROM public.pos_turnos t WHERE t.caja = p_caja))
  )
  SELECT jsonb_build_object(
    'efectivo',       COALESCE((SELECT monto FROM pagos WHERE metodo='efectivo'),0),
    'tarjeta',        COALESCE((SELECT monto FROM pagos WHERE metodo='tarjeta'),0),
    'transferencia',  COALESCE((SELECT monto FROM pagos WHERE metodo='transferencia'),0),
    'link_pago',      COALESCE((SELECT monto FROM pagos WHERE metodo='link_pago'),0),
    'mixto',          COALESCE((SELECT monto FROM pagos WHERE metodo='mixto'),0),
    'hifumi',         COALESCE((SELECT monto FROM pagos WHERE metodo='hifumi'),0),
    'otros',          COALESCE((SELECT SUM(monto) FROM pagos WHERE metodo NOT IN ('efectivo','tarjeta','transferencia','link_pago','mixto','hifumi')),0),
    'total',          COALESCE((SELECT SUM(total) FROM cuentas),0),
    'propinas',       COALESCE((SELECT SUM(propina) FROM cuentas),0),
    'n_cuentas',      (SELECT count(*) FROM cuentas),
    'n_cancelaciones',(SELECT n FROM canc),
    'ticket_promedio',CASE WHEN (SELECT count(*) FROM cuentas) > 0
                           THEN ROUND((SELECT SUM(total) FROM cuentas) / (SELECT count(*) FROM cuentas), 2) ELSE 0 END,
    'eventos_total',  COALESCE((SELECT SUM(total) FROM eventos),0),
    'eventos_n',      (SELECT count(*) FROM eventos)
  );
$function$;

-- 6) Ítems, cortesías y descuentos de empleado del corte: sin los cobros de evento
do $mig$
declare f text; v_def text;
begin
  foreach f in array array['pos_corte_items','pos_corte_cortesias','pos_corte_desc_empleado'] loop
    v_def := pg_get_functiondef(('public.'||f||'(text,timestamp with time zone,timestamp with time zone,uuid,text)')::regprocedure);
    if position('evento' in v_def) > 0 then continue; end if;
    if position(E'and c.estado = ''cobrada''' in v_def) = 0 then raise exception '%: no se encontró el punto de inserción', f; end if;
    execute regexp_replace(v_def, E'and c\\.estado = ''cobrada''', E'and c.estado = ''cobrada'' and c.tipo <> ''evento'' and c.evento_id is null');
  end loop;
end $mig$;

-- 7) Reporte de cobros de eventos
create or replace view public.v_cobros_eventos with (security_invoker = true) as
select c.id as cuenta_id, c.store_code, e.id as evento_id, e.nombre as evento, e.fecha_evento, e.cliente,
       c.cobrada_at, c.total, c.dte_tipo, c.dte_numero_control,
       (select string_agg(p.metodo||' '||p.monto, ', ') from public.pos_cuenta_pagos p where p.cuenta_id=c.id and not p.anulado) as pagos,
       (select coalesce(u.nombre,'')||' '||coalesce(u.apellido,'') from public.usuarios_erp u where u.id=c.cajero_id) as cajero
  from public.pos_cuentas c left join public.eventos e on e.id = c.evento_id
 where c.estado = 'cobrada' and (c.tipo = 'evento' or c.evento_id is not null);
