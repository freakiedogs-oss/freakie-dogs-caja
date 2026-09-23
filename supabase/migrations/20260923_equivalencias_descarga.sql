-- ════════════════════════════════════════════════════════════════════════
-- Equivalencias de descarga + alarmas de inventario + tolerancias del conteo
-- (23-sep-2026, tabla de críticos de Cesar para Plaza Cafetalón)
--
-- Problema: la venta descontaba un producto y la sucursal contaba OTRO
-- (pepinillo 228941 en oz vs bote; queso para dorar en lb vs bolsita;
-- mermelada en tandas vs bolsa; papa en porciones vs bolsa de 30 lb, porque
-- la sub-receta Papa Sazonada seguía asignada aunque Casa Matriz dejó de
-- porcionar el 7-sep; waffle, cebolla blanca, sobres de mayonesa y ketchup).
-- Resultado: faltantes crónicos en 4-6 sucursales que el conteo "corregía"
-- cada noche (papa 30 lb: −9,891 lb en 14 días, ≈ $12.5K) y se acumulaban
-- como fuga.
--
-- Solución de raíz: `inventario_equivalencias` redirige SÓLO la descarga por
-- venta al producto que se cuenta. Recetas, costeo y registrar_produccion
-- (Casa Matriz) quedan intactos. Se parchearon los 3 motores de descarga por
-- venta: pos_deducir_inventario, pos_deducir_preview y pos_explotar_linea
-- (este último lo usan pos_anular_item y _pos_merma_producto_sync, así que la
-- anulación devuelve al mismo producto que se descontó).
--
-- Aplicado en producción con apply_migration, en este orden:
--   inventario_equivalencias_descarga
--   inventario_equivalencias_carga_inicial
--   fn_salud_inventario
--   fn_salud_inventario_consumo_interno_y_fecha_equiv
--   fn_salud_inventario_sin_receta
--   conteo_tolerancia_y_sueltas_criticos
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. inventario_equivalencias_descarga ────────────────────────────────
create table if not exists public.inventario_equivalencias (
  producto_origen  uuid primary key references public.catalogo_productos(id),
  producto_destino uuid not null references public.catalogo_productos(id),
  factor           numeric not null check (factor > 0),
  nota             text,
  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (producto_origen <> producto_destino)
);
comment on table public.inventario_equivalencias is
  'Redirige la descarga por venta del producto origen (el de la receta) al producto que la sucursal cuenta. 1 origen = factor destino. Sin cadenas: un destino no puede ser origen.';

create or replace function public._inventario_equivalencias_sin_cadena()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.inventario_equivalencias
              where producto_origen = new.producto_destino and activo) then
    raise exception 'El destino ya es origen de otra equivalencia: no se permiten cadenas';
  end if;
  if exists (select 1 from public.inventario_equivalencias
              where producto_destino = new.producto_origen and activo) then
    raise exception 'El origen ya es destino de otra equivalencia: no se permiten cadenas';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_inventario_equivalencias_sin_cadena on public.inventario_equivalencias;
create trigger trg_inventario_equivalencias_sin_cadena
  before insert or update on public.inventario_equivalencias
  for each row when (new.activo) execute function public._inventario_equivalencias_sin_cadena();

alter table public.inventario_equivalencias enable row level security;
drop policy if exists inventario_equivalencias_select on public.inventario_equivalencias;
create policy inventario_equivalencias_select on public.inventario_equivalencias
  for select to anon, authenticated using (true);
grant select on public.inventario_equivalencias to anon, authenticated;

