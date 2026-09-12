// Plugin PedidosYa (Delivery Hero) — implementa el contrato "POS Plugin API".
// Doc: https://integration-middleware.stg.restaurant-partners.com/apidocs/pos-plugin-api
//
// Endpoints que Delivery Hero llama sobre esta función (montada en /functions/v1/peya-plugin):
//   POST  /order/{remoteId}                                         → dispatch de una orden nueva
//   PUT   /remoteId/{id}/remoteOrder/{remoteOrderId}/posOrderStatus → cambios de estado
//   PUT   /remoteId/{id}/availability                               → apertura/cierre de la tienda
//   GET   /menuimport/{remoteId}?vendorCode=&menuImportId=          → pedido de menú
//   POST  /catalog-import-callback                                  → estado de import de catálogo
//   GET   /                                                         → health check (SSL/disponibilidad)
//
// AUTENTICACIÓN: el contrato de DH es JWT, no IP. Cada request trae
// `Authorization: Bearer <jwt>` firmado HMAC con el pluginSecret y con el claim
// `service: middleware`. La whitelist de IPs se conserva SOLO como dato informativo
// (`ip_valida`): las IPs de DH cambian y usarlas como gate haría perder pedidos reales.
//
// verify_jwt de Supabase queda en OFF a propósito: el JWT es de DH, no de Supabase,
// y con verify_jwt ON todo webhook moría en 401 antes de llegar a este código.
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PLUGIN_SECRET = Deno.env.get("PEYA_PLUGIN_SECRET") ?? "";

// IPs oficiales de Delivery Hero (LatAm prod + staging). Informativo, no bloquea.
const IPS_DH = new Set([
  "54.161.200.26", "54.174.130.155", "18.204.190.239",
  "34.246.34.27", "18.202.142.208", "54.72.10.41",
]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ---------- JWT (HS256/384/512) con Web Crypto, sin dependencias ----------

function b64urlABytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlATexto = (s: string) => new TextDecoder().decode(b64urlABytes(s));

/** Devuelve el payload si la firma es válida y el claim `service` es `middleware`. */
async function verificarJWT(
  authHeader: string | null,
  secreto: string,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; motivo: string }> {
  if (!secreto) return { ok: false, motivo: "plugin_secret_no_configurado" };
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return { ok: false, motivo: "sin_authorization_bearer" };
  }
  const token = authHeader.slice(7).trim();
  const partes = token.split(".");
  if (partes.length !== 3) return { ok: false, motivo: "jwt_malformado" };

  const [h, p, s] = partes;
  let header: Record<string, unknown>, payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlATexto(h));
    payload = JSON.parse(b64urlATexto(p));
  } catch {
    return { ok: false, motivo: "jwt_no_parseable" };
  }

  const hash = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" }[
    String(header.alg)
  ];
  if (!hash) return { ok: false, motivo: `alg_no_soportado:${header.alg}` };

  let firmaOk: boolean;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secreto),
      { name: "HMAC", hash },
      false,
      ["verify"],
    );
    firmaOk = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlABytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    return { ok: false, motivo: "error_verificando_firma" };
  }
  if (!firmaOk) return { ok: false, motivo: "firma_invalida" };

  // `exp` es opcional: el token de ejemplo de DH sólo trae {service: middleware}.
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return { ok: false, motivo: "jwt_vencido" };
  }
  if (payload.service !== "middleware") {
    return { ok: false, motivo: "claim_service_incorrecto" };
  }
  return { ok: true, payload };
}

// ---------- Tipo de orden (§ "Identify order type" del contrato) ----------

function tipoDeOrden(payload: Record<string, any> | null): string {
  const exp = payload?.expeditionType;
  if (exp === "pickup") return "pickup";
  if (exp === "delivery") {
    // riderPickupTime null ⇒ reparte el comercio; con valor ⇒ reparte un rider de DH.
    return payload?.delivery?.riderPickupTime == null ? "vendor_delivery" : "own_delivery";
  }
  return "desconocido";
}

// ---------- Aceptación automática ----------
// La decisión —aceptar, rechazar o no hacer nada— la toma la base (`peya_auto_decidir`):
// sabe del interruptor por tienda, del turno abierto y de los pedidos de prueba.
// Acá sólo se obedece.
//
// EL ORDEN IMPORTA. Primero se contesta a Delivery Hero y después se arma la comanda:
//   · Si se cocinara primero y la aceptación fallara, DH cancelaría el pedido por
//     vencimiento y la comida ya estaría hecha.
//   · Al revés, si la aceptación sale bien y la comanda falla, el pedido queda visible
//     en la bandeja como aceptado sin comanda — alguien lo ve y lo resuelve.
// El segundo problema se arregla; el primero se tira a la basura.
const ACCION_SECRET = Deno.env.get("PEYA_ACCION_SECRET") ?? "";

