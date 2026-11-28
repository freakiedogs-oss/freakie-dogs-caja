-- «Se acabó» de la caja también apaga el ítem en PedidosYa (28-nov-2026, pedido de Jose).
--
-- La pestaña «Se acabó» del POS (`producto_bloqueo`, vía caja_disponibilidad_set) es
-- el único lugar donde cada sucursal marca lo que se terminó. Ahora, además del menú
-- de delivery propio, se avisa a PedidosYa para ESA tienda:
--   · el producto suelto del menú PeYa con esa clave            → type ITEM
--   · la opción/extra con esa clave (p. ej. «Coca Cola» dentro de «Escoge tu bebida»)
--                                                              → type TOPPING
--   · los combos que traen ese producto fijo NO se apagan (decisión de Jose, opción B).
-- Se apaga hasta la misma hora que en el ERP (mañana 6:00 a.m.: PedidosYa lo prende
-- solo con willBeAvailable AT_TIMESTAMP) y se prende al liberarlo desde la caja.
--
-- Va por una cola (`peya_item_cola`) que procesa la Edge Function `peya-horario`
-- desde el cron de cada minuto: la caja no espera a PedidosYa ni se traba si falla.
-- El trigger nunca rompe el «Se acabó»: si algo falla, queda anotado en la cola.

create table if not exists public.peya_item_cola (
  id           bigserial primary key,
  bloqueo_id   uuid,
  sucursal_id  uuid not null,
  remote_id    text not null,
  clave        text not null,
  nombre       text,
  disponible   boolean not null,
  hasta        timestamptz,
  items        jsonb not null default '[]'::jsonb,   -- [{id, tipo: ITEM|TOPPING, titulo}]
  estado       text not null default 'pendiente'
               check (estado in ('pendiente','hecho','fallo','no_en_peya','error','reemplazado')),
  intentos     int not null default 0,
  intento_at   timestamptz,
  resultado    jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists peya_item_cola_pend on public.peya_item_cola (estado, id);
create index if not exists peya_item_cola_suc_clave on public.peya_item_cola (sucursal_id, clave, id desc);
alter table public.peya_item_cola enable row level security;
revoke all on table public.peya_item_cola from anon, authenticated;

-- Qué ítems del catálogo PeYa corresponden a una clave de producto.
create or replace function public.peya_items_de_clave(p_clave text)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  with c as (select public.peya_catalogo(p_pruebas => false) j)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.key,
           'tipo', case when exists (select 1 from public.pos_modificadores o where o.id::text = e.key)
                        then 'TOPPING' else 'ITEM' end,
           'titulo', e.value->'title'->>'default') order by e.key), '[]'::jsonb)
    from c, jsonb_each(c.j->'catalog'->'items') e
   where e.value->>'type' = 'Product'
     and public.clave_producto(e.value->'title'->>'default') = public.clave_producto(p_clave)
     and (exists (select 1 from public.pos_modificadores o where o.id::text = e.key)
          or exists (select 1 from public.pos_menu_items m where m.id::text = e.key
                     -- Opción B: un combo nunca entra (aunque su nombre coincidiera).
                     and not exists (select 1 from public.pos_combo_componentes cc
                                      where cc.combo_item_id = m.id)));
$$;

create or replace function public.peya_item_encolar(
  p_bloqueo_id uuid, p_sucursal_id uuid, p_clave text, p_nombre text,
  p_disponible boolean, p_hasta timestamptz)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_items jsonb; v record; n int := 0;