-- Parche a los 3 motores, sobre su definición actual (falla si cambiaron).
do $$
declare v text; o text; n text;
begin
  v := pg_get_functiondef('public.pos_deducir_inventario'::regproc);
  o := '  agg AS (SELECT producto_id, sum(qty) AS qty FROM ded GROUP BY producto_id HAVING sum(qty) > 0)';
  n := '  ded_eq AS (SELECT coalesce(eq.producto_destino, d.producto_id) AS producto_id, d.qty * coalesce(eq.factor,1) AS qty'
       || E'\n                FROM ded d LEFT JOIN public.inventario_equivalencias eq ON eq.producto_origen = d.producto_id AND eq.activo),'
       || E'\n  agg AS (SELECT producto_id, sum(qty) AS qty FROM ded_eq GROUP BY producto_id HAVING sum(qty) > 0)';
  if (length(v) - length(replace(v, o, ''))) / length(o) <> 1 then
    raise exception 'pos_deducir_inventario cambió: patrón no encontrado exactamente 1 vez';
  end if;
  execute replace(v, o, n);

  v := pg_get_functiondef('public.pos_explotar_linea'::regproc);
  o := '  agg as (select producto_id, sum(qty) as qty from ded group by producto_id having sum(qty) > 0)';
  n := '  ded_eq as (select coalesce(eq.producto_destino, d.producto_id) as producto_id, d.qty * coalesce(eq.factor,1) as qty'
       || E'\n                from ded d left join public.inventario_equivalencias eq on eq.producto_origen = d.producto_id and eq.activo),'
       || E'\n  agg as (select producto_id, sum(qty) as qty from ded_eq group by producto_id having sum(qty) > 0)';
  if (length(v) - length(replace(v, o, ''))) / length(o) <> 1 then
    raise exception 'pos_explotar_linea cambió: patrón no encontrado exactamente 1 vez';
  end if;
  execute replace(v, o, n);

  v := pg_get_functiondef('public.pos_deducir_preview'::regproc);
  o := '    from ded group by producto_id having sum(qty) > 0;';
  n := '    from (select coalesce(eq.producto_destino, d.producto_id) as producto_id, d.qty * coalesce(eq.factor,1) as qty'
       || E'\n            from ded d left join public.inventario_equivalencias eq on eq.producto_origen = d.producto_id and eq.activo) dq'
       || E'\n   group by producto_id having sum(qty) > 0;';
  if (length(v) - length(replace(v, o, ''))) / length(o) <> 1 then
    raise exception 'pos_deducir_preview cambió: patrón no encontrado exactamente 1 vez';
  end if;
  execute replace(v, o, n);
end $$;

