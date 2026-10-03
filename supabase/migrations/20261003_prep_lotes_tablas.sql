-- ═══════════════════════════════════════════════════════════════════════════
-- Estación de preparación (Casa Matriz): lotes de preparación, insumos usados,
-- impresiones de etiquetas y "deudas" que se cobran al marcar la salida.
--
-- Idea: quien imprime etiquetas lo hace con su PIN. Si el lote de esas etiquetas
-- no tiene sus insumos registrados, queda una deuda a su nombre y la asistencia
-- no lo deja marcar salida hasta saldarla (o hasta que el encargado la autorice,
-- o la pase a un compañero). Imprimir NUNCA se frena: la línea no se detiene.
--
-- Seguridad: las tablas quedan con RLS activado y SIN políticas (anon no las toca
-- directo). Todo entra y sale por funciones SECURITY DEFINER. El PIN solo se
-- valida en fn_prep_actor (con el mismo freno de intentos que erp_login) y nunca
-- se guarda: lo demás recibe el id del usuario que esa función ya devolvió.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Catálogo editable (recetas + insumos) ──────────────────────────────────
create table if not exists public.prep_config (
  clave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists public.prep_alias (          -- código de fábrica → insumo nuestro
  codigo text primary key,
  insumo_codigo text not null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

create table if not exists public.prep_insumos_nuevos ( -- insumos que creó cocina al pistolear
  codigo text primary key,
  nombre text not null,
  categoria text,
  unidad text,
  discreto boolean not null default false,
  estado text not null default 'nuevo' check (estado in ('nuevo','revisado','descartado')),
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

-- ── Lotes de preparación ───────────────────────────────────────────────────
create table if not exists public.prep_lotes (
  id uuid primary key default gen_random_uuid(),
  lote text not null,                                   -- 'L-0007', consecutivo del día
  fecha date not null default ((now() at time zone 'America/El_Salvador')::date),
  store_code text not null default 'CM001',
  recetas jsonb not null default '[]'::jsonb,           -- [{id, nombre, tandas}]
  estado text not null default 'abierto' check (estado in ('abierto','cerrado')),
  sin_preparacion boolean not null default false,       -- se imprimió sin pasar por la estación
  creado_por uuid,
  creado_nombre text,
  created_at timestamptz not null default now(),
  cerrado_por uuid,
  cerrado_nombre text,
  cerrado_at timestamptz,
  unique (fecha, lote)
);
create index if not exists prep_lotes_fecha_idx on public.prep_lotes (fecha desc);

create table if not exists public.prep_lote_insumos (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.prep_lotes(id) on delete cascade,
  receta_id text,
  codigo text,
  insumo text,
  cantidad numeric,
  unidad text,
  cantidad_receta numeric,
  unidad_receta text,
  ratio numeric,                    -- usado / receta (1 = igual). null si no hay receta o faltó
  fuera_receta boolean not null default false,
  falto boolean not null default false,    -- estaba en la receta y no se registró
  nuevo boolean not null default false,
  nota text,
  pistoleos int,
  usuario_id uuid,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  vigente boolean not null default true,      -- corregir un lote NO borra: la versión anterior queda vigente=false
  reemplazado_at timestamptz
);
create index if not exists prep_lote_insumos_lote_idx on public.prep_lote_insumos (lote_id);
create index if not exists prep_lote_insumos_codigo_idx on public.prep_lote_insumos (codigo);
create index if not exists prep_lote_insumos_vigente_idx on public.prep_lote_insumos (lote_id) where vigente;

-- ── Impresiones y deudas ───────────────────────────────────────────────────
create table if not exists public.etiqueta_impresiones (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid references public.prep_lotes(id) on delete set null,
  lote text not null,
  fecha date not null default ((now() at time zone 'America/El_Salvador')::date),
  producto_id text,
  producto text,
  unidades int not null default 1,
  usuario_id uuid,
  usuario_nombre text,
  con_insumos boolean not null default false,
  impreso_at timestamptz not null default now()
);
create index if not exists etiqueta_impresiones_lote_idx on public.etiqueta_impresiones (lote_id);

create table if not exists public.prep_deudas (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid references public.prep_lotes(id) on delete cascade,
  lote text not null,
  fecha date not null,
  usuario_id uuid not null,
  usuario_nombre text,
  estado text not null default 'abierta' check (estado in ('abierta','cerrada','autorizada')),
  created_at timestamptz not null default now(),
  cerrada_at timestamptz,
  autorizada_por text,
  motivo text,
  traspasada_de text
);
create index if not exists prep_deudas_usuario_idx on public.prep_deudas (usuario_id) where estado = 'abierta';

create table if not exists public.prep_bitacora (
  id bigserial primary key,
  momento timestamptz not null default now(),
  accion text not null,
  actor_id uuid,
  actor text,
  detalle jsonb
);

alter table public.prep_config enable row level security;
alter table public.prep_alias enable row level security;
alter table public.prep_insumos_nuevos enable row level security;
alter table public.prep_lotes enable row level security;
alter table public.prep_lote_insumos enable row level security;
alter table public.etiqueta_impresiones enable row level security;
alter table public.prep_deudas enable row level security;
alter table public.prep_bitacora enable row level security;

