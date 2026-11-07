-- ════════════════════════════════════════════════════════════════════════════
-- Incentivos (extras por persona, domicilios) + CRM de clientes de domicilio
-- Pedido de Jazz (M001). Plan: docs/planes/PLAN_desempeno_meseros_y_domicilios.md
--
-- Todo por usuario_id (nunca por nombre). Tablas con RLS y sin policies: solo se
-- accede por las RPC SECURITY DEFINER de abajo, que validan el rol y la sucursal.
-- Fase "medir": todavía NO toca propinas ni planilla.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tablas ──────────────────────────────────────────────────────────────────
create table if not exists public.incentivo_programas (
  id                 uuid primary key default gen_random_uuid(),
  store_code         text not null,
  tipo               text not null check (tipo in ('extras','domicilios')),
  nombre             text not null,
  activo             boolean not null default true,
  vigente_desde      date not null default current_date,
  afecta_propina     boolean not null default false,   -- se enciende en la fase de propina
  -- qué cuenta como extra (solo tipo='extras'):
  categorias_extra   text[] not null default array['Extras','Fries & Sides','Cervezas','Bebidas'],
  cuenta_modificadores boolean not null default true,   -- tocino, queso… cobrados aparte
  tipos_cuenta       text[] not null default array['mesa','para_llevar','drive_through'],
  creado_por         uuid,
  created_at         timestamptz not null default now(),
  unique (store_code, tipo)
);

-- Metas. usuario_id NULL = meta por defecto del programa.
-- ambito 'persona' = meta de cada quien; 'equipo' = meta de toda la sucursal (cocina, domicilios).
create table if not exists public.incentivo_metas (
  id            uuid primary key default gen_random_uuid(),
  programa_id   uuid not null references public.incentivo_programas(id) on delete cascade,
  ambito        text not null default 'persona' check (ambito in ('persona','equipo')),
  usuario_id    uuid references public.usuarios_erp(id),
  meta_lj       numeric(10,2) not null check (meta_lj >= 0),  -- lunes a jueves
  meta_vd       numeric(10,2) not null check (meta_vd >= 0),  -- viernes a domingo
  vigente_desde date not null default current_date,
  creado_por    uuid,
  created_at    timestamptz not null default now(),
  unique nulls not distinct (programa_id, ambito, usuario_id, vigente_desde)
);

-- Tramos de propina (se usan en la fase de propina). factor 0.5 / 1.0
create table if not exists public.incentivo_tramos (
  programa_id uuid not null references public.incentivo_programas(id) on delete cascade,
  desde_pct   numeric(6,2) not null,
  factor      numeric(4,2) not null check (factor between 0 and 2),
  primary key (programa_id, desde_pct)
);

