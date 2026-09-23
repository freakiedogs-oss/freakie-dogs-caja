-- 23-sep-2026 · Incentivo por tocino extra (pedido Cesar): $0.05 por cada «Tocino» extra vendido,
-- para Rosa y Liseth en Metrocentro, encima del incentivo de agrandados. Objetivo: empujar el
-- combo con tocino. Se paga por unidad (sin bloques) y se cuenta desde `tocino_desde`.
--
-- Qué cuenta como tocino extra: el modificador «Tocino» ($0.75) en hamburguesas, hot dogs y
-- papas, y el ítem suelto «Tocino». NO cuentan «SIN Tocino» ni «Mermelada de Tocino».

alter table public.agrandado_config
  add column if not exists tocino_valor numeric(6,3) not null default 0,   -- $ por tocino extra; 0 = sin incentivo
  add column if not exists tocino_desde date;                             -- desde qué día cuenta

comment on column public.agrandado_config.tocino_valor is '$ por cada tocino extra vendido (modificador o ítem «Tocino»). 0 = apagado.';
comment on column public.agrandado_config.tocino_desde is 'Primer día que cuenta para el incentivo de tocino.';

create or replace function public.fn_tocino_extra_es(p_nombre text, p_mods jsonb)
 returns boolean language sql immutable as $$
  select coalesce(p_nombre, '') ~* '^\s*tocino\s*$'
      or exists (
           select 1 from jsonb_array_elements(
             case when jsonb_typeof(p_mods) = 'array' then p_mods else '[]'::jsonb end
           ) m where m->>'nombre' ~* '^\s*tocino\s*$');
$$;

-- Cambia el tipo de retorno (columnas nuevas de tocino): hay que soltarla y volverla a crear.
drop function if exists public.fn_agrandados_panel();

create function public.fn_agrandados_panel()
 returns table(store_code text, sucursal text, mesero text, bloque_tam integer, valor_unit numeric, activo_desde date, ya_arranco boolean, dia_del_mes integer, dias_del_mes integer, hoy integer, mes integer, cuentas_mes integer, tasa_actual numeric, bloques integer, dinero numeric, resto integer, faltan integer, dinero_siguiente numeric, mes_anterior_tasa numeric, meta_pct numeric, tasa_7d numeric, proyeccion_unid integer, proyeccion_dinero numeric, proyeccion_tasa numeric, mejor_dia integer, mejor_dia_fecha date,
               tocino_valor numeric, tocino_desde date, tocino_hoy integer, tocino_mes integer, tocino_dinero numeric)
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
mov as (
  select q.store_code, q.mesero, q.cuenta_id,
         (q.recibido_at at time zone 'America/El_Salvador')::date as dia,
         coalesce(q.cantidad,1) as cant,
         fn_agrandado_es(q.nombre_item, q.modificadores) as agr,
         fn_tocino_extra_es(q.nombre_item, q.modificadores) as toc
  from pos_cocina_queue q
  join base b on b.store_code = q.store_code and b.mesero = q.mesero
  where q.recibido_at >= (date_trunc('month', (select d from hoy_sv)) - interval '1 month')
    and q.estado is distinct from 'anulado'
),
mes_actual as (
  select store_code, mesero,
         sum(cant) filter (where agr and dia = (select d from hoy_sv))::int as hoy,
         sum(cant) filter (where agr and date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)))::int as mes,
         count(distinct cuenta_id) filter (where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)))::int as cuentas
  from mov group by 1,2
),
-- tocino: solo desde tocino_desde y dentro del mes actual
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
  select b.store_code, b.mesero, (coalesce(m.mes,0) + b.arrastre)::int as mes_tot
  from base b left join mes_actual m on m.store_code=b.store_code and m.mesero=b.mesero
)
select
  b.store_code, b.suc_nombre, b.mesero,
  b.bloque_tam, b.valor_unit,
  b.activo_desde, ((select d from hoy_sv) >= b.activo_desde) as ya_arranco,
  extract(day from (select d from hoy_sv))::int,
  extract(day from (date_trunc('month',(select d from hoy_sv)) + interval '1 month - 1 day'))::int,
  coalesce(m.hoy,0), t.mes_tot, coalesce(m.cuentas,0),
  round(100.0*coalesce(m.mes,0)/nullif(m.cuentas,0), 1),
  (t.mes_tot/b.bloque_tam)::int,
  ((t.mes_tot/b.bloque_tam)::int * b.bloque_tam * b.valor_unit)::numeric,
  (t.mes_tot % b.bloque_tam)::int,
  (b.bloque_tam - (t.mes_tot % b.bloque_tam))::int,
  (((t.mes_tot/b.bloque_tam)::int + 1) * b.bloque_tam * b.valor_unit)::numeric,
  round(100.0*p.agr_prev/nullif(p.cta_prev,0), 1),
  coalesce(b.meta_pct_manual, round(100.0*p.agr_prev/nullif(p.cta_prev,0), 1) + b.meta_incremento_pp),
  round(100.0*r.agr_7/nullif(r.cta_7,0), 1),
  (t.mes_tot + round(
     coalesce(r.agr_7,0)/nullif(r.dias_7,0)
     * greatest(extract(day from (date_trunc('month',(select d from hoy_sv)) + interval '1 month - 1 day'))
                - extract(day from (select d from hoy_sv)), 0)))::int,
  (((t.mes_tot + round(coalesce(r.agr_7,0)/nullif(r.dias_7,0)
     * greatest(extract(day from (date_trunc('month',(select d from hoy_sv)) + interval '1 month - 1 day'))
                - extract(day from (select d from hoy_sv)), 0)))::int / b.bloque_tam)::int
    * b.bloque_tam * b.valor_unit)::numeric,
  round(100.0*r.agr_7/nullif(r.cta_7,0), 1),
  coalesce(mj.tot,0), mj.dia,
  b.tocino_valor, b.tocino_desde,
  coalesce(tc.t_hoy,0), coalesce(tc.t_mes,0),
  round(coalesce(tc.t_mes,0) * b.tocino_valor, 2)
from base b
join tot t              on t.store_code=b.store_code and t.mesero=b.mesero
left join mes_actual m  on m.store_code=b.store_code and m.mesero=b.mesero
left join tocino tc     on tc.store_code=b.store_code and tc.mesero=b.mesero
left join mes_previo p  on p.store_code=b.store_code and p.mesero=b.mesero
left join ritmo r       on r.store_code=b.store_code and r.mesero=b.mesero
left join mejor mj      on mj.store_code=b.store_code and mj.mesero=b.mesero
order by t.mes_tot desc;
$function$;

grant execute on function public.fn_agrandados_panel() to anon, authenticated;
grant execute on function public.fn_tocino_extra_es(text, jsonb) to anon, authenticated;

-- Metrocentro: Rosa y Liseth, $0.05 por tocino extra desde hoy
update public.agrandado_config
   set tocino_valor = 0.05, tocino_desde = '2026-09-23'
 where store_code = 'S006' and mesero in ('Rosa', 'Liseth') and activo;
