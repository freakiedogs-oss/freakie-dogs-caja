# Migración a `freakiedogs.com` — runbook

> **Estado al 8-sep-2026, 22:30 — Fases 0 a 3 COMPLETADAS y verificadas.**
> El dominio quedó en Cloudflare (`grant` / `hattie.ns.cloudflare.com`) y los
> cinco hosts sirven 200 desde Vercel, todos en nube gris:
>
> ```
> freakiedogs.com          → 216.150.1.1  (A) → 308 a www
> www.freakiedogs.com      → 4671ca470fa7ad7a.vercel-dns-017.com
> pedidos.freakiedogs.com  → 4671ca470fa7ad7a.vercel-dns-017.com
> erp.freakiedogs.com      → 5bc8ca92ed2037d4.vercel-dns-017.com
> pos.freakiedogs.com      → 5bc8ca92ed2037d4.vercel-dns-017.com
> ```
>
> El canónico del delivery quedó en **`www`** (el apex redirige con 308).
>
> **Fase 4 COMPLETADA (8-sep, 23:10, merge `29de71e`).** El switch se hizo: el
> ERP, el POS y el delivery pasan por `api.freakiedogs.com`. El proxy `/sb`
> sigue desplegado a propósito como red de seguridad. Faltan las Fases 5 y 6.
>
> ```
> TLS       CN=api.freakiedogs.com · Google Trust Services · vence 8-dic-2026
> RPC       erp_ping → {"ok": true}                              ✅
> Functions /functions/v1/dte-service → 200                      ✅
> WebSocket api.freakiedogs.com → 101 Switching Protocols        ✅
>           el MISMO handshake por /sb → 500 Internal Server Error
> ```
>
> Paridad con `btboxlwfqcbrdfrlnwln.supabase.co` verificada endpoint por
> endpoint (mismo 401 en la raíz de `/rest/v1/`, mismo 400 en
> `/storage/v1/bucket`, mismo 200 en el RPC): **Kaeru y Kako no se enteraron**.
>
> Punto de partida, para contexto: el dominio existía desde ene-2024 pero **no
> resolvía a nada** — los nameservers de BanaHosting daban `SERVFAIL` para la
> zona. No había web ni correo en pie, así que no hubo nada que romper.

```
Registrar     NameCheap, Inc.
Creado        2024-01-18   ·   Vence 2027-01-18
Dueño         Luis Castillo (socio)
Status        clientTransferProhibited (candado de registrar; NO bloquea el
              cambio de cuenta dentro de Namecheap)
```

## Mapa objetivo

| Host | Apunta a | Proyecto |
|---|---|---|
| `api.freakiedogs.com` | Supabase Custom Domain | ref `btboxlwfqcbrdfrlnwln` |
| `erp.freakiedogs.com` | Vercel | `freakie-dogs-caja` |
| `pos.freakiedogs.com` | Vercel | `freakie-dogs-caja` |
| `pedidos.freakiedogs.com` | Vercel | `freakiedelivery` |
| `www` + apex | Vercel (landing / redirect a pedidos) | `freakiedelivery` |

**Los `*.vercel.app` NO se apagan.** Vercel acepta varios dominios por proyecto:
conviven indefinidamente. El APK del driver, los QR impresos y los links viejos
de WhatsApp siguen vivos.

---

## Fase 0 — Propiedad (Luis + Jose)

1. **Aceptar la invitación** de manager: entrar a namecheap.com (no por el link
   del correo) → *Domain List* → `freakiedogs.com` → *Sharing & Transfer*.
2. **Mejor todavía:** que Luis haga un **Account Change** a una cuenta Namecheap
   de la empresa (`admin@freakiedogs.com` o similar, con 2FA). Es gratis,
   instantáneo, se queda en Namecheap y no dispara el bloqueo de 60 días de una
   transferencia entre registradores. Ser manager es un permiso revocable; ser
   dueño no.
3. Activar **auto-renew** y **2FA** en esa cuenta. El dominio vence el
   18-ene-2027: si se cae, se cae el ERP entero.

**El orden importa:** primero se crea la zona en Cloudflare y se cargan TODOS
los registros, y **al final** se cambian los nameservers. Así, en el momento del
switch, la zona nueva ya está completa y no hay ventana sin resolver.

## Fase 1 — Zona en Cloudflare (todavía sin switch)

4. Crear cuenta en dash.cloudflare.com (con 2FA) → **Add a domain** →
   `freakiedogs.com` → plan **Free**.
5. Cuando ofrezca *Quick scan for DNS records*, dejalo correr: **no va a
   encontrar nada** porque la zona de BanaHosting está caída. Es lo esperado.
6. Cloudflare muestra 2 nameservers tipo `xxxx.ns.cloudflare.com`. **Anotarlos y
   NO cambiarlos todavía en Namecheap.** Primero se cargan los registros.

*(Alternativa válida: Namecheap BasicDNS. Cloudflare se elige por el manejo de
los registros de correo y por tener reglas y analytics gratis después.)*