create table if not exists public.crm_plantillas (
  id          uuid primary key default gen_random_uuid(),
  store_code  text not null,
  nombre      text not null,
  texto       text not null,
  activo      boolean not null default true,
  creado_por  uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.crm_contactos (
  id             uuid primary key default gen_random_uuid(),
  store_code     text not null,
  telefono       text not null check (telefono ~ '^\d{8}$'),
  cliente_nombre text,
  usuario_id     uuid not null references public.usuarios_erp(id),
  plantilla_id   uuid references public.crm_plantillas(id),
  contactado_at  timestamptz not null default now()
);
create index if not exists crm_contactos_tel_idx on public.crm_contactos (store_code, telefono, contactado_at desc);

create table if not exists public.crm_exclusiones (
  telefono    text primary key check (telefono ~ '^\d{8}$'),
  motivo      text,
  usuario_id  uuid references public.usuarios_erp(id),
  created_at  timestamptz not null default now()
);

alter table public.incentivo_programas enable row level security;
alter table public.incentivo_metas     enable row level security;
alter table public.incentivo_tramos    enable row level security;
alter table public.crm_plantillas      enable row level security;
alter table public.crm_contactos       enable row level security;
alter table public.crm_exclusiones     enable row level security;
revoke all on public.incentivo_programas, public.incentivo_metas, public.incentivo_tramos,
              public.crm_plantillas, public.crm_contactos, public.crm_exclusiones from anon, authenticated;

-- ── Acceso: rol + sucursal ──────────────────────────────────────────────────
-- ejecutivo/superadmin/admin: cualquier sucursal. gerente y los roles extra: solo la suya.
create or replace function public._incentivo_acceso(p_usuario_id uuid, p_store text, p_roles_extra text[] default '{}')
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rol text; v_store text;
begin
  select rol, store_code into v_rol, v_store from public.usuarios_erp where id = p_usuario_id and activo limit 1;
  if v_rol is null then raise exception 'Usuario inválido o inactivo' using errcode = '28000'; end if;
  if v_rol in ('ejecutivo','superadmin','admin') then return v_rol; end if;
  if v_rol = 'gerente' or v_rol = any(p_roles_extra) then
    if v_store is distinct from p_store then
      raise exception 'Solo podés ver tu sucursal (%)', v_store using errcode = '42501';
    end if;
    return v_rol;
  end if;
  raise exception 'Tu rol (%) no tiene acceso a esta pantalla', v_rol using errcode = '42501';
end $$;

-- Meta vigente de un día (persona → default persona). Devuelve null si no hay.
create or replace function public._incentivo_meta_dia(p_programa uuid, p_ambito text, p_usuario uuid, p_dia date)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when extract(isodow from p_dia) >= 5 then m.meta_vd else m.meta_lj end
  from public.incentivo_metas m
  where m.programa_id = p_programa and m.ambito = p_ambito and m.vigente_desde <= p_dia
    and (m.usuario_id = p_usuario or m.usuario_id is null)
  order by (m.usuario_id is null), m.vigente_desde desc
  limit 1
$$;

-- ── Extras por persona y día ────────────────────────────────────────────────
-- Dueño de la cuenta = coalesce(mesero_id, cajero_id). Extra = modificadores cobrados
-- (ítems fuera de las categorías extra) + el subtotal completo de los ítems de las
-- categorías extra (bebida suelta, papas, cerveza…). La bebida DENTRO de un combo
-- vive en `componentes` y no es línea propia: no cuenta. Sin cortesías ni anulados.
create or replace function public.fn_extras_mesero(p_usuario_id uuid, p_store text, p_desde date, p_hasta date)
returns table (
  usuario_id uuid, nombre text, rol text, dia date,
  cuentas bigint, cuentas_mesa bigint, pax bigint, venta numeric, venta_mesa numeric, extras numeric,
  cuentas_con_extra bigint, meta_dia numeric
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_prog public.incentivo_programas;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  if p_hasta - p_desde > 120 then raise exception 'Rango máximo: 120 días'; end if;
  select * into v_prog from public.incentivo_programas where store_code = p_store and tipo = 'extras';
  return query
  with c as (
    select c.id, coalesce(c.mesero_id, c.cajero_id) emp, c.tipo, c.subtotal, case when c.tipo = 'mesa' then coalesce(c.pax_total,0) else 0 end pax,
           (c.cobrada_at at time zone 'America/El_Salvador')::date d
    from public.pos_cuentas c
    where c.store_code = p_store and c.estado = 'cobrada'
      and c.tipo = any(coalesce(v_prog.tipos_cuenta, array['mesa','para_llevar','drive_through']))
      and c.cobrada_at >= (p_desde::timestamp at time zone 'America/El_Salvador')
      and c.cobrada_at <  ((p_hasta + 1)::timestamp at time zone 'America/El_Salvador')
  ), it as (
    select i.cuenta_id,
           sum(case
                 when coalesce(i.cortesia,false) then 0
                 when cat.nombre = any(coalesce(v_prog.categorias_extra, array['Extras','Fries & Sides','Cervezas','Bebidas'])) then i.subtotal
                 when coalesce(v_prog.cuenta_modificadores, true) then coalesce(i.precio_modificadores,0) * i.cantidad
                 else 0 end) ext
    from public.pos_cuenta_items i
    join c on c.id = i.cuenta_id
    left join public.pos_menu_items mi on mi.id = i.menu_item_id
    left join public.pos_menu_categorias cat on cat.id = mi.categoria_id
    where coalesce(i.estado_cocina,'') <> 'cancelado'
    group by i.cuenta_id
  )
  select c.emp, nullif(trim(coalesce(u.nombre,'')||' '||coalesce(u.apellido,'')),''), u.rol, c.d,
         count(*), count(*) filter (where c.tipo='mesa'), sum(c.pax)::bigint,
         round(sum(c.subtotal),2), round(coalesce(sum(c.subtotal) filter (where c.tipo='mesa'),0),2), round(coalesce(sum(it.ext),0),2),
         count(*) filter (where coalesce(it.ext,0) > 0),
         case when v_prog.id is null then null else public._incentivo_meta_dia(v_prog.id, 'persona', c.emp, c.d) end
  from c left join it on it.cuenta_id = c.id
  left join public.usuarios_erp u on u.id = c.emp
  where c.emp is not null
  group by c.emp, u.nombre, u.apellido, u.rol, c.d
  order by c.d, c.emp;
end $$;

-- ── Configuración del programa ──────────────────────────────────────────────
create or replace function public.fn_incentivo_config(p_usuario_id uuid, p_store text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  return jsonb_build_object(
    'programas', coalesce((select jsonb_agg(to_jsonb(p) order by p.tipo) from public.incentivo_programas p where p.store_code = p_store), '[]'),
    'metas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'programa_id', m.programa_id, 'tipo', p.tipo, 'ambito', m.ambito, 'usuario_id', m.usuario_id,
        'nombre', u.nombre, 'meta_lj', m.meta_lj, 'meta_vd', m.meta_vd, 'vigente_desde', m.vigente_desde)
        order by p.tipo, m.ambito, u.nombre nulls first, m.vigente_desde desc)
      from public.incentivo_metas m join public.incentivo_programas p on p.id = m.programa_id
      left join public.usuarios_erp u on u.id = m.usuario_id
      where p.store_code = p_store), '[]'),
    'tramos', coalesce((select jsonb_agg(jsonb_build_object('tipo', p.tipo, 'desde_pct', t.desde_pct, 'factor', t.factor) order by p.tipo, t.desde_pct)
      from public.incentivo_tramos t join public.incentivo_programas p on p.id = t.programa_id where p.store_code = p_store), '[]')
  );
