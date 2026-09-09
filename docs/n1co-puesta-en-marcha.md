# Puesta en marcha del pago con tarjeta — paso a paso

Contexto: n1co ya respondió y **desbloqueó todo**. Las credenciales de API **sí
son self-service** desde el portal (la doc decía lo contrario). Además confirmó
que **los tokens multi-uso ya están activos por defecto**, así que la tarjeta
guardada funciona sin pedir nada extra.

El código está listo en `feat/pago-tarjeta-n1co`. Lo que sigue es configuración.

---

## Paso 0 — Contestarle la pregunta a n1co

Preguntaron: *"¿su integración es servidor a servidor, o el checkout corre en el
navegador del comprador?"*. La respuesta honesta es **las dos cosas**, y conviene
que la tengan clara porque de ahí depende qué nos ofrezcan:

> Es mixta. El checkout corre en el navegador del comprador (una PWA), pero el
> navegador **no** habla con la API de n1co: los datos de la tarjeta se envían a
> nuestro propio backend (una función serverless nuestra) y desde ahí llamamos
> `/PaymentMethods` y `/Charges` servidor a servidor. El `clientSecret` nunca
> sale del backend.
>
> Justamente por eso nos interesan los *hosted fields*: hoy el PAN pasa por
> nuestra infraestructura solo porque no hay otra forma de tokenizar. Con campos
> embebidos, la captura ocurriría en su iframe y bajaríamos a SAQ A **sin**
> perder el control de UX ni la tarjeta guardada, que es lo que el checkout
> hospedado no nos permite.
>
> Les confirmamos que **sí** queremos registrar la solicitud de campos
> embebidos como requerimiento de producto. Mientras tanto seguimos con la API
> directa, porque es la única vía que soporta card-on-file.

Ese último párrafo importa: el checkout hospedado baja el alcance PCI, pero
**no permite guardar la tarjeta**, que era el requisito principal. Por eso no se
eligió.

---

## Paso 1 — Crear la llave de sandbox

En el portal de n1co:

1. Barra lateral izquierda → **engranaje** (configuración).
2. **Sandbox → Ir a sandbox.**
3. Confirmá que la tienda muestre la etiqueta **"sandbox"** arriba a la derecha.
   Si no aparece, la llave que generes será de producción.
4. **API → nueva.** Ponele un nombre (ej. `ERP delivery web · sandbox`) y
   **marcá todos los permisos** (es lo que recomienda n1co para sandbox).
5. El modal te da **dos** valores. Guardalos:
   - `clientId` — parece un uuid: `c8573b9a-88ea-…`
   - `clientSecret` — una cadena larga: `kt68Q-e6FS1FNgve…`

> **El `clientSecret` normalmente se muestra una sola vez.** Copialo antes de
> cerrar el modal.

---

## Paso 2 — Los `locationCode` de las sucursales

**Configuración → Sucursales.** La primera columna, **"ID"**, es el
`locationCode`. Anotá el de cada tienda.

Con una sola sucursal alcanza `N1CO_LOCATION_CODE`. Para cobrar cada pedido
contra la tienda que lo despacha, usá `N1CO_LOCATION_CODES` con un JSON que mapee
el `sucursal_id` de nuestra base al ID de n1co:

```json
{"1382bdc6-4349-43af-86e9-1989b9b529de":"123","04bcc11a-affa-44b4-9fec-b90d00639cf3":"124"}
```

Los `sucursal_id` nuestros salen de:

```sql
select id, store_code, nombre from sucursales where activa and tiene_delivery;
```

---

## Paso 3 — Smoke test local (hacelo ANTES de tocar Vercel)

Esto aísla "¿están bien las credenciales?" de "¿está bien el código?". Si falla
acá, no tiene sentido abrir el menú a probar.

```bash
cd ~/Proyectos/freakie-dogs-caja
git checkout feat/pago-tarjeta-n1co

N1CO_CLIENT_ID='...' \
N1CO_CLIENT_SECRET='...' \
N1CO_LOCATION_CODE='...' \
  node scripts/smoke-n1co.mjs
```

Recorre los 4 pasos reales: **token → tokenizar con `singleUse:false` → cobrar
$1.00 → reversar**. Usa una tarjeta de prueba (no mueve dinero) y devuelve el
cobro para no dejar basura en el portal. No imprime el secret.

Si el paso 2 se queja de `singleUse` o multi-use, escribiles: significa que
card-on-file no está activo en la cuenta a pesar de lo que dijeron.
Si el paso 3 falla mencionando *location*, el `locationCode` está mal.

---

## Paso 4 — Cargar las variables en Vercel

Van en **los dos** proyectos que salen de este repo, porque el menú público y el
ERP se despliegan por separado:

- el del ERP (`erp.freakiedogs.com`)
- el del delivery (`pedidos.freakiedogs.com`)

| Variable | Valor para sandbox |
|---|---|
| `N1CO_CLIENT_ID` | el del paso 1 |
| `N1CO_CLIENT_SECRET` | el del paso 1 |
| `N1CO_LOCATION_CODE` | el del paso 2 |
| `N1CO_BASE_URL` | `https://api-sandbox.n1co.shop` |
| `N1CO_AMBIENTE` | `sandbox` |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen en el proyecto del ERP
(las usa `api/dte-proxy.js`). **Verificá que estén también en el del delivery**,
porque sin la service_role key el cobro no puede confirmar el pedido.

