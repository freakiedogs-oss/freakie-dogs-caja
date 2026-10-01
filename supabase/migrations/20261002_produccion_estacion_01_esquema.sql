-- ═══════════════════════════════════════════════════════════════════════
-- Estación de pesaje y etiquetado → kardex · M1: esquema
-- docs/PLAN-ESTACION-ETIQUETADO-ERP.md §2
--
-- Solo agrega estructura. Ningún comportamiento cambia: produccion_diaria
-- sigue naciendo "cerrada" desde registrar_produccion hasta que M2/M3 la
-- enseñen a abrirse y cerrarse.
-- ═══════════════════════════════════════════════════════════════════════

-- ── produccion_diaria: la tanda ──────────────────────────────────────
alter table public.produccion_diaria
  add column if not exists estado text not null default 'cerrada',
  add column if not exists origen text not null default 'manual',
  add column if not exists modo_consumo text not null default 'backflush',
  add column if not exists base_consumo text not null default 'unidades',
  add column if not exists producto_id uuid references public.catalogo_productos(id),
  add column if not exists es_prueba boolean not null default false,
  add column if not exists cantidad_planificada numeric,
  add column if not exists unidades_producidas numeric,
  add column if not exists peso_total_g numeric,
  add column if not exists tandas_equiv numeric,
  add column if not exists peso_insumo_g numeric,
  add column if not exists yield_real numeric,
  add column if not exists yield_esperado numeric,
  add column if not exists merma_real_g numeric,
  add column if not exists varianza_g numeric,
  add column if not exists abierta_at timestamptz,
  add column if not exists cerrada_at timestamptz,
  add column if not exists cerrada_por uuid references public.usuarios_erp(id) on delete set null,
  add column if not exists bascula_codigo text,
  add column if not exists dispositivo text,
  add column if not exists bpm_corrida_id uuid references public.bpm_corridas(id) on delete set null,
  add column if not exists client_key uuid;

alter table public.produccion_diaria
  drop constraint if exists produccion_diaria_estado_check,
  add constraint produccion_diaria_estado_check
    check (estado in ('abierta','cerrada','cerrada_auto','anulada')),
  drop constraint if exists produccion_diaria_origen_check,
  add constraint produccion_diaria_origen_check
    check (origen in ('manual','orden','estacion')),
  drop constraint if exists produccion_diaria_modo_consumo_check,
  add constraint produccion_diaria_modo_consumo_check
    check (modo_consumo in ('backflush','pick')),
  drop constraint if exists produccion_diaria_base_consumo_check,
  add constraint produccion_diaria_base_consumo_check
    check (base_consumo in ('peso','unidades'));

create unique index if not exists produccion_diaria_client_key_uq
  on public.produccion_diaria(client_key) where client_key is not null;
-- Dos tandas con el mismo lote era posible (count(*)+1 sin lock). Verificado
-- antes de esta migración que no hay duplicados en las 177 filas.
create unique index if not exists produccion_diaria_lote_uq
  on public.produccion_diaria(lote) where lote is not null;
create index if not exists produccion_diaria_estado_idx
  on public.produccion_diaria(estado) where estado = 'abierta';

-- Las producciones viejas: producto_id desnormalizado desde la receta.
update public.produccion_diaria pd
   set producto_id = r.catalogo_id
  from public.recetas r
 where r.id = pd.receta_id and pd.producto_id is null and r.catalogo_id is not null;

-- `merma` = cantidad_producida − cantidad_enviada (GENERATED). cantidad_enviada
-- nunca se actualiza (el despacho va por despachos_sucursal → kardex), así que
-- esta columna dice "100 % de merma" en las 177 filas. Verificado 02-oct que
-- ninguna pantalla ni función la lee (solo ProduccionDiaria.jsx y
-- OrdenesProduccionTab.jsx leen la tabla; ninguno nombra `merma`). La merma
-- real pasa a `merma_real_g`, calculada al cerrar la tanda.
alter table public.produccion_diaria drop column if exists merma;

-- ── produccion_diaria_items: de dónde salió cada consumo ─────────────
alter table public.produccion_diaria_items
  add column if not exists origen text not null default 'bom',
  add column if not exists cantidad_esperada numeric,
  add column if not exists kardex_id uuid references public.kardex_movimientos(id) on delete set null,
  add column if not exists client_key uuid;

alter table public.produccion_diaria_items
  drop constraint if exists produccion_diaria_items_origen_check,
  add constraint produccion_diaria_items_origen_check
    check (origen in ('bom','scan','manual','devolucion')),
  -- una devolución de insumo pickeado (fase 2) es una cantidad negativa
  drop constraint if exists produccion_diaria_items_cantidad_consumida_check,
  add constraint produccion_diaria_items_cantidad_consumida_check
    check (cantidad_consumida > 0 or origen = 'devolucion');

create unique index if not exists produccion_diaria_items_client_key_uq
  on public.produccion_diaria_items(client_key) where client_key is not null;

