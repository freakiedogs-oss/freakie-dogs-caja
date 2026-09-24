-- inventario_conteo_bebidas ya existía en el esquema (fila única por
-- sucursal_id+fecha, items jsonb) pero nunca se conectó a ninguna pantalla,
-- así que nunca nadie le agregó políticas RLS: RLS estaba prendido con CERO
-- políticas, o sea que cualquier lectura/escritura quedaba denegada por
-- default para anon/authenticated.
--
-- 24-sep-2026 (Cesar): el conteo de bebidas de ConteoNocturno.jsx se puso en
-- cero al volver a entrar — esa pantalla nunca había escrito en ninguna
-- tabla (a propósito: no debe tocar kardex ni inventario_conteo_nocturno),
-- así que lo contado vivía solo en memoria del navegador. Se conectó esta
-- pantalla a esta tabla para autoguardar el conteo en progreso; falta esta
-- política para que el cliente (anon/authenticated, como el resto del app)
-- pueda realmente leer y escribir en ella. Mismo patrón permisivo que
-- inventario_conteo_nocturno_all: el control de acceso real es a nivel de
-- app (roles/PIN), no de RLS multi-tenant.
create policy inventario_conteo_bebidas_all on public.inventario_conteo_bebidas
  for all
  to anon, authenticated, service_role
  using (true)
  with check (true);
