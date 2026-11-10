-- Menú web: «⭐ El favorito» en los extras (10-nov-2026, Cesar). Cuántas veces se
-- eligió cada opción CON PRECIO en los últimos N días (todos los canales), por id
-- de opción. Devuelve {"<id>": veces} solo para las que pasan de 20. Sin montos
-- ni clientes. Aplicada como menu_extras_favoritos.
create or replace function public.menu_extras_favoritos(p_dias int default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with l as (
    select ci.cantidad, m from pos_cuenta_items ci,
      jsonb_array_elements(case when jsonb_typeof(ci.modificadores) = 'array' then ci.modificadores else '[]' end) m
     where ci.created_at > now() - make_interval(days => least(greatest(p_dias, 1), 90)) and ci.cancelado_motivo is null
    union all
    select ci.cantidad, m from pos_cuenta_items ci,
      jsonb_array_elements(case when jsonb_typeof(ci.componentes) = 'array' then ci.componentes else '[]' end) c,
      jsonb_array_elements(case when jsonb_typeof(c->'modificadores') = 'array' then c->'modificadores' else '[]' end) m
     where ci.created_at > now() - make_interval(days => least(greatest(p_dias, 1), 90)) and ci.cancelado_motivo is null
  ), t as (
    select o.id, sum(l.cantidad) veces
      from l join pos_modificadores o on o.id::text = l.m->>'id'
     where o.precio_extra > 0
     group by o.id having sum(l.cantidad) >= 20
  )
  select coalesce(jsonb_object_agg(id::text, veces), '{}'::jsonb) from t;
$function$;
grant execute on function public.menu_extras_favoritos(int) to anon, authenticated;
