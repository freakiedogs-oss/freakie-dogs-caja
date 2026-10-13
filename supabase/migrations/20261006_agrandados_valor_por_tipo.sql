-- 06-oct-2026 · Agrandados: cada tipo paga según su precio (decisión de Cesar).
--
-- Antes: los tres agrandados contaban 1 unidad = $0.10, así que el de bebida ($0.50)
-- pagaba lo mismo que el de papa y bebida ($1.25).
-- Ahora todos pagan el mismo 8% de su precio:
--   Agrandado Papa y Bebida / Agrandado Combo  $1.25 → 1.0 punto  → $0.10
--   Agrandado de Papa                           $1.00 → 0.8 puntos → $0.08
--   Agrandado de bebida                         $0.50 → 0.4 puntos → $0.04
-- Los bloques siguen siendo de 100 puntos ($10). Rige desde el 1-oct-2026: el panel solo
-- calcula el mes en curso, así que septiembre no se toca.
--
-- El panel ahora devuelve el desglose por tipo (hoy y mes) para que la cajera vea
-- cuál vende más. `mes`, `hoy`, `resto` y `faltan` pasan a ser PUNTOS (numeric).
-- La tasa y la meta (% de cuentas con agrandado) siguen contando unidades, sin cambio.
--
-- Si algo no se reconoce como papa ni bebida, cae en «papa y bebida» (1 punto): nadie
-- cobra menos que antes por un nombre raro.

begin;

alter table public.agrandado_config
  add column if not exists peso_papa_bebida numeric(4,2) not null default 1.0,
  add column if not exists peso_papa        numeric(4,2) not null default 0.8,
  add column if not exists peso_bebida      numeric(4,2) not null default 0.4;

comment on column public.agrandado_config.peso_papa_bebida is 'Puntos por Agrandado Papa y Bebida / Agrandado Combo ($1.25).';
comment on column public.agrandado_config.peso_papa        is 'Puntos por Agrandado de Papa ($1.00).';
comment on column public.agrandado_config.peso_bebida      is 'Puntos por Agrandado de bebida ($0.50).';

-- Tipo de agrandado de una línea de la comanda. Solo se usa en líneas donde
-- fn_agrandado_es() ya dijo que sí, así que el total de unidades no cambia.
create or replace function public.fn_agrandado_tipo(p_nombre text, p_mods jsonb)
 returns text language sql immutable as $$
  with n as (
    select coalesce(p_nombre, '') as t
    union all
    select coalesce(m->>'nombre', '')
      from jsonb_array_elements(case when jsonb_typeof(p_mods) = 'array' then p_mods else '[]'::jsonb end) m
  )
  select case
    when exists (select 1 from n where t ~* 'agrandado.*papa.*bebida|agrandado.*soda.*papa|agrandado\s+combo') then 'papa_bebida'
    when exists (select 1 from n where t ~* 'agrandado\s+(de\s+)?papa')                             then 'papa'
    when exists (select 1 from n where t ~* 'agrandado\s+(de\s+)?bebida|cambio\s+de\s+bebida')     then 'bebida'
    else 'papa_bebida'
  end;
$$;

grant execute on function public.fn_agrandado_tipo(text, jsonb) to anon, authenticated;

drop function if exists public.fn_agrandados_panel();

create function public.fn_agrandados_panel()
 returns table(store_code text, sucursal text, mesero text, bloque_tam integer, valor_unit numeric, activo_desde date, ya_arranco boolean, dia_del_mes integer, dias_del_mes integer,
               hoy numeric, mes numeric, cuentas_mes integer, tasa_actual numeric, bloques integer, dinero numeric, resto numeric, faltan numeric, dinero_siguiente numeric,
               mes_anterior_tasa numeric, meta_pct numeric, tasa_7d numeric, proyeccion_unid numeric, proyeccion_dinero numeric, proyeccion_tasa numeric, mejor_dia integer, mejor_dia_fecha date,
               tocino_valor numeric, tocino_desde date, tocino_hoy integer, tocino_mes integer, tocino_dinero numeric,
               -- desglose por tipo (unidades) y lo que vale cada tipo en $
               unid_hoy integer, unid_mes integer,
               pb_hoy integer, pb_mes integer, papa_hoy integer, papa_mes integer, beb_hoy integer, beb_mes integer,
               valor_pb numeric, valor_papa numeric, valor_beb numeric)
 language sql stable
 set work_mem to '32MB'
