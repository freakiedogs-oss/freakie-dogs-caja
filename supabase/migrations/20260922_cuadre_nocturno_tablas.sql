-- 22-sep-2026 · Cuadre nocturno (skill «cuadre-nocturno-freakie»): tres tablas.
--  1) productos_criticos   — la lista de críticos, unidad de conteo y tolerancia por producto
--                            (antes vivía en el texto del skill: cambiarla obligaba a reenviar el skill).
--  2) cuadres_nocturnos     — el resultado de cada cuadre (el objeto DATA del panel) por sucursal y noche,
--                            para ver tendencias y la regla «3 noches para el mismo lado».
--  3) cuadre_pendientes     — lo que queda para el encargado al día siguiente; el panel las tacha y
--                            el skill las retoma a la noche siguiente. Compartido entre quien cuadre.

create table if not exists public.productos_criticos (
  id                    uuid primary key default gen_random_uuid(),
  store_code            text,                       -- null = todas las sucursales
  producto_id           uuid not null references public.catalogo_productos(id),
  producto_descarga_id  uuid references public.catalogo_productos(id),  -- si las recetas descargan OTRO producto (queso frito: bolsita vs lb)
  nombre_panel          text not null,              -- cómo se llama en el panel
  unidad                text not null,              -- unidad en que la sucursal CUENTA (bolitas, panes, unidades, bolsas, lb, kg, latas)
  factor_conteo         numeric not null default 1, -- unidades de conteo por 1 unidad del kardex (salchicha 25, pan Berna 10, queso frito 1/0.3)
  tolerancia            numeric not null default 0, -- en unidades de conteo
  grupo                 text,                       -- productos que se cuadran sumados (latas)
  orden                 int not null default 100,
  activo                boolean not null default true,
  nota                  text,                       -- p.ej. «mapeo roto: porción vs libra» (va a «sin evaluar»)
  updated_at            timestamptz not null default now(),
  unique nulls not distinct (store_code, producto_id)   -- store_code null = todas; sin «nulls not distinct» se duplicarían
);

create table if not exists public.cuadres_nocturnos (
  id          uuid primary key default gen_random_uuid(),
  store_code  text not null,
  fecha       date not null,
  data        jsonb not null,           -- el objeto DATA que llena la plantilla
  resumen     jsonb,                    -- [{n, dif, cls}] por producto, para tendencias rápidas
  creado_por  text,
  created_at  timestamptz not null default now(),
  unique (store_code, fecha)
);

create table if not exists public.cuadre_pendientes (
  id          uuid primary key default gen_random_uuid(),
  store_code  text not null,
  fecha       date not null,            -- noche del cuadre que lo generó
  orden       int not null default 0,
  texto       text not null,
  hecho       boolean not null default false,
  hecho_por   text,
  respuesta   text,                     -- lo que contestó cocina / el encargado
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists cuadre_pendientes_store_fecha on public.cuadre_pendientes (store_code, fecha);

alter table public.productos_criticos  enable row level security;
alter table public.cuadres_nocturnos   enable row level security;
alter table public.cuadre_pendientes   enable row level security;

-- Lectura abierta (anon = el panel y la PWA). Escritura: los cuadres y los críticos se escriben
-- desde el skill (service role); los pendientes sí los actualiza el panel con anon (solo hecho/respuesta).
drop policy if exists productos_criticos_read on public.productos_criticos;
create policy productos_criticos_read on public.productos_criticos for select to anon, authenticated using (true);
drop policy if exists cuadres_nocturnos_read on public.cuadres_nocturnos;
create policy cuadres_nocturnos_read on public.cuadres_nocturnos for select to anon, authenticated using (true);
drop policy if exists cuadre_pendientes_read on public.cuadre_pendientes;
create policy cuadre_pendientes_read on public.cuadre_pendientes for select to anon, authenticated using (true);
drop policy if exists cuadre_pendientes_update on public.cuadre_pendientes;
create policy cuadre_pendientes_update on public.cuadre_pendientes for update to anon, authenticated using (true) with check (true);

grant select on public.productos_criticos, public.cuadres_nocturnos to anon, authenticated;
grant select, update (hecho, hecho_por, respuesta, updated_at) on public.cuadre_pendientes to anon, authenticated;

comment on table public.productos_criticos is 'Lista de productos críticos del cuadre nocturno con unidad de conteo, factor y tolerancia. La lee el skill cuadre-nocturno-freakie.';
comment on table public.cuadres_nocturnos  is 'Resultado de cada cuadre nocturno (DATA del panel) por sucursal y noche.';
comment on table public.cuadre_pendientes  is 'Pendientes del cuadre para el encargado; el panel los tacha (anon update) y el skill los retoma al día siguiente.';
