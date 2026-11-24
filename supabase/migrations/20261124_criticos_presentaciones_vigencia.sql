-- Hoja de críticos: cuatro presentaciones nuevas DESDE LA HOJA DEL 22-nov-2026 (pedido de Jose/Saúl):
--   · Carne P Burguer     bolsa de 15 bolitas            (antes bolsa de 6)
--   · Queso P Freir       bolsa de 5 lb = 15 bolsitas    (antes paquete de 25 bolsitas de 0.30 lb)
--   · Pan Para Burguer    bolsa de 6 unidades            (antes 12; el catálogo ya decía 6)
--   · Pan Tradicional HD  bolsa de 12 unidades           (antes 10). El brioche (Super Friek) sigue en 21.
--
-- El problema de fondo: la hoja leía SIEMPRE el factor actual del ítem, así que cambiar la
-- presentación reescribía el pasado. Ahora cada presentación tiene vigencia:
--   · criticos_items_presentaciones guarda la presentación que valió HASTA una fecha.
--   · fn_criticos_hoja / fn_criticos_guardar usan la presentación de la FECHA de la hoja.
--   · El CID que se arrastra de ayer se convierte a la presentación de hoy conservando las piezas.
--   · fn_criticos_semana convierte el cierre de ayer con el factor de AYER.
-- Recetas (decisión de Jose): la porción de queso frito sube de 0.30 a 0.333333 lb (5 lb / 15)
-- y el pan tradicional se descuenta a 1/12 de bolsa.

create table if not exists public.criticos_items_presentaciones (
  item_id            uuid    not null references public.criticos_items(id) on delete cascade,
  hasta              date    not null,           -- último día (inclusive) en que valió
  factor             numeric not null check (factor > 0),
  factor_suelta      numeric,
  unidad_conteo      text,
  unidades_derivadas text,
  nota               text,
  created_at         timestamptz not null default now(),
  primary key (item_id, hasta)
);
alter table public.criticos_items_presentaciones enable row level security;
-- Sin políticas: solo la leen las funciones SECURITY DEFINER de críticos.

-- Las presentaciones que se van: válidas hasta el 21-nov-2026.
insert into public.criticos_items_presentaciones
       (item_id, hasta, factor, factor_suelta, unidad_conteo, unidades_derivadas, nota)
select id, date '2026-11-21', factor, factor_suelta, unidad_conteo, unidades_derivadas,
       'Presentación vigente hasta el 21-nov-2026'
  from public.criticos_items
 where id in ('a7b1e9c6-6ce0-4a50-b764-718201fbca5b',   -- Carne P Burguer
              'f211af31-854f-4476-9719-1799fc3d0a0a',   -- Queso P Freir
              '43a248ac-615b-4ce6-ba4f-9e6c4a6d19a4',   -- Pan Para Burguer
              '4a0707c9-1f02-4467-b702-e668eabf7ed0')   -- Pan Tradicional HD
on conflict do nothing;

update public.criticos_items set updated_at = now(),
       factor = 15, unidad_conteo = 'Bolsa de 15 bolitas', unidades_derivadas = '15 Bolitas',
       nota_config = 'Desde la hoja del 22-nov-2026 se cuenta en bolsas de 15 bolitas (antes bolsa de 6). El CID se arrastra convertido, conservando las bolitas.'
 where id = 'a7b1e9c6-6ce0-4a50-b764-718201fbca5b';

update public.criticos_items set updated_at = now(),
       presentacion = 'Bolsa', factor = 5, factor_suelta = 0.333333,
       unidad_conteo = 'Bolsa de 5 libras', unidades_derivadas = '15 Bolsitas',
       nota_config = 'Desde la hoja del 22-nov-2026: bolsa de 5 lb con 15 bolsitas (1 bolsita = 1 porción = 0.3333 lb). La receta de Queso Frito se subió de 0.30 a 0.3333 lb el 24-nov. El kardex lo mueve en libras.'
 where id = 'f211af31-854f-4476-9719-1799fc3d0a0a';

update public.criticos_items set updated_at = now(),
       factor = 6, unidad_conteo = 'Bolsa de 6 unidades', unidades_derivadas = '6 Uni',
       nota_config = 'Desde la hoja del 22-nov-2026 se cuenta en bolsas de 6 (antes 12).'
 where id = '43a248ac-615b-4ce6-ba4f-9e6c4a6d19a4';

