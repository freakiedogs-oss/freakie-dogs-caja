---
name: menu-publico-flujo
description: Cómo funciona el menú digital público / app de delivery de Freakie Dogs. Reglas de negocio del checkout y despacho.
metadata:
  node_type: memory
  type: project
---

**Menú público único.** Todos los clientes entran al mismo link. Un solo catálogo unificado — el cliente NO elige sucursal.

**Zonas de cobertura del delivery propio:** Usulután, Soyapango, Lourdes, Santa Tecla, San Salvador (5 zonas).

**Flujo del cliente:**

1. Entra al link → ve catálogo (mismo para todas las zonas)
2. Agrega al carrito
3. En checkout elige pickup o delivery
4. Si delivery, ingresa dirección
5. Envía pedido

**Flujo interno:**

- El equipo (despacho) recibe el pedido y **asigna manualmente** la sucursal que despacha, según ubicación del cliente
- No es automático — decisión del despachador
- Cliente en Usulután → despacho desde Usulután. Cliente en Soyapango → despacho desde M001/S001 según proximidad

**Regla de UX crítica:** el menú nuevo debe replicar **EXACTO** el layout, orden, fotos, descripciones y dimensiones del anterior (BuhoPay). Los clientes llevan años usándolo — cambios abruptos = mala experiencia. Mejorar poco a poco, no de golpe.

**Why:** conservar familiaridad para no perder conversión durante el cutover de BuhoPay → app propia.

**How to apply:** al tocar el menú digital PWA, priorizar fidelidad visual sobre "modernización". Mismos colores rojos, mismas cards, mismo orden de categorías (Combos de Temporada → Freakie Burger → Individuales → Combos → Bebidas), mismos textos incluyendo emojis y typos ("Combpleto").

**Catálogo original a replicar:** 48 productos, 5 categorías. Ver [[proyecto-buhopay-reemplazo]].
