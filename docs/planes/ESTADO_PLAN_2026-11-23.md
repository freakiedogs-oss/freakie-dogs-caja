# Estado del plan de ejecución — corte 22-Nov-2026 (noche)

Seguimiento de `PLAN_EJECUCION_2026-11-10.md`. Todo se volvió a medir contra el repo (`main` en `cb8ca8e`), la base, las Edge Functions y Make.

## Lo más importante

1. **La rama `claude/eager-brown-tuyddo` no se ha fusionado a `main`.** Los arreglos de código del 11-Nov (POS, proxies, finanzas, limpieza de PINs) no están en producción. La rama ya incluye `main` al día, compila y pasan las pruebas offline.
2. **Los cambios de base del 11-Nov aguantaron:** 0 cron fallando en 7 días, la bitácora del proxy DTE escribe (683 filas en 24 h), el archivado de cocina ya movió 58,240 filas, y `dte-service` rechaza llaves inventadas.
3. **Otras conversaciones cerraron cosas del plan:** banco, socios y cuentas de terceros pasan por el gate de sesión (PR #471 y #472; `anon` ya no tiene permisos sobre `bank_*`), la consulta de recepción con OC ya está en `main`, y KWA volvió a emitir DTE (0 rechazos en 24 h).
4. **Sigue abierto y es grave:** la `service_role` sigue en Make (los 2 escenarios siguen activos y sin editar desde marzo), `bulk-sql-kaeru` sigue desplegada, `ai-gateway` y `ai-query` siguen sin autenticación, y Kaeru reintenta ahora 5 ventas (1,440 rechazos al día; Kako 288).

## Indicadores

| Indicador | 10-Nov | 22-Nov | Meta 30 días |
|---|---|---|---|
| Funciones privilegiadas ejecutables sin sesión (Freakie) | 564 | **611** (sube: cada función nueva nace abierta) | 564 |
| Políticas `USING(true)` para `anon` | 392 | 392 | 300 |
| Tablas sin RLS en `public` | 29 | **0** | 0 |
| Tablas con permiso de escritura para `anon` (INSERT) | 135 | 126 | — |
| Edge Functions fuera del repo | 50 de 54 | 52 de 56 | 0 |
| Pedidos web con tarjeta sin DTE | 99% | 99% (354 de 355) — regularizados por el contador según Jose | < 1% |
| Cobros 3DS completados | 22% | 32% (17 de 53) | > 60% |
| Rechazos de DTE al día (todas las empresas) | ~5,400 | 1,728 (Kaeru 1,440 · Kako 288 · KWA 0) | < 20 |
| Cron fallando | 2 | **0** | 0 |
| Errores por `delivery_traslados` | ~19,500 al día | sigue (ver decisión 2) | < 500 |
| Inventario en negativo | 632 | 681 | 400 |
| Egresos de caja sin foto | 60% | 60% (203 de 341) | < 10% |
| Pedidos de delivery de más de 60 min | 38% | 33% (mediana 49 min) | 30% |
| Ticket de para llevar | $10.62 | $10.49 | $10.90 |
| PINs de 4 dígitos | 157 | 166 | — |
| Bitácora `pos_operaciones_log` | 0 filas | 0 filas | con datos |

## Estado por paquete

### Ola 0

| ID | Paquete | Estado |
|---|---|---|
| W0-01 | Rotar `service_role` | **Pendiente (Jose).** Solo desde el panel de Supabase |
| W0-02 | Apagar Make | Pendiente. Depende de W0-01 para que tenga sentido |
| W0-03 | Borrar `bulk-sql-kaeru` y `dte-service-v2` | **Pendiente (Jose, es de Kaeru).** Siguen activas |
| W0-04 | Autenticación de `dte-service` | **Hecho en producción** (llaves inválidas). Falta el aislamiento entre empresas: requiere redesplegar |
| W0-05 | Bucles de reintento DTE | KWA resuelto. **Kaeru y Kako pendientes (Jose)**; Kaeru empeoró |
| W0-06 | Cerrar `ai-gateway` y `ai-query` | Pendiente. La parte de Freakie la puedo hacer |
| W0-07 | `kaeru-pin-setup` / `kako-pin-setup` | Pendiente (Jose) |
| W0-08 | Adivinanza de PIN en proxies | **En la rama, sin fusionar.** La tabla del limitador ya existe |
| W0-09 | PINs fuera de los documentos | **En la rama, sin fusionar.** Rotación pendiente (Jose) |
| W0-10 | Salto de ruta en `supaproxy` | **En la rama, sin fusionar** |
| W0-11 | Quitar páginas expuestas | Tableros y `proxy_dgii.py` en la rama. Falta poner secreto a las funciones de ingesta |
| W0-12 | RLS en tablas sin RLS | **Hecho en producción** (22-Nov). Respaldos `bak_*` sin borrar |
| W0-13 | Eatalia | Pendiente (Jose) |

### Ola 1

| ID | Paquete | Estado |
|---|---|---|
| W1-01 a W1-03 | POS: confirmación falsa, revivir cuenta, cola de cocina, KDS | **En la rama, sin fusionar** |
| W1-04 | "Liberar mesa" con autorización | Pendiente |
| W1-05 | Bitácora del POS | Mitad hecha: el proxy DTE ya registra. `pos_operaciones_log` sigue vacía |
| W1-06 | DTE de pedidos web con tarjeta | En pausa: Jose indicó que el contador los regulariza. Sigue sin emitirse en línea |
| W1-07 | 3DS e idempotencia del pago web | Pendiente. La tasa subió sola de 22% a 32% |
| W1-08 | App de motoristas con sesión | Pendiente. Hubo mucho trabajo en la app (v12, ruta fija) pero las RPC siguen abiertas a `anon` |
| W1-09 | Privacidad del cliente web | Pendiente |
| W1-10 | Recepción con OC | **Hecho** (ya en `main` por otra vía; el bloqueo de ítems sin producto va en la rama) |
| W1-11 | Finanzas: números que engañan | Llave por canal y banner en la rama. Pestaña Balance pendiente |
| W1-12 | Cron y rendimiento | Cron: **hecho**. `fn_agrandados_panel`: **hecho en producción** (22-Nov, copia que se refresca cada minuto). `delivery_traslados`: decisión 2 |
| W1-13 | CI obligatorio | Pendiente |
| W1-14 | Dependencias y limpieza | Pendiente (parte de la limpieza va en la rama) |
| W1-15 | Cabeceras y firewall de Vercel | Pendiente |
| W1-16 | Monitoreo de errores | Pendiente |
| W1-17 | Buckets privados | Pendiente. Los 5 siguen públicos |

### Ola 2 y 3

Sin empezar, salvo W2-01 parcial: banco, socios y cuentas de terceros ya usan sesión en servidor (PR #471, #472). Queda `PagosProveedorView` y el resto de dominios.

## Superficie nueva desde el 10-Nov

- **WhatsApp (`api/wa.js`, Kapso, respuestas con Claude):** revisado. El webhook verifica firma HMAC y el envío interno pide secreto; las llaves viven en `app_secretos` (sin políticas, solo `service_role`). Bien hecho.
- **4 Edge Functions nuevas de KWA** (`kwa-reservas-sitio`, `kwa-web-reservas`), fuera del repo.
- 47 funciones privilegiadas nuevas abiertas a `anon`: por defecto toda función nueva queda ejecutable sin sesión. Conviene cambiar el permiso por defecto (decisión 3).

## Decisiones que necesito

1. **Fusionar la rama.** Antes, probar en tablet: cobrar con la caja cerrada, doble toque en Confirmar, comandar una mesa ya cobrada desde otra tablet, KDS sin wifi.
2. **`delivery_traslados`:** el KDS tiene una función que avisa a cocina cuando un pedido se traslada a otra sucursal ("¿ya lo preparaste?"), pero nunca funcionó porque falta el permiso de lectura. Hay 63 traslados sin responder desde el 16-Sep. Si doy el permiso tal cual, las cocinas verían esos 63 avisos viejos. Opciones: (a) activar mostrando solo los de las últimas 3 horas y marcar los viejos como no preparados; (b) quitar la consulta del KDS.
3. **Permiso por defecto de funciones nuevas:** quitarle a `anon` la ejecución automática (cada función nueva tendría que otorgarlo explícitamente). Frena el crecimiento de 564 → 611, pero quien cree una RPC para el menú público o el login debe acordarse de dar el permiso.