update public.criticos_items set updated_at = now(),
       factor_suelta = 0.083333, unidad_conteo = 'Bolsa de 12 unidades', unidades_derivadas = '12 Uni',
       nota_config = 'Desde la hoja del 22-nov-2026 la bolsa trae 12 panes (antes 10); la receta descuenta 1/12 de bolsa por pan desde el 24-nov. También suma el producto viejo «Pan HOT DOG Berna 10X60 GR» (hasta 25-ago-2026).'
 where id = '4a0707c9-1f02-4467-b702-e668eabf7ed0';

-- La hoja del 22-nov ya estaba digitada: sus números pasan a leerse en la presentación nueva.
update public.criticos_conteo_items x
   set factor = i.factor, factor_suelta = i.factor_suelta
  from public.criticos_conteo cc, public.criticos_items i
 where cc.id = x.conteo_id and i.id = x.item_id and cc.fecha >= date '2026-11-22'
   and i.id in ('a7b1e9c6-6ce0-4a50-b764-718201fbca5b','f211af31-854f-4476-9719-1799fc3d0a0a',
                '43a248ac-615b-4ce6-ba4f-9e6c4a6d19a4','4a0707c9-1f02-4467-b702-e668eabf7ed0');

-- Catálogo (conteo nocturno, pedidos SOS, hoja de despacho).
update public.catalogo_productos
   set conteo_unidad = 'Bolsa de 15 bolitas', conteo_factor = 15
 where id = '79513e24-a4fd-4a7c-b117-87c9c899be1e';
update public.catalogo_productos
   set nombre = 'Pan Hot Dog Berna bolsa 12 unidades',
       conteo_unidad = 'Bolsa de 12 unidades', conteo_factor_suelta = 0.083333
 where id = 'e9d21e70-745d-4a6b-9755-32206d8cf42c';
update public.catalogo_productos
   set nombre = 'Queso para dorar bolsita 0.33 lb', conteo_unidad = 'Bolsita de 0.33 lb'
 where id = '60ea83c3-ce3b-40c0-9fd2-6a5ddd7a230c';
update public.criticos_item_productos set factor_a_item = 0.333333
 where item_id = 'f211af31-854f-4476-9719-1799fc3d0a0a'
   and producto_id = '60ea83c3-ce3b-40c0-9fd2-6a5ddd7a230c';

-- Recetas: porción de queso frito 0.30 → 0.333333 lb; pan tradicional 1/10 → 1/12 de bolsa.
update public.receta_ingredientes
   set cantidad = 0.333333,
       notas = coalesce(notas || ' ', '') || '[24-nov-2026] 0.30 → 0.3333 lb: la bolsa de 5 lb rinde 15 porciones.'
 where producto_id = '287ba92f-8335-4a83-b2a6-686b22895261' and cantidad = 0.3;
update public.recetas set costo_calculado = round(costo_calculado * 0.333333 / 0.3, 4)
 where id in ('496280b0-c7b6-4d9d-a456-5d19a670a0f7', '095aac30-fa05-49ee-9424-603cb870a083');
update public.receta_ingredientes
   set factor_a_stock = 0.083333,
       cantidad_catalogo = case when cantidad_catalogo is not null then 0.083333 end,
       notas = coalesce(notas || ' ', '') || '[24-nov-2026] bolsa de 12: 1/12 de bolsa por pan.'
 where producto_id = 'e9d21e70-745d-4a6b-9755-32206d8cf42c' and factor_a_stock = 0.1;

-- Parches a las tres funciones: se reemplaza texto exacto y se exige UNA sola coincidencia.
create function public._mig_rep(p_txt text, p_de text, p_a text) returns text
language plpgsql as $f$
declare v_n int := (length(p_txt) - length(replace(p_txt, p_de, ''))) / length(p_de);
begin
  if v_n <> 1 then
    raise exception 'Se esperaba 1 coincidencia de «%» y hay %', p_de, v_n;
  end if;
  return replace(p_txt, p_de, p_a);
end $f$;

do $mig$
declare
  v_def text;
  v_lat constant text := 'left join lateral (select x.* from criticos_items_presentaciones x where x.item_id = %s and x.hasta >= %s order by x.hasta limit 1) p on true';
