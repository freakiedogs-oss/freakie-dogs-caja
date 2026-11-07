-- Propina del mes en %: base por meta (tramos) + premios − faltas (pedido de Jose, 5-nov-2026)
--   Falta leve −2.5 %, moderada −5 %, grave −10 %. Premio: + el % que se elija (hasta 20 por registro).
--   Base: 100 % si cumple su meta del mes, 50 % si no (incentivo_tramos). Sin meta cargada = 100 %.
--     meseros/cajeras → meta personal de extras; cocina → meta de equipo; domicilios → meta de pedidos.
--   Final = max(0, base + premios + faltas). Lo registra admin/gerente; cada quien ve el suyo.
--   Fase "medir": todavía NO se aplica a la planilla; se muestra el % para que el equipo se acostumbre.

create table if not exists public.incentivo_ajustes (
  id             uuid primary key default gen_random_uuid(),
  store_code     text not null,
  usuario_id     uuid not null references public.usuarios_erp(id),
  fecha          date not null default current_date,
  tipo           text not null check (tipo in ('falta_leve','falta_moderada','falta_grave','premio')),
  pct            numeric(5,2) not null,
  motivo         text not null check (length(trim(motivo)) >= 3),
  registrado_por uuid not null references public.usuarios_erp(id),
  created_at     timestamptz not null default now(),
  anulado        boolean not null default false,
  anulado_por    uuid references public.usuarios_erp(id),
  anulado_motivo text,
  anulado_at     timestamptz,
  check ((tipo = 'falta_leve' and pct = -2.5) or (tipo = 'falta_moderada' and pct = -5)
      or (tipo = 'falta_grave' and pct = -10) or (tipo = 'premio' and pct > 0 and pct <= 20))
);
create index if not exists incentivo_ajustes_idx on public.incentivo_ajustes (store_code, fecha, usuario_id);
alter table public.incentivo_ajustes enable row level security;
revoke all on public.incentivo_ajustes from anon, authenticated;

-- Roles que entran al reparto (y por lo tanto a este cálculo)
create or replace function public._propina_roles() returns text[] language sql immutable as $$
  select array['mesero','mesera','cajera','cajero','cocina','domicilios']
$$;

-- Factor del tramo (100 = 1.0). Sin meta → 100.
create or replace function public._tramo_pct(p_programa uuid, p_cumpl numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select t.factor * 100 from public.incentivo_tramos t
                   where t.programa_id = p_programa and t.desde_pct <= p_cumpl
                   order by t.desde_pct desc limit 1), 100)
$$;

-- Cálculo interno por sucursal y mes
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
    select pd.emp, sum(pd.ext) ext, sum(pd.m) meta from pd group by pd.emp
  ), eqd as (
    select x.dia, sum(x.extras) ext,
           case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'equipo', null, x.dia) end m
    from x group by x.dia
  ), eq as (select sum(eqd.ext) ext, sum(eqd.m) meta from eqd),
  domd as (
    select g.d::date dia, count(c.id) n,
           case when v_dom is null then null else public._incentivo_meta_dia(v_dom, 'equipo', null, g.d::date) end m
    from generate_series(v_desde, v_hasta, interval '1 day') g(d)
    left join public.pos_cuentas c on c.store_code = p_store and c.tipo = 'delivery_propio' and c.estado = 'cobrada'
     and (c.cobrada_at at time zone 'America/El_Salvador')::date = g.d::date
    group by g.d
  ), dom as (select sum(domd.n)::numeric ext, sum(domd.m) meta from domd),
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
revoke all on function public._tramo_pct(uuid,numeric) from public, anon, authenticated;

