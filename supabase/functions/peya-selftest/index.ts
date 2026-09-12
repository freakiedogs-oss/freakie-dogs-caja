// Autoprueba de la integración con PedidosYa, corriendo DENTRO de Supabase.
//
// POR QUÉ EXISTE
// Los secretos (`PEYA_PLUGIN_SECRET`, `PEYA_ACCION_SECRET`) viven como Edge Function
// Secrets y no salen de acá: no están en el repo, ni en la base, ni en ninguna consola.
// Eso está bien, pero significa que nadie puede ejercitar la cadena completa sin
// tenerlos a mano en una terminal. Esta función los usa desde adentro y devuelve
// sólo un reporte, así que la prueba se puede disparar por SQL sin que ningún
// secreto viaje a ningún lado.
//
// CÓMO SE DISPARA (sólo con un token de un solo uso emitido por SQL):
//   insert into peya_selftest_tokens (token)
//   values (encode(gen_random_bytes(24), 'hex')) returning token;
//
//   select net.http_post(
//     '<SUPABASE_URL>/functions/v1/peya-selftest',
//     '{}'::jsonb,
//     headers := jsonb_build_object('Content-Type','application/json','x-selftest-token','<token>')
//   );
//
// NO manda pedidos falsos a la API de PedidosYa: el pedido de prueba lleva sus
// callbackUrls apuntando al /echo de esta misma función, así que el responder
// recorre todo su camino real contra un destino nuestro. Lo único que sí toca a
// PeYa es el login, que es justamente lo que queremos verificar que sigue vivo.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_BASE = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const PLUGIN = `${URL_BASE}/functions/v1/peya-plugin`;
const RESPONDER = `${URL_BASE}/functions/v1/peya-responder`;
const ECHO = `${URL_BASE}/functions/v1/peya-selftest/echo`;

const PLUGIN_SECRET = Deno.env.get("PEYA_PLUGIN_SECRET") ?? "";
const ACCION_SECRET = Deno.env.get("PEYA_ACCION_SECRET") ?? "";
const VENDOR = Deno.env.get("PEYA_VENDOR_PRUEBA") ?? "AR-PRUEBAS-INTEGRACION-0001";

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ---------- Firma del JWT, igual que lo hace el middleware de Delivery Hero ----------
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const b64urlTexto = (s: string) => b64url(new TextEncoder().encode(s));

