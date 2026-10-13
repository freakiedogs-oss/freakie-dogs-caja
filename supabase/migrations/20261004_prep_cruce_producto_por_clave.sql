-- Aplicada vía MCP el 4-oct-2026. Ver memoria.md («Turno de Casa Matriz» + bug del cruce).
-- etiqueta_impresiones.producto_id guarda la CLAVE; estas funciones cruzaban por uuid.
do $$
declare f text; def text; nuevo text;
begin
  foreach f in array array['fn_prep_pendientes_detalle(uuid)',
                           'fn_prep_lote_guardar(uuid,uuid,jsonb,jsonb,boolean)'] loop
    def := pg_get_functiondef(('public.' || f)::regprocedure);
    nuevo := replace(def, 'on p.id::text = e.producto_id',
                          'on (p.id::text = e.producto_id or p.clave = e.producto_id)');
    if nuevo = def then
      raise exception 'No encontré el cruce a reemplazar en %', f;
    end if;
    execute nuevo;
  end loop;
end $$;
