# Puesta en marcha del pago con tarjeta — directo a producción

**El sandbox de n1co no se pudo usar:** al entrar al modo sandbox la plataforma
cierra la sesión, y al volver a entrar la tienda está de nuevo en producción
(`portal.n1co.shop/configuration/sandbox` → *Ir a sandbox*). Sin sandbox no hay
tarjetas de prueba, así que **la validación se hace con dinero real**.

Eso cambia el plan: no se prueba menos, se prueba **acotado**. El código trae dos
frenos nuevos para que un error durante el estreno no le cueste plata a un
cliente.

---

## Los dos frenos (leer antes que nada)

| Variable | Qué hace |
|---|---|
| `N1CO_TELEFONOS_PRUEBA` | **Piloto.** Con uno o más teléfonos (coma), **solo esos** pueden pagar con tarjeta; a todos los demás la app les responde que el pago con tarjeta no está disponible y que usen efectivo. Vacía = abierto a todos. |
| `N1CO_MONTO_MAX` | **Techo por cobro.** Default **$150**. Un delivery de smash burgers no llega ahí: si lo supera, algo está muy mal (total corrupto, bug de cantidades) y no se cobra. |

El piloto es el interruptor del lanzamiento suave, y es lo que reemplaza al
sandbox: **cobrás de verdad, pero solo vos**. Cuando esté validado, se borra la
variable y queda abierto — sin redeploy de código, solo la variable y un
redeploy de Vercel.

Probados en `scripts/test-frenos-n1co.mjs` (**14/14**), incluido el caso de una
variable mal escrita: `N1CO_MONTO_MAX=abc` **no** desactiva el techo, cae al
default. Si cayera en `NaN`, toda comparación daría `false` y pasaría cualquier
monto.

```bash
node scripts/test-frenos-n1co.mjs
```

---

## Paso 1 — Crear la llave de producción

Portal n1co → **engranaje** → **API → nueva**. Con el modo sandbox apagado (que
es donde estás igual), la llave sale de producción.

### El nombre y los roles

El modal se llama **"Nueva app"** y pide un nombre y unos *roles*.

**El nombre no importa técnicamente** — es solo la etiqueta con la que vas a
identificar (y revocar) esa llave. Lo que sí conviene es que diga **dónde se
usa**, para que el día que haya varias sepas cuál apagar sin adivinar. Por
ejemplo `Freakies · delivery web` en vez de solo `Freakies`.

**Los roles sí importan.** n1co recomendó marcar todos *para sandbox*, pero esta
es una llave de **producción** que va a vivir en Vercel: si se filtra, alguien
puede hacer todo lo que la llave permita. Marcá solo:

| Rol | ¿Marcar? | Por qué |
|---|---|---|
| **V\*: Pasarela de pagos** | ✅ **sí** | Es el que usa todo: tarjetas, cobros y devoluciones. Sin este no funciona nada. |
| **V1: Autenticación 3DS** | ✅ **sí** | El reto del banco. Sin este, un cobro que pida 3DS falla. |
| V2/V3: Administrador de links de pago | ➖ opcional | Solo si algún día prendés el puente de CheckoutLink (`api/n1co-link.js`). Riesgo bajo. |
| V2/V3: Administrador de tienda | ❌ **no** | Nunca administramos la tienda desde el ERP. Si la llave se filtra, esto deja que se la modifiquen. |
| V3: Administración de suscripciones | ❌ **no** | No cobramos suscripciones. |
| V2/V3: Links de pago de suscripción | ❌ **no** | Idem. |

Si más adelante hace falta un rol, se crea otra llave: es más seguro que dejar
una llave que puede todo.

El modal da **dos** valores:

- `clientId` — un uuid: `c8573b9a-88ea-…`
- `clientSecret` — cadena larga: `kt68Q-e6FS1FNgve…`

**Copiá el `clientSecret` antes de cerrar el modal**, normalmente se muestra una
sola vez. Si se pierde, se borra la llave y se crea otra.

> Como no hay sandbox, esta llave cobra de verdad desde el primer request. Por
> eso el piloto por teléfono se configura en el mismo paso que la llave, no
> después.

---

## Paso 2 — Los `locationCode`

**Configuración → Sucursales.** La primera columna, **"ID"**, es el
`locationCode`. Anotá el de cada tienda.

### ¿Uno solo, o una sucursal de n1co por tienda?

