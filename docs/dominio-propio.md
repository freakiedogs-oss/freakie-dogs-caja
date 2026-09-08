# Migración a `freakiedogs.com` — runbook

> Estado al 8-sep-2026. El dominio existe pero **no resuelve a nada**: los
> nameservers (`ns410/411.banahosting.com`) responden `SERVFAIL` para la zona.
> No hay web ni correo en pie, así que no hay nada que romper — pero tampoco
> hay nada que heredar.

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

## Fase 1 — DNS (30 min, sin impacto)

4. Crear zona en **Cloudflare** (plan Free) → *Add a site* → `freakiedogs.com`.
   El escaneo no va a encontrar nada (la zona actual está muerta): es lo esperado.
5. Copiar los 2 nameservers que asigna Cloudflare → Namecheap → *Domain* →
   *Nameservers* → **Custom DNS** → pegar y guardar.
6. Esperar la propagación y verificar:
   ```
   dig +short freakiedogs.com NS      # debe devolver los de Cloudflare
   dig +short freakiedogs.com SOA     # ya no debe dar SERVFAIL
   ```
   *(Alternativa válida: Namecheap BasicDNS. Cloudflare se elige por el manejo
   de los registros de correo y por tener analytics/reglas gratis después.)*

**Antes de cambiar los NS**, confirmar con Luis que en BanaHosting no queda un
buzón de correo con historial que alguien siga necesitando. El correo hoy no
entra (no hay MX resolvible), pero el archivo viejo vive en ese hosting.

## Fase 2 — Vercel (sin tocar producción)

7. Vercel → proyecto **`freakie-dogs-caja`** → *Settings → Domains* → agregar
   `erp.freakiedogs.com` y `pos.freakiedogs.com`.
8. Proyecto **`freakiedelivery`** → agregar `pedidos.freakiedogs.com`, `www` y
   el apex.
9. Crear en Cloudflare los registros **exactamente como los muestra Vercel**
   (`CNAME → cname.vercel-dns.com` para los subdominios, `A → 76.76.21.21` para
   el apex). **Nube gris — proxy de Cloudflare APAGADO**: con el proxy encendido
   son dos CDN encadenadas y Vercel no puede emitir su certificado.
10. Abrir `https://erp.freakiedogs.com` y `https://pedidos.freakiedogs.com`.
    Deben servir lo mismo que los `.vercel.app`. Hasta acá **nada cambió** para
    la operación: son hosts nuevos que nadie usa todavía.

## Fase 3 — `api.freakiedogs.com` y muerte del proxy `/sb`

Esta es la fase que arregla el problema de fondo: los **1,858 errores 504 en
10 minutos** del 4-sep, el techo duro de ~25 s del runtime Edge y el WebSocket
roto (ver `src/supabase.js`).

11. Supabase → proyecto `btboxlwfqcbrdfrlnwln` → *Settings → General → Custom
    Domains* → activar el add-on (**~$10/mes**; la organización ya está en Pro).
12. Registrar `api.freakiedogs.com`. Supabase entrega un CNAME y un TXT de
    verificación → crearlos en Cloudflare (**nube gris**) → *Verify* → *Activate*.
13. Verificar que el WebSocket sí sube por el host nuevo (con HTTP/2 la prueba
    es inconclusa, hay que forzar 1.1):
    ```
    curl -s -i --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
      -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
      "https://api.freakiedogs.com/realtime/v1/websocket?apikey=<anon>&vsn=1.0.0"
    ```
    Esperado: `101 Switching Protocols`.
14. **El switch** — variables de entorno en Vercel (Production) y redeploy:

    | Variable | Proyecto | Valor |
    |---|---|---|
    | `VITE_SB_URL` | ambos | `https://api.freakiedogs.com` |
    | `VITE_URL_DELIVERY` | ambos | `https://pedidos.freakiedogs.com` |
    | `URL_DELIVERY` | `freakie-dogs-caja` | `https://pedidos.freakiedogs.com` |

    El código ya está preparado: con `VITE_SB_URL` seteada, `src/supabase.js`
    deja de usar el proxy **y** deja de hacer el swap del `RealtimeClient` (ese
    parche existía solo porque el proxy no sabe hacer upgrade a WebSocket).
    **Rollback = borrar la variable y redeployar.** No hay que tocar código.
15. Hacer el switch un **martes o miércoles por la mañana**, nunca viernes ni en
    hora pico. Vigilar 30 min: login del POS, cobro, KDS en vivo, despacho.
16. Dejar `api/supaproxy.js` desplegado ~2 semanas como red de seguridad. Recién
    después evaluar borrarlo junto con los rewrites `/sb` de `vercel.json`.

## Fase 4 — Correo

17. Google Workspace (~$7/usuario/mes) o Zoho Mail (plan gratis hasta 5 buzones).
18. MX + **SPF + DKIM + DMARC** en Cloudflare. Sin los tres, los correos con el
    DTE le caen en spam al cliente.
19. Buzones mínimos: `pedidos@`, `facturacion@`, `admin@`.

## Fase 5 — Cola (después del switch, sin prisa)

20. **TikTok**: `public/tiktok-auth.html:106` y la verificación de dominio del
    portal apuntan a `freakie-dogs-caja.vercel.app`. Dar de alta el redirect URI
    nuevo **antes** de cambiar el archivo, o el OAuth se cae.
21. **Meta / Instagram**: rehacer la verificación de dominio.
22. **APK del driver**: `android-driver/` carga el `.vercel.app` en el WebView.
    Repuntarlo a `pos.freakiedogs.com` exige recompilar y reinstalar en cada
    teléfono — hacerlo solo cuando toque otra actualización del APK.
23. **n1co**: los orígenes ya están permitidos (`api/n1co.js`, `api/n1co-link.js`
    traen `freakiedogs.com`, `www.` y `pedidos.` en `ORIGENES_OK`, más la
    variable `N1CO_ORIGENES`). Lo que **sí** hay que hacer es avisarle a n1co el
    dominio de producción del comercio al pedir credenciales productivas.
24. QR impresos del menú y links del manual: regenerar cuando toque reimprimir.

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
