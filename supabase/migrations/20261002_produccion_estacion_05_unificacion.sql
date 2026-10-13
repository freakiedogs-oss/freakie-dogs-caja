-- ═══════════════════════════════════════════════════════════════════════
-- Estación de pesaje y etiquetado · M5: unificación con la versión de Cesar
--
-- 1 y 2-oct-2026 se trabajó la misma pantalla en paralelo: Cesar subió a main
-- la lista de productos editable desde la tablet (`etiquetado_productos`, PIN,
-- tara, retiro a los 15 días) y esta rama conectó la estación al kardex
-- (`produccion_diaria` abierta/cerrada, `produccion_unidades`, cierre con
-- consumo por receta) con su propia tabla de parámetros.
--
-- Decisión (Jose, 02-oct): una sola tabla de productos, la de Cesar, porque
-- es la que Kevin ya usa; se le agrega el vínculo opcional con la receta.
-- · Producto CON receta → al cerrar la tanda se descuentan insumos y se da de
--   alta el producto, como en M3.
-- · Producto SIN receta (lo que Kevin crea en la tablet, carne, queso frito,
--   pepinillo) → se pesa, se imprime y las unidades quedan registradas; el
--   cierre avisa "sin receta: no descontó inventario". Cuando se vincule la
--   receta desde el ERP, empieza a descontar. Nadie se para frente a la báscula.
-- `produccion_etiquetado_productos` (M1/M4) desaparece.
-- ═══════════════════════════════════════════════════════════════════════

-- ── etiquetado_productos: vínculo con la receta ─────────────────────────
alter table public.etiquetado_productos
  add column if not exists receta_id uuid references public.recetas(id) on delete set null,
  add column if not exists producto_id uuid references public.catalogo_productos(id) on delete set null,
  add column if not exists requiere_peso boolean not null default true,
  add column if not exists vida_util_estado text not null default 'provisional';
alter table public.etiquetado_productos
  drop constraint if exists etiquetado_productos_vida_util_estado_check,
  add constraint etiquetado_productos_vida_util_estado_check
    check (vida_util_estado in ('provisional','validado'));

-- Vínculos conocidos (los mismos de produccion_etiquetado_productos). Truffa y
-- Mermelada quedan SIN receta a propósito hasta corregirlas (rendimiento
-- 0.2125 bolsa / "tanda"): con receta descontarían disparates. Carne (bolsa
-- de 20 bolitas vs receta en bolitas), Queso frito y Pepinillo tampoco tienen
-- receta de producción aplicable todavía.
update public.etiquetado_productos e
   set receta_id = x.rid::uuid, producto_id = r.catalogo_id, updated_at = now()
  from (values
    ('cheddar',   '5f12329e-39a5-4aa3-a59c-113df8820ec0'),
    ('chili',     'f9e150d6-f0e4-4728-a303-a38891a12555'),
    ('cebmorada', '7cb31083-ec3e-43a0-bc9f-757c3d19602b'),
    ('sal',       '16efeb6c-da3a-4907-b119-62e720eff83a'),
    ('escabeche', '2dc5b021-5715-4bbf-ad83-38c0d6537036'),
    ('milislas',  '9d90ccfe-eb97-4956-b262-235680a32e18'),
    ('chipotle',  'a49aaa40-38b5-4e77-8a23-6b9ce57a04ee'),
    ('salchicha', '6fe5b6de-83c6-4b49-85a1-dd9a251143f3'),
    ('cebblanca', 'cd67cde8-101f-487b-915c-c0fd96306aa0')
  ) as x(clave, rid)
  join public.recetas r on r.id = x.rid::uuid
 where e.clave = x.clave and e.receta_id is null;
update public.etiquetado_productos set requiere_peso = false where clave = 'salchicha';

-- Ranch ya no se porciona (Jose, 02-oct): sale de la lista con rastro.
with r as (
  update public.etiquetado_productos
     set activo = false, retirado_at = now(), updated_at = now(),
         retirado_motivo = 'Ya no se porciona: se manda el bote completo (Jose, 02-oct-2026)'
   where clave = 'ranch' and activo
  returning id, clave)
insert into public.etiquetado_productos_bitacora (producto_id, clave, accion, actor_nombre)
select id, clave, 'retiro', 'sistema (unificación 02-oct)' from r;

