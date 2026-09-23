-- ════════════════════════════════════════════════════════════════════════════
-- Pedidos SOS v1 (23-sep-2026) — aplicada en Supabase como `pedidos_sos_v1_23sep`
-- Arregla lo que encontró la simulación del Pedido de emergencia:
--   E05/E06/E08  la emergencia se sumaba a la orden del día → el conteo nocturno,
--                una edición con pantalla vieja o una orden atascada la borraban.
--                AHORA: cada SOS es una orden propia (tipo='sos') que el conteo no toca.
--   E07          bodega despachaba de una foto vieja del pedido.
--                AHORA: despacho_crear() hace todo en el servidor y rechaza si el
--                pedido cambió desde que se abrió.
--   Unidades     se pedía en unidad de inventario (carne "unidad" = bolita).
--                AHORA: se pide en el empaque del conteo y el servidor convierte.
--   Buscador     ofrecía productos viejos/duplicados.
--                AHORA: solo lo que la sucursal cuenta (sos_catalogo) y el servidor
--                rechaza lo demás.
--   Doble envío  sumaba dos veces. AHORA: código único por envío + aviso si ese
--                producto ya va en un SOS abierto.
--   Faltantes    lo que bodega no mandaba se olvidaba.
--                AHORA: queda como SOS "pendiente" ligado al original.
--   Candados     usuario obligatorio y de esa sucursal, motivo obligatorio,
--                Casa Matriz no se pide a sí misma, confirmación en cantidades grandes.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.pedidos_sucursal
  add column if not exists tipo text not null default 'regular',
  add column if not exists motivo text,
  add column if not exists client_token uuid,
  add column if not exists pedido_origen_id uuid references public.pedidos_sucursal(id) on delete set null,
  add column if not exists cancelado_por uuid references public.usuarios_erp(id) on delete set null,
  add column if not exists cancelado_at timestamptz,
  add column if not exists motivo_cancelacion text;
alter table public.pedido_items add column if not exists cantidad_empaques numeric;
alter table public.pedidos_sucursal drop constraint if exists pedidos_sucursal_tipo_check;
alter table public.pedidos_sucursal add constraint pedidos_sucursal_tipo_check check (tipo in ('regular','sos'));
alter table public.pedidos_sucursal drop constraint if exists pedidos_sucursal_motivo_check;
alter table public.pedidos_sucursal add constraint pedidos_sucursal_motivo_check check (motivo is null or motivo in ('se_acabo','se_dano','no_llego','otro','pendiente'));
alter table public.pedidos_sucursal drop constraint if exists pedidos_sucursal_estado_check;
alter table public.pedidos_sucursal add constraint pedidos_sucursal_estado_check check (estado in ('borrador','enviado','preparando','despachado','recibido','cancelado'));
create unique index if not exists uniq_pedido_client_token on public.pedidos_sucursal(client_token) where client_token is not null;
-- "Una sola orden viva por sucursal" ahora aplica solo a la orden del día.
drop index if exists public.uniq_pedido_vivo_por_sucursal;
create unique index uniq_pedido_vivo_por_sucursal on public.pedidos_sucursal(sucursal_id) where estado = 'enviado' and tipo = 'regular';
create index if not exists idx_pedidos_sos_abiertos on public.pedidos_sucursal(estado, created_at) where tipo = 'sos';

-- guardar_pedido_vivo: igual que antes, pero SOLO ve la orden regular.
-- (Cuerpo completo aplicado en Supabase; el único cambio es `and tipo = 'regular'`
--  en el select de la orden viva.)

-- Funciones nuevas (cuerpos completos aplicados en Supabase, ver pg_get_functiondef):
--   sos_catalogo(p_sucursal_id)                 productos del conteo nocturno de la sucursal, con empaque y factor
--   crear_pedido_sos(p_sucursal_id, p_usuario_id, p_items[{producto_id, empaques}], p_motivo,
--                    p_nota, p_token, p_confirmar, p_cantidad_en_stock)
--                                               crea un SOS aparte; valida usuario/sucursal/motivo/productos/cantidades;
--                                               idempotente por p_token; pide confirmación si es grande o repetido
--   crear_pedido_emergencia(...)                wrapper de la app vieja → crear_pedido_sos (cantidad en unidad de stock)
--   cancelar_pedido_sos(p_pedido_id, p_usuario_id, p_motivo)
--                                               solo SOS en 'enviado'
--   despacho_crear(p_pedido_id, p_usuario_id, p_motorista_nombre, p_items[{producto_id, solicitado, despachar}],
--                  p_motorista_id)             despacho atómico: candado por sucursal, rechaza si el pedido cambió
--                                               ('cambio') o ya no está pendiente ('estado'); crea despacho + items,
--                                               kardex de Casa Matriz, cantidad_despachada, estado 'preparando'; en SOS,
--                                               lo no despachado queda como SOS 'pendiente' ligado al original
--   vista sos_tiempos                           hora pedida / preparada / despachada / recibida de cada SOS
--
-- Pruebas (23-sep, en rollback, Plaza Cafetalón): 2 paq. carne → 40 bolitas; reenvío mismo token no duplica;
-- repetido y cantidad grande piden confirmación; producto viejo, otro usuario, sin usuario, CM a sí misma,
-- sin motivo, cantidad 0/texto → rechazados; conteo nocturno con SOS abierto no lo toca; despacho con pantalla
-- vieja rechazado con el cambio exacto; despacho doble rechazado; SOS parcial deja pendiente el jabón;
-- recepción suma 40 al inventario de la sucursal y marca recibido; app vieja crea SOS aparte.
