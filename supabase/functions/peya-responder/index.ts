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
// LLAMADA (desde el POS o desde scripts/peya-responder.sh):
//   POST /functions/v1/peya-responder
//   x-freakie-secreto: <PEYA_ACCION_SECRET>
//   { "remoteOrderId": "FD-...", "accion": "aceptar" }
//   { "remoteOrderId": "FD-...", "accion": "rechazar", "motivo": "ITEM_UNAVAILABLE",
//     "mensaje": "Se acabó el pan brioche" }
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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
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
const MINUTOS_PREP_DEFAULT = 20;

function calcularAcceptanceTime(orden: Record<string, any>): string {
  const p = orden.payload ?? {};
  const candidato = orden.tipo_orden === "pickup"
    ? p?.pickup?.pickupTime
    : orden.tipo_orden === "vendor_delivery"
    ? p?.delivery?.expectedDeliveryTime
    : p?.delivery?.riderPickupTime;

  const porDefecto = Date.now() + MINUTOS_PREP_DEFAULT * 60_000;
  let ms = candidato ? Date.parse(candidato) : NaN;
  if (!Number.isFinite(ms)) ms = porDefecto;

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

Deno.serve(async (req) => {
  if (req.method === "GET") {
    return json({ status: "ok", service: "freakie-dogs-peya-responder" });
  }
  if (req.method !== "POST") return json({ error: "metodo_no_permitido" }, 405);

  // Esta función hace acciones con consecuencias reales contra la API de PedidosYa,
  // así que va detrás de un secreto propio y no queda expuesta con sólo conocer la URL.
  if (!ACCION_SECRET || req.headers.get("x-freakie-secreto") !== ACCION_SECRET) {
    return json({ error: "no_autorizado" }, 401);
  }

  let cuerpo: Record<string, any>;
  try {
    cuerpo = await req.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }

  const { remoteOrderId, orderToken, accion, motivo, mensaje } = cuerpo;
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

  const cb = (orden.callback_urls ?? {}) as Record<string, string>;
  const token = orden.order_token;

  let url: string;
  let payloadDH: unknown | null;
  let estadoNuevo: string;
  const ahora = new Date().toISOString();
  const cambios: Record<string, unknown> = { actualizado_at: ahora };

  if (accion === "aceptar") {
    url = cb.orderAcceptedUrl || `${BASE}/v2/order/status/${encodeURIComponent(token)}`;
    payloadDH = {
      status: "order_accepted",
      acceptanceTime: cuerpo.acceptanceTime || calcularAcceptanceTime(orden),
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

  return json({
    ok,
    accion,
    remoteOrderId: orden.remote_order_id,
    esPrueba: orden.es_prueba,
    venceEn: orden.expiry_date,
    enviadoA: url,
    payload: payloadDH,
    respuesta: { http: r.status, intentos: r.intentos, cuerpo: r.texto.slice(0, 500) },
  }, ok ? 200 : 502);
});