async function firmarJWT(payload: Record<string, unknown>, secreto: string): Promise<string> {
  const h = b64urlTexto(JSON.stringify({ typ: "JWT", alg: "HS512" }));
  const p = b64urlTexto(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secreto),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(firma))}`;
}

// ---------- Arnés ----------
type Chequeo = { nombre: string; ok: boolean; detalle: string };

function arnes() {
  const checks: Chequeo[] = [];
  const anotar = (nombre: string, ok: boolean, detalle: unknown) =>
    checks.push({ nombre, ok, detalle: String(detalle).slice(0, 300) });
  const igual = (nombre: string, esperado: unknown, obtenido: unknown) =>
    anotar(
      nombre,
      esperado === obtenido,
      esperado === obtenido ? `${obtenido}` : `esperaba ${esperado}, obtuvo ${obtenido}`,
    );
  return { checks, anotar, igual };
}

async function pedir(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const texto = await r.text();
  let cuerpo: any = null;
  try { cuerpo = JSON.parse(texto); } catch { /* no era JSON */ }
  return { status: r.status, texto, cuerpo };
}

// ---------- La prueba ----------
async function correr() {
  const { checks, anotar, igual } = arnes();
  const ahora = Date.now();
  const tokenOrden = `SELFTEST-${ahora}`;
  const idEsperado = `FD-${tokenOrden}`;
  const riderPickup = new Date(ahora + 25 * 60_000).toISOString();

  const jwtOk = await firmarJWT({ service: "middleware" }, PLUGIN_SECRET);
  const jwtClaimMalo = await firmarJWT({ service: "otra-cosa" }, PLUGIN_SECRET);
  const jwtFirmaMala = (await firmarJWT({ service: "middleware" }, "secreto-que-no-es")).replace(
    /\.[^.]+$/,
    ".ZmlybWFJbnZhbGlkYQ",
  );

  const jsonHdr = { "Content-Type": "application/json" };
  const conJwt = (j: string) => ({ ...jsonHdr, Authorization: `Bearer ${j}` });

  // El pedido de prueba: `test: true` para que jamás se confunda con uno real, y
  // callbacks apuntando a nuestro propio /echo para no mandarle basura a PeYa.
  const pedido = {
    token: tokenOrden,
    code: tokenOrden,
    shortCode: "ST01",
    test: true,
    expiryDate: new Date(ahora + 15 * 60_000).toISOString(),
    expeditionType: "delivery",
    delivery: { riderPickupTime: riderPickup },
    platformRestaurant: { id: "478876" },
    callbackUrls: { orderAcceptedUrl: ECHO, orderRejectedUrl: ECHO, orderPreparedUrl: ECHO },
    products: [{ name: "Freakie Clásica", quantity: "1", paidPrice: "5.99" }],
  };

  // 1. Health check — público a propósito: es lo que PeYa usó para validar el SSL.
  let r = await pedir(PLUGIN, { method: "GET" });
  igual("plugin/health responde 200", 200, r.status);
  anotar("plugin/health dice status ok", r.cuerpo?.status === "ok", r.texto.slice(0, 80));

  // 2-4. La puerta. Si cualquiera de estos diera 200, el webhook estaría abierto.
  r = await pedir(`${PLUGIN}/order/${VENDOR}`, {
    method: "POST", headers: jsonHdr, body: JSON.stringify({ token: "SIN-AUTH" }),
  });
  igual("dispatch sin Authorization da 401", 401, r.status);

  r = await pedir(`${PLUGIN}/order/${VENDOR}`, {
    method: "POST", headers: conJwt(jwtClaimMalo), body: JSON.stringify({ token: "CLAIM-MALO" }),
  });
  igual("claim service incorrecto da 401", 401, r.status);

  r = await pedir(`${PLUGIN}/order/${VENDOR}`, {
    method: "POST", headers: conJwt(jwtFirmaMala), body: JSON.stringify({ token: "FIRMA-MALA" }),
  });
  igual("firma inválida da 401", 401, r.status);

  // 5. Dispatch real. Sin remoteOrderId en el acuse no llegan los updates de estado.
  r = await pedir(`${PLUGIN}/order/${VENDOR}`, {
    method: "POST", headers: conJwt(jwtOk), body: JSON.stringify(pedido),
  });
  igual("dispatch con JWT válido da 200", 200, r.status);
  igual("devuelve el remoteOrderId esperado", idEsperado, r.cuerpo?.remoteResponse?.remoteOrderId);

  // 6. Idempotencia: DH reintenta hasta 10 veces y no puede duplicar el pedido.
  r = await pedir(`${PLUGIN}/order/${VENDOR}`, {
    method: "POST", headers: conJwt(jwtOk), body: JSON.stringify(pedido),
  });
  igual("el reintento devuelve el mismo id", idEsperado, r.cuerpo?.remoteResponse?.remoteOrderId);

  const { data: filas } = await svc.from("peya_ordenes").select("*").eq("order_token", tokenOrden);
  igual("el reintento no duplicó la fila", 1, filas?.length ?? 0);

  // 7. Los campos que protegen la operación.
  const orden = filas?.[0];
  anotar("es_prueba quedó en true", orden?.es_prueba === true, orden?.es_prueba);
  anotar("expiry_date quedó guardado", !!orden?.expiry_date, orden?.expiry_date);
  igual("tipo_orden detectado", "own_delivery", orden?.tipo_orden);
  igual("sucursal mapeada", true, !!orden?.sucursal_id);
  igual("estado inicial", "recibido", orden?.estado);

  // 8. El responder también tiene puerta propia.
  r = await pedir(RESPONDER, {
    method: "POST", headers: jsonHdr,
    body: JSON.stringify({ remoteOrderId: idEsperado, accion: "aceptar" }),
  });
  igual("responder sin secreto da 401", 401, r.status);

  // 9. Aceptar de verdad. Saca token contra PeYa (eso sí es real) y postea al callback.
  if (!ACCION_SECRET) {
    anotar("PEYA_ACCION_SECRET configurado", false, "falta el secreto, se salta el aceptar");
  } else {
    r = await pedir(RESPONDER, {
      method: "POST",
      headers: { ...jsonHdr, "x-freakie-secreto": ACCION_SECRET },
      body: JSON.stringify({ remoteOrderId: idEsperado, accion: "aceptar" }),
    });
    igual("aceptar responde 200", 200, r.status);
    anotar("login contra PeYa funcionó", r.cuerpo?.ok === true, r.texto.slice(0, 200));

    // El acceptanceTime es el dato que más caro sale equivocado: por debajo del
    // mínimo de 2 minutos DH rechaza la aceptación y el pedido se vence solo.
    const at = r.cuerpo?.payload?.acceptanceTime;
    const margenMin = at ? (Date.parse(at) - Date.now()) / 60_000 : NaN;
    anotar(
      "acceptanceTime a más de 2 minutos",
      Number.isFinite(margenMin) && margenMin >= 2,
      at ? `${at} (${margenMin.toFixed(1)} min)` : "no vino acceptanceTime",
    );
    igual("acceptanceTime sale del riderPickupTime", riderPickup, at);

    const { data: tras } = await svc.from("peya_ordenes").select("estado, respuesta_http, aceptado_at")
      .eq("order_token", tokenOrden).limit(1);
    igual("el estado local avanzó a aceptado", "aceptado", tras?.[0]?.estado);
    igual("guardó el http de la respuesta", 200, tras?.[0]?.respuesta_http);
  }

  // 10. Cambios de estado que manda la plataforma.
  r = await pedir(`${PLUGIN}/remoteId/${VENDOR}/remoteOrder/${idEsperado}/posOrderStatus`, {
    method: "PUT", headers: conJwt(jwtOk),
    body: JSON.stringify({ status: "ORDER_CANCELLED", message: "autoprueba" }),
  });
  igual("cancelación da 200", 200, r.status);

  r = await pedir(`${PLUGIN}/remoteId/${VENDOR}/remoteOrder/FD-NO-EXISTE/posOrderStatus`, {
    method: "PUT", headers: conJwt(jwtOk),
    body: JSON.stringify({ status: "ORDER_CANCELLED", message: "x" }),
  });
  igual("estado de orden inexistente da 404", 404, r.status);

  // 11. Pedido de menú: 202 sincrónico, el catálogo se manda después por la API.
  r = await pedir(`${PLUGIN}/menuimport/${VENDOR}?vendorCode=X&menuImportId=Y`, {
    method: "GET", headers: conJwt(jwtOk),
  });
  igual("menuimport da 202", 202, r.status);

  // Limpieza: la orden de prueba no tiene por qué quedar viviendo en la tabla.
  const { error: errBorrar } = await svc.from("peya_ordenes").delete().eq("order_token", tokenOrden);
  anotar("orden de prueba borrada", !errBorrar, errBorrar?.message ?? "ok");

  const fallas = checks.filter((c) => !c.ok);
  return {
    ok: fallas.length === 0,
    total: checks.length,
    fallas: fallas.length,
    ordenDePrueba: idEsperado,
    checks,
  };
}

Deno.serve(async (req) => {
  // Ruta relativa al montaje de la función, igual que en `peya-plugin`: el
  // prefijo depende de si se entra por *.supabase.co o por el dominio propio.
  const segs = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = segs.indexOf("peya-selftest");
  const ruta = i >= 0 ? segs.slice(i + 1) : segs;

  // Destino de los callbacks del pedido de prueba. No hace nada y no guarda nada:
  // sólo existe para que el responder tenga adónde postear sin molestar a PeYa.
  if (ruta[0] === "echo") return json({ ok: true, echo: true });

  if (req.method === "GET" && ruta.length === 0) {
    return json({ status: "ok", service: "freakie-dogs-peya-selftest" });
  }
  if (req.method !== "POST") return json({ error: "metodo_no_permitido" }, 405);

  // Puerta: token de un solo uso emitido por SQL. Esta función crea pedidos y
  // habla con PeYa; no puede quedar abierta con sólo conocer la URL.
  const token = req.headers.get("x-selftest-token") ?? "";
  if (!token) return json({ error: "falta_x_selftest_token" }, 401);

  const { data: fila } = await svc.from("peya_selftest_tokens").select("*").eq("token", token).limit(1);
  const t = fila?.[0];
  if (!t) return json({ error: "token_desconocido" }, 401);
  if (t.usado_at) return json({ error: "token_ya_usado" }, 401);
  if (Date.parse(t.vence_at) < Date.now()) return json({ error: "token_vencido" }, 401);

  // Se consume ANTES de correr: si la prueba se cae a la mitad, el token igual
  // queda quemado y nadie puede repetirla a voluntad.
  await svc.from("peya_selftest_tokens").update({ usado_at: new Date().toISOString() })
    .eq("token", token);

  if (!PLUGIN_SECRET) return json({ error: "falta_PEYA_PLUGIN_SECRET" }, 500);

  try {
    const reporte = await correr();
    return json(reporte, reporte.ok ? 200 : 500);
  } catch (e) {
    return json({ ok: false, error: "la_prueba_reventó", message: String(e) }, 500);
  }
});
