# Solicitud de credenciales a n1co — mensaje listo para enviar

Contexto: la integración (branch `feat/pago-tarjeta-n1co`) está construida contra
la **Integration API v3 (EPay)**, que es la única vía que soporta **tarjeta
guardada** (`singleUse: false`). Sus credenciales no salen del portal: la doc
dice explícitamente *"The n1co team will provide the necessary credentials"*.

El punto **2** es el que no se puede negociar: sin tokens multi-uso, el cliente
teclea la tarjeta en cada compra y se pierde todo el objetivo de bajar la
fricción.

---

## Mensaje

> Buen día 👋 Les escribo de **Freakie Dogs** (comercio: `____`, NIT `____`).
>
> Estamos integrando pagos con tarjeta en nuestra app de pedidos a domicilio. El
> desarrollo ya está listo contra la **Integration API v3 (EPay)** y nos falta
> que nos habiliten lo siguiente:
>
> **1. Credenciales de API.** `clientId` y `clientSecret` para
> `POST /api/v3/Token`, en **sandbox** y en **producción**. En el portal no las
> encontramos y su documentación indica que las entrega el equipo de n1co.
>
> **2. Tokens multi-uso / tarjeta guardada.** Necesitamos tokenizar con
> `card.singleUse: false` en `/api/v3/PaymentMethods` y después cobrar con ese
> `cardId` en compras posteriores, para que el cliente no reingrese la tarjeta
> cada vez. ¿Está habilitado para nuestro comercio? ¿El adquirente pide algún
> requisito extra para *card-on-file*?
>
> **3. `locationCode`.** El código de cada una de nuestras 6 sucursales, que es
> campo requerido en `/api/v3/Charges`.
>
> **4. URL de producción.** Confirmarnos que es `https://api.n1co.com`. En la
> documentación solo está publicada la de sandbox.
>
> **5. Webhooks de EPay.** Su doc explica el webhook firmado con
> `X-H4B-Hmac-Sha256` para CheckoutLink. ¿Aplica igual para los cobros de EPay?
> ¿Cómo registramos la URL y obtenemos la llave secreta?
>
> **6. Consulta técnica.** ¿Tienen *hosted fields* o algún SDK de tokenización
> desde el navegador? Hoy la API nos obliga a que el número de tarjeta pase por
> nuestro servidor; con campos embebidos reduciríamos nuestro alcance PCI sin
> cambiarle la experiencia al cliente.
>
> Quedamos atentos. ¡Gracias!

---

## Cómo recibir las llaves (no por WhatsApp)

Pediles que las manden por un canal que no quede en el historial del chat, o
cargalas vos directo en Vercel apenas las veas. **No las pegues en el chat de
Claude ni en el repo.** Van en:

Vercel → proyecto → Settings → Environment Variables, en **los dos** proyectos
del repo (ERP y `freakiedelivery`):

| Variable | Valor |
|---|---|
| `N1CO_CLIENT_ID` | el que manden |
| `N1CO_CLIENT_SECRET` | el que manden |
| `N1CO_LOCATION_CODE` | código de sucursal por defecto |
| `N1CO_BASE_URL` | `https://api-sandbox.n1co.shop` para probar |
| `N1CO_AMBIENTE` | `sandbox` |

Para producción: `N1CO_BASE_URL=https://api.n1co.com` y
`N1CO_AMBIENTE=produccion`.

Si tienen varias sucursales con código distinto, `N1CO_LOCATION_CODES` acepta un
JSON `{"<sucursal_id>":"<code>"}` y cobra cada pedido contra la tienda que lo
despacha.

---

## Si n1co demora

Existe una salida self-service que **no** necesita nada de esto: el
**CheckoutLink API**, cuya llave sale de `portal.n1co.shop` → Ajustes → Opciones
de desarrollador → Checkout Link. Ya está implementado en `api/n1co-link.js`.

La contra es justo lo que queremos evitar: es un checkout hospedado, genera un
link nuevo por compra y **no permite guardar la tarjeta**, así que el cliente la
teclea siempre. Sirve como puente para empezar a cobrar online, no como destino.
Para prenderlo alcanza con cargar `N1CO_CHECKOUT_SECRET` y avisarme.