**Uno solo, y que sea del canal web — no el de una tienda física.**

El motivo es la conciliación que ya hacen. Hoy cada sucursal cuadra contra el
**lote del datáfono N1CO** de esa tienda: el 4-sep en S002 el voucher cerró con
18 ventas / $259.55 y los pagos con tarjeta del POS anteriores a esa hora sumaban
$259.55 exacto (ver `memoria.md`). Ese cuadre al centavo es lo que permite
detectar un pago duplicado.

Si los cobros del menú web se imputan al `locationCode` de, digamos, Usulután, el
lote de Usulután va a incluir ventas que **no** están en los pagos con tarjeta de
su POS, y ese cuadre exacto se rompe para siempre. El daño no es cosmético: es
perder la herramienta con la que se encontraron $499.76 de pagos duplicados.

Así que lo correcto es que **el delivery web sea su propia "sucursal" en n1co**
(ej. `Pedidos en línea`), con su propio lote y su propio depósito. Se conciliaría
contra las ventas de canal `delivery_propio`, no contra el POS de una tienda.

- Si en Configuración → Sucursales ya existen las tiendas físicas (probable: los
  datáfonos están ahí), **no las toques**. Creá una nueva para el canal web, o
  usá la de Casa Matriz si crear una no es posible.
- Con eso, `N1CO_LOCATION_CODE` es una sola variable y `N1CO_LOCATION_CODES` no
  hace falta.

`N1CO_LOCATION_CODES` existe para el día que quieran imputar por tienda a
propósito — toma un JSON `{"<sucursal_id nuestro>":"<ID de n1co>"}`, con los
nuestros de acá:

```sql
select id, store_code, nombre from sucursales where activa and tiene_delivery;
```

Pero **no lo usen hasta haber decidido cómo van a conciliar**, porque una vez
que los cobros entran mezclados no se pueden separar hacia atrás.

---

## Paso 3 — Smoke test con tu propia tarjeta

Valida credenciales, tokenización multi-uso y `locationCode` **sin pasar por la
app**, así no depurás dos cosas a la vez. Cobra el monto que le digas y **lo
reversa al final**.

```bash
cd ~/Proyectos/freakie-dogs-caja
git checkout feat/pago-tarjeta-n1co

  N1CO_BASE_URL=https://api.n1co.com \
  N1CO_CLIENT_ID='...' N1CO_CLIENT_SECRET='...' N1CO_LOCATION_CODE='...' \
  N1CO_TEST_CARD_NUMBER='4111...' N1CO_TEST_CARD_MONTH=12 \
  N1CO_TEST_CARD_YEAR=2030 N1CO_TEST_CARD_CVV=123 \
  N1CO_TEST_CARD_HOLDER='JOSE ISART' \
    node scripts/smoke-n1co.mjs --cobrar-de-verdad
```

Detalles que importan:

- **El espacio antes del comando** no es un typo: en zsh con `HIST_IGNORE_SPACE`
  evita que la línea con la tarjeta y el secret quede en el historial.
- Sin `--cobrar-de-verdad` el script **se niega a correr** contra producción.
  Tampoco arranca si falta la tarjeta.
- El monto sale de `N1CO_TEST_AMOUNT` (default **$1.00**).
- El script **no imprime** el secret ni el número completo, solo los últimos 4.
- El paso 4 hace el reverso por `/Refunds`. Si falla, te da el `orderId` para
  anularlo a mano en el portal. **El cargo y su reverso igual aparecen en tu
  estado de cuenta** — son dos movimientos de $1.

Si el paso 2 se queja de `singleUse` o multi-use, card-on-file no está activo
pese a lo que dijeron y hay que escribirles. Si el paso 3 falla mencionando
*location*, el `locationCode` está mal.

---

## Paso 4 — Variables en Vercel

En **los dos** proyectos que salen de este repo (ERP y delivery), porque se
despliegan por separado:

| Variable | Valor |
|---|---|
| `N1CO_CLIENT_ID` | el del paso 1 |
| `N1CO_CLIENT_SECRET` | el del paso 1 |
| `N1CO_LOCATION_CODE` | el del paso 2 |
| `N1CO_BASE_URL` | `https://api.n1co.com` |
| `N1CO_AMBIENTE` | `produccion` |
| **`N1CO_TELEFONOS_PRUEBA`** | **tu teléfono** — el freno del piloto |
| `N1CO_MONTO_MAX` | opcional; poné `25` mientras probás |

