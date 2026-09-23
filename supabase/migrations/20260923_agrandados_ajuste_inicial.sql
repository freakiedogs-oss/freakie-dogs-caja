-- 23-sep-2026 · Agrandados food court: arrastre inicial por cajera (pedido Cesar).
-- Caso: Stephanie (S006) renunció; Rosa y Liseth se turnan su puesto. Cesar repartió mitad y
-- mitad lo acumulado en septiembre (1,310 de Stephanie + 164 hechos con el PIN de Super Admin
-- = 1,474 → 737 c/u) y de aquí en adelante cada una factura con su propio PIN.
-- El panel cuenta por pos_cocina_queue.mesero (nombre del usuario que cobró), así que no se
-- reescribe historia: se agrega un ajuste que se suma al mes indicado y nada más.
alter table public.agrandado_config
  add column if not exists ajuste_inicial integer not null default 0,   -- agrandados que se suman al contador del mes
  add column if not exists ajuste_mes     date;                         -- mes al que aplica (día 1); null = nunca

comment on column public.agrandado_config.ajuste_inicial is 'Agrandados que se suman al contador de ajuste_mes (arrastre al repartir un puesto, corrección manual). No afecta hoy ni la tasa.';
comment on column public.agrandado_config.ajuste_mes is 'Mes (día 1) al que aplica ajuste_inicial. Fuera de ese mes no suma.';

create or replace function public.fn_agrandados_panel()
 returns table(store_code text, sucursal text, mesero text, bloque_tam integer, valor_unit numeric, activo_desde date, ya_arranco boolean, dia_del_mes integer, dias_del_mes integer, hoy integer, mes integer, cuentas_mes integer, tasa_actual numeric, bloques integer, dinero numeric, resto integer, faltan integer, dinero_siguiente numeric, mes_anterior_tasa numeric, meta_pct numeric, tasa_7d numeric, proyeccion_unid integer, proyeccion_dinero numeric, proyeccion_tasa numeric, mejor_dia integer, mejor_dia_fecha date)
 language sql stable
 set work_mem to '32MB'
as $function$
with hoy_sv as (select (now() at time zone 'America/El_Salvador')::date as d),
base as (
  select c.*, s.nombre as suc_nombre,
         -- arrastre: solo cuenta dentro del mes al que aplica
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
         fn_agrandado_es(q.nombre_item, q.modificadores) as agr
  from pos_cocina_queue q
  join base b on b.store_code = q.store_code and b.mesero = q.mesero
  where q.recibido_at >= (date_trunc('month', (select d from hoy_sv)) - interval '1 month')
),
mes_actual as (
  select store_code, mesero,
         sum(cant) filter (where agr and dia = (select d from hoy_sv))::int as hoy,
         sum(cant) filter (where agr and date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)))::int as mes,
         count(distinct cuenta_id) filter (where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)))::int as cuentas
  from mov group by 1,2
),
mes_previo as (
  select store_code, mesero,
         sum(cant) filter (where agr)::numeric as agr_prev,
         count(distinct cuenta_id)::numeric as cta_prev
  from mov
  where date_trunc('month',dia) = date_trunc('month',(select d from hoy_sv)) - interval '1 month'
  group by 1,2
),
-- El ritmo se mide sobre los ultimos 7 dias, no sobre el acumulado: proyectar
-- la tasa desde el acumulado da siempre el mismo numero y no avisa nada.
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
-- mes_tot = lo vendido por ella este mes + el arrastre. Es lo que paga bloques.
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
  coalesce(mj.tot,0), mj.dia
from base b
join tot t              on t.store_code=b.store_code and t.mesero=b.mesero
left join mes_actual m  on m.store_code=b.store_code and m.mesero=b.mesero
left join mes_previo p  on p.store_code=b.store_code and p.mesero=b.mesero
left join ritmo r       on r.store_code=b.store_code and r.mesero=b.mesero
left join mejor mj      on mj.store_code=b.store_code and mj.mesero=b.mesero
order by t.mes_tot desc;
$function$;

-- Reparto Metrocentro (23-sep-2026)
update public.agrandado_config
   set activo = false,
       notas = concat_ws(' · ', nullif(notas,''), 'Renunció 22-sep-2026; sus 1,310 de septiembre + 164 del PIN Super se repartieron 737/737 entre Rosa y Liseth (Cesar 23-sep)')
 where store_code = 'S006' and mesero = 'Stephanie Guadalupe';

insert into public.agrandado_config (store_code, mesero, bloque_tam, valor_unit, meta_incremento_pp, activo_desde, activo, notas, ajuste_inicial, ajuste_mes)
values
 ('S006', 'Rosa',   100, 0.10, 2.0, '2026-09-23', true, 'Toma el puesto de Stephanie junto con Liseth (se turnan). Arrastre 737 = mitad de 1,474 (sep 1–22).', 737, '2026-09-01'),
 ('S006', 'Liseth', 100, 0.10, 2.0, '2026-09-23', true, 'Toma el puesto de Stephanie junto con Rosa (se turnan). Arrastre 737 = mitad de 1,474 (sep 1–22).',   737, '2026-09-01');