-- ── 2. inventario_equivalencias_carga_inicial ───────────────────────────
do $$
declare v_ceb uuid; v_n int; v_bolsita uuid; v_queso uuid; v_item uuid;
begin
  -- Cebolla Blanca: hay 2 productos con ese nombre; el bueno es el de la sub-receta en bolsas.
  select r.catalogo_id into v_ceb from recetas r join catalogo_productos c on c.id=r.catalogo_id
   where c.nombre='Cebolla Blanca' and r.unidad_rendimiento='bolsa';
  if v_ceb is null then raise exception 'No encontré la sub-receta Cebolla Blanca en bolsas'; end if;

  insert into inventario_equivalencias(producto_origen, producto_destino, factor, nota)
  select o.id, d.id, x.f, x.nota from (values
    ('228941 Pepinillos','Pepinillo para burguer bote', 1/19.12::numeric,
     'La hamburguesa descuenta oz escurridas de 228941; la sucursal cuenta botes. 19.12 oz escurridas por bote (factor de Cesar 26-ago).'),
    ('Queso para dorar','Queso para dorar bolsita 0.35 gr', 1/0.30::numeric,
     'Receta Queso Frito: 0.30 lb por orden = 1 bolsita (Jose 19-ago). La sucursal cuenta y recibe bolsitas.'),
    ('Mermelada de Tocino','Mermelada bolsa', 1/(0.014337*32)::numeric,
     'Las recetas convierten oz a tanda con 0.014337 (69.75 oz por tanda). La bolsa es de 2 lb = 32 oz, así que 1 oz vendida = 1/32 bolsa.'),
    ('Papa Sazonada','Papa Sazonadas 30lb', 0.35,
     'Casa Matriz dejó de porcionar (7-sep). La porción es 0.35 lb de la bolsa de 30 lb (receta Papa Sazonada; los Fancy usan 0.70 = 2 porciones).'),
    ('Papa Waffle 27LB','Papa Waffle', 1, 'Mismo producto en libras: las recetas descuentan 27LB, la sucursal recibe y cuenta Papa Waffle.'),
    ('PAPA WAFFLE NAT CAJA 6/4.5 LBS','Papa Waffle', 1, 'Producto inactivo que todavía usan recetas; mismo waffle en libras.'),
    ('Mayonesa MC Mcormick 900 X9 GRS Sobres','Mayonesa caja 900 sobres', 1/900::numeric, 'La venta descuenta sobres; la sucursal cuenta cajas de 900.'),
    ('Ketchup MC Cormick Portion Pack 1000/8g','Ketchup caja 1000 sobres', 1/1000::numeric, 'La venta descuenta sobres; la sucursal cuenta cajas de 1000.')
  ) x(o,d,f,nota)
  join catalogo_productos o on o.nombre=x.o join catalogo_productos d on d.nombre=x.d;
  get diagnostics v_n = row_count;
  if v_n <> 8 then raise exception 'Se esperaban 8 equivalencias por nombre, entraron %', v_n; end if;

  insert into inventario_equivalencias(producto_origen, producto_destino, factor, nota)
  select v_ceb, id, 1, 'La sub-receta Cebolla Blanca rinde bolsas de 2 lb; la sucursal cuenta Cebolla bolsa (2 lb).'
    from catalogo_productos where nombre='Cebolla bolsa';

  -- Costo de referencia para destinos sin compras: costo del origen ÷ factor.
  update catalogo_productos d
     set precio_referencia = round(coalesce(
           (select r.costo_calculado / nullif(r.rendimiento,0) from recetas r
             where r.catalogo_id = e.producto_origen and coalesce(r.costo_calculado,0) > 0
             order by coalesce(r.activo,true) desc limit 1),
           (select v.costo_unit from v_fd_costo_insumo v where v.producto_id = e.producto_origen)) / e.factor, 4)
    from inventario_equivalencias e
   where e.producto_destino = d.id and coalesce(costo_producto(d.id),0) = 0 and d.precio_referencia is null;

  select id into v_bolsita from catalogo_productos where nombre='Queso para dorar bolsita 0.35 gr';
  update catalogo_productos set activo = true, nombre = 'Queso para dorar bolsita 0.30 lb',
         conteo_unidad = 'Bolsita de 0.30 lb', conteo_factor = 1
   where id = v_bolsita;

  select id into v_queso from catalogo_productos where nombre='Queso para dorar';
  select item_id into v_item from criticos_item_productos where producto_id = v_queso;
  insert into criticos_item_productos(item_id, producto_id, factor_a_item, principal)
  values (v_item, v_bolsita, 0.30, false) on conflict do nothing;

  update catalogo_productos set activo = true, conteo_unidad = coalesce(conteo_unidad,'Bidón'), conteo_factor = coalesce(conteo_factor,1)
   where nombre = 'Aceite Santa Clara bidón';

  update catalogo_productos set incluir_conteo = false
   where nombre in ('Pan de Hamburguesa Brioche bolsa 12 unidades [unificado]',
                    'Pastel porción (pastel $25 / 10 porciones)', 'Queso frito ');

  update catalogo_productos
     set unidad_medida = 'unidad', conteo_unidad = 'Bolsa de 20 cartitas', conteo_factor = 20,
         conteo_fraccionado = true, conteo_unidad_suelta = 'cartitas', conteo_factor_suelta = 1
   where nombre = 'Adivina la Maraca paquete 20 Unidades';
  update inventario i set stock_minimo = i.stock_minimo * 20, stock_maximo = i.stock_maximo * 20
    from catalogo_productos cp, sucursales s
   where cp.id = i.producto_id and s.id = i.sucursal_id
     and cp.nombre = 'Adivina la Maraca paquete 20 Unidades' and s.store_code not in ('CM001','EVT001');

  insert into inventario(sucursal_id, producto_id, stock_actual, stock_minimo, stock_maximo)
  select distinct i.sucursal_id, pw.id, 0, 0, 0
    from inventario i
    join catalogo_productos w on w.id = i.producto_id and w.nombre = 'Papa Waffle 27LB'
    cross join (select id from catalogo_productos where nombre = 'Papa Waffle') pw
   where not exists (select 1 from inventario x where x.sucursal_id = i.sucursal_id and x.producto_id = pw.id);
end $$;

-- ── 3. fn_salud_inventario (versión final, tras los 2 parches del mismo día) ──
-- Regla de lectura: el mismo desvío en muchas sucursales = sistema (receta,
-- factor, equivalencia); en una sola = operación (merma, porcionado, fuga).
create or replace function public.fn_salud_inventario(p_dias integer default 14)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
with
desde as (select now() - make_interval(days => p_dias) t),
suc as (select id, store_code from sucursales where store_code not in ('CM001','EVT001')),
huerfana as (
  select cp.id, cp.nombre, cp.unidad_medida, coalesce(cp.conteo_modo,'normal') modo,
         round(sum(-k.cantidad),2) venta, count(distinct k.sucursal_id) sucursales,
         round(sum(-k.cantidad) * coalesce(max(v.costo_unit),0), 2) valor_usd
    from kardex_movimientos k
    join suc s on s.id = k.sucursal_id
    join catalogo_productos cp on cp.id = k.producto_id
    left join v_fd_costo_insumo v on v.producto_id = cp.id
   where k.tipo = 'venta' and k.referencia_tipo = 'pos_cuenta' and k.created_at > (select t from desde)
     and not coalesce(cp.incluir_conteo,false)
     and not exists (select 1 from inventario_equivalencias e where e.producto_origen = cp.id and e.activo)
   group by cp.id, cp.nombre, cp.unidad_medida, cp.conteo_modo
  having sum(-k.cantidad) > 0),