async function autoResponder(ordenId: number): Promise<void> {
  const { data: d, error } = await svc.rpc("peya_auto_decidir", { p_orden_id: ordenId });
  if (error) throw new Error(`peya_auto_decidir: ${error.message}`);
  if (!d || d.accion === "nada") return;

  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const { data: orden } = await svc.from("peya_ordenes")
    .select("remote_order_id").eq("id", ordenId).single();
  if (!orden?.remote_order_id) return;

  const llamar = (cuerpo: Record<string, unknown>) =>
    fetch(`${base}/functions/v1/peya-responder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-freakie-secreto": ACCION_SECRET },
      body: JSON.stringify({ remoteOrderId: orden.remote_order_id, ...cuerpo }),
    });

  if (d.accion === "rechazar") {
    const r = await llamar({ accion: "rechazar", motivo: d.motivo, mensaje: d.mensaje });
    console.log("auto-rechazo", orden.remote_order_id, d.motivo, r.status);
    return;
  }

  const r = await llamar({ accion: "aceptar" });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok || !cuerpo?.ok) {
    console.error("auto-aceptar rechazado por PeYa", orden.remote_order_id, r.status,
      JSON.stringify(cuerpo).slice(0, 300));
    return; // sin aceptación no se cocina
  }

  if (d.crear_comanda === false) {
    // Pedido de prueba de DH: se acepta —eso es lo que homologan— pero no baja a
    // cocina. El contrato lo pide explícitamente.
    console.log("aceptado sin comanda (pedido de prueba)", orden.remote_order_id);
    return;
  }

  const { data: cuenta, error: errCuenta } = await svc.rpc("peya_crear_cuenta", { p_orden_id: ordenId });
  if (errCuenta) {
    // Aceptado con DH pero sin comanda: queda visible en la bandeja para que
    // alguien lo arme a mano. Peor sería que nadie se enterara.
    console.error("aceptado SIN comanda", orden.remote_order_id, errCuenta.message);
    await svc.from("peya_ordenes").update({
      notas: `aceptado en PeYa pero la comanda falló: ${errCuenta.message}`,
    }).eq("id", ordenId);
    return;
  }
  console.log("auto-aceptado", orden.remote_order_id, JSON.stringify(cuenta));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();

  // Ruta relativa al montaje de la función.
  const segs = url.pathname.split("/").filter(Boolean);
  const i = segs.indexOf("peya-plugin");
  const ruta = i >= 0 ? segs.slice(i + 1) : segs;

  // Health check público: confirma SSL y disponibilidad sin tocar la BD.
  if (req.method === "GET" && ruta.length === 0) {
    return json({ status: "ok", service: "freakie-dogs-peya-plugin" });
  }

  // Cuerpo crudo (una sola lectura).
  let texto = "";
  let payload: Record<string, any> | null = null;
  try {
    texto = await req.text();
    payload = texto ? JSON.parse(texto) : null;
  } catch {
    payload = { _raw: texto.slice(0, 10_000) };
  }

  const auth = await verificarJWT(req.headers.get("authorization"), PLUGIN_SECRET);

  // Qué evento es, para el registro crudo.
  let evento = "desconocido";
  if (ruta[0] === "order") evento = "dispatch";
  else if (ruta[0] === "remoteId" && ruta[4] === "posOrderStatus") evento = "order_status";
  else if (ruta[0] === "remoteId" && ruta[2] === "availability") evento = "availability";
  else if (ruta[0] === "menuimport") evento = "menu_import";
  else if (ruta[0] === "catalog-import-callback") evento = "catalog_import";

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    // Nunca guardar el token: sólo si vino y de qué tipo.
    headers[k] = k.toLowerCase() === "authorization" ? `${v.split(" ")[0]} [oculto]` : v;
  });

  // Se registra SIEMPRE, incluso si la autenticación falla: sin esto, un secreto mal
  // configurado se ve como silencio y no hay con qué diagnosticar.
  const { error: errCrudo } = await svc.from("peya_ordenes_raw").insert({
    metodo: req.method,
    path: url.pathname + url.search,
    headers,
    payload,
    remote_ip: ip,
    ip_valida: IPS_DH.has(ip),
    evento,
    jwt_valido: auth.ok,
    rechazo_motivo: auth.ok ? null : auth.motivo,
    peya_order_token: payload?.token ?? payload?.orderToken ?? null,
    // El remoteId va segundo tanto en /order/{id} como en /remoteId/{id}/...
    vendor_remote_id: ruta[1] ?? null,
  });

  // El registro crudo es la única red de diagnóstico que queda cuando algo falla.
  // Si su INSERT se rompe (un GRANT faltante, por ejemplo) y nadie mira el error,
  // el webhook parece funcionar y en realidad no está guardando nada.
  if (errCrudo) console.error("peya-plugin: fallo al registrar el crudo:", errCrudo.message);

  if (!auth.ok) {
    return json({ error: "unauthorized", reason: auth.motivo }, 401);
  }

  try {
    // ---- POST /order/{remoteId} — dispatch de orden nueva ----
    if (req.method === "POST" && ruta[0] === "order" && ruta.length === 2) {
      const remoteId = decodeURIComponent(ruta[1]);
      const token = payload?.token;
      if (!token) {
        // 400 = rechazo definitivo. Sólo para payloads que no se pueden procesar.
        return json({ reason: "order-validation-error", message: "Falta el campo token" }, 400);
      }

      const remoteOrderId = `FD-${token}`;

      // El vendor sin mapear NO rechaza el pedido: se guarda sin sucursal para que
      // alguien lo resuelva. Rechazar aquí sería perder una venta real por un dato faltante.
      const { data: mapa } = await svc
        .from("peya_vendor_map")
        .select("sucursal_id")
        .eq("remote_id", remoteId)
        .eq("activo", true)
        .maybeSingle();

      // upsert por order_token: los reintentos de DH (hasta 10) no duplican el pedido
      // y devuelven siempre el mismo remoteOrderId.
      const { data: datos, error } = await svc.from("peya_ordenes").upsert({
        order_token: token,
        remote_order_id: remoteOrderId,
        vendor_remote_id: remoteId,
        sucursal_id: mapa?.sucursal_id ?? null,
        expedition_type: payload?.expeditionType ?? null,
        tipo_orden: tipoDeOrden(payload),
        callback_urls: payload?.callbackUrls ?? null,
        // Vence la ventana para aceptar/rechazar ⇒ DH cancela solo y, si pasa seguido,
        // cierra la tienda. Es el dato que hay que vigilar.
        expiry_date: payload?.expiryDate || null,
        // "Plugins should handle test orders carefully and make sure that the order
        // won't be prepared in the kitchen."
        es_prueba: payload?.test === true,
        code: payload?.code ?? null,
        short_code: payload?.shortCode ?? null,
        platform_restaurant_id: payload?.platformRestaurant?.id ?? null,
        payload,
        actualizado_at: new Date().toISOString(),
        notas: mapa ? null : `vendor ${remoteId} sin mapear en peya_vendor_map`,
      }, { onConflict: "order_token", ignoreDuplicates: false })
        .select("id")
        .single();

      // Un fallo de BD debe dar 5xx para que DH reintente, nunca 200.
      if (error) return json({ error: "persistencia", message: error.message }, 500);

      // La aceptación automática NO se hace antes de contestar: DH espera el acuse
      // del dispatch y meterle dos llamadas más de latencia sería pedir un timeout.
      // Se contesta primero y se decide después, en segundo plano.
      const decidir = () => autoResponder(datos!.id).catch((e) =>
        console.error("auto-aceptar falló", remoteOrderId, String(e))
      );
      // `EdgeRuntime` existe en el runtime de Supabase pero no está declarado en
      // TypeScript; se busca en globalThis para no romper el chequeo de tipos.
      const er = (globalThis as Record<string, any>).EdgeRuntime;
      if (typeof er?.waitUntil === "function") er.waitUntil(decidir()); else decidir();

      // remoteOrderId es obligatorio: sin él no llegan los updates de estado.
      return json({ remoteResponse: { remoteOrderId } }, 200);
    }

    // ---- PUT /remoteId/{id}/remoteOrder/{remoteOrderId}/posOrderStatus ----
    if (
      req.method === "PUT" && ruta[0] === "remoteId" &&
      ruta[2] === "remoteOrder" && ruta[4] === "posOrderStatus"
    ) {
      const remoteOrderId = decodeURIComponent(ruta[3]);
      const status = String(payload?.status ?? "");
      const ahora = new Date().toISOString();

      const cambios: Record<string, unknown> = { actualizado_at: ahora };
      if (status === "ORDER_CANCELLED") {
        cambios.estado = "cancelado";
        cambios.cancelado_at = ahora;
      } else if (status === "ORDER_PICKED_UP") {
        cambios.estado = "retirado";
      }
      cambios.notas = `${status}: ${payload?.message ?? ""}`.slice(0, 500);

      const { data, error } = await svc
        .from("peya_ordenes")
        .update(cambios)
        .eq("remote_order_id", remoteOrderId)
        .select("id");

      if (error) return json({ error: "persistencia", message: error.message }, 500);
      if (!data?.length) return json({ error: "not_found" }, 404);
      return json({ ok: true }, 200);
    }

    // ---- PUT /remoteId/{id}/availability — la plataforma abre/cierra la tienda ----
    // Notificación idempotente: puede llegar repetida y fuera de orden. Por ahora sólo
    // se registra (queda en el crudo); aplicarla al POS requiere decidir qué hace la caja.
    if (req.method === "PUT" && ruta[0] === "remoteId" && ruta[2] === "availability") {
      return json({ ok: true }, 200);
    }

    // ---- GET /menuimport/{remoteId} — piden el menú ----
    // 202 sincrónico y sin cuerpo; el menú se envía después por la API del middleware.
    if (req.method === "GET" && ruta[0] === "menuimport") {
      return new Response(null, { status: 202 });
    }

    // ---- POST /catalog-import-callback — estado de un import de catálogo ----
    if (req.method === "POST" && ruta[0] === "catalog-import-callback") {
      return new Response(null, { status: 200 });
    }

    return json({ error: "ruta_no_implementada", path: url.pathname }, 404);
  } catch (e) {
    // 500 ⇒ DH reintenta. Preferible a un 200 que dé el pedido por recibido sin estarlo.
    return json({ error: "error_interno", message: String(e) }, 500);
  }
});
