# Pago con tarjeta en el delivery web — pasarela n1co (EPay)

Branch: `feat/pago-tarjeta-n1co` · Estado: **listo para sandbox, falta configurar credenciales**

El objetivo es que el cliente pague con tarjeta al hacer el pedido en `/menu` y
el pedido entre solo a la cocina, sin el ida y vuelta por WhatsApp para
coordinar el cobro.

---

## Cómo queda el flujo

```
Carrito → Checkout → [💳 Tarjeta] → crear_pedido_delivery   (pedido guardado, IMPAGO)
                                          ↓
                                   PagoTarjeta.jsx
                                          ↓ POST /api/n1co/pagar
                        ┌─────────────────────────────────────┐
                        │  Edge Function api/n1co.js          │
                        │  1. pago_online_iniciar  → monto    │
                        │  2. n1co /PaymentMethods → cardId   │
                        │  3. n1co /Charges                   │
                        │  4. pago_online_resolver            │
                        └─────────────────────────────────────┘
                                          ↓
              SUCCEEDED → cobrado=true + comanda a cocina → "¡Pedido pagado!"
              AUTHENTICATION_REQUIRED → iframe 3DS → /api/n1co/confirmar-3ds
              FAILED → "probá con otra tarjeta" o volver a efectivo
```

**El pedido se crea ANTES de pedir la tarjeta, a propósito.** Si el cobro falla
o el cliente cierra el navegador a la mitad, el pedido igual quedó guardado y la
torre lo ve y lo rescata. Nada se pierde por un problema de la pasarela.

### Las cuatro reglas que sostienen esto

1. **El monto lo pone la base, no el navegador.** `pago_online_iniciar` devuelve
   el `total` que ya guardó `crear_pedido_delivery`. El servidor cobra ese
   número y no mira nada del body del request.
2. **`anon` no puede tocar el pago.** Las RPC `pago_online_*` tienen el execute
   revocado a `public`/`anon`/`authenticated`. Solo `service_role`, desde la
   Edge Function. Si `pago_online_resolver` quedara abierta a anon, cualquiera
   marcaría su pedido como pagado.
3. **El endpoint no sirve para probar tarjetas robadas.** Cada intento exige un
   pedido real, impago y de menos de 3 horas, con tope de 5 intentos por pedido.
4. **Los datos de tarjeta no se guardan.** El PAN cruza la Edge Function hacia
   n1co y muere ahí. En `pagos_online` solo quedan marca, últimos 4 y el token
   del proveedor.

---

## Qué falta para poder probar

### 1. Credenciales — no las pegues en el chat ni en el repo

Van como variables de entorno del proyecto en Vercel (Settings → Environment
Variables), en **los dos** proyectos que salen de este repo (el del ERP y el de
`freakiedelivery`), porque el menú público corre en el segundo.

| Variable | Qué es | Requerida |
|---|---|---|
| `N1CO_CLIENT_ID` | clientId de la plataforma n1co | sí |
| `N1CO_CLIENT_SECRET` | clientSecret | sí |
| `N1CO_LOCATION_CODE` | código de sucursal del Portal n1co | sí |
| `N1CO_BASE_URL` | `https://api-sandbox.n1co.shop` para pruebas | no (default sandbox) |
| `N1CO_AMBIENTE` | `sandbox` o `produccion` | no (default sandbox) |
| `N1CO_LOCATION_CODES` | JSON `{"<sucursal_id>":"<code>"}` para cobrar por tienda | no |
| `N1CO_ORIGENES` | orígenes extra permitidos, separados por coma | no |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen en el proyecto del ERP
(las usa `api/dte-proxy.js`); hay que agregarlas también al proyecto del
delivery si no están.

**Ojo con la doc de n1co:** dice *"The n1co team will provide the necessary
credentials"*, así que la parte de API puede no ser self-service aunque el
portal sí lo sea. Si en el portal no aparecen `clientId`/`clientSecret`, hay que
pedirlos a soporte de n1co junto con el `locationCode` de cada sucursal.

### 2. La URL de producción no está en la doc

La doc pública solo publica el host de sandbox (`api-sandbox.n1co.shop`). El de
producción hay que pedirlo y ponerlo en `N1CO_BASE_URL` cuando se salga de
pruebas. **No pasar a producción sin cambiar también `N1CO_AMBIENTE`**, que es
lo que queda registrado en cada fila de `pagos_online`.

---