noche as (
  select k.producto_id, k.sucursal_id,
         (k.created_at at time zone 'America/El_Salvador')::date d, sum(k.cantidad) aj
    from kardex_movimientos k join suc s on s.id = k.sucursal_id
   where k.tipo = 'conteo_fisico' and k.created_at > (select t from desde)
   group by 1,2,3),
por_suc as (
  select producto_id, sucursal_id, count(*) noches,
         count(*) filter (where aj < 0) neg, count(*) filter (where aj > 0) pos, sum(aj) aj
    from noche group by 1,2),
venta as (
  select k.producto_id, k.sucursal_id, sum(-k.cantidad) venta
    from kardex_movimientos k join suc s on s.id = k.sucursal_id
   where k.tipo = 'venta' and k.created_at > (select t from desde)
   group by 1,2),
cronico as (
  select cp.id, cp.nombre, cp.unidad_medida,
         count(*) filter (where ps.noches >= 4 and ps.neg >= ps.noches * 0.8) suc_faltante,
         count(*) filter (where ps.noches >= 4 and ps.pos >= ps.noches * 0.8) suc_sobrante,
         count(*) filter (where ps.noches >= 4) suc_contadas,
         round(sum(ps.aj),2) ajuste,
         round(sum(coalesce(vt.venta,0)),2) venta,
         round(abs(sum(ps.aj)) * coalesce(max(v.costo_unit),0), 2) valor_usd,
         jsonb_object_agg(s.store_code, round(ps.aj,2)) por_sucursal
    from por_suc ps
    join suc s on s.id = ps.sucursal_id
    join catalogo_productos cp on cp.id = ps.producto_id
    left join venta vt on vt.producto_id = ps.producto_id and vt.sucursal_id = ps.sucursal_id
    left join v_fd_costo_insumo v on v.producto_id = cp.id
   group by cp.id, cp.nombre, cp.unidad_medida),
cronico_clasif as (
  select c.*,
         (select max(e.created_at)::date from inventario_equivalencias e
           where e.activo and (e.producto_destino = c.id or e.producto_origen = c.id)) equivalencia_desde,
         case when c.venta = 0
               and not exists (select 1 from receta_ingredientes ri where ri.producto_id = c.id)
               and not exists (select 1 from pos_modificador_insumos pmi where pmi.producto_id = c.id)
               and not exists (select 1 from inventario_equivalencias e where e.producto_destino = c.id and e.activo)
              then 'sin_receta'
              when greatest(suc_faltante, suc_sobrante) >= 4 then 'sistema'
              when greatest(suc_faltante, suc_sobrante) between 1 and 2 then 'operacion'
              else 'revisar' end diagnostico,
         case when suc_sobrante > suc_faltante then 'sobrante' else 'faltante' end sentido,
         (venta = 0) sin_venta
    from cronico c
   where greatest(suc_faltante, suc_sobrante) >= 1),
inactivos_en_conteo as (
  select cp.nombre from catalogo_productos cp
   where cp.incluir_conteo and not coalesce(cp.activo,true)
     and exists (select 1 from inventario i where i.producto_id = cp.id)),
contado_sin_inventario as (
  select cp.nombre, (select jsonb_agg(s.store_code order by s.store_code) from suc s
                      where not exists (select 1 from inventario i where i.producto_id = cp.id and i.sucursal_id = s.id)
                        and exists (select 1 from kardex_movimientos k where k.sucursal_id = s.id
                                     and k.tipo = 'venta' and k.created_at > (select t from desde))) faltan_en
    from catalogo_productos cp
   where cp.incluir_conteo and coalesce(cp.activo,true) and coalesce(cp.conteo_modo,'normal') = 'normal'
     and exists (select 1 from inventario_equivalencias e where e.producto_destino = cp.id and e.activo)),
subreceta_freno as (
  select sr.nombre sub_receta, cp.nombre producto
    from recetas sr join catalogo_productos cp on cp.id = sr.catalogo_id
   where not coalesce(sr.activo,true)
     and exists (select 1 from receta_ingredientes ri join recetas r on r.id = ri.receta_id
                  where ri.sub_receta_id = sr.id and coalesce(r.activo,true))
     and not exists (select 1 from inventario_equivalencias e where e.producto_origen = cp.id and e.activo))
