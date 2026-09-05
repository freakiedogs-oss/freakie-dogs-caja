# Auditoría de dobles cobros y DTEs duplicados — 05-Sep-2026

Origen: descuadre del corte del 4-sep en Usulután (S002) reportado por Rigo, y el
mismo síntoma reportado por Wendy en Lourdes (S003). Causa raíz y fixes en
`memoria.md` (entrada del 05-Sep-2026) y en el commit `b82279f`.

**Ventana auditada:** 1-jul-2026 → 5-sep-2026. Criterio: cuentas de `pos_cuentas`
con 2 o más filas en `pos_cuenta_pagos` cuya suma supera el total de la cuenta.

## Resumen

| Grupo | Cuentas | Exceso cobrado | Acción |
|---|---:|---:|---|
| **B** · Par de DTE identificado, ambos aceptados | **21** | **$335.51** | **Invalidar el 2º DTE** |
| C · Par ya invalidado antes de esta auditoría | 2 | $19.24 | Resuelto |
| D/E · Match no 1:1 con los DTE | 9 | $138.08 | Revisar caso por caso |
| A · PedidosYa (no emite DTE) | 3 | $20.48 | Solo corrección interna |
| **Total** | **35** | **$513.31** | |

IVA sobredeclarado por el grupo B: **$38.60** (335.51 ÷ 1.13 × 0.13).

Reparto por sucursal del total: S003 Lourdes ~$208 · S006 Metro Centro ~$176 ·
S002 Usulután ~$85 · resto ~$44.

## Grupo B — invalidar el 2º DTE (21 documentos)

Todas son **Factura de consumidor final (tipo 01)**. Hacienda **no acepta Nota de
Crédito** sobre este tipo: la única corrección es la **invalidación**. Tipo de
anulación que corresponde: **2 — rescindir la operación** (la segunda venta nunca
existió; el documento correcto es el primero, que se deja vivo).

Motivo sugerido: `Documento duplicado por doble registro del POS. La operación se
facturó en el DTE <numeroControl del 1º>. No hubo segunda venta.`

| # | Suc | Fecha y hora (SV) | Monto | Nº Control a invalidar | Código de generación |
|---|---|---|---:|---|---|
| 1 | S001 | 08-02 20:33:55 | $3.50 | DTE-01-S001P001-001785724435977 | D8BC0E62-2539-4610-AA62-AF287491B82B |
| 2 | S001 | 09-04 15:45:41 | $0.50 | DTE-01-S001P001-001788558341739 | 7C861D6A-7EA4-4873-A2C8-BE24E1AA7B4E |
| 3 | S002 | 07-29 12:30:04 | $3.50 | DTE-01-S002P001-001785349804708 | 16BF3F39-ED37-4BB5-8875-F894EF2F9682 |
| 4 | S002 | 08-05 12:55:22 | $19.50 | DTE-01-S002P001-001785956122692 | C4B5DB58-31A5-4A35-AFC0-10478AA855BA |
| 5 | S002 | 08-17 15:28:07 | $0.50 | DTE-01-S002P001-001787002087314 | 03075162-8DA4-4D7D-9EA2-9588B421A278 |
| 6 | S002 | 08-31 11:50:09 | $2.00 | DTE-01-S002P001-001788198609748 | 42CCFB9A-5100-4275-9DD2-BFA053175778 |
| 7 | S002 | 09-04 17:05:51 | $18.99 | DTE-01-S002P001-001788563151870 | 2BE1D5FA-90CD-43CF-9B0B-2FAD074CF86B |
| 8 | S002 | 09-04 22:34:35 | $19.49 | DTE-01-S002P001-001788582875898 | 49D38843-CB34-403B-BBC2-04B873F0D50A |
| 9 | S003 | 08-09 15:03:53 | $19.99 | DTE-01-S003P001-001786309433903 | 1F507B10-5B42-4768-87F8-8D99A001F4AF |
| 10 | S003 | 08-20 19:43:07 | $61.04 | DTE-01-S003P001-001787276587921 | 3913983F-1E52-4AD7-ACB1-53835339884A |
| 11 | S003 | 08-24 18:48:12 | $32.99 | DTE-01-S003P001-001787618892922 | C930FF00-B047-4B16-9911-13C14417B773 |
| 12 | S003 | 08-27 20:50:51 | $20.49 | DTE-01-S003P001-001787885451911 | 60D95518-CE38-4D15-9A23-C38686C1BD19 |
| 13 | S003 | 08-30 19:54:34 | $31.60 | DTE-01-S003P001-001788141274006 | 870F763E-CC6D-4139-977C-1ED051364AFE |
| 14 | S003 | 09-01 12:41:45 | $16.49 | DTE-01-S003P001-001788288105510 | 8515F7E9-C8B6-45BC-AF2B-F821E1F94C30 |
| 15 | S006 | 07-21 17:25:10 | $15.49 | DTE-01-S006P001-001784676310392 | 1181291C-3E17-4B82-8EFA-14A665C76BEA |
| 16 | S006 | 07-26 14:49:57 | $3.99 | DTE-01-S006P001-001785098997520 | FD70132A-2762-4874-AE6C-2A7A3216DE1E |
| 17 | S006 | 08-07 11:15:37 | $14.99 | DTE-01-S006P001-001786122937837 | EFA04837-F9C5-4ECC-AD2D-FCD2DE929082 |
| 18 | S006 | 08-07 11:19:57 | $15.99 | DTE-01-S006P001-001786123197850 | FBF51CA2-F306-4CFC-88AC-FB3FEF78E078 |
| 19 | S006 | 08-12 13:39:01 | $14.99 | DTE-01-S006P001-001786563541468 | A44278C3-280D-4A03-82DC-921E13F8A84D |
| 20 | S006 | 09-01 17:09:38 | $7.98 | DTE-01-S006P001-001788304178508 | 47774B89-7A25-48FC-A920-62468DEBA78D |
| 21 | S006 | 09-04 13:08:33 | $11.50 | DTE-01-S006P001-001788548913412 | E29E852D-C2DD-4909-9FA6-51294858FAAD |

