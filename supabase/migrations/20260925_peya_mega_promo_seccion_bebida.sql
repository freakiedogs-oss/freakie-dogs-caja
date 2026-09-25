-- 25-sep-2026 (OK Frank, YA APLICADA) · PeYa «Mega Promo» (2 hot dogs + 2 papas + 2 bebidas)
-- no tenía sección de bebida: no descargaba las 2 bebidas ni dejaba el cambio de bebida.
-- Queda como Combo Duo: Hot Dog ×2, Fries ×2, Bebida ×2 (componentes sin producto; la
-- receta del padre no cambia). Respaldo de los grupos del padre en _bk_peya_mega_promo_grupos_25sep.
do $$
declare
  p        constant uuid := '518b7cdf-5eab-459f-b097-5e7ec12813b0';
  c_hotdog constant uuid := '3764ae85-c6c6-4d06-b99d-5595aa1f56be';
  c_fries  constant uuid := 'c9d28c94-3eb0-4894-a55e-34d4c5ec7c6f';
  c_beb    constant uuid := '76662c38-a01e-402c-962b-150b80ad9c9e';
begin
  if exists (select 1 from pos_combo_componentes where combo_item_id = p) then
    raise exception 'Mega Promo ya tiene componentes: no se aplica dos veces';
  end if;
  create table if not exists _bk_peya_mega_promo_grupos_25sep as
    select * from pos_item_modificadores where menu_item_id = p;
  alter table _bk_peya_mega_promo_grupos_25sep enable row level security;
  revoke all on _bk_peya_mega_promo_grupos_25sep from anon, authenticated;
  insert into pos_combo_componentes (combo_item_id, componente_item_id, cantidad, orden) values
    (p, c_hotdog, 1, 1), (p, c_hotdog, 1, 2), (p, c_fries, 1, 3), (p, c_fries, 1, 4), (p, c_beb, 1, 5), (p, c_beb, 1, 6);
  delete from pos_item_modificadores where menu_item_id = p;
end $$;
