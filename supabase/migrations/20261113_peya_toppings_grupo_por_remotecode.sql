-- PeYa: una opción que existe en dos grupos caía en el grupo equivocado.
--
-- 13-nov-2026, pedido real 2369317464 en la tienda de pruebas (Combo Freakie
-- Dog con Ketchup + Jalapeños en «Complemento de Hot Dog» y Chipotle en
-- «Salsas Papas»). El traductor devolvió Jalapeños en Salsas Papas y Chipotle
-- en Complemento de Hot Dog: las dos opciones existen en los dos grupos y la
-- heurística por nombre («familia sin estrenar») las cruzó. En cocina eso es
-- chipotle en el hot dog y jalapeño en las papas.
--
-- El dato correcto ya viene en el pedido: cada nodo de grupo trae su
-- `remoteCode`, que es NUESTRO id del Topping del catálogo (`TOP-<grupo>` o
-- `TOP-<grupo>-<n>` para la unidad n de un combo). Se perdía al aplanar.
--
--   · `peya_toppings_planos` ahora le pega a cada hoja el remoteCode del grupo
--     del que cuelga (`_grupo_rc`).
--   · `peya_traducir_toppings`, si la hoja trae `_grupo_rc` con forma
--     `TOP-<uuid>[-n]`, usa ese grupo (y esa unidad) directamente. La
--     heurística por nombre queda sólo para pedidos sin ese dato.