as $function$
with hoy_sv as (select (now() at time zone 'America/El_Salvador')::date as d),
base as (
  select c.*, s.nombre as suc_nombre,
         case when c.ajuste_mes is not null
               and date_trunc('month', c.ajuste_mes) = date_trunc('month', (select d from hoy_sv))
              then c.ajuste_inicial else 0 end as arrastre
  from agrandado_config c
  join sucursales s on s.store_code = c.store_code
  where c.activo
),
mov0 as (
  select q.store_code, q.mesero, q.cuenta_id,
         (q.recibido_at at time zone 'America/El_Salvador')::date as dia,
         coalesce(q.cantidad,1) as cant,
         fn_agrandado_es(q.nombre_item, q.modificadores) as agr,
         fn_tocino_extra_es(q.nombre_item, q.modificadores) as toc,
         q.nombre_item, q.modificadores
  from pos_cocina_queue q
  join base b on b.store_code = q.store_code and b.mesero = q.mesero
  where q.recibido_at >= (date_trunc('month', (select d from hoy_sv)) - interval '1 month')
    and q.estado is distinct from 'anulado'
),
mov as (
  select m.store_code, m.mesero, m.cuenta_id, m.dia, m.cant, m.agr, m.toc, x.tipo,
         case when not m.agr then 0
              else m.cant * case x.tipo when 'papa' then b.peso_papa
                                        when 'bebida' then b.peso_bebida
                                        else b.peso_papa_bebida end
         end as pts
  from mov0 m
  join base b on b.store_code = m.store_code and b.mesero = m.mesero
  cross join lateral (select case when m.agr then fn_agrandado_tipo(m.nombre_item, m.modificadores) end as tipo) x
),
mes_actual as (
  select store_code, mesero,
         coalesce(sum(pts)  filter (where dia = (select d from hoy_sv)), 0) as hoy_pts,
         coalesce(sum(pts)  filter (where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv))), 0) as mes_pts,
         coalesce(sum(cant) filter (where agr and dia = (select d from hoy_sv)), 0)::int as hoy_u,
         coalesce(sum(cant) filter (where agr and date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv))), 0)::int as mes_u,
         coalesce(sum(cant) filter (where tipo='papa_bebida' and dia = (select d from hoy_sv)), 0)::int as pb_h,
         coalesce(sum(cant) filter (where tipo='papa_bebida' and date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv))), 0)::int as pb_m,
         coalesce(sum(cant) filter (where tipo='papa' and dia = (select d from hoy_sv)), 0)::int as pa_h,
         coalesce(sum(cant) filter (where tipo='papa' and date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv))), 0)::int as pa_m,
         coalesce(sum(cant) filter (where tipo='bebida' and dia = (select d from hoy_sv)), 0)::int as be_h,
         coalesce(sum(cant) filter (where tipo='bebida' and date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv))), 0)::int as be_m,
         count(distinct cuenta_id) filter (where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)))::int as cuentas
  from mov group by 1,2
),
tocino as (
  select m.store_code, m.mesero,
         sum(m.cant) filter (where m.toc and m.dia = (select d from hoy_sv))::int as t_hoy,
         sum(m.cant) filter (where m.toc and date_trunc('month',m.dia) = date_trunc('month',(select d from hoy_sv)))::int as t_mes
  from mov m join base b on b.store_code=m.store_code and b.mesero=m.mesero
  where b.tocino_valor > 0 and b.tocino_desde is not null and m.dia >= b.tocino_desde
  group by 1,2
),
mes_previo as (
  select store_code, mesero,
         sum(cant) filter (where agr)::numeric as agr_prev,
         count(distinct cuenta_id)::numeric as cta_prev
  from mov
  where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)) - interval '1 month'
  group by 1,2
),
ritmo as (
  select store_code, mesero,
         sum(cant) filter (where agr)::numeric as agr_7,
         sum(pts)::numeric as pts_7,
         count(distinct cuenta_id)::numeric as cta_7,
         count(distinct dia)::numeric as dias_7
  from mov where dia > (select d from hoy_sv) - 7 and dia <= (select d from hoy_sv)
  group by 1,2
),
mejor as (
  select distinct on (store_code, mesero) store_code, mesero, dia, tot
  from (select store_code, mesero, dia, sum(cant) filter (where agr)::int as tot
        from mov where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv))
        group by 1,2,3) x
  where tot > 0 order by store_code, mesero, tot desc
),
tot as (
  select b.store_code, b.mesero, round(coalesce(m.mes_pts,0) + b.arrastre, 1) as mes_tot
  from base b left join mes_actual m on m.store_code=b.store_code and m.mesero=b.mesero
),
proy as (
  select b.store_code, b.mesero,
         round(t.mes_tot + coalesce(r.pts_7,0)/nullif(r.dias_7,0)
               * greatest(extract(day from (date_trunc('month',(select d from hoy_sv)) + interval '1 month - 1 day'))
                          - extract(day from (select d from hoy_sv)), 0), 1) as p
  from base b
  join tot t on t.store_code=b.store_code and t.mesero=b.mesero
  left join ritmo r on r.store_code=b.store_code and r.mesero=b.mesero
)
select
  b.store_code, b.suc_nombre, b.mesero,
  b.bloque_tam, b.valor_unit,
  b.activo_desde, ((select d from hoy_sv) >= b.activo_desde) as ya_arranco,
  extract(day from (select d from hoy_sv))::int,
  extract(day from (date_trunc('month',(select d from hoy_sv)) + interval '1 month - 1 day'))::int,
  round(coalesce(m.hoy_pts,0), 1), t.mes_tot, coalesce(m.cuentas,0),
  round(100.0*coalesce(m.mes_u,0)/nullif(m.cuentas,0), 1),
  floor(t.mes_tot/b.bloque_tam)::int,
  (floor(t.mes_tot/b.bloque_tam) * b.bloque_tam * b.valor_unit)::numeric,
  round(t.mes_tot - floor(t.mes_tot/b.bloque_tam) * b.bloque_tam, 1),
  round(b.bloque_tam - (t.mes_tot - floor(t.mes_tot/b.bloque_tam) * b.bloque_tam), 1),
  ((floor(t.mes_tot/b.bloque_tam) + 1) * b.bloque_tam * b.valor_unit)::numeric,
  round(100.0*p.agr_prev/nullif(p.cta_prev,0), 1),
  coalesce(b.meta_pct_manual, round(100.0*p.agr_prev/nullif(p.cta_prev,0), 1) + b.meta_incremento_pp),
  round(100.0*r.agr_7/nullif(r.cta_7,0), 1),
  coalesce(pr.p, t.mes_tot),
  (floor(coalesce(pr.p, t.mes_tot)/b.bloque_tam) * b.bloque_tam * b.valor_unit)::numeric,
  round(100.0*r.agr_7/nullif(r.cta_7,0), 1),
  coalesce(mj.tot,0), mj.dia,
  b.tocino_valor, b.tocino_desde,
  coalesce(tc.t_hoy,0), coalesce(tc.t_mes,0),
  round(coalesce(tc.t_mes,0) * b.tocino_valor, 2),
  coalesce(m.hoy_u,0), coalesce(m.mes_u,0),
  coalesce(m.pb_h,0), coalesce(m.pb_m,0), coalesce(m.pa_h,0), coalesce(m.pa_m,0), coalesce(m.be_h,0), coalesce(m.be_m,0),
  round(b.valor_unit * b.peso_papa_bebida, 3), round(b.valor_unit * b.peso_papa, 3), round(b.valor_unit * b.peso_bebida, 3)
from base b
join tot t              on t.store_code=b.store_code and t.mesero=b.mesero
left join mes_actual m  on m.store_code=b.store_code and m.mesero=b.mesero
left join tocino tc     on tc.store_code=b.store_code and tc.mesero=b.mesero
left join mes_previo p  on p.store_code=b.store_code and p.mesero=b.mesero
left join ritmo r       on r.store_code=b.store_code and r.mesero=b.mesero
left join mejor mj      on mj.store_code=b.store_code and mj.mesero=b.mesero
left join proy pr       on pr.store_code=b.store_code and pr.mesero=b.mesero
order by t.mes_tot desc;
$function$;

grant execute on function public.fn_agrandados_panel() to anon, authenticated;

commit;