end $$;

-- Guarda una meta (nueva fila con vigente_desde: así queda el historial).
create or replace function public.fn_incentivo_meta_guardar(
  p_usuario_id uuid, p_store text, p_tipo text, p_ambito text, p_target uuid,
  p_meta_lj numeric, p_meta_vd numeric, p_vigente_desde date default current_date)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_prog uuid; v_id uuid;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  select id into v_prog from public.incentivo_programas where store_code = p_store and tipo = p_tipo;
  if v_prog is null then raise exception 'La sucursal % no tiene programa de %', p_store, p_tipo; end if;
  if p_target is not null and not exists (select 1 from public.usuarios_erp where id = p_target and store_code = p_store) then
    raise exception 'Esa persona no es de la sucursal %', p_store;
  end if;
  insert into public.incentivo_metas (programa_id, ambito, usuario_id, meta_lj, meta_vd, vigente_desde, creado_por)
  values (v_prog, p_ambito, p_target, p_meta_lj, p_meta_vd, coalesce(p_vigente_desde, current_date), p_usuario_id)
  on conflict (programa_id, ambito, usuario_id, vigente_desde)
  do update set meta_lj = excluded.meta_lj, meta_vd = excluded.meta_vd, creado_por = excluded.creado_por
  returning id into v_id;
  return v_id;
end $$;

-- Cambia qué cuenta como extra.
create or replace function public.fn_incentivo_reglas_guardar(p_usuario_id uuid, p_store text, p_categorias text[], p_modificadores boolean)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store);
  update public.incentivo_programas set categorias_extra = p_categorias, cuenta_modificadores = p_modificadores
  where store_code = p_store and tipo = 'extras';