select jsonb_build_object(
  'generado', now(), 'dias', p_dias,
  'descarga_huerfana', coalesce((select jsonb_agg(to_jsonb(h) - 'id' order by h.valor_usd desc) from huerfana h), '[]'),
  'ajuste_cronico', coalesce((select jsonb_agg(to_jsonb(c) - 'id' order by c.diagnostico, c.valor_usd desc nulls last) from cronico_clasif c), '[]'),
  'inactivos_en_conteo', coalesce((select jsonb_agg(nombre) from inactivos_en_conteo), '[]'),
  'contado_sin_inventario', coalesce((select jsonb_agg(to_jsonb(x)) from contado_sin_inventario x where jsonb_array_length(coalesce(x.faltan_en,'[]')) > 0), '[]'),
  'subreceta_freno', coalesce((select jsonb_agg(to_jsonb(f)) from subreceta_freno f), '[]'),
  'equivalencias', coalesce((select jsonb_agg(jsonb_build_object('origen', o.nombre, 'destino', d.nombre, 'factor', round(e.factor,6)))
                               from inventario_equivalencias e join catalogo_productos o on o.id = e.producto_origen
                               join catalogo_productos d on d.id = e.producto_destino where e.activo), '[]')
);
$$;
revoke all on function public.fn_salud_inventario(integer) from public, anon;
grant execute on function public.fn_salud_inventario(integer) to authenticated, service_role;
comment on function public.fn_salud_inventario(integer) is
  'Alarmas de inventario (descarga huérfana, ajuste crónico con diagnóstico sistema/operacion/sin_receta, conteo mal configurado, sub-recetas que frenan la descarga). equivalencia_desde marca desde cuándo rige un arreglo: antes de esa fecha el desvío es histórico. La corre la rutina diaria.';

-- ── 4. conteo_tolerancia_y_sueltas_criticos ─────────────────────────────
alter table public.catalogo_productos add column if not exists conteo_tolerancia numeric
  check (conteo_tolerancia is null or conteo_tolerancia >= 0);
comment on column public.catalogo_productos.conteo_tolerancia is
  'Tolerancia del conteo nocturno EN UNIDAD DE STOCK. Una diferencia dentro de ± este valor no se pinta en rojo ni pide PIN de faltante (tabla de críticos de Cesar, 22-sep-2026). NULL = 0.';

do $$
declare v_n int;
begin
  update catalogo_productos c set conteo_tolerancia = x.t
    from (values
      ('Carne para hamburguesa', 2::numeric),                 -- ±2 bolitas
      ('Pan de Hamburguesa Brioche 2.8oz', 1),                -- ±1 pan
      ('Salchicha Parowsi paquete 25 unidades', 2/25.0),      -- ±2 salchichas
      ('Pan Hot Dog Berna bolsa 10 unidades', 0.1),           -- ±1 pan
      ('Pan de Hot Dog Brioche bolsa 21 unidades', round(1/21.0, 6)), -- ±1 pan
      ('Chili bolsa', 0.2),                                   -- ±1 lb
      ('Tocino Ahumado Chimex paquete', 10/200.0),            -- ±10 lascas
      ('Cheddar Porcionado', 0.25),                           -- ±0.25 bolsa
      ('MQ LAC Procesado Reb AM C 1.4kg/3lb', 0.5),           -- ±0.5 lb
      ('CM MIX mezcla 3 quesos de costra (bolsa 2.27 kg)', 0.2268), -- ±0.5 lb en kg
      ('Gomitas de hamburguesas caja 24 unidades', 1)         -- ±1
    ) x(nombre, t)
   where c.nombre = x.nombre;
  get diagnostics v_n = row_count;
  if v_n <> 11 then raise exception 'Se esperaban 11 productos, se actualizaron %', v_n; end if;

  -- (Aquí se habían pasado tocino/chili/cheddar a sueltas en lascas/libras; se
  -- revirtió el mismo día en `conteo_peso_como_fraccion_criterio_saul`: Saúl definió
  -- que los productos de peso se cuentan en bolsas y la abierta como fracción.)
end $$;

-- ── 5. conteo_peso_como_fraccion_criterio_saul ──────────────────────────
update catalogo_productos set conteo_fraccionado = false, conteo_unidad_suelta = null, conteo_factor_suelta = null
 where nombre in ('Tocino Ahumado Chimex paquete', 'Chili bolsa', 'Cheddar Porcionado');
