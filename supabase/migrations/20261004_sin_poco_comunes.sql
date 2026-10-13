-- 4-Oct-2026 — «Sin carne / sin pan / sin salchicha» en caja, escondidos en «Más opciones».
-- Por qué: el 3-oct en Cafetalón un Freakie Burger web se pidió «sin los dos
-- medallones» solo en la nota; el sistema descontó 2 bolitas que no se usaron y
-- el cuadre nocturno lo encontró como sobrante. Pedido de Frank: que se pueda
-- marcar en caja, pero sin llenar la pantalla con botones que casi nunca se usan.
-- Qué cambia:
--   1) receta_ingredientes.poco_comun: el SIN de ese ingrediente se muestra
--      dentro de «Más opciones (poco comunes)» y no a la vista.
--   2) Carne, pan y salchicha pasan a ser removibles (y poco comunes) en los
--      bloques armados: Hamburguesa Sencilla (armada), Freakie Dog armado,
--      Super Freak armado y Chilli dog individual. Etiquetas distintas para que
--      en un Burger Box «sin pan de hamburguesa» no le quite el pan al hot dog.
--   3) pos_removibles_item: igual que pos_ingredientes_removibles pero devuelve
--      también poco_comun. La vieja queda igual para las cajas con la app en caché.
-- La descarga no cambia: pos_explotar_linea / pos_deducir_inventario ya no
-- descuentan un ingrediente removible marcado SIN (desde 18-ago).
alter table public.receta_ingredientes add column if not exists poco_comun boolean not null default false;

update public.receta_ingredientes ri
   set removible = true, poco_comun = true, etiqueta = v.etiqueta
  from (values
    ('b5e98f47-5d00-426d-b204-98cad6a561f0'::uuid, 'Carne'),               -- Hamburguesa Sencilla (armada): 2 bolitas
    ('a405f8b7-cd1a-4fbb-a46e-5e7025d19d94'::uuid, 'Pan de hamburguesa'),
    ('277645b1-77ca-4319-9f11-f5a6549f5a17'::uuid, 'Salchicha'),           -- Freakie Dog armado
    ('28cf24bc-396a-4839-8b5f-975921dd7dec'::uuid, 'Pan de hot dog'),
    ('fc74473e-aff2-410e-988a-823191d399b4'::uuid, 'Salchicha'),           -- Super Freak armado
    ('01d10c3e-7c99-45f7-af63-f49fb07d6847'::uuid, 'Pan de hot dog'),
    ('d4dd8602-bbff-417a-bd43-f7e82e1c7186'::uuid, 'Salchicha'),           -- Chilli dog individual
    ('afd37264-c0ff-4059-a5b4-f4e3b59c487c'::uuid, 'Pan de hot dog')
  ) v(id, etiqueta)
 where ri.id = v.id;

create or replace function public.pos_removibles_item(p_menu_item_id uuid)
 returns table(nombre text, bloque text, veces bigint, poco_comun boolean)
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  with recursive raiz as (
    select r.id as receta_id, r.nombre as bloque, 0 as nivel
      from public.pos_menu_items mi
      join public.recetas r on r.catalogo_id = mi.producto_id and r.activo
     where mi.id = p_menu_item_id
  ),
  arbol as (
    select ri.id, ri.receta_id, ri.sub_receta_id, ri.producto_id, ri.removible, ri.poco_comun, ri.etiqueta,
           z.bloque, z.nivel
      from raiz z
      join public.receta_ingredientes ri on ri.receta_id = z.receta_id
    union all
    select ri.id, ri.receta_id, ri.sub_receta_id, ri.producto_id, ri.removible, ri.poco_comun, ri.etiqueta,
           sr.nombre, a.nivel + 1
      from arbol a
      join public.recetas sr on sr.id = a.sub_receta_id and sr.activo
      join public.receta_ingredientes ri on ri.receta_id = sr.id
     where a.nivel < 6
  )
  select coalesce(nullif(btrim(a.etiqueta), ''), p.nombre, sr2.nombre) as nombre,
         min(a.bloque) as bloque,
         count(*)      as veces,
         bool_and(a.poco_comun) as poco_comun
    from arbol a
    left join public.catalogo_productos p   on p.id   = a.producto_id
    left join public.recetas            sr2 on sr2.id = a.sub_receta_id
   where a.removible
   group by coalesce(nullif(btrim(a.etiqueta), ''), p.nombre, sr2.nombre)
   order by 1;
$function$;
grant execute on function public.pos_removibles_item(uuid) to anon, authenticated, service_role;
