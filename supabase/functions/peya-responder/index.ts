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
//   { "pin": "1234", "remoteOrderId": "FD-...", "accion": "ajustar_prep", "minutos": 10 }
//   { "pin": "1234", "accion": "tienda", "abrir": false,
//     "motivo": "TOO_BUSY_KITCHEN", "minutos": 30 }
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
  metodo: "POST" | "PUT" | "GET" = "POST",
): Promise<{ status: number; texto: string; intentos: number }> {
  let ultimo = { status: 0, texto: "", intentos: 0 };

  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    const token = await obtenerToken();
    const r = await fetch(url, {
      method: metodo,
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

// ---------- Bloque 1: abrir y cerrar la tienda en PedidosYa ----------
// Contrato: middlewareExternalApi.yaml, "Availability Status GET/PUT".
//
// El PUT NO se puede armar a ciegas. Dice la doc: «It should first be checked which
// kind of availability changes are allowed by making a GET request to this endpoint
// and verifying that the `changeable` property is true otherwise the request will be
// unsuccessful». Y el GET devuelve un ARRAY: un local puede estar publicado en varias
// plataformas de Delivery Hero a la vez, cada una con su `platformKey`, su
// `platformRestaurantId` y su propia lista de estados y motivos permitidos.
//
// O sea que el orden es: consultar, quedarse con las plataformas que se dejan
// cambiar, y mandarle a cada una sólo valores que ella misma declaró aceptar.
async function accionTienda(
  pin: string | undefined,
  cuerpo: Record<string, any>,
): Promise<Response> {
  const abrir = cuerpo.abrir === true;
  const minutos = Number(cuerpo.minutos ?? 0) || null;
  const motivo = String(cuerpo.motivo ?? "TOO_BUSY_KITCHEN").toUpperCase();

  if (!pin) return json({ error: "falta_pin" }, 400);

  const { data: v, error: errV } = await svc.rpc("peya_vendor_de_usuario", { p_pin: String(pin) });
  if (errV) return json({ error: "base", message: errV.message }, 500);
  const vendor = v as Record<string, any>;
  if (!vendor?.ok) return json(vendor ?? { error: "sin_vendor" }, 400);

  const urlDisp = `${BASE}/v2/chains/${encodeURIComponent(vendor.chain_code)}` +
    `/remoteVendors/${encodeURIComponent(vendor.remote_id)}/availability`;

  // 1) Consultar. El 204 significa «pedido recibido, todavía no hay respuesta»:
  // no es un error y no hay que tratarlo como tal, hay que volver a preguntar.
  const get = await enviarADH(urlDisp, null, "GET");
  if (get.status === 204) {
    return json({ error: "consulta_en_curso", reintentar_en_segundos: 5,
      message: "PedidosYa acusó la consulta pero todavía no tiene el estado." }, 202);
  }
  if (get.status < 200 || get.status >= 300) {
    return json({ error: "no_se_pudo_consultar", http: get.status, respuesta: get.texto }, 502);
  }

  let plataformas: Record<string, any>[] = [];
  try {
    const d = JSON.parse(get.texto);
    plataformas = Array.isArray(d) ? d : [d];
  } catch {
    return json({ error: "respuesta_no_json", respuesta: get.texto }, 502);
  }

  // Se guarda lo consultado aunque después falle el PUT: sirve para diagnosticar y
  // para saber en qué plataformas está publicada la tienda.
  await svc.rpc("peya_guardar_plataformas", {
    p_remote_id: vendor.remote_id,
    p_plataformas: plataformas,
  });

  const cambiables = plataformas.filter((p) => p?.changeable === true);
  if (cambiables.length === 0) {
    return json({
      error: "ninguna_plataforma_cambiable",
      message: "PedidosYa no permite cambiar el estado de esta tienda ahora mismo.",
      plataformas,
    }, 409);
  }

  // 2) Escribir, una por plataforma y con sus propios valores permitidos.
  const resultados: Record<string, unknown>[] = [];
  for (const p of cambiables) {
    const permitidos: string[] = Array.isArray(p.availabilityStates) ? p.availabilityStates : [];
    let estado = "";

    if (abrir) {
      if (!permitidos.includes("OPEN")) {
        resultados.push({ platformKey: p.platformKey, omitida: "no_acepta_OPEN", permitidos });
        continue;
      }
      estado = "OPEN";
    } else {
      // `closingMinutes` sólo funciona con CLOSED_UNTIL — el resto lo ignora. Si la
      // plataforma no lo acepta, se cae a CLOSED, que es un cierre sin hora de vuelta.
      if (minutos && permitidos.includes("CLOSED_UNTIL")) estado = "CLOSED_UNTIL";
      else if (permitidos.includes("CLOSED")) estado = "CLOSED";
      else if (permitidos.includes("CLOSED_UNTIL")) estado = "CLOSED_UNTIL";

      if (!estado) {
        resultados.push({ platformKey: p.platformKey, omitida: "no_acepta_cierre", permitidos });
        continue;
      }
    }

    const cuerpoPut: Record<string, unknown> = {
      availabilityState: estado,
      platformKey: p.platformKey,
      platformRestaurantId: String(p.platformRestaurantId),
    };

    if (!abrir) {
      // El motivo también sale de lo que declaró esa plataforma; si no lo acepta, se
      // usa el primero de su lista antes que arriesgar un 400 por un enum ajeno.
      const motivosOk: string[] = Array.isArray(p.closingReasons) ? p.closingReasons : [];
      if (motivosOk.includes(motivo)) cuerpoPut.closedReason = motivo;
      else if (motivosOk.includes("OTHER")) cuerpoPut.closedReason = "OTHER";
      else cuerpoPut.closedReason = motivosOk[0] ?? motivo;

      if (estado === "CLOSED_UNTIL" && minutos) {
        // Sus `closingMinutes` son una lista cerrada (30/60/120/...): se elige el
        // más cercano al pedido en vez de mandar un número que van a rebotar.
        const ops: number[] = Array.isArray(p.closingMinutes) ? p.closingMinutes : [];
        cuerpoPut.closingMinutes = ops.length
          ? ops.reduce((a, b) => Math.abs(b - minutos) < Math.abs(a - minutos) ? b : a)
          : minutos;
      }
    }

    const put = await enviarADH(urlDisp, cuerpoPut, "PUT");
    const okPut = put.status >= 200 && put.status < 300;
    resultados.push({
      platformKey: p.platformKey,
      enviado: cuerpoPut,
      http: put.status,
      ok: okPut,
      respuesta: okPut ? undefined : put.texto,
    });
  }

  const todoOk = resultados.every((r) => r.ok === true || r.omitida);
  const algunoOk = resultados.some((r) => r.ok === true);

  // El estado local sólo se mueve si PedidosYa aceptó al menos una. Al revés —
  // marcarlo cerrado acá y seguir recibiendo pedidos— sería peor que no hacer nada:
  // la caja creería que no entran y entrarían igual.
  let local: unknown = null;
  if (algunoOk) {
    const { data: l } = await svc.rpc("peya_tienda_abrir_cerrar", {
      p_pin: String(pin),
      p_disponible: abrir,
      p_motivo: abrir ? null : motivo,
      p_minutos: abrir ? null : minutos,
    });
    local = l;
  }

  const salida: Record<string, unknown> = {
    ok: algunoOk,
    abierta: abrir,
    plataformas: resultados,
    local,
  };
  if (algunoOk && !todoOk) salida.aviso = "alguna plataforma no aceptó el cambio";
  return json(salida, algunoOk ? 200 : 502);
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
  // Abrir/cerrar la tienda no es sobre un pedido: se resuelve antes de pedir
  // remoteOrderId.
  if (accion === "tienda") {
    return await accionTienda(pin, cuerpo);
  }

  const ACCIONES = ["aceptar", "rechazar", "preparado", "retirado", "ajustar_prep"];
  if (!ACCIONES.includes(accion)) {
    return json({ error: "accion_invalida", validas: ACCIONES.concat(["tienda"]) }, 400);
  }
  if (!remoteOrderId && !orderToken) {
    return json({ error: "falta_remoteOrderId_u_orderToken" }, 400);
  }

  // Los 24 motivos válidos del contrato (shared-components.yaml, `order_rejected`).
  // Un código fuera de esta lista lo rebota DH con 400, y entonces el pedido se queda
  // sin contestar hasta que vence: cuenta como fallo nuestro y puede cerrar la tienda.
  // Se valida acá y no sólo en el POS porque a este endpoint también entra la
  // aceptación automática.
  const MOTIVOS_VALIDOS = new Set([
    "ADDRESS_INCOMPLETE_MISSTATED", "BAD_WEATHER", "BLACKLISTED",
    "CARD_READER_NOT_AVAILABLE", "CLOSED", "CONTENT_WRONG_MISLEADING",
    "FOOD_QUALITY_SPILLAGE", "FRAUD_PRANK", "ITEM_UNAVAILABLE", "LATE_DELIVERY",
    "MENU_ACCOUNT_SETTINGS", "MOV_NOT_REACHED", "NO_COURIER", "NO_PICKER",
    "NO_RESPONSE", "OUTSIDE_DELIVERY_AREA", "TECHNICAL_PROBLEM", "TEST_ORDER",
    "TOO_BUSY", "UNABLE_TO_FIND", "UNABLE_TO_PAY", "UNPROFESSIONAL_BEHAVIOUR",
    "WILL_NOT_WORK_WITH_PLATFORM", "WRONG_ORDER_ITEMS_DELIVERED",
  ]);

  if (accion === "rechazar" && !motivo) {
    return json({
      error: "rechazo_sin_motivo",
      ayuda: "p.ej. ITEM_UNAVAILABLE, TOO_BUSY, CLOSED, TEST_ORDER",
    }, 400);
  }
  if (accion === "rechazar" && !MOTIVOS_VALIDOS.has(String(motivo).toUpperCase())) {
    return json({
      error: "motivo_invalido",
      motivo,
      message: "Delivery Hero rebota los motivos que no están en su lista.",
      validos: Array.from(MOTIVOS_VALIDOS),
    }, 400);
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
  } else if (accion === "ajustar_prep") {
    // Cocina se saturó y el tiempo prometido al aceptar ya no es real. Se corre la
    // hora de retiro para que el motorista no llegue a esperar de gusto.
    //
    // Sólo aplica a pedidos que reparte un rider de DH, y sólo hasta que el rider
    // aceptó el viaje. El rango permitido viene en el propio pedido: mandar algo
    // fuera de min/max lo rebotan con 400.
    const info = (orden.payload?.preparationTimeAdjustmentInformation ?? {}) as Record<string, string>;
    const min = info.minPickUpTimestamp ?? info.minPickupTimestamp ?? null;
    const max = info.maxPickUpTimestamp ?? info.maxPickupTimestamp ?? null;

    const mins = Number(cuerpo.minutos ?? 0);
    if (!mins || !Number.isFinite(mins)) {
      return json({ error: "faltan_minutos", message: "Cuántos minutos más necesita cocina." }, 400);
    }

    const nuevo = new Date(Date.now() + mins * 60_000);
    if (min && nuevo < new Date(min)) {
      return json({ error: "fuera_de_rango", limite: "minPickUpTimestamp", min, max,
        message: "Ese tiempo es más corto de lo que PedidosYa permite para este pedido." }, 400);
    }
    if (max && nuevo > new Date(max)) {
      return json({ error: "fuera_de_rango", limite: "maxPickUpTimestamp", min, max,
        message: "Ese tiempo pasa del máximo que PedidosYa permite para este pedido." }, 400);
    }

    url = cb.orderPreparationTimeAdjustmentUrl ||
      `${BASE}/v2/orders/${encodeURIComponent(token)}/adjust-preparation-time`;
    payloadDH = { expectedPickupAt: nuevo.toISOString() };
    // Ajustar el tiempo NO mueve el pedido de estado: sigue en cocina.
    estadoNuevo = orden.estado;
    cambios.notas = `tiempo de preparación ajustado +${mins} min → ${nuevo.toISOString()}`;
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
