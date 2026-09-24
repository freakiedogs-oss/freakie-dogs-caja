-- 24-sep-2026 · Simulación del ingreso manual de La Constancia: dos entregas sin
-- N° de factura en el mismo segundo generaban el mismo código automático
-- (ENTREGA-<suc>-<fecha-hora>) y chocaban con el UNIQUE de compras_bees.id_factura.
-- Se agrega un sufijo aleatorio de 4 caracteres. (Aplicada como
-- `bees_entrega_id_factura_unico_24sep`.)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.bees_registrar_entrega(uuid,uuid,jsonb,text,text,numeric,text,text,boolean)'::regprocedure);
  d := replace(d, $x$to_char(now() at time zone 'America/El_Salvador', 'YYMMDD-HH24MISS')),$x$,
                  $x$to_char(now() at time zone 'America/El_Salvador', 'YYMMDD-HH24MISS') || '-' ||
             upper(substr(md5(gen_random_uuid()::text), 1, 4))),$x$);
  if position('md5(gen_random_uuid()' in d) = 0 then raise exception 'no se aplicó el reemplazo'; end if;
  execute d;
end $$;