-- ── Admin / gerente ─────────────────────────────────────────────────────────
create or replace function public.fn_propina_mes(p_usuario_id uuid, p_store text, p_mes date)
returns table (usuario_id uuid, nombre text, rol text, ambito text, logrado numeric, meta numeric, cumplimiento numeric,
               base_pct numeric, faltas_pct numeric, premios_pct numeric, n_faltas integer, n_premios integer, pct_final numeric, sin_meta boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  return query select * from public._propina_mes(p_store, p_mes);
end $$;

create or replace function public.fn_ajustes_mes(p_usuario_id uuid, p_store text, p_mes date)
returns table (id uuid, usuario_id uuid, nombre text, rol text, fecha date, tipo text, pct numeric, motivo text,
               registrado_por text, anulado boolean, anulado_motivo text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  return query
  select a.id, a.usuario_id, u.nombre, u.rol, a.fecha, a.tipo, a.pct, a.motivo, r.nombre, a.anulado, a.anulado_motivo
  from public.incentivo_ajustes a
  join public.usuarios_erp u on u.id = a.usuario_id
  left join public.usuarios_erp r on r.id = a.registrado_por
  where a.store_code = p_store
    and a.fecha between date_trunc('month', p_mes)::date and (date_trunc('month', p_mes) + interval '1 month - 1 day')::date
  order by a.fecha desc, a.created_at desc;
end $$;

create or replace function public.fn_ajuste_registrar(p_usuario_id uuid, p_store text, p_target uuid, p_tipo text,
                                                      p_pct numeric, p_fecha date, p_motivo text)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_pct numeric; v_id uuid;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  if not exists (select 1 from public.usuarios_erp u where u.id = p_target and u.store_code = p_store and u.activo
                 and u.rol = any(public._propina_roles())) then
    raise exception 'Esa persona no está en el reparto de propina de %', p_store;
  end if;
  if p_target = p_usuario_id then raise exception 'No podés registrarte faltas o premios a vos misma'; end if;
  v_pct := case p_tipo when 'falta_leve' then -2.5 when 'falta_moderada' then -5 when 'falta_grave' then -10
                       when 'premio' then p_pct end;
  if v_pct is null then raise exception 'Tipo inválido'; end if;
  if coalesce(p_fecha, current_date) > current_date then raise exception 'La fecha no puede ser futura'; end if;
  insert into public.incentivo_ajustes (store_code, usuario_id, fecha, tipo, pct, motivo, registrado_por)
  values (p_store, p_target, coalesce(p_fecha, current_date), p_tipo, v_pct, trim(p_motivo), p_usuario_id)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fn_ajuste_anular(p_usuario_id uuid, p_id uuid, p_motivo text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_store text;
begin
  select a.store_code into v_store from public.incentivo_ajustes a where a.id = p_id;
  if v_store is null then raise exception 'No existe'; end if;
  perform public._incentivo_acceso(p_usuario_id, v_store);
  if coalesce(length(trim(p_motivo)),0) < 3 then raise exception 'Escribí por qué se anula'; end if;
  update public.incentivo_ajustes set anulado = true, anulado_por = p_usuario_id, anulado_motivo = trim(p_motivo), anulado_at = now()
  where id = p_id and not anulado;
end $$;

grant execute on function public.fn_propina_mes(uuid,text,date), public.fn_ajustes_mes(uuid,text,date),
  public.fn_ajuste_registrar(uuid,text,uuid,text,numeric,date,text), public.fn_ajuste_anular(uuid,uuid,text)
to anon, authenticated;

-- ── Cada quien: su % (lo usa «Mi Desempeño») ────────────────────────────────
create or replace function public.fn_mi_propina(p_usuario_id uuid, p_mes date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_u public.usuarios_erp; r jsonb;
begin
  select * into v_u from public.usuarios_erp u where u.id = p_usuario_id and u.activo limit 1;
  if v_u.id is null then raise exception 'Usuario inválido o inactivo' using errcode = '28000'; end if;
  select jsonb_build_object(
    'resumen', (select to_jsonb(m) from public._propina_mes(v_u.store_code, p_mes) m where m.usuario_id = p_usuario_id),
    'ajustes', coalesce((select jsonb_agg(jsonb_build_object('fecha', a.fecha, 'tipo', a.tipo, 'pct', a.pct, 'motivo', a.motivo) order by a.fecha desc)
                         from public.incentivo_ajustes a
                         where a.usuario_id = p_usuario_id and not a.anulado
                           and a.fecha between date_trunc('month', p_mes)::date and (date_trunc('month', p_mes) + interval '1 month - 1 day')::date), '[]')
  ) into r;
  return r;
end $$;
grant execute on function public.fn_mi_propina(uuid,date) to anon, authenticated;