end $$;

-- ── Domicilios: avance diario vs meta ───────────────────────────────────────
create or replace function public.fn_domicilios_avance(p_usuario_id uuid, p_store text, p_desde date, p_hasta date)
returns table (dia date, pedidos bigint, venta numeric, meta_dia numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_prog uuid;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  select id into v_prog from public.incentivo_programas where store_code = p_store and tipo = 'domicilios';
  return query
  select g.d::date,
         count(c.id),
         round(coalesce(sum(c.total),0),2),
         case when v_prog is null then null else public._incentivo_meta_dia(v_prog, 'equipo', null, g.d::date) end
  from generate_series(p_desde, p_hasta, interval '1 day') g(d)
  left join public.pos_cuentas c
    on c.store_code = p_store and c.tipo = 'delivery_propio' and c.estado = 'cobrada'
   and (c.cobrada_at at time zone 'America/El_Salvador')::date = g.d::date
  group by g.d order by g.d;
end $$;

-- ── CRM: clientes de domicilio ──────────────────────────────────────────────
-- Agrupa por teléfono (8 dígitos). Solo pedidos entregados. Segmentos:
--   vip (7+ pedidos) · frecuente (3+) · dormido (>21 días sin pedir) · nuevo (1 pedido, ≤14 días) · ocasional
create or replace function public.fn_clientes_delivery(p_usuario_id uuid, p_store text)
returns table (
  telefono text, nombre text, pedidos bigint, total numeric, ticket numeric,
  primer_pedido date, ultimo_pedido date, dias_sin_pedir integer, favorito text, segmento text,
  contactos bigint, ultimo_contacto timestamptz, volvio_tras_contacto boolean, excluido boolean
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  return query
  with d as (
    select right(regexp_replace(dc.cliente_telefono,'\D','','g'), 8) tel, dc.cliente_nombre, dc.total, dc.items,
           dc.created_at, (dc.created_at at time zone 'America/El_Salvador')::date dia
    from public.delivery_clientes dc join public.sucursales s on s.id = dc.sucursal_id
    where s.store_code = p_store and dc.estado = 'entregada'
      and length(regexp_replace(coalesce(dc.cliente_telefono,''),'\D','','g')) >= 8
  ), agg as (
    select d.tel, count(*) n, sum(d.total) tot, min(d.dia) pri, max(d.dia) ult, max(d.created_at) ult_ts,
           (array_agg(d.cliente_nombre order by d.created_at desc))[1] nom
    from d group by d.tel
  ), fav as (
    select distinct on (x.tel) x.tel, x.item
    from (select d.tel, e->>'nombre' item, sum(coalesce((e->>'cantidad')::int,1)) q
          from d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.items)='array' then d.items else '[]'::jsonb end) e
          group by d.tel, e->>'nombre') x
    order by x.tel, x.q desc
  ), ct as (
    select k.telefono tel, count(*) n, max(k.contactado_at) ult
    from public.crm_contactos k where k.store_code = p_store group by k.telefono
  )
  select a.tel, a.nom, a.n, round(a.tot,2), round(a.tot / a.n, 2), a.pri, a.ult,
         (current_date - a.ult)::int, f.item,
         case when a.n >= 7 then 'vip'
              when (current_date - a.ult) > 21 then 'dormido'
              when a.n >= 3 then 'frecuente'
              when a.n = 1 and (current_date - a.pri) <= 14 then 'nuevo'
              else 'ocasional' end,
         coalesce(ct.n,0), ct.ult,
         (ct.ult is not null and exists (select 1 from d where d.tel = a.tel and d.created_at > ct.ult and d.created_at <= ct.ult + interval '7 days')),
         (x.telefono is not null)
  from agg a left join fav f on f.tel = a.tel left join ct on ct.tel = a.tel
  left join public.crm_exclusiones x on x.telefono = a.tel
  order by a.ult desc;
end $$;

