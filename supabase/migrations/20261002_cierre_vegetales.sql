-- Vegetales del día en el cierre de caja (2-oct-2026, Cesar / Saúl).
-- Un registro por sucursal y día, que la cajera llena en el Corte Z del POS:
-- ¿se compró?, libras de lechuga y tomate, monto de la factura, quién autorizó y
-- la foto de la factura de vegetales (única cosa obligatoria, y solo si hubo compra).
-- Saúl y gerencia lo revisan en el módulo «Vegetales» (todas las sucursales).
create table if not exists public.cierre_vegetales (
  id            uuid primary key default gen_random_uuid(),
  store_code    text not null,
  fecha         date not null,
  comprado      boolean not null default true,
  lechuga_lb    numeric(10,2),
  tomate_lb     numeric(10,2),
  monto         numeric(10,2),
  autorizo      text,
  foto_urls     text[] not null default '{}',
  sin_foto      boolean not null default false,   -- cierre con excepción "sin fotos" del día
  registrado_por text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (store_code, fecha)
);
create index if not exists cierre_vegetales_fecha_idx on public.cierre_vegetales (fecha desc);

alter table public.cierre_vegetales enable row level security;
drop policy if exists cierre_vegetales_all on public.cierre_vegetales;
create policy cierre_vegetales_all on public.cierre_vegetales
  for all to anon, authenticated, service_role using (true) with check (true);
grant select, insert, update, delete on public.cierre_vegetales to anon, authenticated, service_role;

-- Módulo de revisión (Saúl es admin; también ejecutivo y superadmin)
insert into public.permisos_rol (rol, nav_key)
select r, 'vegetales' from unnest(array['admin','superadmin','ejecutivo']) r
where not exists (select 1 from public.permisos_rol p where p.rol = r and p.nav_key = 'vegetales');
