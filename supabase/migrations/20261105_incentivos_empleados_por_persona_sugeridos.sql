-- ════════════════════════════════════════════════════════════════════════════
-- Incentivos v2 (pedido de Jose, 5-nov-2026)
--  1. Ventas a empleados FUERA de los promedios:
--     - cuenta con descuento categoría 'empleado' o con descuento_empleado_id, o
--     - ítems de productos de empleado (nombre ~ 'emplead': Soda Empleados,
--       Café empleado, Camisas empleados…). Si la cuenta solo tiene eso, se va entera.
--     En M001 eran ~126 cuentas marcadas + ~640 ventas de soda/café de empleado
--     cobradas como «para llevar» sin marcar (bajaban el ticket de las cajeras).
--  2. Promedios POR PERSONA atendida: personas = pax de la mesa; en para llevar /
--     drive thru (no registran pax) cada cuenta = 1 persona.
--  3. Metas sugeridas a partir de los últimos N días.
-- ════════════════════════════════════════════════════════════════════════════

-- Patrón de productos de empleado (configurable por programa)
alter table public.incentivo_programas
  add column if not exists patron_items_empleado text not null default 'emplead';

-- ── Base común: una fila por cuenta, ya sin empleados ───────────────────────
create or replace function public._extras_cuentas(p_store text, p_desde date, p_hasta date)
returns table (cuenta_id uuid, emp uuid, tipo text, dia date, personas integer,
               venta numeric, extras numeric, es_empleado boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_prog public.incentivo_programas;
begin
  select p.* into v_prog from public.incentivo_programas p where p.store_code = p_store and p.tipo = 'extras';
  return query
  with c as (
    select c.id, coalesce(c.mesero_id, c.cajero_id) emp, c.tipo,
           (c.cobrada_at at time zone 'America/El_Salvador')::date d,
           case when c.tipo = 'mesa' and coalesce(c.pax_total,0) > 0 then c.pax_total else 1 end pax,
           (coalesce(c.descuento_categoria,'') = 'empleado' or c.descuento_empleado_id is not null) marcada_emp
    from public.pos_cuentas c
    where c.store_code = p_store and c.estado = 'cobrada'
      and c.tipo = any(coalesce(v_prog.tipos_cuenta, array['mesa','para_llevar','drive_through']))
      and c.cobrada_at >= (p_desde::timestamp at time zone 'America/El_Salvador')
      and c.cobrada_at <  ((p_hasta + 1)::timestamp at time zone 'America/El_Salvador')
  ), it as (
    select i.cuenta_id,
           sum(case when i.nombre ~* coalesce(v_prog.patron_items_empleado,'emplead') then 0
                    else i.subtotal - coalesce(i.descuento,0) end) venta,
           sum(case
                 when i.nombre ~* coalesce(v_prog.patron_items_empleado,'emplead') then 0
                 when coalesce(i.cortesia,false) then 0
                 when cat.nombre = any(coalesce(v_prog.categorias_extra, array['Extras','Fries & Sides','Cervezas','Bebidas'])) then i.subtotal
                 when coalesce(v_prog.cuenta_modificadores, true) then coalesce(i.precio_modificadores,0) * i.cantidad
                 else 0 end) ext,
           bool_and(i.nombre ~* coalesce(v_prog.patron_items_empleado,'emplead')) solo_emp
    from public.pos_cuenta_items i
    join c on c.id = i.cuenta_id
    left join public.pos_menu_items mi on mi.id = i.menu_item_id
    left join public.pos_menu_categorias cat on cat.id = mi.categoria_id
    where coalesce(i.estado_cocina,'') <> 'cancelado'
    group by i.cuenta_id
  )
  select c.id, c.emp, c.tipo, c.d, c.pax,
         round(coalesce(it.venta,0),2), round(coalesce(it.ext,0),2),
         (c.marcada_emp or coalesce(it.solo_emp,false))
  from c left join it on it.cuenta_id = c.id
  where c.emp is not null;
end $$;
revoke all on function public._extras_cuentas(text,date,date) from public, anon, authenticated;

-- ── fn_extras_mesero v2: por persona, sin empleados ─────────────────────────
drop function if exists public.fn_extras_mesero(uuid,text,date,date);
create function public.fn_extras_mesero(p_usuario_id uuid, p_store text, p_desde date, p_hasta date)
returns table (
  usuario_id uuid, nombre text, rol text, dia date,
  cuentas bigint, cuentas_mesa bigint, personas bigint, venta numeric, extras numeric,
  cuentas_con_extra bigint, ventas_empleado bigint, meta_dia numeric
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_prog uuid;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  if p_hasta - p_desde > 120 then raise exception 'Rango máximo: 120 días'; end if;
  select id into v_prog from public.incentivo_programas where store_code = p_store and tipo = 'extras';
  return query
  select x.emp, nullif(trim(coalesce(u.nombre,'')||' '||coalesce(u.apellido,'')),''), u.rol, x.dia,
         count(*) filter (where not x.es_empleado),
         count(*) filter (where not x.es_empleado and x.tipo = 'mesa'),
         coalesce(sum(x.personas) filter (where not x.es_empleado),0)::bigint,
         coalesce(sum(x.venta) filter (where not x.es_empleado),0),
         coalesce(sum(x.extras) filter (where not x.es_empleado),0),
         count(*) filter (where not x.es_empleado and x.extras > 0),
         count(*) filter (where x.es_empleado),
         case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'persona', x.emp, x.dia) end
  from public._extras_cuentas(p_store, p_desde, p_hasta) x
  left join public.usuarios_erp u on u.id = x.emp
  group by x.emp, u.nombre, u.apellido, u.rol, x.dia
  order by x.dia, x.emp;
end $$;
grant execute on function public.fn_extras_mesero(uuid,text,date,date) to anon, authenticated;

-- ── Metas sugeridas ─────────────────────────────────────────────────────────
-- Persona: percentil 60 de los extras por día-persona (días con ≥ 5 cuentas),
--          separado L–J / V–D, redondeado a $5. «Lo logra hoy el 40 % de los días».
-- Equipo:  mediana de extras diarios de la sucursal × 1.05, redondeado a $10.
-- Domicilios: promedio de pedidos diarios × 1.10, redondeado a 1.
create or replace function public.fn_incentivo_sugerencias(p_usuario_id uuid, p_store text, p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_desde date := current_date - p_dias; v_hasta date := current_date - 1; r jsonb;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  with x as (select * from public._extras_cuentas(p_store, v_desde, v_hasta) where not es_empleado),
  pd as (  -- persona-día
    select emp, dia, extract(isodow from dia) >= 5 vd, sum(extras) ext, sum(personas) per, count(*) n
    from x group by emp, dia having count(*) >= 5
  ), sd as ( -- sucursal-día
    select dia, extract(isodow from dia) >= 5 vd, sum(extras) ext from x group by dia
  ), dd as ( -- domicilios-día
    select g.d::date dia, extract(isodow from g.d) >= 5 vd, count(c.id) n
    from generate_series(v_desde, v_hasta, interval '1 day') g(d)
    left join public.pos_cuentas c on c.store_code = p_store and c.tipo = 'delivery_propio' and c.estado = 'cobrada'
     and (c.cobrada_at at time zone 'America/El_Salvador')::date = g.d::date
    group by g.d
  )
  select jsonb_build_object(
    'desde', v_desde, 'hasta', v_hasta,
    'persona', jsonb_build_object(
      'lj', (select round(percentile_cont(0.6) within group (order by ext)::numeric / 5) * 5 from pd where not vd),
      'vd', (select round(percentile_cont(0.6) within group (order by ext)::numeric / 5) * 5 from pd where vd),
      'prom_lj', (select round(avg(ext),2) from pd where not vd),
      'prom_vd', (select round(avg(ext),2) from pd where vd),
      'extras_por_persona', (select round(sum(ext)/nullif(sum(per),0),2) from pd),
      'dias_persona', (select count(*) from pd)),
    'equipo', jsonb_build_object(
      'lj', (select round(percentile_cont(0.5) within group (order by ext)::numeric * 1.05 / 10) * 10 from sd where not vd),
      'vd', (select round(percentile_cont(0.5) within group (order by ext)::numeric * 1.05 / 10) * 10 from sd where vd),
      'prom_lj', (select round(avg(ext),2) from sd where not vd),
      'prom_vd', (select round(avg(ext),2) from sd where vd)),
    'domicilios', jsonb_build_object(
      'lj', (select round(avg(n) * 1.10) from dd where not vd),
      'vd', (select round(avg(n) * 1.10) from dd where vd),
      'prom_lj', (select round(avg(n),1) from dd where not vd),
      'prom_vd', (select round(avg(n),1) from dd where vd)),
    'por_persona', coalesce((select jsonb_agg(jsonb_build_object('usuario_id', q.emp, 'nombre', u.nombre,
        'lj', q.lj, 'vd', q.vd, 'dias', q.dias) order by u.nombre)
      from (select emp, round(avg(ext) filter (where not vd),2) lj, round(avg(ext) filter (where vd),2) vd, count(*) dias
            from pd group by emp) q left join public.usuarios_erp u on u.id = q.emp), '[]')
  ) into r;
  return r;
end $$;
grant execute on function public.fn_incentivo_sugerencias(uuid,text,integer) to anon, authenticated;

-- ── Qué vende cada persona (agrupado) ───────────────────────────────────────
-- grupo = categoría del menú (Combos, Individuales, Bebidas, Cervezas, Fries & Sides,
-- Extras) + «Ingredientes extra» (modificadores cobrados dentro de cada plato).
-- Sin ventas a empleados, sin cortesías, sin anulados.
create or replace function public.fn_items_mesero(p_usuario_id uuid, p_store text, p_desde date, p_hasta date)
returns table (usuario_id uuid, grupo text, item text, cantidad bigint, monto numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_pat text;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  if p_hasta - p_desde > 120 then raise exception 'Rango máximo: 120 días'; end if;
  select coalesce(patron_items_empleado,'emplead') into v_pat from public.incentivo_programas where store_code = p_store and tipo = 'extras';
  v_pat := coalesce(v_pat, 'emplead');
  return query
  with x as (select * from public._extras_cuentas(p_store, p_desde, p_hasta) where not es_empleado),
  i as (
    select x.emp, it.*, cat.nombre cat
    from x join public.pos_cuenta_items it on it.cuenta_id = x.cuenta_id
    left join public.pos_menu_items mi on mi.id = it.menu_item_id
    left join public.pos_menu_categorias cat on cat.id = mi.categoria_id
    where coalesce(it.estado_cocina,'') <> 'cancelado' and not coalesce(it.cortesia,false)
      and it.nombre !~* v_pat
  ), platos as (
    select i.emp, coalesce(i.cat,'Otros') g, initcap(lower(trim(regexp_replace(i.nombre,'\s+',' ','g')))) n, sum(i.cantidad)::bigint q, sum(i.subtotal) m
    from i group by 1,2,3
  ), mods as (  -- modificadores cobrados: en componentes de combos y en el ítem
    select i.emp, 'Ingredientes extra' g, initcap(lower(trim(m->>'nombre'))) n, sum(i.cantidad)::bigint q,
           sum((m->>'precio_extra')::numeric * i.cantidad) mm
    from i
    cross join lateral (
      select jsonb_array_elements(case when jsonb_typeof(c->'modificadores')='array' then c->'modificadores' else '[]' end) m
      from jsonb_array_elements(case when jsonb_typeof(i.componentes)='array' then i.componentes else '[]' end) c
      union all
      select jsonb_array_elements(case when jsonb_typeof(i.modificadores)='array' then i.modificadores else '[]' end)
    ) z
    where coalesce((m->>'precio_extra')::numeric,0) > 0
    group by 1,2,3
  )
  select emp, g, n, q, round(m,2) from platos
  union all
  select emp, g, n, q, round(mm,2) from mods
  order by 1, 2, 4 desc;
end $$;
grant execute on function public.fn_items_mesero(uuid,text,date,date) to anon, authenticated;