> **Verificar el plazo de invalidación antes de transmitir.** Los documentos van de
> julio a septiembre; los más viejos pueden estar fuera del plazo que admite
> Hacienda. Hacienda rechaza los que no proceden, así que el intento es informativo
> — pero conviene confirmarlo con el contador antes de correr los 21.

**Cómo se ejecuta:** ERP → Finanzas → **DTEs emitidos** → botón **⚠️ Duplicados**.
Ese filtro lista exactamente estos 21 (ignora el rango de fechas), cada fila indica
cuál es la factura buena que se deja viva, y *Corregir → Invalidar* abre con el
motivo ya redactado y tipo de anulación 2. Requiere PIN y rol ejecutivo /
superadmin / admin. Es **irreversible** y queda registrada en Hacienda.

La lista sale de la vista `v_dte_duplicados_pendientes`, que la recalcula en vivo:
a medida que se invaliden van desapareciendo del filtro, y si el problema
reapareciera en el futuro se vería solo. Va cerrada a la llave pública y detrás del
gate de finanzas, igual que `v_dtes_emitidos`.

## Grupo C — ya invalidados (sin acción)

| Suc | Fecha | Monto | Nº Control |
|---|---|---:|---|
| S002 | 07-30 13:04:16 | $2.75 | DTE-01-S002P001-001785438256549 |
| S006 | 08-08 13:56:05 | $16.49 | DTE-01-S006P001-001786218965730 |

## Grupos D/E — revisar caso por caso (9 cuentas, $138.08)

El cruce automático no dio exactamente 2 DTE en la ventana (hay 1, 3 o 5
candidatos del mismo monto), así que hay que mirarlos a mano antes de invalidar
nada. Varios tienen exceso que **no** es el doble exacto del total, señal de que
el segundo cobro fue por un monto distinto (cuenta editada entre ambos cobros).

