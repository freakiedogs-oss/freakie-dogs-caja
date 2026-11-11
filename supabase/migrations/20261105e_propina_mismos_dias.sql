-- Fix (5-nov-2026): el logrado se comparaba con la meta de MENOS días.
-- Las metas se cargaron vigentes desde el 5-nov; se sumaban los extras del 1 al 4
-- (sin meta) contra la meta de 1 día → cocina daba 534 %. Ahora logrado y meta se
-- toman sobre los MISMOS días: los que tienen meta (y hasta ayer).
create or replace function public._propina_mes(p_store text, p_mes date)
returns table (usuario_id uuid, nombre text, rol text, ambito text,
               logrado numeric, meta numeric, cumplimiento numeric, base_pct numeric,
               faltas_pct numeric, premios_pct numeric, n_faltas integer, n_premios integer,
               pct_final numeric, sin_meta boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_desde date := date_trunc('month', p_mes)::date;
  v_fin   date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  -- Hasta AYER: el día en curso no terminó y su meta completa bajaría el % de todos.
  v_hasta date := least(v_fin, current_date - 1);
  v_prog uuid; v_dom uuid;
begin
  select p.id into v_prog from public.incentivo_programas p where p.store_code = p_store and p.tipo = 'extras' and p.activo;
  select p.id into v_dom  from public.incentivo_programas p where p.store_code = p_store and p.tipo = 'domicilios' and p.activo;
  return query
  with staff as (
    select u.id, u.nombre, u.rol from public.usuarios_erp u
    where u.store_code = p_store and u.activo and u.rol = any(public._propina_roles())
  ), x as (
    select * from public._extras_cuentas(p_store, v_desde, v_hasta) where not es_empleado
  ), pd as (
    select x.emp, x.dia, sum(x.extras) ext,
           case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'persona', x.emp, x.dia) end m
    from x group by x.emp, x.dia
  ), pers as (
    select pd.emp, coalesce(sum(pd.ext) filter (where pd.m is not null), sum(pd.ext)) ext, sum(pd.m) meta from pd group by pd.emp
  ), eqd as (
    select x.dia, sum(x.extras) ext,
           case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'equipo', null, x.dia) end m
    from x group by x.dia
  ), eq as (select coalesce(sum(eqd.ext) filter (where eqd.m is not null), sum(eqd.ext)) ext, sum(eqd.m) meta from eqd),
  domd as (
    select g.d::date dia, count(c.id) n,
           case when v_dom is null then null else public._incentivo_meta_dia(v_dom, 'equipo', null, g.d::date) end m
    from generate_series(v_desde, v_hasta, interval '1 day') g(d)
    left join public.pos_cuentas c on c.store_code = p_store and c.tipo = 'delivery_propio' and c.estado = 'cobrada'
     and (c.cobrada_at at time zone 'America/El_Salvador')::date = g.d::date
    group by g.d
  ), dom as (select coalesce(sum(domd.n) filter (where domd.m is not null), sum(domd.n))::numeric ext, sum(domd.m) meta from domd),
  aj as (
    select a.usuario_id uid,
           coalesce(sum(a.pct) filter (where a.pct < 0),0) f, coalesce(sum(a.pct) filter (where a.pct > 0),0) p,
           count(*) filter (where a.pct < 0)::int nf, count(*) filter (where a.pct > 0)::int np
    from public.incentivo_ajustes a
    where a.store_code = p_store and not a.anulado and a.fecha between v_desde and v_fin
    group by a.usuario_id
  ), base as (
    select s.id, s.nombre, s.rol,
           case when s.rol = 'cocina' then 'equipo' when s.rol = 'domicilios' then 'domicilios' else 'persona' end amb,
           case when s.rol = 'cocina' then (select eq.ext from eq) when s.rol = 'domicilios' then (select dom.ext from dom) else pe.ext end lo,
           case when s.rol = 'cocina' then (select eq.meta from eq) when s.rol = 'domicilios' then (select dom.meta from dom) else pe.meta end me,
           case when s.rol = 'domicilios' then v_dom else v_prog end prog
    from staff s left join pers pe on pe.emp = s.id
  )
  select b.id, b.nombre, b.rol, b.amb,
         round(coalesce(b.lo,0),2), round(b.me,2),
         case when coalesce(b.me,0) > 0 then round(coalesce(b.lo,0) / b.me * 100, 1) end,
         case when coalesce(b.me,0) > 0 and b.prog is not null then public._tramo_pct(b.prog, coalesce(b.lo,0) / b.me * 100) else 100 end,
         coalesce(aj.f,0), coalesce(aj.p,0), coalesce(aj.nf,0), coalesce(aj.np,0),
         greatest(0, (case when coalesce(b.me,0) > 0 and b.prog is not null then public._tramo_pct(b.prog, coalesce(b.lo,0) / b.me * 100) else 100 end)
                     + coalesce(aj.p,0) + coalesce(aj.f,0)),
         coalesce(b.me,0) = 0
  from base b left join aj on aj.uid = b.id
  order by b.rol, b.nombre;
end $$;
revoke all on function public._propina_mes(text,date) from public, anon, authenticated;
