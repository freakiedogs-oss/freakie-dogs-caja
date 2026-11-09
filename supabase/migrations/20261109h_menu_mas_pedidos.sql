-- Menú web: «Los más pedidos en delivery» (9-nov-2026, Cesar). Unidades vendidas
-- por la app (canal delivery_propio) en los últimos N días, por nombre de producto.
-- Solo nombres y orden: nada de montos ni clientes. Aplicada como menu_mas_pedidos_delivery.
create or replace function public.menu_mas_pedidos(p_dias int default 30, p_limite int default 8)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with c as (
    select distinct q.cuenta_id from pos_cocina_queue q
     where q.canal = 'delivery_propio' and q.recibido_at > now() - make_interval(days => least(greatest(p_dias, 1), 90))
  )
  select coalesce(jsonb_agg(nombre order by u desc), '[]'::jsonb)
    from (select ci.nombre, sum(ci.cantidad) u
            from pos_cuenta_items ci join c on c.cuenta_id = ci.cuenta_id
           where ci.cancelado_motivo is null
           group by ci.nombre
           order by u desc
           limit least(greatest(p_limite, 1), 20)) t;
$function$;
grant execute on function public.menu_mas_pedidos(int, int) to anon, authenticated;