| Suc | Primer cobro | Segundo | Método | Total | Pagado | Exceso | DTE candidatos | cuenta_id |
|---|---|---|---|---:|---:|---:|---:|---|
| S006 | 07-17 13:53:11 | 13:53:19 | efectivo | $16.49 | $32.98 | $16.49 | 3 | c2c60d77-14b3-49a7-871e-bded94a7457e |
| S006 | 08-02 15:47:37 | 15:48:49 | efectivo | $16.24 | $28.48 | $12.24 | 1 | 2fa90029-be98-4d1e-a33a-050d1340d9d1 |
| S006 | 08-07 11:53:32 | 11:54:33 | tarjeta | $14.99 | $29.98 | $14.99 | 5 | c7fa16d8-13d0-48ed-93d4-cb9bce7d9e78 |
| S002 | 08-09 14:18:38 | 15:44:54 | efectivo | $1.99 | $9.49 | $7.50 | 1 | 225b6639-c52f-45ee-95f3-816775c24144 |
| S003 | 08-11 13:33:30 | 16:40:45 | tarjeta | $20.35 | $40.70 | $20.35 | 3 | 37f4add3-8968-4f0a-b371-e190fa589c2f |
| S004 | 08-19 20:16:59 | 20:35:59 | efectivo | $27.23 | $52.53 | $25.30 | 1 | cbc5a697-6d03-4d25-a0db-9893550ad43e |
| S006 | 08-20 11:22:23 | 11:24:04 | efectivo | $20.98 | $41.96 | $20.98 | 3 | b88abfcd-c722-4cdf-b0ee-6208519d051e |
| M001 | 08-28 13:52:04 | 14:11:20 | efec+tarj | $7.49 | $26.72 | $19.23 | 1 | 369f202e-43a4-4f9f-ab28-501c77c37075 |
| S002 | 08-30 16:09:21 | 16:10:30 | efectivo | $8.25 | $9.25 | $1.00 | 1 | 85ae8fbd-479d-4715-bfb8-d22d12835f34 |

## Grupo A — PedidosYa (3 cuentas, $20.48)

No emiten DTE, así que no hay nada que invalidar en Hacienda. Solo queda la
corrección interna del pago duplicado.

| Suc | Primer cobro | Segundo | Total | Pagado | cuenta_id |
|---|---|---|---:|---:|---|
| S003 | 08-30 19:07:01 | 19:07:10 | $5.50 | $11.00 | 5bc1c159-194e-4519-9f93-9f845d8b1029 |
| M001 | 09-01 15:01:32 | 15:01:55 | $4.99 | $9.98 | 648668b1-f98c-4a7a-b78a-cf1ba08ddb82 |
| S006 | 09-02 18:49:49 | 18:53:55 | $9.99 | $19.98 | e5e2cb93-2040-4e98-945a-65f1f406ae1c |

## Pagos duplicados en la base — hecho (marcados, no borrados)

`pos_cuenta_pagos` tiene ahora `anulado` / `anulado_motivo` / `anulado_at` /
`anulado_por`. Se marcaron **33 filas por $499.76**; la evidencia queda y es
reversible con un UPDATE.

Dejaron de sumarse en `pos_corte` (la RPC del cierre de caja), `v_pos_ventas_diario`,
`v_pos_ventas_diario_sin_peya` y `v_canal_ingreso_diario`.

Verificación con el corte del 4-sep en Usulután, recalculado después de marcar:

| | Antes | Ahora | Contraste |
|---|---:|---:|---|
| Tarjeta | $279.04 | **$259.55** | = voucher N1CO (18 ventas) |
| Efectivo | $316.19 | **$297.20** | −65.60 de egresos = $231.60 vs $235.49 contados |
| Total | $556.75 | $556.75 | ya estaba bien |

> Los turnos ya cerrados guardan `sistema_efectivo` / `sistema_tarjeta` como
> snapshot en `pos_turnos`: **no cambian**. Esto corrige los reportes que
> recalculan en vivo y todos los cortes de aquí en adelante.

**No se marcaron 2 de las 35**, a propósito: en ellas el pago que coincide con el
total de la cuenta es el segundo, no el primero, así que cuál sobra no es obvio y
adivinar cambiaría el desglose por método. Son las dos que ya estaban en el grupo D:
`225b6639…` (S002 08-09, total $1.99 con pagos de $7.50 y $1.99) y `369f202e…`
(M001 08-28, total $7.49 con efectivo $19.23 y tarjeta $7.49).

## Hallazgo aparte: 5 cuentas con total $0.00 y un pago registrado

Salieron al verificar lo anterior. Es un problema **distinto** al doble cobro —
un solo pago, pero la cuenta quedó en total $0 (4 de ellas además `cancelada`).
No se tocaron.

| Suc | Fecha | Estado cuenta | Pago registrado |
|---|---|---|---:|
| S001 | 07-28 12:04 | cobrada | $1.75 |
| S001 | 07-28 12:04 | cancelada | $1.75 |
| S002 | 08-08 13:59 | cancelada | $1.75 |
| S002 | 08-09 19:47 | cancelada | $7.99 (PedidosYa) |
| S001 | 08-30 12:47 | cancelada | $14.99 |