**Antes de cambiar los NS**, confirmar con Luis que en BanaHosting no queda un
buzón de correo con historial que alguien siga necesitando. El correo hoy no
entra (no hay MX resolvible), pero el archivo viejo vive en ese hosting.

## Fase 2 — Vercel dice qué registros hay que crear

7. Vercel → proyecto **`freakie-dogs-caja`** → *Settings → Domains* → *Add* →
   `erp.freakiedogs.com`. Repetir con `pos.freakiedogs.com`.
8. Proyecto **`freakiedelivery`** → agregar `pedidos.freakiedogs.com`,
   `freakiedogs.com` (apex) y `www.freakiedogs.com`. Al agregar el apex y el www
   Vercel pregunta cuál es el principal: **apex principal, `www` redirige a él**.
   La raíz de ese proyecto ya sirve una página válida (verificado: `200`), así
   que el apex no queda en 404.
9. Cada dominio va a quedar en **"Invalid Configuration"** — correcto, el DNS
   todavía no existe. Vercel muestra ahí el registro exacto que espera.
10. Crear esos registros en Cloudflare (*DNS → Records → Add record*),
    **copiando el valor que muestra Vercel** (el destino de los CNAME cambia
    según la cuenta; no asumir `cname.vercel-dns.com`):

    | Tipo | Nombre | Valor | Proxy |
    |---|---|---|---|
    | CNAME | `erp` | el que muestre Vercel | **DNS only (gris)** |
    | CNAME | `pos` | el que muestre Vercel | **DNS only (gris)** |
    | CNAME | `pedidos` | el que muestre Vercel | **DNS only (gris)** |
    | CNAME | `www` | el que muestre Vercel | **DNS only (gris)** |
    | A | `@` | la IP que muestre Vercel | **DNS only (gris)** |

    **La nube tiene que quedar gris en todos** — ver abajo por qué, porque
    Cloudflare insiste con un banner en que la enciendas.

### Por qué TODO va en nube gris (DNS only)

Cloudflare avisa que *"proxying is required for most security and performance
features"*. Es cierto en general y es falso en nuestro caso: **delante de Vercel
la nube naranja no agrega, duplica.**

- **Vercel ya es una CDN** con caché en el edge, TLS automático, protección DDoS
  y firewall propio. Encender Cloudflare encima no suma una capa: pone dos
  cachés en serie.
- **Dos cachés rompen el candado de versión.** Vercel purga su caché en cada
  deploy; Cloudflare no se entera. Como el candado compara el `version.json` del
  servidor contra el id horneado en el bundle, una caché intermedia sirviendo
  bundles viejos es exactamente el escenario del bucle de recargas.
- **Se pierde la IP real.** Con la nube naranja, Vercel ve IPs de Cloudflare en
  todas las peticiones: su Firewall, su rate limiting y sus logs quedan ciegos,
  y nuestros endpoints de n1co ven a todos los clientes como un solo origen.
- **El certificado.** Vercel emite y renueva el suyo por dominio; con el proxy
  encendido Cloudflare termina el TLS con el propio y la validación se traba.
- **Techos nuevos.** El proxy de Cloudflare Free corta a los 100 s y limita la
  subida a 100 MB. Toda esta migración existe para *quitar* un techo.
- Para `api.freakiedogs.com` **no es opcional**: Supabase requiere el CNAME en
  DNS only o no puede emitir el certificado.

Lo que sí queríamos de Cloudflare —DNS anycast rápido, gratis y confiable, y el
manejo cómodo de los registros de correo— lo tenemos con la nube gris. Si algún
día hace falta un WAF, el lugar correcto es el **Firewall de Vercel**, no una
segunda CDN.

## Fase 3 — El switch de nameservers

11. Namecheap → `freakiedogs.com` → pestaña **Domain** → **NAMESERVERS** →
    dejar **Custom DNS** y reemplazar `ns410` y `ns411.banahosting.com` por los
    dos de Cloudflare. Nameserver 3 vacío. Guardar con el ✓ verde.
12. Namecheap avisa que puede tardar hasta 48 h; en la práctica son minutos.
    Verificar:
    ```
    dig +short freakiedogs.com NS     # los de Cloudflare
    dig +short freakiedogs.com SOA    # ya no debe dar SERVFAIL
    dig +short erp.freakiedogs.com
    ```
13. En Cloudflare, la zona pasa a **Active**. En Vercel, los 5 dominios pasan
    solos de "Invalid Configuration" a válidos y emiten certificado (minutos).
14. Abrir `https://erp.freakiedogs.com` y `https://pedidos.freakiedogs.com`:
    deben servir lo mismo que los `.vercel.app`. Hasta acá **nada cambió** para
    la operación — son hosts nuevos que nadie usa todavía.

## Fase 4 — `api.freakiedogs.com` y muerte del proxy `/sb`

