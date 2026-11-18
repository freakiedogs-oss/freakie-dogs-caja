-- Carne para hamburguesa: desde la hoja del 16-nov-2026 llega en BOLSA DE 15 BOLITAS
-- (antes bolsa de 6; hasta el 4-nov paquete de 20). Aviso de Saúl en «Freakie Operaciones».
--
-- El problema de fondo: la hoja de críticos leía SIEMPRE el factor actual del ítem, así
-- que cambiar la presentación reescribía el pasado (las hojas ya digitadas en bolsas de 6
-- se habrían leído como bolsas de 15). El 5-nov se resolvió convirtiendo las hojas viejas
-- a mano. Ahora cada presentación tiene vigencia:
--   · criticos_items_presentaciones guarda la presentación que valió HASTA una fecha.
--   · fn_criticos_hoja / fn_criticos_guardar usan la presentación de la FECHA de la hoja.
--   · El CID que se arrastra de ayer se convierte a la presentación de hoy conservando
--     las piezas (26 bolsas de 6 + 23 bolitas = 179 = 11 bolsas de 15 + 14 bolitas).
--   · fn_criticos_semana convierte el cierre de ayer con el factor de AYER.

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

-- La presentación que se va: bolsa de 6, válida hasta el 15-nov-2026.
insert into public.criticos_items_presentaciones
       (item_id, hasta, factor, factor_suelta, unidad_conteo, unidades_derivadas, nota)
select id, date '2026-11-15', factor, factor_suelta, unidad_conteo, unidades_derivadas,
       'Bolsa de 6 bolitas (5-nov a 15-nov-2026)'
  from public.criticos_items
 where id = 'a7b1e9c6-6ce0-4a50-b764-718201fbca5b' and factor = 6
on conflict do nothing;

update public.criticos_items
   set factor = 15,
       unidad_conteo = 'Bolsa de 15 bolitas',
       unidades_derivadas = '15 Bolitas',
       nota_config = 'Desde la hoja del 16-nov-2026 se cuenta en bolsas de 15 bolitas (antes bolsa de 6). Las hojas hasta el 15-nov siguen en bolsas de 6; el CID se arrastra convertido, conservando las bolitas.',
       updated_at = now()
 where id = 'a7b1e9c6-6ce0-4a50-b764-718201fbca5b';

-- Catálogo: conteo nocturno, pedidos SOS y hoja de despacho (el stock sigue en bolitas).
update public.catalogo_productos
   set conteo_unidad = 'Bolsa de 15 bolitas', conteo_factor = 15
 where id = '79513e24-a4fd-4a7c-b117-87c9c899be1e';

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