## Cómo probar en sandbox

Con las variables puestas, en el checkout elegí **💳 Tarjeta** y usá estas
tarjetas (CVV cualquiera, vencimiento cualquier fecha futura):

| Escenario | Visa | Mastercard |
|---|---|---|
| Aprueba, sin 3DS | `4000056655665556` | `5267260000000001` |
| Rechaza, sin 3DS | `4242424242424242` | `5555555555554444` |
| 3DS que aprueba | `4000000000001000` | `5200000000001005` |
| 3DS que rechaza | `4000000000001013` | `5200000000001018` |
| 3DS no soportado | `4000000000001034` | `5200000000001039` |

Las Visa de la tabla son de emisor **USA**, así que la app va a pedir el código
postal de facturación: es el camino `requiere_billing`, y es correcto que
aparezca. Las Mastercard de emisores no-USA saltan ese paso.

### Qué mirar en cada prueba

```sql
select estado, monto, marca, last4, authorization_code, error_code, error_msg, intento
  from pagos_online order by created_at desc limit 10;
```

- **Aprueba** → el pedido queda `cobrado=true`, `estado='preparando'` y con
  `pos_cuenta_id` (entró al KDS). La pantalla dice "¡Pedido pagado!".
- **Rechaza** → el pedido sigue impago y visible para la torre; el cliente puede
  reintentar o volver a efectivo sin rehacer el pedido.
- **3DS** → aparece el iframe del banco dentro del drawer. El resultado llega
  por `postMessage` y solo se acepta si el origen es `https://front-3ds.n1co.com`.

### Prueba de la capa de base de datos

```bash
psql "$DATABASE_URL" -f scripts/test-pago-online.sql
```

Corre el ciclo completo (incluida la comanda a cocina) contra la base real y lo
revierte todo con un `RAISE EXCEPTION` al final, así que no deja pedidos
fantasma en el KDS. Que "falle" es lo esperado; los resultados salen en el
mensaje. Última corrida: **6/6**.

---

## Impacto en la operación

Un pedido pagado con tarjeta queda `metodo_pago='tarjeta'` y `cobrado=true`.
Eso cambia lo que ven adentro:

- **Torre (`TabPedidos`)** — sello verde `💳 PAGADO ONLINE · NO COBRAR`, el
  botón pasa de "Confirmar pago" a "🍳 Mandar a cocina", y el mensaje de
  WhatsApp deja de preguntar cómo quiere pagar.
- **Motorista (`DriverBeacon`)** — donde decía "Cobrar $X en tarjeta" ahora dice
  **"Ya pagado — no cobrés nada"**, y el resumen del pedido lleva `· PAGADO`.
  Los pedidos con tarjeta ya quedaban fuera de la liquidación de efectivo, eso
  no cambió.

  El aviso se decide por **`cobrado`, no por `metodo_pago`**: quien elige tarjeta
  en el menú y después abandona el cobro queda etiquetado `'tarjeta'` pero
  debiendo. Con la etiqueta el motorista habría entregado sin cobrar. Para eso
  hubo que exponer `cobrado` en `mis_pedidos_driver` (cambio aditivo).

Normalmente el pedido pagado ni pasa por la columna "Por cobrar": el cobro lo
comanda directo. La excepción es un pedido **fuera de cobertura** (sin sucursal
ruteada): se cobra igual, queda en `recibida` con el sello de pagado, y la torre
le asigna tienda y lo manda a cocina. Se prefirió cobrar y avisar antes que
abortar la transacción con la plata ya capturada.

---

## Tarjeta guardada (fricción cero en la segunda compra)

El objetivo de Jose: que el cliente que vuelve **no reingrese la tarjeta**. Se
resuelve con el token multi-uso de n1co (`card.singleUse: false`): la tarjeta la
guarda n1co, nosotros guardamos solo el token.

```
1ª compra   formulario + ☑ "Guardar mi tarjeta"  → tokeniza singleUse:false
                                                 → cobra → guarda el token
2ª compra   "Visa ····5556 · Pagar $12.40"       → un toque, cero campos
```

### Atada al dispositivo, NO al teléfono

Esta es la decisión que sostiene la seguridad de todo el módulo.

El menú público corre con la anon key y ya identifica al cliente por el teléfono
guardado en su navegador. **Si la tarjeta guardada se buscara por teléfono,
cualquiera escribiría el número de otro y pediría comida a su casa cobrándosela
a esa tarjeta.** El teléfono es un identificador público, no una credencial.

