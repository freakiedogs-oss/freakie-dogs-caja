-- Arnés de `fn_deposito_registrar` / `fn_deposito_anular` (anti doble registro).
--
-- Corre sobre una sucursal falsa (ZZTEST) y borra lo suyo al final, así que es
-- seguro contra producción. Pegarlo en el SQL editor de Supabase.
--
-- Contexto: hasta el 22-sep-2026 registrar un depósito era un INSERT suelto.
-- El mismo depósito se subió dos veces 23 veces ($12,080.61 de más) y nadie lo
-- veía, porque el Dashboard de Cierres trae el depósito del día con LIMIT 1.

create temp table if not exists _t_dep (n int, etapa text, espera text, res jsonb);
truncate _t_dep;

do $$
declare r jsonb; v1 uuid; v2 uuid;
begin
  -- 1. Día libre → entra sin preguntar nada.
  r := public.fn_deposito_registrar('ZZTEST', 100.00, '2026-09-20', array['2026-09-20'],
        array['f1.jpg'], 'test', 100.00, 'Tester', null, 'nuevo', null);
  insert into _t_dep values (1, 'dia libre, modo nuevo', 'ok', r);
  v1 := (r->>'id')::uuid;

  -- 2. Otra persona intenta el mismo día sin saber que ya está → FRENA y le
  --    devuelve lo que hay, para que decida sobre datos reales.
  r := public.fn_deposito_registrar('ZZTEST', 100.00, '2026-09-20', array['2026-09-20'],
        array['f2.jpg'], 'test', 100.00, 'Otra persona', null, 'nuevo', null);
  insert into _t_dep values (2, 'mismo dia, otra persona', 'ya_existe', r);

  -- 3. Doble clic exacto, aun pidiendo 'agregar' → lo para el índice único.
  --    Es la red de abajo: funciona aunque la UI se equivoque.
  r := public.fn_deposito_registrar('ZZTEST', 100.00, '2026-09-20', array['2026-09-20'],
        array['f3.jpg'], 'test', 100.00, 'Tester', null, 'agregar', array[v1]);
  insert into _t_dep values (3, 'mismo monto, modo agregar', 'duplicado_exacto', r);

  -- 4. Segunda PARTIDA del mismo día (monto distinto) → sí entra. Esto es
  --    legítimo y pasa de verdad (S002 24-jul: 77.28 + 254.25 = 331.53).
  r := public.fn_deposito_registrar('ZZTEST', 55.00, '2026-09-20', array['2026-09-20'],
        array['f4.jpg'], 'segunda partida', 100.00, 'Tester', null, 'agregar', array[v1]);
  insert into _t_dep values (4, 'otra partida, modo agregar', 'ok', r);
  v2 := (r->>'id')::uuid;

  -- 5. Reemplazar decidiendo sobre una vista VIEJA (vio 1, ya hay 2) → no se
  --    ejecuta. Es el caso "alguien más lo subió mientras llenabas el form":
  --    anular algo que el usuario nunca vio sería destruir el registro de otro.
  r := public.fn_deposito_registrar('ZZTEST', 999.00, '2026-09-20', array['2026-09-20'],
        array['f5.jpg'], 'x', 100.00, 'Tester', null, 'reemplazar', array[v1]);
  insert into _t_dep values (5, 'reemplazar con vista vieja', 'cambio', r);

  -- 6. Reemplazar con la vista correcta → anula los 2 y entra el nuevo.
  r := public.fn_deposito_registrar('ZZTEST', 155.00, '2026-09-20', array['2026-09-20'],
        array['f6.jpg'], 'correccion', 100.00, 'Tester', null, 'reemplazar', array[v1, v2]);
  insert into _t_dep values (6, 'reemplazar con vista correcta', 'ok, anulados=2', r);

  -- 7. Días desordenados y repetidos → se normalizan (ordenados y únicos), o el
  --    índice único vería distintos dos arrays con el mismo contenido.
  r := public.fn_deposito_registrar('ZZTEST', 77.00, '2026-09-25',
        array['2026-09-24','2026-09-23','2026-09-24'],
        array['f7.jpg'], 'x', 77.00, 'Tester', null, 'nuevo', null);
  insert into _t_dep values (7, 'dias desordenados y repetidos', 'ok, dias={23,24}', r);

  -- 8. Solape PARCIAL (24-25 contra 23-24) → frena. El índice único no ve esto
  --    (son arrays distintos); lo ve la función, que compara con &&.
  r := public.fn_deposito_registrar('ZZTEST', 88.00, '2026-09-26',
        array['2026-09-24','2026-09-25'],
        array['f8.jpg'], 'x', 88.00, 'Tester', null, 'nuevo', null);
  insert into _t_dep values (8, 'solape parcial de dias', 'ya_existe', r);

  -- 9/10. Anular exige motivo y no se puede anular dos veces.
  insert into _t_dep values (9,  'anular sin motivo',    'falta_motivo', public.fn_deposito_anular(v1, '  ', 'Tester'));
  insert into _t_dep values (10, 'anular uno ya anulado', 'ya_anulado',  public.fn_deposito_anular(v1, 'porque si', 'Tester'));
end $$;

select n, etapa, espera,
       coalesce(res->>'motivo', 'ok' ) obtuvo,
       res->>'anulados' anulados,
       jsonb_array_length(coalesce(res->'vigentes','[]')) vigentes_devueltos
from _t_dep order by n;

-- Los días se guardaron ordenados y sin repetir, y el reemplazo dejó rastro
-- en los dos sentidos (el viejo apunta al nuevo, el nuevo lista a los viejos).
select monto, dias_cubiertos, estado,
       anulado_motivo is not null tiene_motivo,
       reemplazado_por is not null apunta_al_nuevo,
       cardinality(coalesce(reemplaza_a,'{}')) reemplaza_n
from depositos_bancarios where store_code = 'ZZTEST' order by created_at;

-- Limpieza.
update depositos_bancarios set reemplazado_por = null where store_code = 'ZZTEST';
delete from depositos_bancarios where store_code = 'ZZTEST';