-- ── produccion_diaria / unidades ───────────────────────────────────────
alter table public.produccion_diaria
  add column if not exists etiquetado_id uuid references public.etiquetado_productos(id) on delete set null;
-- Una tanda de un producto sin receta no tiene receta_id.
alter table public.produccion_diaria alter column receta_id drop not null;
-- La báscula pesa bruto; la etiqueta y el kardex llevan neto (bruto − tara).
alter table public.produccion_unidades add column if not exists bruto_g numeric;

-- ── Lo que reemplaza ────────────────────────────────────────────────────
-- Los DROP quedaban colgados en la herramienta de migración (pide una
-- confirmación interactiva que no existe en esta sesión), así que lo obsoleto
-- se RENOMBRA; borrarlo desde el dashboard cuando se quiera:
--   _obsoleta_v_produccion_estacion_productos, _obsoleta_produccion_etiquetado_productos,
--   produccion_etiquetado_guardar (ahora solo levanta "Obsoleta").
alter view public.v_produccion_estacion_productos rename to _obsoleta_v_produccion_estacion_productos;
alter table public.produccion_etiquetado_productos rename to _obsoleta_produccion_etiquetado_productos;
create or replace function public.produccion_etiquetado_guardar(p jsonb, p_usuario_id uuid default null)
returns jsonb language plpgsql as $$
begin raise exception 'Obsoleta (02-oct-2026): los parámetros viven en etiquetado_productos; usá fn_etiquetado_vincular_receta'; end $$;
-- La firma vieja de abrir (p_producto_id) queda como aviso de "recargá la tablet".
create or replace function public.produccion_tanda_abrir(
  p_producto_id uuid, p_cantidad_planificada numeric, p_responsable_id uuid,
  p_client_key uuid, p_dispositivo text default null, p_bascula_codigo text default null,
  p_es_prueba boolean default false, p_orden_id uuid default null,
  p_usuario_nombre text default null)
returns jsonb language plpgsql as $$
begin raise exception 'La tablet tiene una versión vieja de la estación: recargá la página (Ctrl+R) y volvé a intentar.'; end $$;

-- ── Lista para la tablet: la de Cesar, más el vínculo ───────────────────
create or replace function public.fn_etiquetado_productos()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.clave, 'uuid', p.id, 'nombre', p.nombre, 'unidad', p.unidad,
           'gramos', p.gramos, 'banda', p.banda, 'tara', p.tara,
           'dias', p.dias, 'conserva', p.conserva,
           'origen', p.origen, 'ultimo_uso', p.ultimo_uso,
           'creado_nombre', p.creado_nombre,
           'requiere_peso', p.requiere_peso, 'vida_util_estado', p.vida_util_estado,
           'receta_id', p.receta_id, 'receta', r.nombre, 'tiene_receta', r.id is not null and r.activo
         ) order by p.orden, p.nombre), '[]'::jsonb)
  from etiquetado_productos p left join recetas r on r.id = p.receta_id
  where p.activo;
$$;