begin
  ------------------------------------------------------------------ fn_criticos_hoja
  select pg_get_functiondef('public.fn_criticos_hoja(text,date)'::regprocedure) into v_def;

  v_def := public._mig_rep(v_def, 'cci.linea_sueltas sug_sueltas',
    'cci.linea_sueltas sug_sueltas, cci.factor fac, cci.factor_suelta fac_s');
  v_def := public._mig_rep(v_def, 'costo as (',
    'pres as (
    select i.id item_id,
           coalesce(p.factor, i.factor) factor,
           coalesce(p.factor_suelta, i.factor_suelta) factor_suelta,
           coalesce(p.unidad_conteo, i.unidad_conteo) unidad_conteo,
           coalesce(p.unidades_derivadas, i.unidades_derivadas) unidades_derivadas
      from criticos_items i
      ' || format(v_lat, 'i.id', 'v_fecha') || '
  ),
  costo as (');
  v_def := public._mig_rep(v_def, '''unidades_derivadas'', i.unidades_derivadas', '''unidades_derivadas'', pr.unidades_derivadas');
  v_def := public._mig_rep(v_def, '''unidad_conteo'', i.unidad_conteo', '''unidad_conteo'', pr.unidad_conteo');
  v_def := public._mig_rep(v_def, '''factor'', i.factor,', '''factor'', pr.factor,');
  v_def := public._mig_rep(v_def, '''factor_suelta'', i.factor_suelta', '''factor_suelta'', pr.factor_suelta');
  v_def := public._mig_rep(v_def, '''cid_sug_enteros'', a.sug_enteros, ''cid_sug_sueltas'', a.sug_sueltas',
    '''cid_sug_enteros'', case when a.item_id is null or a.fac is not distinct from pr.factor then a.sug_enteros
                else floor((coalesce(a.sug_enteros,0) * a.fac
                          + coalesce(a.sug_sueltas,0) * coalesce(a.fac_s, a.fac)) / pr.factor + 1e-9) end,
           ''cid_sug_sueltas'', case when a.item_id is null or a.fac is not distinct from pr.factor then a.sug_sueltas
                else round(((coalesce(a.sug_enteros,0) * a.fac
                           + coalesce(a.sug_sueltas,0) * coalesce(a.fac_s, a.fac))
                          - floor((coalesce(a.sug_enteros,0) * a.fac
                                 + coalesce(a.sug_sueltas,0) * coalesce(a.fac_s, a.fac)) / pr.factor + 1e-9) * pr.factor)
                          / coalesce(pr.factor_suelta, pr.factor), 4) end');
  v_def := public._mig_rep(v_def, 'left join ayer a on a.item_id = i.id',
    'left join ayer a on a.item_id = i.id
    join pres pr on pr.item_id = i.id');
  execute v_def;

  --------------------------------------------------------------- fn_criticos_guardar
  select pg_get_functiondef(oid) into v_def from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'fn_criticos_guardar';
  v_def := public._mig_rep(v_def, 'select en.*, ci.factor, ci.factor_suelta',
    'select en.*, coalesce(p.factor, ci.factor) factor, coalesce(p.factor_suelta, ci.factor_suelta) factor_suelta');
  v_def := public._mig_rep(v_def, 'on ci.id = en.item_id and ci.activo',
    'on ci.id = en.item_id and ci.activo
      ' || format(v_lat, 'ci.id', 'p_fecha'));
  execute v_def;

  ---------------------------------------------------------------- fn_criticos_semana
  select pg_get_functiondef('public.fn_criticos_semana(text,date,date)'::regprocedure) into v_def;
  v_def := public._mig_rep(v_def, 'order by cc.fecha) prev_fecha',
    'order by cc.fecha) prev_fecha,
           lag(cci.factor)        over (partition by cci.item_id order by cc.fecha) prev_fac,
           lag(cci.factor_suelta) over (partition by cci.item_id order by cc.fecha) prev_fs');
  v_def := public._mig_rep(v_def, 'coalesce(d.prev_tps,0) * d.factor',
    'coalesce(d.prev_tps,0) * coalesce(d.prev_fac, d.factor)');
  v_def := public._mig_rep(v_def, 'coalesce(d.prev_linea,0) * coalesce(d.factor_suelta, d.factor)',
    'coalesce(d.prev_linea,0) * coalesce(d.prev_fs, d.prev_fac, d.factor_suelta, d.factor)');
  execute v_def;
end
$mig$;

drop function public._mig_rep(text, text, text);

-- Estación de etiquetado: la bolsa de carne pasa a 15 bolitas (15 × 0.15 lb = 1,021 g netos,
-- banda ±34 g = media bolita) y la bolsita de queso frito a 0.3333 lb (151 g).
update public.etiquetado_productos
   set unidad = 'bolsa 15 bolitas', gramos = 1021, banda = 34, unidades_catalogo = 15, updated_at = now()
 where clave = 'carne';
update public.etiquetado_productos
   set unidad = 'bolsita 0.33 lb', gramos = 151, updated_at = now()
 where clave = 'quesofrito';