create or replace function public.fn_crm_registrar_contacto(p_usuario_id uuid, p_store text, p_telefono text, p_nombre text, p_plantilla uuid)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  if exists (select 1 from public.crm_exclusiones where telefono = p_telefono) then
    raise exception 'Ese cliente pidió no recibir mensajes';
  end if;
  insert into public.crm_contactos (store_code, telefono, cliente_nombre, usuario_id, plantilla_id)
  values (p_store, p_telefono, p_nombre, p_usuario_id, p_plantilla) returning id into v_id;
  return v_id;
end $$;

create or replace function public.fn_crm_excluir(p_usuario_id uuid, p_store text, p_telefono text, p_motivo text, p_excluir boolean default true)
returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  if p_excluir then
    insert into public.crm_exclusiones (telefono, motivo, usuario_id) values (p_telefono, p_motivo, p_usuario_id)
    on conflict (telefono) do nothing;
  else
    delete from public.crm_exclusiones where telefono = p_telefono;
  end if;
end $$;

create or replace function public.fn_crm_plantillas(p_usuario_id uuid, p_store text)
returns setof public.crm_plantillas language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  return query select * from public.crm_plantillas where store_code = p_store and activo order by created_at;
end $$;

create or replace function public.fn_crm_plantilla_guardar(p_usuario_id uuid, p_store text, p_id uuid, p_nombre text, p_texto text, p_activo boolean default true)
returns uuid language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public._incentivo_acceso(p_usuario_id, p_store, array['domicilios']);
  if p_id is null then
    insert into public.crm_plantillas (store_code, nombre, texto, activo, creado_por)
    values (p_store, p_nombre, p_texto, p_activo, p_usuario_id) returning id into v_id;
  else
    update public.crm_plantillas set nombre = p_nombre, texto = p_texto, activo = p_activo
    where id = p_id and store_code = p_store returning id into v_id;
  end if;
  return v_id;
end $$;

-- ── Grants (las tablas siguen cerradas; solo las RPC) ───────────────────────
revoke all on function public._incentivo_acceso(uuid,text,text[]) from public, anon, authenticated;
revoke all on function public._incentivo_meta_dia(uuid,text,uuid,date) from public, anon, authenticated;
grant execute on function
  public.fn_extras_mesero(uuid,text,date,date),
  public.fn_incentivo_config(uuid,text),
  public.fn_incentivo_meta_guardar(uuid,text,text,text,uuid,numeric,numeric,date),
  public.fn_incentivo_reglas_guardar(uuid,text,text[],boolean),
  public.fn_domicilios_avance(uuid,text,date,date),
  public.fn_clientes_delivery(uuid,text),
  public.fn_crm_registrar_contacto(uuid,text,text,text,uuid),
  public.fn_crm_excluir(uuid,text,text,text,boolean),
  public.fn_crm_plantillas(uuid,text),
  public.fn_crm_plantilla_guardar(uuid,text,uuid,text,text,boolean)
to anon, authenticated;

-- ── Semilla M001 (fase medir: sin metas cargadas, afecta_propina = false) ───
insert into public.incentivo_programas (store_code, tipo, nombre)
values ('M001','extras','Extras por persona'), ('M001','domicilios','Domicilios')
on conflict (store_code, tipo) do nothing;

insert into public.incentivo_tramos (programa_id, desde_pct, factor)
select id, x.desde, x.factor from public.incentivo_programas p
cross join (values (0::numeric, 0.5::numeric), (100, 1.0)) x(desde, factor)
where p.store_code = 'M001'
on conflict do nothing;

insert into public.crm_plantillas (store_code, nombre, texto)
select 'M001', 'Te extrañamos',
  '¡Hola {nombre}! 🍔 Te extrañamos en Freakie Dogs Santa Tecla. Seguimos aquí para llevarte tu {favorito} calientito a domicilio. ¿Te lo mandamos hoy? Escríbenos por aquí y con gusto te atendemos.'
where not exists (select 1 from public.crm_plantillas where store_code = 'M001');
