// Responde a Delivery Hero sobre un pedido: aceptar, rechazar, marcar preparado o retirado.
// Es la contraparte de `peya-plugin`: aquel recibe, éste contesta.
//
// Doc: https://integration-middleware.stg.restaurant-partners.com/apidocs/pos-middleware-api
//
// POR QUÉ IMPORTA LA VENTANA DE TIEMPO
// Cada pedido trae `expiryDate`. Si no se acepta ni rechaza antes de esa hora, DH lo cancela
// solo con motivo NO_RESPONSE (típicamente a los 15 minutos) y, si pasa seguido, cierra la
// tienda para proteger su tasa de fallas. Aceptar a tiempo no es una cortesía: es lo que
// mantiene la tienda abierta.
//
// DOS FORMAS DE AUTENTICARSE, y no son intercambiables
//   a) `pin` en el cuerpo — la del POS. El POS es una PWA en el navegador: un
//      secreto fijo en el frontend se lee con F12, así que no puede ser la puerta.
//      El PIN ya es la credencial con la que el cajero entra, se valida contra
//      usuarios_erp en cada llamada y además ata la acción a una persona y a una
//      sucursal (nadie contesta pedidos de otra tienda).
//   b) `x-freakie-secreto: <PEYA_ACCION_SECRET>` — la de los scripts, el cron y
//      la autoprueba, que corren en servidores y no tienen PIN.
//
// LLAMADA:
//   POST /functions/v1/peya-responder
//   { "pin": "1234", "remoteOrderId": "FD-...", "accion": "aceptar" }
//   { "pin": "1234", "remoteOrderId": "FD-...", "accion": "rechazar",
//     "motivo": "ITEM_UNAVAILABLE", "mensaje": "Se acabó el pan brioche" }
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const USUARIO = Deno.env.get("PEYA_USERNAME") ?? "";
const PASSWORD = Deno.env.get("PEYA_PASSWORD") ?? "";
const ACCION_SECRET = Deno.env.get("PEYA_ACCION_SECRET") ?? "";
const BASE = (Deno.env.get("PEYA_BASE_URL") ??
  "https://integration-middleware.us.restaurant-partners.com").replace(/\/+$/, "");

// Lo llama el navegador del POS, así que necesita CORS y preflight.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-freakie-secreto",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Token de la API (cacheado) ----------
// expires_in viene en 7200 s. Pedir un token por request sería gratis pero lento y
// ruidoso; se renueva con 5 minutos de margen sobre el vencimiento real.
let tokenCache: { valor: string; venceEn: number } | null = null;