-- ── receta_ingredientes: empaque vs materia ──────────────────────────
-- Las materias primas se descuentan en proporción al PESO real producido;
-- los empaques (bolsa de vacío, bote) por UNIDADES producidas: 3 bolsas son
-- 3 bolsas, nunca 2.91. Se marca por línea, no se adivina por categoría.
alter table public.receta_ingredientes
  add column if not exists es_empaque boolean not null default false;

-- ── produccion_unidades: cada bolsa pesada ───────────────────────────
create table if not exists public.produccion_unidades (
  id              uuid primary key default gen_random_uuid(),
  produccion_id   uuid not null references public.produccion_diaria(id) on delete cascade,
  numero          int  not null,
  gramos          numeric,                        -- null cuando el producto no se pesa
  fuera_banda     boolean not null default false,
  vence           date,
  pesado_por_id   uuid references public.usuarios_erp(id) on delete set null,
  pesado_por      text,
  bascula_codigo  text,
  impresa         boolean not null default false,
  impresiones     int not null default 0,
  etiqueta        jsonb not null,                 -- lo que se imprimió; reimprime idéntico
  estado          text not null default 'activa' check (estado in ('activa','anulada')),
  anulada_motivo  text,
  anulada_por     uuid references public.usuarios_erp(id) on delete set null,
  anulada_at      timestamptz,
  codigo_corto    text not null unique,           -- lo que va en el QR
  client_key      uuid not null unique,
  created_at      timestamptz not null default now(),
  unique (produccion_id, numero)
);
create index if not exists produccion_unidades_produccion_idx on public.produccion_unidades(produccion_id);

-- ── produccion_etiquetado_productos: lo que antes vivía en productos.js ──
-- Uno por producto de catálogo. `receta_id` es LA receta que usa la estación
-- (resuelve que un producto tenga dos recetas, como pasó con la cebolla).
create table if not exists public.produccion_etiquetado_productos (
  producto_id       uuid primary key references public.catalogo_productos(id),
  receta_id         uuid not null references public.recetas(id),
  nombre_etiqueta   text not null,
  requiere_peso     boolean not null default true,
  peso_nominal_g    numeric,
  banda_g           numeric,
  tara_g            numeric not null default 0,
  vida_util_dias    int not null,
  vida_util_estado  text not null default 'provisional'
                    check (vida_util_estado in ('provisional','validado')),
  conservacion      text,
  orden             int not null default 0,
  activo            boolean not null default true,
  updated_by        uuid references public.usuarios_erp(id) on delete set null,
  updated_at        timestamptz not null default now(),
  check (peso_nominal_g is null or peso_nominal_g > 0),
  check (banda_g is null or banda_g >= 0),
  check (vida_util_dias > 0)
);

-- ── catalogo_barcodes: fase 2 (pistola). Se crea ahora para no migrar después. ──
create table if not exists public.catalogo_barcodes (
  codigo       text primary key,
  producto_id  uuid not null references public.catalogo_productos(id),
  cantidad     numeric not null default 1 check (cantidad > 0),
  descripcion  text,
  creado_por   uuid references public.usuarios_erp(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ── RLS y grants: la tablet lee por anon (proxy /sb); escribe solo por RPC ──
alter table public.produccion_unidades enable row level security;
alter table public.produccion_etiquetado_productos enable row level security;
alter table public.catalogo_barcodes enable row level security;

drop policy if exists produccion_unidades_sel on public.produccion_unidades;
create policy produccion_unidades_sel on public.produccion_unidades
  for select to anon, authenticated using (true);
drop policy if exists produccion_etiquetado_productos_sel on public.produccion_etiquetado_productos;
create policy produccion_etiquetado_productos_sel on public.produccion_etiquetado_productos
  for select to anon, authenticated using (true);
drop policy if exists catalogo_barcodes_sel on public.catalogo_barcodes;
create policy catalogo_barcodes_sel on public.catalogo_barcodes
  for select to anon, authenticated using (true);

grant select on public.produccion_unidades, public.produccion_etiquetado_productos, public.catalogo_barcodes
  to anon, authenticated;

-- Lo que ve la estación: productos activos con su receta y producto de catálogo.
create or replace view public.v_produccion_estacion_productos as
select pe.producto_id, pe.receta_id, pe.nombre_etiqueta, pe.requiere_peso, pe.peso_nominal_g,
       pe.banda_g, pe.tara_g, pe.vida_util_dias, pe.vida_util_estado, pe.conservacion, pe.orden,
       cp.nombre as producto, cp.unidad_medida as unidad,
       r.nombre as receta, r.rendimiento, r.unidad_rendimiento, r.activo as receta_activa
  from public.produccion_etiquetado_productos pe
  join public.catalogo_productos cp on cp.id = pe.producto_id
  join public.recetas r on r.id = pe.receta_id
 where pe.activo
 order by pe.orden, cp.nombre;
grant select on public.v_produccion_estacion_productos to anon, authenticated;
