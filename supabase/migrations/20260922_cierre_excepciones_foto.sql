-- 22-sep-2026 · Excepciones de cierre por sucursal y día (pedido Cesar).
-- Caso: Alejandro (Paseo Venecia S004) no puede subir fotos desde la tablet y el
-- corte Z exige la foto del voucher n1co (y algunos egresos exigen foto). Con una
-- fila aquí para (store_code, fecha) el POS deja de exigir fotos SOLO ese día;
-- al día siguiente vuelve la regla normal sin tocar nada.
create table if not exists public.pos_cierre_excepciones (
  id           uuid primary key default gen_random_uuid(),
  store_code   text not null,
  fecha        date not null,
  sin_foto     boolean not null default true,
  motivo       text,
  creado_por   text,
  created_at   timestamptz not null default now(),
  unique (store_code, fecha)
);

alter table public.pos_cierre_excepciones enable row level security;

-- El POS entra con anon key (login por PIN): sólo lectura. Las filas se crean a mano.
drop policy if exists pos_cierre_excepciones_read on public.pos_cierre_excepciones;
create policy pos_cierre_excepciones_read on public.pos_cierre_excepciones
  for select to anon, authenticated using (true);

grant select on public.pos_cierre_excepciones to anon, authenticated;

comment on table public.pos_cierre_excepciones is
  'Excepciones del cierre POS por sucursal y día: sin_foto=true → el corte Z no exige foto del voucher n1co ni fotos de egreso ese día.';