Esta es la fase que arregla el problema de fondo: los **1,858 errores 504 en
10 minutos** del 4-sep, el techo duro de ~25 s del runtime Edge y el WebSocket
roto (ver `src/supabase.js`).

15. Supabase → proyecto `btboxlwfqcbrdfrlnwln` → *Settings → General → Custom
    Domains* → activar el add-on (**~$10/mes**; la organización ya está en Pro).
16. Registrar `api.freakiedogs.com`. Supabase pide un **CNAME** (`api` →
    `btboxlwfqcbrdfrlnwln.supabase.co`) y uno o más **TXT de verificación** →
    crearlos en Cloudflare **en nube gris** → *Verify* → *Activate*.
17. Verificar que el WebSocket sí sube por el host nuevo (con HTTP/2 la prueba
    es inconclusa, hay que forzar 1.1):
    ```
    curl -s -i --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
      -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
      "https://api.freakiedogs.com/realtime/v1/websocket?apikey=<anon>&vsn=1.0.0"
    ```
    Esperado: `101 Switching Protocols`.
18. **El switch** — variables de entorno en Vercel (Production) y redeploy:

    | Variable | Proyecto | Valor |
    |---|---|---|
    | `VITE_SB_URL` | ambos | `https://api.freakiedogs.com` |
    | `VITE_URL_DELIVERY` | ambos | `https://pedidos.freakiedogs.com` |
    | `URL_DELIVERY` | `freakie-dogs-caja` | `https://pedidos.freakiedogs.com` |

    El código ya está preparado: con `VITE_SB_URL` seteada, `src/supabase.js`
    deja de usar el proxy **y** deja de hacer el swap del `RealtimeClient` (ese
    parche existía solo porque el proxy no sabe hacer upgrade a WebSocket).
    **Rollback = borrar la variable y redeployar.** No hay que tocar código.
19. Hacer el switch un **martes o miércoles por la mañana**, nunca viernes ni en
    hora pico. Vigilar 30 min: login del POS, cobro, KDS en vivo, despacho.
20. Dejar `api/supaproxy.js` desplegado ~2 semanas como red de seguridad. Recién
    después evaluar borrarlo junto con los rewrites `/sb` de `vercel.json`.

## Fase 5 — Correo

21. Google Workspace (~$7/usuario/mes) o Zoho Mail (plan gratis hasta 5 buzones).
22. MX + **SPF + DKIM + DMARC** en Cloudflare. Sin los tres, los correos con el
    DTE le caen en spam al cliente.
23. Buzones mínimos: `pedidos@`, `facturacion@`, `admin@`.

## Fase 6 — Cola (después del switch, sin prisa)

24. **TikTok**: `public/tiktok-auth.html:106` y la verificación de dominio del
    portal apuntan a `freakie-dogs-caja.vercel.app`. Dar de alta el redirect URI
    nuevo **antes** de cambiar el archivo, o el OAuth se cae.
25. **Meta / Instagram**: rehacer la verificación de dominio.
26. **APK del driver**: `android-driver/` carga el `.vercel.app` en el WebView.
    Repuntarlo a `pos.freakiedogs.com` exige recompilar y reinstalar en cada
    teléfono — hacerlo solo cuando toque otra actualización del APK.
27. **n1co** (vive en la branch `feat/pago-tarjeta-n1co`, todavía sin mergear):
    los orígenes ya están permitidos — `api/n1co.js` y `api/n1co-link.js` traen
    `freakiedogs.com`, `www.` y `pedidos.` en `ORIGENES_OK`, más la variable
    `N1CO_ORIGENES`. Lo que **sí** hay que hacer es avisarle a n1co el dominio
    de producción del comercio al pedir credenciales productivas.
28. QR impresos del menú y links del manual: regenerar cuando toque reimprimir.

---

## ⚠️ Lo que se pierde al cambiar de origen

El navegador aísla `localStorage`, IndexedDB y el service worker **por origen**.
Al mover a alguien de `freakie-dogs-caja.vercel.app` a `erp.freakiedogs.com`:

- La PWA instalada en las tablets **hay que reinstalarla** (el ícono viejo sigue
  funcionando contra el host viejo, así que no es urgente, pero conviven dos).
- La **tarjeta guardada del cliente queda atada al dispositivo *y al origen***:
  quien tenga una guardada en `freakiedelivery.vercel.app` la pierde al entrar
  por `pedidos.freakiedogs.com`. No es pérdida de dinero — el token vive en
  n1co — pero el cliente tiene que volver a ingresar la tarjeta una vez.

Por eso el orden importa: primero levantar los hosts nuevos (Fase 2), después
mover el backend (Fase 3), y recién al final empezar a repartir los links nuevos.

## Costo

| Concepto | Costo |
|---|---|
| Dominio | ya pagado hasta ene-2027 |
| Cloudflare DNS | $0 |
| Dominios en Vercel | $0 (el team ya es Pro) |
| Supabase Custom Domain | ~$10/mes |
| Correo (Zoho free / Workspace) | $0 – ~$7 por buzón/mes |