async function obtenerToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.venceEn) return tokenCache.valor;
  if (!USUARIO || !PASSWORD) throw new Error("faltan PEYA_USERNAME / PEYA_PASSWORD");

  const r = await fetch(`${BASE}/v2/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: USUARIO,
      password: PASSWORD,
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Error(`login ${r.status}: ${(await r.text()).slice(0, 300)}`);

  const d = await r.json();
  if (!d?.access_token) throw new Error("login sin access_token");
  const margen = 300_000; // 5 min
  tokenCache = {
    valor: d.access_token,
    venceEn: Date.now() + Math.max(Number(d.expires_in ?? 3600) * 1000 - margen, 60_000),
  };
  return tokenCache.valor;
}

// ---------- acceptanceTime ----------
// El significado cambia según el tipo de orden (§ acceptanceTime del contrato):
//   pickup          → cuándo estará listo para que el cliente lo recoja (pickup.pickupTime)
//   vendor delivery → cuándo se entrega al cliente (delivery.expectedDeliveryTime)
//   own delivery    → no tiene efecto, existe por compatibilidad; se usa riderPickupTime
// Y sobre todo: "needs to be at least 2 minutes later than the sending time of the
// request, otherwise acceptance request will fail".
//
// DE DÓNDE SALE EL NÚMERO
// Antes era un fijo de 20 minutos para las 6 tiendas. Lourdes tiene mediana real
// de 7: le prometíamos casi el triple y el motorista llegaba tarde a una bolsa
// que ya estaba lista. Ahora sale de `peya_minutos_prep`, que es la mediana (p50)
// de `aceptado_en → lista_para_retiro` de esa tienda A ESA HORA, sobre los últimos
// 90 días de la liquidación de PedidosYa. Varía con el volumen, que es justo lo
// que ellos modelaban: Cafetalón p50 12 a mediodía, 8 a las 9pm.
//
// A la mediana le toca llegar tarde la mitad de las veces, por definición. Es la
// elección deliberada: apuntar al p90 sería prometer 22 minutos en Cafetalón para
// cubrir los peores, y hacer esperar al motorista el resto del día. Se cambia con
// un `peya_recalcular_tiempo_prep(90, 0.9)` si se decide lo contrario.
//
// CUÁNDO MANDA EL NÚMERO DE ELLOS Y CUÁNDO EL NUESTRO
// El significado de acceptanceTime cambia según el tipo, así que la fuente también:
//   pickup          → cuándo estará listo. Lo decidimos nosotros: va el p50.
//   vendor_delivery → cuándo lo recibe el CLIENTE. Eso es nuestra cocina más el
//                     viaje de ellos; su expectedDeliveryTime lo estima mejor.
//   own_delivery    → no tiene efecto (existe por compatibilidad); riderPickupTime.
const MINUTOS_PREP_FALLBACK = 15;

async function minutosPrep(orden: Record<string, any>): Promise<number> {
  try {
    const { data } = await svc.rpc("peya_minutos_prep", {
      p_sucursal_id: orden.sucursal_id,
    });
    const n = Number(data);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (e) {
    console.error("peya_minutos_prep falló, va el fallback", String(e));
  }
  return MINUTOS_PREP_FALLBACK;
}

async function calcularAcceptanceTime(orden: Record<string, any>): Promise<string> {
  const p = orden.payload ?? {};
  const prep = await minutosPrep(orden);
  const nuestro = Date.now() + prep * 60_000;

  const deEllos = orden.tipo_orden === "vendor_delivery"
    ? p?.delivery?.expectedDeliveryTime
    : orden.tipo_orden === "own_delivery"
    ? p?.delivery?.riderPickupTime
    : null;

  let ms = deEllos ? Date.parse(deEllos) : NaN;
  if (!Number.isFinite(ms)) ms = nuestro;

  // Piso duro de 3 minutos: con menos, DH rechaza la aceptación y el pedido se pierde
  // por vencimiento. El margen sobre el mínimo de 2 absorbe la latencia de red.
  const piso = Date.now() + 3 * 60_000;
  if (ms < piso) ms = piso;

  return new Date(ms).toISOString();
}

// ---------- Envío con reintento del 409 recuperable ----------
// La doc: si el estado actual es ASSIGNED_TO_TRANSPORT o WAITING_FOR_ACKNOWLEDGEMENT, el
// dispatch todavía no terminó de asentarse del lado de DH y hay que reintentar "every ~10
// seconds for next 5 minutes" para que el pedido no quede colgado y se cancele solo.
// Los otros 409 (pedido ya cancelado, integración indirecta) NO se reintentan.
const ESTADOS_REINTENTABLES = new Set(["ASSIGNED_TO_TRANSPORT", "WAITING_FOR_ACKNOWLEDGEMENT"]);
const MAX_INTENTOS = 4;

async function enviarADH(
  url: string,
  cuerpo: unknown | null,
): Promise<{ status: number; texto: string; intentos: number }> {
  let ultimo = { status: 0, texto: "", intentos: 0 };

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const token = await obtenerToken();
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    const texto = (await r.text()).slice(0, 1000);
    ultimo = { status: r.status, texto, intentos: intento };

    if (r.ok) return ultimo;

    // Un 401 puede ser el token vencido antes de lo anunciado: se tira el cache y se
    // reintenta una vez con uno nuevo.
    if (r.status === 401 && intento === 1) {
      tokenCache = null;
      continue;
    }

    if (r.status === 409) {
      let estadoActual = "";
      try {
        estadoActual = JSON.parse(texto)?.currentState ?? "";
      } catch { /* cuerpo no JSON: no reintentable */ }
      if (ESTADOS_REINTENTABLES.has(estadoActual) && intento < MAX_INTENTOS) {
        await dormir(10_000);
        continue;
      }
      return ultimo; // 409 no recuperable
    }

    if (r.status >= 500 && intento < MAX_INTENTOS) {
      await dormir(10_000);
      continue;
    }
    return ultimo;
  }
  return ultimo;
}

// ---------- Quién puede contestar un pedido ----------
// Los mismos roles que pueden marcar comida lista en el panel de delivery: si
// alguien puede decirle a la cocina que algo salió, puede aceptar un pedido.
const ROLES_PERMITIDOS = new Set([
  "cocina", "gerente", "cajero", "cajera", "jefe_casa_matriz",
  "admin", "superadmin", "ejecutivo", "telefono",
]);
// La central de delivery y administración atienden todas las tiendas.
const ROLES_TODAS_LAS_TIENDAS = new Set(["admin", "superadmin", "ejecutivo", "telefono"]);

type Actor = { nombre: string; rol: string; storeCode: string; todas: boolean };

async function autorizarPorPin(pin: string): Promise<Actor | null> {
  const { data } = await svc.from("usuarios_erp")
    .select("nombre, apellido, rol, store_code")
    .eq("pin", String(pin).trim()).eq("activo", true).limit(1);
  const u = data?.[0];
  if (!u || !ROLES_PERMITIDOS.has(u.rol)) return null;
  return {
    nombre: [u.nombre, u.apellido].filter(Boolean).join(" ").trim() || "staff",
    rol: u.rol,
    storeCode: u.store_code,
    todas: ROLES_TODAS_LAS_TIENDAS.has(u.rol),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET") {
    return json({ status: "ok", service: "freakie-dogs-peya-responder" });
  }
  if (req.method !== "POST") return json({ error: "metodo_no_permitido" }, 405);

  let cuerpo: Record<string, any>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }

  const { pin, remoteOrderId, orderToken, accion, motivo, mensaje, forzar } = cuerpo;

  // Esta función hace cosas con consecuencias reales contra PedidosYa, así que no
  // puede quedar expuesta con sólo conocer la URL. Se entra por PIN (el POS) o por
  // el secreto de servidor (scripts, cron, autoprueba); nunca sin ninguno.
  const porSecreto = !!ACCION_SECRET && req.headers.get("x-freakie-secreto") === ACCION_SECRET;
  let actor: Actor | null = null;
  if (!porSecreto) {
    if (!pin) return json({ error: "no_autorizado", motivo: "sin_pin_ni_secreto" }, 401);
    actor = await autorizarPorPin(pin);
    if (!actor) return json({ error: "no_autorizado", motivo: "pin_invalido_o_rol_sin_permiso" }, 401);
  }
  if (!["aceptar", "rechazar", "preparado", "retirado"].includes(accion)) {
    return json({ error: "accion_invalida", validas: ["aceptar", "rechazar", "preparado", "retirado"] }, 400);
  }
  if (!remoteOrderId && !orderToken) {
    return json({ error: "falta_remoteOrderId_u_orderToken" }, 400);
  }

  // Rechazar sin motivo válido lo rebota DH; mejor fallar acá con un mensaje claro.
  if (accion === "rechazar" && !motivo) {
    return json({ error: "rechazo_sin_motivo", ayuda: "p.ej. ITEM_UNAVAILABLE, TOO_BUSY, CLOSED, TEST_ORDER" }, 400);
  }

  const q = svc.from("peya_ordenes").select("*").limit(1);
  const { data: filas, error: errBusca } = remoteOrderId
    ? await q.eq("remote_order_id", remoteOrderId)
    : await q.eq("order_token", orderToken);

  if (errBusca) return json({ error: "error_bd", message: errBusca.message }, 500);
  const orden = filas?.[0];
  if (!orden) return json({ error: "orden_no_encontrada" }, 404);

  // Un cajero no contesta pedidos de otra tienda: el alcance lo decide el
  // servidor a partir del PIN, nunca lo que mande el cliente.
  if (actor && !actor.todas) {
    const { data: suc } = await svc.from("sucursales")
      .select("id").eq("store_code", actor.storeCode).limit(1);
    if (!suc?.[0]?.id || orden.sucursal_id !== suc[0].id) {
      return json({ error: "pedido_de_otra_sucursal" }, 403);
    }
  }

  // ---------- Candado: no se retira lo que cocina no terminó ----------
  // `order_picked_up` es irreversible: a partir de ahí DH da el pedido por
  // entregado y entra a la liquidación. Si esto se aprieta mientras la plancha
  // todavía arma la bolsa, el motorista se va sin comida y el reclamo llega con
  // la venta ya cobrada. La verdad de "listo" es la cola de cocina, la misma que
  // pone la tarjeta en verde en el KDS.
  //
  // Se puede forzar, pero sólo gerencia y queda firmado: un KDS caído a las 8pm
  // no puede dejar la tienda sin manera de entregar. La cajera no tiene esa
  // llave — para ella el candado es duro, que es lo que se pidió.
  const ROLES_FUERZAN = new Set(["gerente", "jefe_casa_matriz", "admin", "superadmin", "ejecutivo"]);
  let notaForzado: string | null = null;
  if (accion === "retirado") {
    const { data: cocina } = await svc.rpc("peya_listo_para_retirar", { p_orden_id: orden.id });
    const listo = (cocina as Record<string, any> | null)?.listo !== false;
    if (!listo) {
      const puedeForzar = forzar === true && (porSecreto || (actor && ROLES_FUERZAN.has(actor.rol)));
      if (!puedeForzar) {
        return json({
          error: "cocina_no_termino",
          message: (cocina as Record<string, any>)?.motivo ?? "Cocina todavía no marcó la comanda lista",
          cocina,
          puedeForzarlo: actor ? ROLES_FUERZAN.has(actor.rol) : true,
        }, 409);
      }
      notaForzado = `retiro forzado sin que cocina marcara listo, por ${
        actor ? `${actor.nombre} (${actor.rol})` : "sistema"
      }`;
    }
  }

  const cb = (orden.callback_urls ?? {}) as Record<string, string>;
  const token = orden.order_token;

  let url: string;
  let payloadDH: unknown | null;
  let estadoNuevo: string;
  const ahora = new Date().toISOString();
  // Cuando un cliente reclama un rechazo, la pregunta siguiente es siempre quién
  // lo rechazó. Sin esto sólo queda el motivo, sin la persona.
  const cambios: Record<string, unknown> = {
    actualizado_at: ahora,
    respondido_por: actor ? `${actor.nombre} (${actor.rol})` : "sistema",
    ...(notaForzado ? { notas: notaForzado } : {}),
  };

  if (accion === "aceptar") {
    url = cb.orderAcceptedUrl || `${BASE}/v2/order/status/${encodeURIComponent(token)}`;
    payloadDH = {
      status: "order_accepted",
      acceptanceTime: cuerpo.acceptanceTime || await calcularAcceptanceTime(orden),
      remoteOrderId: orden.remote_order_id,
    };
    estadoNuevo = "aceptado";
    cambios.aceptado_at = ahora;
  } else if (accion === "rechazar") {
    url = cb.orderRejectedUrl || `${BASE}/v2/order/status/${encodeURIComponent(token)}`;
    payloadDH = { status: "order_rejected", reason: motivo, message: mensaje ?? "" };
    estadoNuevo = "rechazado";
    cambios.rechazado_at = ahora;
    cambios.motivo_rechazo = `${motivo}: ${mensaje ?? ""}`.slice(0, 500);
  } else if (accion === "preparado") {
    // Sólo aplica a pedidos que reparte un rider de DH: le avisa que ya puede recogerlo.
    url = cb.orderPreparedUrl ||
      `${BASE}/v2/orders/${encodeURIComponent(token)}/preparation-completed`;
    payloadDH = null;
    estadoNuevo = "preparado";
  } else {
    // order_picked_up sólo es válido para reparto del comercio y para retiro en tienda.
    url = cb.orderPickedUpUrl || `${BASE}/v2/order/status/${encodeURIComponent(token)}`;
    payloadDH = { status: "order_picked_up" };
    estadoNuevo = "retirado";
  }

  // Cinturón de seguridad para los pedidos simulados desde el POS. Sus callbacks
  // apuntan a un endpoint nuestro, pero si alguno faltara, la URL por defecto de
  // arriba es la API REAL de Delivery Hero — y les llegaría un pedido que de su
  // lado no existe. Ya pasó una vez con `orderPickedUpUrl`. Un pedido de prueba de
  // DH (test: true) sí debe contestarse contra DH: por eso el corte es el vendor
  // simulado, no el flag `es_prueba`.
  const esSimulado = String(orden.vendor_remote_id ?? "").startsWith("SIMULADO-");
  if (esSimulado && !url.includes("/functions/v1/")) {
    return json({
      error: "simulado_no_sale_a_peya",
      message: `La acción "${accion}" de un pedido simulado habría ido a ${url}. Falta su callback.`,
    }, 400);
  }

  let r: { status: number; texto: string; intentos: number };
  try {
    r = await enviarADH(url, payloadDH);
  } catch (e) {
    return json({ error: "fallo_llamando_a_peya", message: String(e) }, 502);
  }

  const ok = r.status >= 200 && r.status < 300;
  cambios.respuesta_http = r.status;
  cambios.respuesta_cuerpo = r.texto.slice(0, 1000);
  cambios.intentos_respuesta = r.intentos;
  // El estado local sólo avanza si DH lo confirmó. Marcarlo como aceptado cuando la
  // llamada falló haría creer que el pedido está vivo mientras se vence solo.
  if (ok) cambios.estado = estadoNuevo;

  await svc.from("peya_ordenes").update(cambios).eq("id", orden.id);

  // Aceptar a mano tiene que armar la comanda igual que cuando acepta el webhook.
  // Sin esto el pedido queda aceptado en PedidosYa y en ningún lado más: ni en
  // cocina, ni en caja. Se descubrió probando en Cafetalón el 12-sep.
  //
  // La misma regla que usa el webhook: los pedidos `test: true` de DH se aceptan
  // pero NO bajan a cocina; los simulados nuestros sí, que para eso son.
  // `peya_crear_cuenta` es idempotente (si ya hay pos_cuenta_id, devuelve la misma),
  // así que un doble clic no duplica la comanda.
  let comanda: unknown = null;
  if (ok && accion === "aceptar") {
    const esNuestro = String(orden.vendor_remote_id ?? "").startsWith("SIMULADO-");
    if (!orden.es_prueba || esNuestro) {
      const { data: c, error: errComanda } = await svc.rpc("peya_crear_cuenta", {
        p_orden_id: orden.id,
      });
      if (errComanda) {
        console.error("aceptado SIN comanda", orden.remote_order_id, errComanda.message);
        comanda = { ok: false, error: errComanda.message };
        await svc.from("peya_ordenes").update({
          notas: `aceptado en PeYa pero la comanda falló: ${errComanda.message}`,
        }).eq("id", orden.id);
      } else {
        comanda = c;
      }
    } else {
      comanda = { ok: true, omitida: "pedido de prueba de PedidosYa: no baja a cocina" };
    }
  }

  // El retiro es el momento en que la venta se vuelve cuenta por cobrar. Se cierra
  // DESPUÉS de que DH confirmó: una cuenta cobrada sobre un pedido que ellos no dan
  // por retirado descuadra la liquidación del viernes.
  let cierre: unknown = null;
  if (ok && accion === "retirado") {
    const { data: c, error: errCierre } = await svc.rpc("peya_cerrar_cuenta", {
      p_orden_id: orden.id,
      p_por: actor ? `${actor.nombre} (${actor.rol})` : "sistema",
    });
    if (errCierre) {
      // DH ya sabe que salió, así que no se revierte nada; pero la cuenta quedó
      // abierta y eso lo tiene que ver alguien antes del cierre de turno.
      console.error("retiro OK pero la cuenta no cerró", orden.remote_order_id, errCierre.message);
      cierre = { ok: false, error: errCierre.message };
      await svc.from("peya_ordenes").update({
        notas: `retirado en PeYa pero la cuenta no cerró: ${errCierre.message}`,
      }).eq("id", orden.id);
    } else {
      cierre = c;
    }
  }

  return json({
    ok,
    accion,
    comanda,
    cierre,
    por: actor ? actor.nombre : "sistema",
    remoteOrderId: orden.remote_order_id,
    esPrueba: orden.es_prueba,
    venceEn: orden.expiry_date,
    enviadoA: url,
    payload: payloadDH,
    respuesta: { http: r.status, intentos: r.intentos, cuerpo: r.texto.slice(0, 500) },
  }, ok ? 200 : 502);
});