begin
  if not exists (select 1 from public.peya_vendor_map where sucursal_id = p_sucursal_id
                  and activo and not es_pruebas and chain_code is not null) then
    return 0;
  end if;
  begin
    v_items := public.peya_items_de_clave(p_clave);
  exception when others then
    insert into public.peya_item_cola (bloqueo_id, sucursal_id, remote_id, clave, nombre, disponible, hasta, estado, resultado)
    select p_bloqueo_id, p_sucursal_id, vm.remote_id, p_clave, p_nombre, p_disponible, p_hasta, 'error',
           jsonb_build_object('error', SQLERRM)
      from public.peya_vendor_map vm
     where vm.sucursal_id = p_sucursal_id and vm.activo and not vm.es_pruebas and vm.chain_code is not null;
    return 0;
  end;

  for v in select vm.remote_id from public.peya_vendor_map vm
            where vm.sucursal_id = p_sucursal_id and vm.activo and not vm.es_pruebas
              and vm.chain_code is not null loop
    -- Un cambio nuevo reemplaza lo que todavía no salió para esa misma clave.
    update public.peya_item_cola set estado = 'reemplazado'
     where remote_id = v.remote_id and clave = p_clave and estado = 'pendiente';
    insert into public.peya_item_cola (bloqueo_id, sucursal_id, remote_id, clave, nombre, disponible, hasta, items, estado)
    values (p_bloqueo_id, p_sucursal_id, v.remote_id, p_clave, p_nombre, p_disponible, p_hasta,
            v_items, case when jsonb_array_length(v_items) = 0 then 'no_en_peya' else 'pendiente' end);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public._peya_item_bloqueo_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  begin
    if new.liberado_at is null and (new.hasta is null or new.hasta > now())
       and (tg_op = 'INSERT' or old.liberado_at is not null or old.hasta is distinct from new.hasta) then
      perform public.peya_item_encolar(new.id, new.sucursal_id, new.clave, new.nombre, false, new.hasta);
    elsif tg_op = 'UPDATE' and old.liberado_at is null and new.liberado_at is not null then
      perform public.peya_item_encolar(new.id, new.sucursal_id, new.clave, new.nombre, true, null);
    end if;
  exception when others then
    -- El «Se acabó» de la caja nunca falla por PedidosYa.
    raise warning 'peya_item_cola: %', SQLERRM;
  end;
  return new;
end;
$$;

drop trigger if exists trg_peya_item_bloqueo on public.producto_bloqueo;
create trigger trg_peya_item_bloqueo
  after insert or update on public.producto_bloqueo
  for each row execute function public._peya_item_bloqueo_trg();

create or replace function public.peya_item_pendientes()
returns table(id bigint, remote_id text, items jsonb, disponible boolean, hasta timestamptz)
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.id, c.remote_id, c.items, c.disponible, c.hasta
    from public.peya_item_cola c
   where c.estado = 'pendiente' and c.intentos < 10
     and (c.intento_at is null or c.intento_at < now() - interval '50 seconds')
   order by c.id
   limit 30;
$$;

create or replace function public.peya_item_marcar(p_id bigint, p_resultado text, p_detalle jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update public.peya_item_cola
     set intentos = intentos + 1, intento_at = now(), resultado = p_detalle,
         estado = case p_resultado when 'hecho' then 'hecho' when 'fallo' then 'fallo'
                                   else case when intentos + 1 >= 10 then 'fallo' else 'pendiente' end end
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- Estado en PedidosYa de cada «Se acabó» activo de la sucursal, para la caja.
create or replace function public.peya_estado_se_acabo(p_usuario uuid, p_store text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare q jsonb; v_suc uuid;
begin
  q := _caja_quien(p_usuario, p_store);
  v_suc := (q->>'sucursal_id')::uuid;
  return coalesce((
    select jsonb_object_agg(x.clave, x.estado)
      from (select distinct on (c.clave) c.clave, c.estado
              from public.peya_item_cola c
             where c.sucursal_id = v_suc and not c.disponible and c.estado <> 'reemplazado'
               and c.created_at > now() - interval '2 days'
             order by c.clave, c.id desc) x), '{}'::jsonb);
end;
$$;

-- El tick del cron también despierta a la función si hay ítems por mandar.
create or replace function public.peya_horario_tick()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n integer;
begin
  update public.peya_cierres_especiales set estado = 'vencida'
   where estado = 'pendiente' and now() >= hasta;
  select (select count(*) from public.peya_horario_pendientes())
       + (select count(*) from public.peya_especial_pendientes())
       + (select count(*) from public.peya_item_pendientes()) into n;
  if n > 0 then
    perform net.http_post(
      url := 'https://btboxlwfqcbrdfrlnwln.supabase.co/functions/v1/peya-horario',
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 55000);
  end if;
  return n;
end;
$$;

revoke all on function public.peya_items_de_clave(text) from public, anon, authenticated;
revoke all on function public.peya_item_encolar(uuid, uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.peya_item_pendientes() from public, anon, authenticated;
revoke all on function public.peya_item_marcar(bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.peya_horario_tick() from public, anon, authenticated;
grant execute on function public.peya_item_pendientes() to service_role;
grant execute on function public.peya_item_marcar(bigint, text, jsonb) to service_role;
grant all on table public.peya_item_cola to service_role;
grant usage on sequence public.peya_item_cola_id_seq to service_role;
revoke all on function public.peya_estado_se_acabo(uuid, text) from public;
grant execute on function public.peya_estado_se_acabo(uuid, text) to anon, authenticated, service_role;