### Cómo verificar que no falta nada

En Vercel → proyecto → **Settings → Environment Variables**, pestaña
**Project**. Revisá también la pestaña **Shared**: si la service_role key está
compartida a nivel de equipo, se agrega con **Link Shared Variable** en vez de
volver a pegarla (mejor: un solo lugar donde rotarla).

El proyecto **`freakiedelivery`** tiene que terminar con:

```
VITE_URL_DELIVERY          ← ya está
VITE_SB_URL                ← ya está
VITE_TARGET                ← ya está
SUPABASE_URL               ← FALTA
SUPABASE_SERVICE_ROLE_KEY  ← FALTA  ⚠️
N1CO_CLIENT_ID             ← FALTA
N1CO_CLIENT_SECRET         ← FALTA
N1CO_LOCATION_CODE         ← FALTA
N1CO_BASE_URL              ← FALTA
N1CO_AMBIENTE              ← FALTA
N1CO_TELEFONOS_PRUEBA      ← FALTA
```

**Poné las `N1CO_*` solo en el environment `Production`, no en Preview.** Son
credenciales que cobran de verdad: en Preview, cualquier deploy de una branch
podría cobrar tarjetas reales. Sin ellas, un preview responde "el pago no está
disponible", que es exactamente lo que querés.

Dos cosas que se pasan por alto:

- **`SUPABASE_SERVICE_ROLE_KEY` tiene que estar en el proyecto del delivery**,
  no solo en el del ERP (donde ya está para `api/dte-proxy.js`). Sin ella el
  cobro no puede confirmar el pedido: la tarjeta se cobra y el pedido queda
  impago. Es el peor modo de falla del módulo — verificalo antes de cobrar nada.
- **`N1CO_AMBIENTE=produccion` no es cosmético**: queda grabado en cada fila de
  `pagos_online`. Si se olvida, los cobros reales figuran como sandbox y la
  conciliación miente.
- `N1CO_BASE_URL` va **sin** `/api/v3` (el código la concatena). Si la pegás
  completa el código la limpia, pero mejor cargarla bien.

Las env vars se hornean en el build: **hay que redeployar** después de cargarlas.

---

## Paso 5 — Webhook

**Configuración → URL de acceso al webhook.** Registrá:

```
https://pedidos.freakiedogs.com/api/n1co-link/webhook
```

Ahí mismo el portal genera la **llave secreta** → cargala en Vercel como
`N1CO_WEBHOOK_SECRET`. Esa pantalla también guarda el **historial de webhooks
enviados**, que es lo primero que hay que mirar cuando un cobro no cuadre.

n1co confirmó que el encabezado `X-H4B-Hmac-Sha256` viaja en el **100%** de los
eventos, y el endpoint verifica la firma antes de tocar la base. **Sin
`N1CO_WEBHOOK_SECRET` rechaza todo**, a propósito: un webhook sin firma que
marque pedidos como pagados sería un agujero para comer gratis.

**Pendiente conocido:** el handler hoy resuelve órdenes de CheckoutLink.
Extenderlo a los cobros de EPay es el próximo paso de endurecimiento, y cubre
justo el hueco de "n1co cobró pero nuestra confirmación falló en el medio".

---

## Paso 5.5 — Verificar el despliegue (sin tarjeta, sin plata)

Apenas termine el deploy del merge, **antes** de probar con una tarjeta real:

```bash
node scripts/verificar-despliegue-n1co.mjs https://pedidos.freakiedogs.com 70123456
```

(el segundo argumento es tu teléfono del piloto). Es caja negra: no necesita
secretos ni tarjeta, y no cobra nada.

Lo que prueba, en orden: que el rewrite quedó, que las credenciales de n1co
están cargadas, **que el Edge Function llega a Postgres con la service_role**,
que las validaciones rechazan basura sin gastar intentos, que el piloto bloquea
un teléfono ajeno y habilita el tuyo, que CORS no habilita un `vercel.app`
ajeno, y que una op inventada se rechaza.

El chequeo 3 es el que importa: pide cobrar un pedido **inexistente** y espera
`no_existe`. Solo puede contestar eso si llegó a la base. Si contesta **502**,
falta `SUPABASE_SERVICE_ROLE_KEY` — el modo de falla en que n1co cobra la tarjeta
y el pedido queda impago.

Si algo sale mal ahí, no pruebes con tarjeta todavía.

---