-- Desde el ERP (Producción → Etiquetado): vincular receta y marcar los días.
create or replace function public.fn_etiquetado_vincular_receta(
  p_id uuid, p_receta_id uuid, p_requiere_peso boolean default true,
  p_vida_util_estado text default 'provisional', p_usuario_id uuid default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_cat uuid; v_antes jsonb; v_nombre text;
begin
  select to_jsonb(e) into v_antes from public.etiquetado_productos e where e.id = p_id;
  if v_antes is null then raise exception 'El producto no existe'; end if;
  if p_receta_id is not null then
    select catalogo_id into v_cat from public.recetas where id = p_receta_id;
    if not found then raise exception 'La receta no existe'; end if;
    if v_cat is null then raise exception 'Esa receta no tiene producto de catálogo: no puede dar de alta nada'; end if;
  end if;
  select btrim(nombre || ' ' || coalesce(apellido, '')) into v_nombre from public.usuarios_erp where id = p_usuario_id;
  update public.etiquetado_productos
     set receta_id = p_receta_id, producto_id = v_cat, requiere_peso = coalesce(p_requiere_peso, true),
         vida_util_estado = coalesce(p_vida_util_estado, 'provisional'),
         editado_nombre = coalesce(v_nombre, editado_nombre), updated_at = now()
   where id = p_id;
  insert into public.etiquetado_productos_bitacora (producto_id, clave, accion, antes, despues, actor_id, actor_nombre)
  select e.id, e.clave, 'vinculo_receta', v_antes, to_jsonb(e), p_usuario_id, coalesce(v_nombre, 'ERP')
    from public.etiquetado_productos e where e.id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.fn_etiquetado_vincular_receta(uuid, uuid, boolean, text, uuid) to anon, authenticated;

-- ── Payload de la tanda ─────────────────────────────────────────────────
create or replace function public._produccion_tanda_json(p_id uuid)
returns jsonb
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'produccion_id', pd.id, 'lote', pd.lote, 'estado', pd.estado, 'es_prueba', pd.es_prueba,
    'fecha', pd.fecha, 'abierta_at', pd.abierta_at, 'cerrada_at', pd.cerrada_at,
    'etiquetado_id', pd.etiquetado_id, 'clave', e.clave,
    'producto_id', pd.producto_id, 'producto', cp.nombre, 'unidad', coalesce(cp.unidad_medida, e.unidad),
    'receta_id', pd.receta_id, 'receta', r.nombre, 'rendimiento', r.rendimiento,
    'tiene_receta', pd.receta_id is not null,
    'base_consumo', pd.base_consumo, 'cantidad_planificada', pd.cantidad_planificada,
    'responsable_id', pd.responsable_id, 'dispositivo', pd.dispositivo,
    'nombre_etiqueta', e.nombre, 'requiere_peso', e.requiere_peso,
    'peso_nominal_g', e.gramos, 'banda_g', e.banda, 'tara_g', e.tara,
    'vida_util_dias', e.dias, 'vida_util_estado', e.vida_util_estado,
    'conservacion', e.conserva,
    'unidades_producidas', pd.unidades_producidas, 'peso_total_g', pd.peso_total_g,
    'tandas_equiv', pd.tandas_equiv, 'costo_total', pd.costo_total,
    'orden_id', (select o.id from public.ordenes_produccion o where o.produccion_id = pd.id limit 1),
    'unidades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'unidad_id', u.id, 'numero', u.numero, 'gramos', u.gramos, 'bruto_g', u.bruto_g,
        'fuera_banda', u.fuera_banda, 'vence', u.vence, 'impresa', u.impresa,
        'impresiones', u.impresiones, 'estado', u.estado, 'pesado_por', u.pesado_por,
        'created_at', u.created_at, 'etiqueta', u.etiqueta, 'codigo_corto', u.codigo_corto) order by u.numero)
      from public.produccion_unidades u where u.produccion_id = pd.id), '[]'::jsonb)
  )
  from public.produccion_diaria pd
  left join public.etiquetado_productos e on e.id = pd.etiquetado_id
  left join public.recetas r on r.id = pd.receta_id
  left join public.catalogo_productos cp on cp.id = pd.producto_id
  where pd.id = p_id
$$;