create or replace function public.peya_toppings_planos(p_toppings jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_out   jsonb := '[]'::jsonb;
  v_nodo  jsonb;
  v_hijos jsonb;
  v_rc    text;
begin
  if coalesce(jsonb_array_length(p_toppings), 0) = 0 then return v_out; end if;

  for v_nodo in select value from jsonb_array_elements(p_toppings) loop
    v_hijos := case when jsonb_typeof(v_nodo->'children') = 'array'
                    then v_nodo->'children' else '[]'::jsonb end;

    if jsonb_array_length(v_hijos) > 0 then
      -- Agrupación: el nombre es la pregunta, no una selección. Se baja, y
      -- cada hoja se lleva el remoteCode del grupo (el más cercano gana).
      v_rc := nullif(btrim(coalesce(v_nodo->>'remoteCode', '')), '');
      v_out := v_out || coalesce((
        select jsonb_agg(case when v_rc is not null and not (h ? '_grupo_rc')
                              then h || jsonb_build_object('_grupo_rc', v_rc)
                              else h end)
          from jsonb_array_elements(public.peya_toppings_planos(v_hijos)) h
      ), '[]'::jsonb);
    else
      v_out := v_out || jsonb_build_array(v_nodo);
    end if;
  end loop;

  return v_out;
end $function$;

create or replace function public.peya_traducir_toppings(p_menu_item_id uuid, p_toppings jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_planos   jsonb;
  v_fams     jsonb := '{}'::jsonb;
  v_opts     jsonb := '{}'::jsonb;
  v_base     jsonb := '{}'::jsonb;
  v_slot     jsonb := '{}'::jsonb;
  v_usados   jsonb := '{}'::jsonb;
  v_cerrado  jsonb := '{}'::jsonb;
  v_tocada   jsonb := '{}'::jsonb;
  v_previa   text  := null;
  f          record;
  v_top      jsonb;
  v_nombre   text;
  v_precio   numeric;
  v_rc       text;
  v_grc      text;
  v_preset   record;
  v_es_preset boolean;
  v_hay      boolean;
  v_nombres  text[];
  v_hint     text;
  v_clave    text;
  v_cand     text;
  v_cabe     boolean;
  v_sin_estrenar boolean;
  v_s        int;
  v_usa      jsonb;
  v_grupo    jsonb;
  v_gnombre  text;
  v_gid      uuid;
  v_gbase    uuid;
  v_g2       record;
  v_mod      record;
  v_n        text;
  v_out      jsonb := '[]'::jsonb;
  v_primero  boolean;
begin
  v_planos := public.peya_toppings_planos(p_toppings);
  if coalesce(jsonb_array_length(v_planos), 0) = 0 then return v_out; end if;

  for f in select * from public.peya_familias_item(p_menu_item_id) loop
    v_fams := jsonb_set(v_fams, array[f.clave || '#' || f.slot],
                jsonb_build_object('id', f.grupo_id, 'nombre', f.grupo_nombre), true);
    v_opts := jsonb_set(v_opts, array[f.clave],
                coalesce(v_opts->f.clave, '[]'::jsonb) ||
                to_jsonb(coalesce(f.opciones, array[]::text[])), true);
    if f.slot = 1 then
      v_base := jsonb_set(v_base, array[f.clave], to_jsonb(f.grupo_nombre), true);
    end if;
  end loop;

  for v_top in select value from jsonb_array_elements(v_planos) loop
    v_nombre := btrim(coalesce(v_top->>'name', ''));
    v_precio := coalesce(nullif(btrim(coalesce(v_top->>'price', '')), '')::numeric, 0);
    v_rc     := nullif(btrim(coalesce(v_top->>'remoteCode', '')), '');
    v_grc    := nullif(btrim(coalesce(v_top->>'_grupo_rc', '')), '');
    if v_nombre = '' and v_rc is null then continue; end if;

    -- ── 1. A qué opciones nuestras equivale ────────────────────────────────
    v_hint := null; v_es_preset := false; v_n := null; v_nombres := null;

    if v_rc ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select btrim(m.nombre) into v_n from pos_modificadores m
       where m.id = v_rc::uuid and m.activo;
    end if;

    if v_n is not null then
      v_nombres := array[v_n];
    else
      select * into v_preset from peya_preset_map
       where parentesis_norm = public.peya_parentesis(v_nombre);
      v_hay := found;
      if not v_hay then
        select * into v_preset from peya_preset_map
         where parentesis_norm = public.peya_norm(v_nombre);
        v_hay := found;
      end if;

      if v_hay then
        v_es_preset := true;
        v_nombres   := coalesce(v_preset.expande_a, array[]::text[]);
        v_hint      := v_preset.grupo_pos;
      else
        select nombre_pos into v_n from peya_modificador_map
         where peya_nombre_norm = public.peya_norm(v_nombre);
        if v_n is null then
          select nombre_pos into v_n from peya_modificador_map
           where peya_nombre_norm = public.peya_sin_parentesis(v_nombre);
        end if;
        if v_n is null then
          select btrim(m.nombre) into v_n
            from pos_modificadores m
            join pos_modificadores_grupo g on g.id = m.grupo_id
           where m.activo and g.activo
             and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_nombre)
           order by (exists (select 1 from jsonb_each(v_fams) e
                              where (e.value->>'id')::uuid = g.id)) desc, g.nombre
           limit 1;
        end if;
        if v_n is null then
          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'grupo_id', null, 'grupo_nombre', 'PeYa sin mapear',
            'opcion_id', null, 'nombre', '⚠️ ' || coalesce(nullif(v_nombre, ''), v_rc),
            'precio_extra', v_precio));
          continue;
        end if;
        v_nombres := array[v_n];
      end if;
    end if;

    -- ── 1b. El grupo viene en el pedido: se usa tal cual ───────────────────
    -- `TOP-<uuid>` o `TOP-<uuid>-<n>` es el id del Topping que publicamos.
    -- Con eso no hay que adivinar la familia ni la unidad.
    if v_grc ~* '^TOP-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9]+)?$' then
      v_gbase := substring(v_grc from 5 for 36)::uuid;
      v_s := coalesce(substring(v_grc from '^TOP-.{36}-([0-9]+)$')::int, 1);
      v_gnombre := null;
      select g.nombre into v_gnombre from pos_modificadores_grupo g where g.id = v_gbase;
      if v_gnombre is not null then
        v_gid := v_gbase;
        if v_s > 1 then
          -- Unidad n de un combo: si el POS tiene «<grupo> n» como grupo
          -- propio, va ahí; si no, se numera el nombre igual.
          v_g2 := null;
          select g.id, g.nombre into v_g2 from pos_modificadores_grupo g
           where g.activo and public.peya_norm(g.nombre) = public.peya_norm(v_gnombre || ' ' || v_s)
           limit 1;
          if v_g2.id is not null then
            v_gid := v_g2.id; v_gnombre := v_g2.nombre;
          else
            v_gnombre := v_gnombre || ' ' || v_s;
          end if;
        end if;

        v_primero := true;
        foreach v_n in array v_nombres loop
          v_mod := null;
          -- El remoteCode de la opción es nuestro id: si pertenece a este grupo
          -- (o al base), es la opción exacta.
          if v_rc ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             and not v_es_preset then
            select m.id, btrim(m.nombre) as nombre into v_mod from pos_modificadores m
             where m.id = v_rc::uuid and m.grupo_id in (v_gid, v_gbase);
          end if;
          if v_mod.id is null then
            select m.id, btrim(m.nombre) as nombre into v_mod from pos_modificadores m
             where m.activo and m.grupo_id = v_gid
               and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_n)
             limit 1;
          end if;
          if v_mod.id is null then
            select m.id, btrim(m.nombre) as nombre into v_mod from pos_modificadores m
             where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_n)
             order by (m.grupo_id = v_gbase) desc
             limit 1;
          end if;

          v_out := v_out || jsonb_build_array(jsonb_build_object(
            'grupo_id', v_gid, 'grupo_nombre', v_gnombre,
            'opcion_id', v_mod.id, 'nombre', coalesce(v_mod.nombre, v_n),
            'precio_extra', case when v_primero then v_precio else 0 end));
          v_primero := false;
        end loop;
        continue;
      end if;
    end if;

    -- ── 2. Qué familia (pedidos sin grupo en el payload) ───────────────────
    v_clave := null; v_sin_estrenar := false;

    if v_hint is not null and v_opts ? public.peya_familia_clave(v_hint) then
      v_clave := public.peya_familia_clave(v_hint);
    end if;

    if v_clave is null and cardinality(v_nombres) > 0 then
      for v_cand in select k from jsonb_object_keys(v_opts) k loop
        select bool_and(to_jsonb(public.peya_norm(x)) <@ (v_opts->v_cand))
          into v_cabe from unnest(v_nombres) x;
        if coalesce(v_cabe, false) then
          if not (v_tocada ? v_cand) then
            v_clave := v_cand; v_sin_estrenar := true; exit;
          end if;
          if v_previa = v_cand then v_clave := v_cand;
          elsif v_clave is null then v_clave := v_cand; end if;
        end if;
      end loop;

      if not v_sin_estrenar
         and v_previa is not null and v_clave is not null and v_clave <> v_previa then
        select bool_and(to_jsonb(public.peya_norm(x)) <@ coalesce(v_opts->v_previa, '[]'::jsonb))
          into v_cabe from unnest(v_nombres) x;
        if coalesce(v_cabe, false) then v_clave := v_previa; end if;
      end if;
    end if;

    if v_clave is null and v_hint is not null then
      v_clave := public.peya_familia_clave(v_hint);
      if not (v_base ? v_clave) then
        v_base := jsonb_set(v_base, array[v_clave], to_jsonb(v_hint), true);
      end if;
    end if;

    if v_clave is null then
      select g.nombre into v_gnombre
        from pos_modificadores m
        join pos_modificadores_grupo g on g.id = m.grupo_id
       where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_nombres[1])
       order by g.nombre limit 1;
      v_gnombre := coalesce(v_gnombre, 'Modificadores');
      v_clave   := public.peya_familia_clave(v_gnombre);
      if not (v_base ? v_clave) then
        v_base := jsonb_set(v_base, array[v_clave], to_jsonb(v_gnombre), true);
      end if;
    end if;

    -- ── 3. Qué unidad ──────────────────────────────────────────────────────
    v_s   := coalesce((v_slot->>v_clave)::int, 1);
    v_usa := coalesce(v_usados->(v_clave || '#' || v_s), '[]'::jsonb);
    if exists (select 1 from unnest(v_nombres) x where to_jsonb(public.peya_norm(x)) <@ v_usa)
       or coalesce((v_cerrado->>(v_clave || '#' || v_s))::boolean, false)
    then
      v_s := v_s + 1;
      v_usa := '[]'::jsonb;
    end if;
    v_slot   := jsonb_set(v_slot, array[v_clave], to_jsonb(v_s), true);
    v_tocada := jsonb_set(v_tocada, array[v_clave], 'true'::jsonb, true);
    v_previa := v_clave;

    v_grupo   := v_fams -> (v_clave || '#' || v_s);
    v_gid     := nullif(v_grupo->>'id', '')::uuid;
    v_gnombre := coalesce(v_grupo->>'nombre',
                   (v_base->>v_clave) || case when v_s > 1 then ' ' || v_s else '' end,
                   'Modificadores');

    -- ── 4. Salen las opciones ──────────────────────────────────────────────
    v_primero := true;
    foreach v_n in array v_nombres loop
      select m.id, btrim(m.nombre) as nombre into v_mod
        from pos_modificadores m
       where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_n)
         and (v_gid is null or m.grupo_id = v_gid)
       limit 1;
      if v_mod.id is null then
        select m.id, btrim(m.nombre) into v_mod from pos_modificadores m
         where m.activo and public.peya_norm(btrim(m.nombre)) = public.peya_norm(v_n)
         limit 1;
      end if;

      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'grupo_id', v_gid, 'grupo_nombre', v_gnombre,
        'opcion_id', v_mod.id, 'nombre', coalesce(v_mod.nombre, v_n),
        'precio_extra', case when v_primero then v_precio else 0 end));
      v_usa := v_usa || to_jsonb(public.peya_norm(v_n));
      v_primero := false;
    end loop;

    if v_es_preset then
      if cardinality(v_nombres) = 0 then v_usa := v_usa || to_jsonb('∅'::text); end if;
      v_cerrado := jsonb_set(v_cerrado, array[v_clave || '#' || v_s], 'true'::jsonb, true);
    end if;

    v_usados := jsonb_set(v_usados, array[v_clave || '#' || v_s], v_usa, true);
  end loop;

  return v_out;
end;
$function$;
