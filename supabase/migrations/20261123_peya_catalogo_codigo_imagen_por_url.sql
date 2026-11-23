-- PeYa: el código de cada imagen del catálogo cambia cuando cambia la foto.
--
-- 23-nov-2026, tienda piloto SV-FREAKIE-DOGS-0001. Tres productos (Combo Fancy
-- Dúo, Freakie Chilli, Fancy fries) fallaban en cada import con «Errors when
-- creating images» aunque la URL nueva era válida (las mismas fotos que usa
-- PedidosYa en Metro Centro). El código de imagen era fijo por producto
-- (`IMG-<item>`) y esos códigos ya existían en DataFridge con una foto vieja que
-- había fallado: PedidosYa no reemplaza la imagen de un código existente.
--
-- Ahora el código es `IMG-<item>-<8 hex del md5 de la URL>`: misma foto, mismo
-- código (no se re-sube); foto nueva, código nuevo. Se reescribe la función
-- vigente reemplazando las 4 apariciones del código (clave e id, en el
-- producto y en el ítem Image), sin tocar el resto de su cuerpo.

do $$
declare
  v_def text := pg_get_functiondef('public.peya_catalogo(uuid,boolean)'::regprocedure);
begin
  if position('md5(btrim(i.imagen_url))' in v_def) = 0 then
    v_def := replace(v_def, '''IMG-'' || i.id',
                     '''IMG-'' || i.id || ''-'' || left(md5(btrim(i.imagen_url)), 8)');
    execute v_def;
  end if;
end $$;