> `N1CO_BASE_URL` va **sin** `/api/v3`. La doc de n1co la publica con la versión
> incluida y el código la concatena, así que si la pegás completa quedaría
> duplicada. El código igual la limpia, pero mejor cargarla bien.

Después de cargar variables hay que **redeployar**: en Vercel las env vars se
hornean en el build.

---

## Paso 5 — Webhook (red de seguridad para el dinero)

**Configuración → URL de acceso al webhook.** Registrá:

```
https://pedidos.freakiedogs.com/api/n1co-link/webhook
```

Ahí mismo el portal genera y muestra la **llave secreta** → cargala en Vercel
como `N1CO_WEBHOOK_SECRET`. Esa pantalla también tiene el historial de webhooks
enviados, que es oro para depurar.

n1co confirmó que el encabezado `X-H4B-Hmac-Sha256` viaja en **el 100% de los
eventos**, así que la firma siempre se puede verificar — y el endpoint la
verifica antes de tocar la base. **Sin `N1CO_WEBHOOK_SECRET` el webhook rechaza
todo**, a propósito: un webhook sin firma que marque pedidos como pagados sería
un agujero para comer gratis.

Para qué sirve: si n1co cobra la tarjeta pero nuestra confirmación contra la
base falla en el medio (timeout, corte), el cliente queda cobrado y el pedido
sin marcar. El webhook cierra ese hueco. **Pendiente:** hoy el handler resuelve
órdenes de CheckoutLink; extenderlo a los cobros de EPay es el próximo paso de
endurecimiento (ver `api/n1co-link.js`).

---

## Paso 6 — Probar desde el menú

Entrá a `pedidos.freakiedogs.com/menu`, armá un pedido y elegí **💳 Tarjeta**.

| Escenario | Visa | Mastercard |
|---|---|---|
| Aprueba, sin 3DS | `4000056655665556` | `5267260000000001` |
| Rechaza, sin 3DS | `4242424242424242` | `5555555555554444` |
| 3DS que aprueba | `4000000000001000` | `5200000000001005` |
| 3DS que rechaza | `4000000000001013` | `5200000000001018` |

CVV cualquiera, vencimiento cualquier fecha futura. Las Visa son de emisor USA,
así que la app va a pedir el código postal — es el camino `requiere_billing` y es
correcto que aparezca.

**La prueba que importa de verdad** (es el requisito de Jose):

1. Pagá con `4000056655665556` **dejando marcado** "Guardar mi tarjeta".
2. Hacé un **segundo** pedido con el mismo teléfono/navegador.
3. Al elegir tarjeta tiene que aparecer **"Visa ····5556 · Pagar $X"** y cobrarse
   de un toque, sin escribir nada.

Qué mirar del lado de la base:

```sql
select estado, metodo, monto, marca, last4, authorization_code, error_code, intento
  from pagos_online order by created_at desc limit 10;

select marca, last4, vence_mes, vence_anio, ultimo_uso
  from tarjetas_guardadas order by created_at desc limit 5;
```

Un cobro aprobado deja el pedido con `cobrado=true`, `estado='preparando'` y
`pos_cuenta_id` (ya entró al KDS). En la torre aparece el sello
`💳 PAGADO ONLINE · NO COBRAR`.

---

## Paso 7 — Pasar a producción

1. En el portal, **desactivá el modo sandbox** de la tienda.
2. Generá una llave nueva (Configuración → API → nueva). **La de sandbox no
   sirve en producción.**
3. Volvé a sacar los `locationCode`: verificá que sean los mismos.
4. Corré el smoke test contra producción — con `amount: 1.0` y el reverso
   automático, es ~$1 que vuelve.
   ```bash
   N1CO_BASE_URL=https://api.n1co.com N1CO_CLIENT_ID=... N1CO_CLIENT_SECRET=... \
   N1CO_LOCATION_CODE=... node scripts/smoke-n1co.mjs
   ```
5. En Vercel: `N1CO_BASE_URL=https://api.n1co.com` y
   `N1CO_AMBIENTE=produccion`. Redeploy.
6. Registrá el webhook de producción (el del portal en modo producción es otro).

`N1CO_AMBIENTE` no es cosmético: queda grabado en cada fila de `pagos_online`.
Si se olvida, los cobros reales quedan registrados como sandbox y la
conciliación miente.

---

## Antes de abrirlo a clientes reales

- **Estrenar la tarjeta guardada ya en `pedidos.freakiedogs.com`.**
  `localStorage` es por origen: si se lanza en `freakiedelivery.vercel.app` y
  después se muda, todas las tarjetas guardadas quedan huérfanas y cada cliente
  tiene que reingresarla. Como el dominio ya está en producción, esto se cumple
  solo — pero hay que confirmar que `VITE_URL_DELIVERY` apunte al dominio nuevo
  antes de habilitar el pago.
- Avisarle a **Karina y a los motoristas** qué cambia: los pedidos pagados
  llegan con el sello verde y **no se les cobra nada** en la puerta.
- Revisar `pagos_online` los primeros días buscando `estado='error'`: es donde
  aparecen los problemas de configuración (`SIN_LOCATION_CODE`,
  `REQUIERE_BILLING`).
