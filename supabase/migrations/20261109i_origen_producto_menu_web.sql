-- ════════════════════════════════════════════════════════════════════
-- Menú web: de dónde vino cada producto (9-nov-2026, Cesar)
-- Aplicadas como pedido_web_origen_producto + reporte_origen_menu_web.
--
-- 1) crear_pedido_delivery guarda en delivery_clientes.items[*]:
--      origen        = menu | mas_pedidos | para_compartir | sugerencia_carrito | oferta_duo | repetir
--      agrandado_via = boton | pregunta
--    Valores fuera de la lista → null (nunca rompe el pedido). Se aplicó con un
--    replace sobre la definición vigente (solo se agregaron esas 2 llaves al
--    jsonb_build_object de cada línea):
do $$
declare d text;
  v_old text := '''nota'', nullif(btrim(coalesce(v_line->>''nota'','''')),''''), ''subtotal'', v_line_total);';
  v_new text := '''nota'', nullif(btrim(coalesce(v_line->>''nota'','''')),''''), ''subtotal'', v_line_total,'
    || E'\n      ''origen'', case when v_line->>''origen'' in (''menu'',''mas_pedidos'',''para_compartir'',''sugerencia_carrito'',''oferta_duo'',''repetir'') then v_line->>''origen'' end,'
    || E'\n      ''agrandado_via'', case when v_line->>''agrandado_via'' in (''boton'',''pregunta'') then v_line->>''agrandado_via'' end);';
begin
  d := pg_get_functiondef('public.crear_pedido_delivery'::regproc);
  if position('''origen'', case when v_line' in d) > 0 then return; end if;   -- ya aplicada
  if position(v_old in d) = 0 then raise exception 'no encontré el cierre de la línea en crear_pedido_delivery'; end if;
  execute replace(d, v_old, v_new);
end $$;

-- 2) Reporte: select * from reporte_origen_menu_web('2026-11-10', now());
create or replace function public.reporte_origen_menu_web(p_desde timestamptz, p_hasta timestamptz default now())
returns table(origen text, pedidos bigint, lineas bigint, unidades numeric, monto numeric)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(it->>'origen', 'sin_dato') origen,
         count(distinct d.id), count(*), sum((it->>'cantidad')::numeric), round(sum((it->>'subtotal')::numeric), 2)
    from delivery_clientes d, jsonb_array_elements(d.items) it
   where d.numero_orden like 'WEB-%' and d.created_at >= p_desde and d.created_at < p_hasta
   group by 1
  union all
  select 'agrandado_via_' || (it->>'agrandado_via'), count(distinct d.id), count(*), sum((it->>'cantidad')::numeric), round(sum((it->>'subtotal')::numeric), 2)
    from delivery_clientes d, jsonb_array_elements(d.items) it
   where d.numero_orden like 'WEB-%' and d.created_at >= p_desde and d.created_at < p_hasta and it->>'agrandado_via' is not null
   group by 1;
$function$;
revoke all on function public.reporte_origen_menu_web(timestamptz, timestamptz) from public, anon;
grant execute on function public.reporte_origen_menu_web(timestamptz, timestamptz) to authenticated;
