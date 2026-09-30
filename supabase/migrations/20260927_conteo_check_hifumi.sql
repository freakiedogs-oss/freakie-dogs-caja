-- 27-sep-2026 (Frank): doble check antes de cerrar el conteo nocturno.
-- Hifumi no entra solo al POS; si un pedido se prepara y nadie lo digita, sale sin
-- descargar y el conteo lo marca como faltante (caso 25-sep, $62.93 en Cafetalón).
-- Antes del primer guardado de la noche, el conteo pregunta si quedó alguno sin ingresar
-- y deja la respuesta firmada acá (una fila por respuesta: queda el rastro si primero
-- dijeron que faltaba y después confirmaron).
create table if not exists public.conteo_check_hifumi (
  id bigint generated always as identity primary key,
  sucursal_id uuid not null references public.sucursales(id),
  store_code text,
  fecha date not null,
  respuesta text not null check (respuesta in ('todos_ingresados','no_hubo','faltaba_ingresar')),
  hifumi_registrados int,
  cuentas_abiertas int,
  usuario_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists conteo_check_hifumi_suc_fecha on public.conteo_check_hifumi (sucursal_id, fecha);

alter table public.conteo_check_hifumi enable row level security;
-- Mismo patrón que inventario_conteo_nocturno / merma_sin_reporte: la app controla el acceso.
-- Solo leer e insertar: una respuesta firmada no se edita ni se borra.
create policy conteo_check_hifumi_select on public.conteo_check_hifumi for select to anon, authenticated using (true);
create policy conteo_check_hifumi_insert on public.conteo_check_hifumi for insert to anon, authenticated with check (true);
grant select, insert on public.conteo_check_hifumi to anon, authenticated;
