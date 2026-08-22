---
name: proyecto-buhopay-reemplazo
description: Estado y contexto del reemplazo de BuhoPay por app de delivery propio (Fase 8 roadmap Freakie Dogs). Deadline sábado con empresa externa saliente.
metadata:
  node_type: memory
  type: project
---

**Empresa saliente:** BuhoPay (URL: https://menu.buhopay.com/) — proveedor externo que hospedaba la app de menú digital + delivery de Freakie Dogs.

**Deadline crítico:** Sábado (semana del 27-jul-2026). Ese día es el último día laboral de la empresa BuhoPay para Freakie Dogs.

**Why:** el módulo de delivery propio + menú digital debe estar operativo antes que corten el servicio de BuhoPay, sino Freakie Dogs queda sin canal de venta digital directo (solo quedaría PeYa/Delivery Hero como delivery externo).

**How to apply:** cuando se hable de la app de delivery, la integración BUHO, la app de domicilio o el módulo delivery propio, el contexto es este reemplazo urgente.

## Estado (a 30-jul-2026)

**BD (Supabase):** 6 tablas creadas — `delivery_clientes`, `viajes_delivery`, `despacho_motoristas`, `bonos_delivery_mensual`, `metas_delivery`, `config_delivery`. Vistas: `v_delivery_dia`, `v_delivery_hero_prorrateado`.

**Config bonos ya cargado:** km_umbral_doble=17, tarifa_entrega_normal=$0.50, tarifa_entrega_larga=$1.00, tarifa_fuera_horario=$3.00 (flat, reemplaza distancia), tarifa_mandado=$0.50.

**Frontend hecho:**

- `src/components/delivery/DeliveryView.jsx` — tabs de Despacho / Viajes / Bonos
- Cargos motoristas: 'Motorista', 'Domicilio', 'Motorista Interno', 'Domicilios Propios'
- Funciones `calcTarifa` y `bonoDriver` implementadas
- KPI Delivery Propio dashboard — lee de `quanto_ordenes` con `canal_venta=delivery_propio`
- KPI Despacho Motoristas — despacho con GPS llegada/salida

**Vínculo POS ↔ Delivery:** `delivery_clientes.pos_cuenta_id` UUID que apunta a `pos_cuentas` con `tipo=delivery_app`.

## Referencias

- Notion Módulos ERP: Módulo #10 (Menú Digital) + #11 (Delivery Propio) + #16 (Bonos Delivery)
- Repo: `src/components/delivery/DeliveryView.jsx` y tablas Supabase `delivery_*`

> Nota: esta nota es del 30-jul-2026. Verificá el estado actual contra el CHANGELOG antes de darla por vigente.
