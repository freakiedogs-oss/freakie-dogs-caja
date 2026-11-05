-- «Mi Desempeño»: cada persona ve SOLO lo suyo (pedido de Jose, 5-nov-2026).
-- Admin/ejecutivo/superadmin ven todo en Desempeño Meseros; gerente su sucursal.
-- La restricción vive acá: la RPC toma la sucursal y la persona del usuario,
-- no de parámetros del cliente, así que no se puede pedir la de otro.

-- Base interna de ítems (sin control de acceso), para reutilizar.
create or replace function public._items_cuentas(p_store text, p_desde date, p_hasta date)
returns table (usuario_id uuid, grupo text, item text, cantidad bigint, monto numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_pat text;
begin
  select coalesce(p.patron_items_empleado,'emplead') into v_pat from public.incentivo_programas p where p.store_code = p_store and p.tipo = 'extras';
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
  ), mods as (
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
revoke all on function public._items_cuentas(text,date,date) from public, anon, authenticated;

create or replace function public.fn_items_mesero(p_usuario_id uuid, p_store text, p_desde date, p_hasta date)
returns table (usuario_id uuid, grupo text, item text, cantidad bigint, monto numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  if p_hasta - p_desde > 120 then raise exception 'Rango máximo: 120 días'; end if;
  return query select * from public._items_cuentas(p_store, p_desde, p_hasta);
end $$;
grant execute on function public.fn_items_mesero(uuid,text,date,date) to anon, authenticated;

-- Todo lo de UNA persona, en un JSON. La sucursal sale del usuario.
create or replace function public.fn_mi_desempeno(p_usuario_id uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_u public.usuarios_erp; v_prog uuid; v_dom uuid; r jsonb;
begin
  select * into v_u from public.usuarios_erp u where u.id = p_usuario_id and u.activo limit 1;
  if v_u.id is null then raise exception 'Usuario inválido o inactivo' using errcode = '28000'; end if;
  if p_hasta - p_desde > 120 then raise exception 'Rango máximo: 120 días'; end if;
  select p.id into v_prog from public.incentivo_programas p where p.store_code = v_u.store_code and p.tipo = 'extras' and p.activo;
  select p.id into v_dom  from public.incentivo_programas p where p.store_code = v_u.store_code and p.tipo = 'domicilios' and p.activo;

  with x as (select * from public._extras_cuentas(v_u.store_code, p_desde, p_hasta) where not es_empleado),
  mio as (select * from x where x.emp = p_usuario_id),
  dias as (
    select m.dia, count(*) cuentas, sum(m.personas) personas, round(sum(m.venta),2) venta, round(sum(m.extras),2) extras,
           count(*) filter (where m.extras > 0) con_extra,
           case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'persona', p_usuario_id, m.dia) end meta_dia
    from mio m group by m.dia
  ), eq as (
    select x.dia, round(sum(x.extras),2) extras,
           case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'equipo', null, x.dia) end meta_dia
    from x group by x.dia
  ), dom as (
    select g.d::date dia, count(c.id) pedidos,
           case when v_dom is null then null else public._incentivo_meta_dia(v_dom, 'equipo', null, g.d::date) end meta_dia
    from generate_series(p_desde, p_hasta, interval '1 day') g(d)
    left join public.pos_cuentas c on c.store_code = v_u.store_code and c.tipo = 'delivery_propio' and c.estado = 'cobrada'
     and (c.cobrada_at at time zone 'America/El_Salvador')::date = g.d::date
    group by g.d
  )
  select jsonb_build_object(
    'nombre', v_u.nombre, 'rol', v_u.rol, 'store_code', v_u.store_code,
    'tiene_programa', v_prog is not null,
    'unidad', case when v_u.rol in ('mesero','mesera') then 'persona' else 'ticket' end,
    'dias', coalesce((select jsonb_agg(to_jsonb(d) order by d.dia) from dias d), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('grupo', t.grupo, 'item', t.item, 'cantidad', t.cantidad, 'monto', t.monto))
                       from public._items_cuentas(v_u.store_code, p_desde, p_hasta) t where t.usuario_id = p_usuario_id), '[]'),
    'equipo', coalesce((select jsonb_agg(to_jsonb(e) order by e.dia) from eq e), '[]'),
    'domicilios', case when v_u.rol = 'domicilios' then coalesce((select jsonb_agg(to_jsonb(d) order by d.dia) from dom d), '[]') else null end,
    -- Promedio de la sucursal (agregado, sin nombres) para compararse
    'sucursal', (select jsonb_build_object(
        'venta_persona', round(sum(x.venta) filter (where x.tipo='mesa') / nullif(sum(x.personas) filter (where x.tipo='mesa'),0),2),
        'extras_persona', round(sum(x.extras) filter (where x.tipo='mesa') / nullif(sum(x.personas) filter (where x.tipo='mesa'),0),2),
        'venta_ticket', round(avg(x.venta) filter (where x.tipo<>'mesa'),2),
        'extras_ticket', round(avg(x.extras) filter (where x.tipo<>'mesa'),2),
        'pct_con_extra', round(100.0 * count(*) filter (where x.extras > 0) / nullif(count(*),0),1)) from x)
  ) into r;
  return r;
end $$;
grant execute on function public.fn_mi_desempeno(uuid,date,date) to anon, authenticated;
