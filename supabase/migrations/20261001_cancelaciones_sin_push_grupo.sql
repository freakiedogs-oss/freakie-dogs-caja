-- Cancelaciones: el grupo (Frank, César, José) ya no recibe push (1-oct-2026, Frank).
-- «Nos puede parecer muy intrusivo… y así ella toma más responsabilidad.»
-- · El aviso al celular es solo para el primer aviso de la sucursal (gerente /
--   cancelacion_avisos 'primero'). A los 15 min sin decidir se le vuelve a
--   avisar a ELLA («⏰ Sin decidir»); el grupo lo ve solo dentro del ERP
--   (píldora sin sonido y bandeja).
-- · Si nadie de primer aviso tiene el celular suscrito, ya no se salta al grupo.
-- · cancelacion_config.push_grupo = true devuelve el comportamiento anterior en
--   una sucursal (p.ej. una que no tenga encargado).
alter table public.cancelacion_config add column if not exists push_grupo boolean not null default false;

create or replace function public.cancelaciones_push_preparar(p_id bigint, p_nivel text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_c public.cancelaciones_validacion%rowtype;
  v_ids bigint[]; v_titulos text; v_n int; v_primero uuid[]; v_grupo uuid[]; v_dest uuid[];
  v_subs jsonb; v_nivel text := p_nivel; v_desac text; v_push_grupo boolean;
begin
  select * into v_c from public.cancelaciones_validacion where id = p_id for update;
  if not found or v_c.estado <> 'pendiente' then return jsonb_build_object('enviar', false, 'razon', 'no pendiente'); end if;

  if v_nivel = 'nueva' and v_c.avisado_at is not null then
    return jsonb_build_object('enviar', false, 'razon', 'ya avisado');
  end if;
  if v_nivel = 'grupo' and v_c.escalado_at is not null and v_c.escalado_at < now() - interval '30 seconds' then
    return jsonb_build_object('enviar', false, 'razon', 'ya escalado');
  end if;

  select coalesce(push_grupo, false) into v_push_grupo from public.cancelacion_config where store_code = v_c.store_code;
  v_push_grupo := coalesce(v_push_grupo, false);

  select array_agg(id order by id), string_agg(titulo, ' · ' order by id), count(*)
    into v_ids, v_titulos, v_n
    from public.cancelaciones_validacion
   where estado = 'pendiente'
     and (id = p_id or (v_c.cuenta_id is not null and cuenta_id = v_c.cuenta_id
                        and abs(extract(epoch from created_at - v_c.created_at)) < 120));

  select coalesce(array_agg(distinct u.id), '{}') into v_primero
    from public.usuarios_erp u
   where u.activo and ((u.rol = 'gerente' and u.store_code = v_c.store_code)
      or u.id in (select usuario_id from public.cancelacion_avisos where nivel = 'primero' and store_code = v_c.store_code));
  select coalesce(array_agg(distinct usuario_id), '{}') into v_grupo
    from public.cancelacion_avisos where nivel = 'grupo' and store_code is null;

  -- Saltar al grupo cuando el primer aviso no tiene celular: solo con push_grupo.
  if v_push_grupo and v_nivel = 'nueva'
     and not exists (select 1 from public.push_suscripciones where usuario_id = any(v_primero)) then
    v_nivel := 'grupo';
  end if;

  v_dest := case when v_nivel = 'grupo' and v_push_grupo then v_primero || v_grupo else v_primero end;

  if v_nivel = 'nueva' then
    update public.cancelaciones_validacion set avisado_at = now() where id = any(v_ids) and avisado_at is null;
  else
    update public.cancelaciones_validacion set avisado_at = coalesce(avisado_at, now()), escalado_at = now()
     where id = any(v_ids) and escalado_at is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs from public.push_suscripciones s where s.usuario_id = any(v_dest);

  v_desac := case
    when v_c.opinion_caja is not null and v_c.opinion_cocina is not null and v_c.opinion_caja <> v_c.opinion_cocina
      then ' · Caja y cocina no coinciden' else '' end;

  return jsonb_build_object(
    'enviar', jsonb_array_length(v_subs) > 0,
    'nivel', v_nivel,
    'subs', v_subs,
    'titulo', case when v_nivel = 'grupo' and p_nivel = 'grupo' then '⏰ Sin decidir · ' else '↩️ ' end
              || v_c.store_code || ' · ' || coalesce(v_c.referencia, 'Cancelación'),
    'cuerpo', left(v_titulos, 140) || coalesce(' · anuló ' || v_c.cancelado_por_nombre, '') || v_desac
              || case when v_nivel = 'grupo' and p_nivel = 'grupo' then '. Lleva más de 15 min: decidí antes del conteo.'
                      else '. Tocá para decidir qué pasó con el producto.' end,
    'tag', 'cancel-' || coalesce(v_c.cuenta_id::text, v_c.id::text),
    'url', '/?ir=cancelaciones');
end $$;
revoke all on function public.cancelaciones_push_preparar(bigint, text) from public, anon, authenticated;
grant execute on function public.cancelaciones_push_preparar(bigint, text) to service_role;