-- ── abrir (cantidad entera: así la firma no choca con la vieja) ─────────
create or replace function public.produccion_tanda_abrir(
  p_etiquetado_id uuid, p_cantidad_planificada integer, p_responsable_id uuid,
  p_client_key uuid, p_dispositivo text default null, p_bascula_codigo text default null,
  p_es_prueba boolean default false, p_orden_id uuid default null,
  p_usuario_nombre text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid; e record; v_receta record; v_fecha date := public._produccion_fecha_sv();
  v_lote text; v_turno text; v_hora int; v_receta_id uuid; v_cat uuid; v_notas text;
begin
  if p_client_key is null then raise exception 'p_client_key es obligatorio'; end if;
  select id into v_id from public.produccion_diaria where client_key = p_client_key;
  if v_id is not null then return public._produccion_tanda_json(v_id); end if;   -- reintento

  select * into e from public.etiquetado_productos where id = p_etiquetado_id;
  if not found then raise exception 'Ese producto no está en la lista de la estación'; end if;
  if not e.activo then raise exception '«%» está retirado de la lista', e.nombre; end if;
  if coalesce(p_cantidad_planificada, 0) <= 0 then raise exception 'Indicá cuántas unidades vas a pesar'; end if;

  -- Receta: solo si existe, está activa y produce un producto de catálogo.
  -- Si no, la tanda igual se abre; al cerrar avisa que no descontó.
  if e.receta_id is not null then
    select * into v_receta from public.recetas where id = e.receta_id;
    if found and v_receta.activo and v_receta.catalogo_id is not null then
      v_receta_id := v_receta.id; v_cat := v_receta.catalogo_id;
    else
      v_notas := 'Receta ' || coalesce(v_receta.nombre, '?') || ' inactiva o sin producto: la tanda no descuenta inventario';
    end if;
  else
    v_notas := 'Producto sin receta: la tanda no descuenta inventario';
  end if;
  if p_es_prueba then v_notas := 'TANDA DE PRUEBA: no toca inventario'; end if;

  if p_orden_id is not null then
    perform 1 from public.ordenes_produccion o
     where o.id = p_orden_id and o.receta_id = v_receta_id
       and o.estado in ('aprobada','asignada') and o.produccion_id is null for update;
    if not found then raise exception 'La orden de producción no está disponible para esta receta'; end if;
  end if;

  v_hora := extract(hour from (now() at time zone 'America/El_Salvador'))::int;
  v_turno := case when v_hora < 13 then 'mañana' else 'tarde' end;
  v_lote := public._produccion_lote(v_fecha, p_es_prueba);

  insert into public.produccion_diaria
    (fecha, receta_id, producto_id, etiquetado_id, cantidad_producida, cantidad_enviada, turno, lote,
     responsable_id, created_by, created_by_id, estado, origen, modo_consumo, base_consumo,
     es_prueba, cantidad_planificada, abierta_at, dispositivo, bascula_codigo, client_key, notas)
  values
    (v_fecha, v_receta_id, v_cat, e.id, 0, 0, v_turno, v_lote,
     p_responsable_id, coalesce(p_usuario_nombre, 'Estación etiquetado'), p_responsable_id,
     'abierta', case when p_orden_id is null then 'estacion' else 'orden' end, 'backflush',
     case when e.requiere_peso and coalesce(e.gramos, 0) > 0 then 'peso' else 'unidades' end,
     p_es_prueba, p_cantidad_planificada, now(), p_dispositivo, p_bascula_codigo, p_client_key, v_notas)
  returning id into v_id;

  if p_orden_id is not null then
    update public.ordenes_produccion set produccion_id = v_id, updated_at = now() where id = p_orden_id;
  end if;
  -- Lo que mantenía marcarUso() desde la tablet: el producto se usó hoy.
  update public.etiquetado_productos
     set ultimo_uso = v_fecha, usos = usos + 1 where id = e.id;
  return public._produccion_tanda_json(v_id);
end;
$$;

-- ── unidad: registrar (p_gramos = NETO; p_bruto_g = lo que marcó la báscula) ──
create or replace function public.produccion_unidad_registrar(
  p_produccion_id uuid, p_gramos numeric, p_client_key uuid,
  p_pesado_por_id uuid default null, p_pesado_por text default null,
  p_bascula_codigo text default null, p_bruto_g numeric default null)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  u record; pd record; e record;
  v_num int; v_vence date; v_fuera boolean := false; v_cod text; v_hoy date;
  v_etq jsonb; v_quien text; v_id uuid;
begin
  if p_client_key is null then raise exception 'p_client_key es obligatorio'; end if;
  select * into u from public.produccion_unidades where client_key = p_client_key;
  if found then
    return jsonb_build_object('unidad_id', u.id, 'numero', u.numero, 'etiqueta', u.etiqueta,
      'codigo_corto', u.codigo_corto, 'vence', u.vence, 'fuera_banda', u.fuera_banda, 'repetida', true);
  end if;

  select * into pd from public.produccion_diaria where id = p_produccion_id for update;
  if not found then raise exception 'La tanda no existe'; end if;
  if pd.estado <> 'abierta' then raise exception 'La tanda % ya está % — abrí una nueva', pd.lote, pd.estado; end if;
  select * into e from public.etiquetado_productos where id = pd.etiquetado_id;
  if e.requiere_peso and coalesce(p_gramos, 0) <= 0 then raise exception 'Falta el peso de la unidad'; end if;

  select coalesce(max(numero), 0) + 1 into v_num from public.produccion_unidades where produccion_id = pd.id;
  v_hoy := public._produccion_fecha_sv();
  v_vence := case when e.dias is null then null else v_hoy + e.dias end;
  if e.requiere_peso and e.gramos is not null and e.banda is not null then
    v_fuera := abs(p_gramos - e.gramos) > e.banda;
  end if;
  loop
    v_cod := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    exit when not exists (select 1 from public.produccion_unidades where codigo_corto = v_cod);
  end loop;
  v_quien := coalesce(p_pesado_por,
    (select nombre || ' ' || coalesce(apellido, '') from public.usuarios_erp where id = p_pesado_por_id), '');

  -- Congelado: reimprimir da exactamente lo mismo aunque después cambie el producto.
  v_etq := jsonb_build_object(
    'producto', e.nombre, 'lote', pd.lote, 'numero', v_num,
    'gramos', p_gramos, 'bruto_g', p_bruto_g, 'tara_g', e.tara,
    'libras', case when p_gramos is null then null else round(p_gramos / 453.59237, 2) end,
    'vence', v_vence, 'vence_txt', case when v_vence is null then null else public._produccion_fecha_txt(v_vence) end,
    'elaborado', v_hoy, 'elaborado_txt', public._produccion_fecha_txt(v_hoy),
    'hora', to_char(now() at time zone 'America/El_Salvador', 'HH24:MI'),
    'quien', btrim(v_quien), 'conservacion', e.conserva, 'es_prueba', pd.es_prueba,
    'codigo_corto', v_cod,
    'qr', 'https://freakie-dogs-caja.vercel.app/unidad.html?c=' || v_cod);

  insert into public.produccion_unidades
    (produccion_id, numero, gramos, bruto_g, fuera_banda, vence, pesado_por_id, pesado_por,
     bascula_codigo, etiqueta, codigo_corto, client_key)
  values (pd.id, v_num, p_gramos, p_bruto_g, v_fuera, v_vence, p_pesado_por_id, btrim(v_quien),
     coalesce(p_bascula_codigo, pd.bascula_codigo), v_etq, v_cod, p_client_key)
  returning id into v_id;

  return jsonb_build_object('unidad_id', v_id, 'numero', v_num, 'etiqueta', v_etq,
    'codigo_corto', v_cod, 'vence', v_vence, 'fuera_banda', v_fuera, 'repetida', false);
end;
$$;

-- Las firmas viejas (M3) dejaban ambigua la sobrecarga (PostgREST no podía elegir);
-- se renombran a _obsoleta_* (tampoco se pudieron DROPear acá).
alter function public.produccion_unidad_registrar(uuid, numeric, uuid, uuid, text, text) rename to _obsoleta_produccion_unidad_registrar;
alter function public.produccion_tanda_abrir(uuid, numeric, uuid, uuid, text, text, boolean, uuid, text) rename to _obsoleta_produccion_tanda_abrir;

-- ── cerrar: sin receta no toca kardex, pero cierra y avisa ──────────────
create or replace function public.produccion_tanda_cerrar(
  p_produccion_id uuid, p_usuario_id uuid default null, p_peso_insumo_g numeric default null,
  p_auto boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  pd record; e record;
  v_unid numeric; v_peso numeric; v_rend numeric;
  v_t_unid numeric; v_t_peso numeric; v_excluir uuid[];
  v_cons jsonb := jsonb_build_object('consumidos', 0, 'sub_sin_catalogo', 0, 'faltantes', '[]'::jsonb);
  v_alta jsonb := jsonb_build_object('alta', false);
  v_costo numeric := 0; v_yield numeric; v_merma numeric; v_avisos jsonb := '[]'::jsonb;
  v_consumos jsonb; v_mueve boolean;
begin
  select * into pd from public.produccion_diaria where id = p_produccion_id for update;
  if not found then raise exception 'La tanda no existe'; end if;
  if pd.estado in ('cerrada', 'cerrada_auto') then
    return public._produccion_tanda_json(pd.id) || jsonb_build_object('ya_cerrada', true);
  end if;
  if pd.estado = 'anulada' then raise exception 'La tanda % está anulada', pd.lote; end if;

  select count(*), coalesce(sum(gramos), 0) into v_unid, v_peso
    from public.produccion_unidades where produccion_id = pd.id and estado = 'activa';
  if v_unid = 0 then raise exception 'La tanda % no tiene unidades: anulala en vez de cerrarla', pd.lote; end if;

  select * into e from public.etiquetado_productos where id = pd.etiquetado_id;
  v_mueve := (not pd.es_prueba) and pd.receta_id is not null;
  select coalesce(nullif(rc.rendimiento, 0), 1) into v_rend from public.recetas rc where rc.id = pd.receta_id;
  v_rend := coalesce(v_rend, 1);

  v_t_unid := round(v_unid / v_rend, 6);
  if pd.base_consumo = 'peso' and coalesce(e.gramos, 0) > 0 and v_peso > 0 then
    v_t_peso := round(v_peso / (v_rend * e.gramos), 6);
  else
    v_t_peso := v_t_unid;
  end if;

  select coalesce(array_agg(distinct producto_id), '{}') into v_excluir
    from public.produccion_diaria_items where produccion_id = pd.id and origen = 'scan';

  if v_mueve then
    v_cons := public._produccion_consumir(pd.id, v_t_peso, v_t_unid, v_excluir, p_usuario_id);
    v_alta := public._produccion_alta(pd.id, v_unid, p_usuario_id);
    select coalesce(sum(costo_linea), 0) into v_costo from public.produccion_diaria_items where produccion_id = pd.id;
    if not (v_alta->>'alta')::boolean then v_avisos := v_avisos || to_jsonb(v_alta->>'aviso'); end if;
    if (v_cons->>'sub_sin_catalogo')::int > 0 then
      v_avisos := v_avisos || to_jsonb((v_cons->>'sub_sin_catalogo') || ' sub-receta(s) sin producto de catálogo: su consumo no se descontó.');
    end if;
  elsif not pd.es_prueba then
    v_avisos := v_avisos || to_jsonb('«' || e.nombre || '» no tiene receta vinculada: las unidades quedaron registradas pero NO se descontó inventario. Vinculá la receta en Producción → Etiquetado.');
  end if;

  if p_peso_insumo_g is not null and p_peso_insumo_g > 0 then
    v_yield := round(v_peso / p_peso_insumo_g, 4);
    v_merma := p_peso_insumo_g - v_peso;
  end if;

  update public.produccion_diaria
     set estado = case when p_auto then 'cerrada_auto' else 'cerrada' end,
         cantidad_producida = v_t_peso, tandas_equiv = v_t_peso,
         unidades_producidas = v_unid, peso_total_g = nullif(v_peso, 0),
         peso_insumo_g = p_peso_insumo_g, yield_real = v_yield, merma_real_g = v_merma,
         costo_total = v_costo, cerrada_at = now(), cerrada_por = p_usuario_id
   where id = pd.id;

  update public.ordenes_produccion set estado = 'completada', updated_at = now()
   where produccion_id = pd.id and estado not in ('cancelada', 'completada');

  select coalesce(jsonb_agg(jsonb_build_object(
      'producto_id', i.producto_id, 'nombre', cp.nombre, 'cantidad', i.cantidad_consumida,
      'unidad', i.unidad_medida, 'costo_linea', i.costo_linea, 'es_empaque',
      exists (select 1 from public.receta_ingredientes ri where ri.receta_id = pd.receta_id
                and ri.producto_id = i.producto_id and ri.es_empaque)) order by cp.nombre), '[]'::jsonb)
    into v_consumos
    from public.produccion_diaria_items i join public.catalogo_productos cp on cp.id = i.producto_id
   where i.produccion_id = pd.id;

  return public._produccion_tanda_json(pd.id) || jsonb_build_object(
    'ya_cerrada', false, 'movio_inventario', v_mueve, 'consumos', v_consumos,
    'faltantes', v_cons->'faltantes', 'avisos', v_avisos, 'alta', v_alta,
    'tandas_peso', v_t_peso, 'tandas_unidades', v_t_unid);
end;
$$;

grant execute on function
  public.produccion_tanda_abrir(uuid, integer, uuid, uuid, text, text, boolean, uuid, text),
  public.produccion_unidad_registrar(uuid, numeric, uuid, uuid, text, text, numeric),
  public.produccion_tanda_cerrar(uuid, uuid, numeric, boolean)
to anon, authenticated;
