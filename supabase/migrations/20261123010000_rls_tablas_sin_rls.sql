-- W0-12 del plan de ejecución. 29 tablas de public no tenían RLS.
-- Se activa RLS y se deja UNA política por tabla que conserva exactamente los accesos de hoy:
--   · roles internos erp_finanzas_ro y francisco_freakies (ya tenían permisos y no saltan RLS)
--   · anon / authenticated solo en las 3 tablas donde ya tenían permiso otorgado
-- No cambia qué puede leer o escribir nadie hoy; evita que un permiso futuro abra la tabla entera.
do $$
declare
  r record;
  v_roles text;
begin
  for r in
    select t.tablename
    from pg_tables t
    where t.schemaname = 'public' and not t.rowsecurity
  loop
    select string_agg(distinct quote_ident(g.grantee), ', ')
      into v_roles
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = r.tablename
      and g.grantee in ('erp_finanzas_ro', 'francisco_freakies', 'anon', 'authenticated');

    execute format('alter table public.%I enable row level security', r.tablename);
    if v_roles is not null then
      execute format('drop policy if exists acceso_previo_a_rls on public.%I', r.tablename);
      execute format('create policy acceso_previo_a_rls on public.%I for all to %s using (true) with check (true)',
                     r.tablename, v_roles);
    end if;
  end loop;
end $$;