Por eso la llave es un `crypto.randomUUID()` (122 bits) que se genera en el
navegador del cliente, vive en su `localStorage` y no sale de ahí. La Edge
Function lo convierte en **SHA-256** antes de tocar Postgres, así que:

- Un volcado de `tarjetas_guardadas` **no** permite cobrarle a nadie: haría
  falta el secreto original, que no está en la base y no es adivinable.
- `tarjetas_listar` **no devuelve el `card_id`** — al navegador solo van marca,
  últimos 4 y vencimiento. El token nunca sale del servidor.
- `tarjeta_para_cobro` exige que la tarjeta pertenezca a **ese** dispositivo:
  conocer el uuid de una tarjeta ajena no alcanza.

Consecuencias aceptadas (las mismas de cualquier app de delivery):

- Cambia de teléfono o borra los datos del navegador → reingresa la tarjeta una
  vez.
- Le roban el teléfono desbloqueado → podrían pedir comida.
- En modo incógnito no se ofrece guardar, porque no hay dónde atarla.

### ⚠️ El cambio a freakiedogs.com afecta esto directamente

**`localStorage` es por origen.** Si el menú se muda de
`freakiedelivery.vercel.app` a `freakiedogs.com`, el secreto del dispositivo no
viaja, y **todas las tarjetas guardadas quedan huérfanas**: el cliente las tiene
que volver a ingresar. Lo mismo le pasa al perfil `freakie_cliente_v1` (nombre,
teléfono, dirección), que es un problema preexistente pero del mismo tipo.

Por eso conviene **estrenar la tarjeta guardada ya en el dominio definitivo**.
Si se lanza antes, la primera camada de clientes que guarde su tarjeta la pierde
el día de la mudanza — y eso se siente como que el sistema falló.

Lo demás del módulo aguanta el cambio de dominio con dos ajustes, ya hechos:

- `ORIGENES_OK` en `api/n1co.js` y `api/n1co-link.js` ya incluye
  `freakiedogs.com`, `www.` y `pedidos.`. Cualquier otro subdominio se agrega
  con la env `N1CO_ORIGENES` (lista separada por comas), sin tocar código.
- Las URLs de retorno del CheckoutLink salen del `Origin` validado del request,
  no de una constante, así que siguen al dominio solo.

Queda pendiente para la otra sesión: `URL_DELIVERY` en `src/config.js` sigue
apuntando a `freakiedelivery.vercel.app` y es de donde salen los links de
seguimiento que se le mandan al cliente.

### Prueba

```bash
psql "$DATABASE_URL" -f scripts/test-tarjetas-guardadas.sql
```

Se revierte sola, igual que la otra. Última corrida: **6/6**. La prueba 4 es la
que importa — verifica que un dispositivo distinto **no** puede cobrar la
tarjeta de otro aunque conozca el uuid.

---

## Pendientes conocidos

- **Webhooks.** `api/n1co.js` confirma el cobro con la respuesta síncrona de
  `/Charges`, que es autoritativa. No se implementó el webhook porque la doc de
  n1co documenta los tipos de evento pero **no la verificación de firma**, y un
  webhook sin firma que marque pedidos como pagados es un agujero. Si se quiere
  como red de seguridad, primero hay que preguntarle a n1co cómo se firma.
- **Reembolsos.** Existe `POST /api/v3/Refunds` y la tabla ya contempla el
  estado `reembolsado`, pero no hay botón ni endpoint todavía. Hoy un reembolso
  se hace desde el portal de n1co y se anota a mano.
- **Alcance PCI — decisión tomada, con costo.** Esta API no tiene hosted
  checkout ni campos embebidos: el formulario es nuestro y el PAN pasa por
  nuestro servidor (SAQ D). Se eligió igual porque **es la única vía que permite
  guardar la tarjeta**, y bajar la fricción era la prioridad. La alternativa sin
  alcance PCI es el CheckoutLink (`api/n1co-link.js`, implementado y sin
  cablear), pero obliga a teclear la tarjeta en cada compra.
  El punto 6 de `docs/n1co-solicitud-credenciales.md` le pregunta a n1co si
  tienen *hosted fields*: si aparecen, se gana lo mejor de los dos.
- **DTE.** Este cobro **no** emite factura electrónica. La emisión sigue por
  donde estaba (`_comanda_delivery` → POS). No se tocó nada de DTE.