## Paso 6 — Probar desde la app, con el piloto puesto

Con `N1CO_TELEFONOS_PRUEBA` = tu teléfono, andá a
`pedidos.freakiedogs.com/menu` y armá un pedido **barato de verdad** (una soda:
el menú tiene ítems de $0.50–$1.75).

**Antes de nada, verificá que el freno funciona:** pedí desde otro teléfono (o
sacá tu número de la lista un momento) y confirmá que la app responde *"el pago
con tarjeta está en pruebas… elegí efectivo"*. Si ahí cobra, el piloto no está
activo y no sigas.

Después, en orden:

1. **Cobro simple.** Pagá con tu tarjeta, **sin** marcar "guardar". Verificá que
   la pantalla diga "¡Pedido pagado!" y que el pedido entre a cocina.
2. **La prueba que importa** (el requisito): pagá un segundo pedido **dejando
   marcado** "Guardar mi tarjeta". Después hacé un **tercero** con el mismo
   navegador: al elegir tarjeta tiene que aparecer **"Visa ····1234 · Pagar $X"**
   y cobrarse de un toque, sin escribir nada.
3. **Rechazo.** Difícil de forzar con una tarjeta buena; se puede con una tarjeta
   sin fondos o vencida. Si no tenés, salteá: el camino de rechazo no mueve
   dinero.
4. **Cancelá y reversá** los pedidos de prueba: en la torre, y el cobro desde el
   portal de n1co.

Qué mirar en la base:

```sql
select estado, metodo, monto, marca, last4, authorization_code,
       error_code, error_msg, intento, created_at
  from pagos_online order by created_at desc limit 10;

select marca, last4, vence_mes, vence_anio, ultimo_uso
  from tarjetas_guardadas order by created_at desc limit 5;
```

Un cobro aprobado deja el pedido con `cobrado=true`, `estado='preparando'` y
`pos_cuenta_id` (ya está en el KDS), y en la torre aparece el sello
`💳 PAGADO ONLINE · NO COBRAR`.

Los frenos dejan rastro: `error_code='FUERA_DE_PILOTO'` o `'MONTO_SOBRE_TECHO'`
en `pagos_online`. Si ves esos códigos con tu propio teléfono, revisá la
variable.

---

## Paso 7 — Abrir a los clientes

Recién cuando el paso 6 esté limpio:

1. Avisale a **Karina y a los motoristas**: los pedidos pagados llegan con el
   sello verde y **no se les cobra nada** en la puerta.
2. Subí `N1CO_MONTO_MAX` a `150` (o al techo que quieras).
3. **Borrá `N1CO_TELEFONOS_PRUEBA`** y redeploy. Ahí queda abierto.
4. Los primeros días, revisá a diario:
   ```sql
   select error_code, count(*), max(created_at)
     from pagos_online where estado in ('error','rechazado')
     group by 1 order by 2 desc;
   ```
   Ahí aparecen los problemas de configuración (`SIN_LOCATION_CODE`,
   `REQUIERE_BILLING`) y la tasa de rechazo real de los emisores.

Si algo sale mal, el rollback es **volver a poner `N1CO_TELEFONOS_PRUEBA` con un
número cualquiera** y redeployar: el pago con tarjeta se apaga para todos los
clientes en un deploy, sin tocar código y sin bajar el menú.

---

## Para escribirle a n1co

Vale reportar el bug del sandbox y aprovechar para dos preguntas:

> Dos cosas:
>
> **1.** No logramos usar el sandbox: en
> `portal.n1co.shop/configuration/sandbox`, al presionar **Ir a sandbox** la
> plataforma nos cierra la sesión, y al volver a entrar la tienda sigue en
> producción (nunca aparece la etiqueta "sandbox"). Probamos varias veces.
> ¿Es un problema de nuestra cuenta, o el sandbox necesita un *workspace*
> aparte? Lo preguntamos porque, sin sandbox, la única forma de validar la
> integración es cobrando con tarjetas reales.
>
> **2.** Mientras eso se resuelve vamos a validar en producción con montos
> chicos y reversándolos. ¿Hay algún límite de reversos por día, o alguna
> recomendación para no que no se marque como actividad sospechosa?
>
> **3.** Confirmamos que **sí** queremos registrar los *hosted fields* como
> requerimiento de producto: es lo que nos dejaría en SAQ A sin perder la
> tarjeta guardada, que el checkout hospedado no permite.
