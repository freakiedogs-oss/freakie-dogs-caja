// Cierra y reabre las tiendas en PedidosYa según el horario de cada sucursal.
//
// 25-nov-2026, pedido de Jose: la tienda tiene que cerrarse a la hora de cierre
// de la sucursal, no cuando se cierra la caja. Lo dispara el cron
// `peya_horario_tick` (cada minuto, y sólo si hay algo que hacer).
//
// QUÉ HACER LO DECIDE LA BASE, EN HORA DE EL SALVADOR: `peya_horario_pendientes()`
// lista las tiendas que ya pasaron su hora de cierre de hoy y siguen sin cerrar,
// y las que se cerraron por horario un día anterior y ya llegaron a su apertura.
// Esta función sólo lo ejecuta contra PedidosYa y lo anota (`peya_horario_marcar`).
//
// SIN CREDENCIALES A PROPÓSITO: no recibe tienda ni estado del request, así que
// lo único que puede hacer es cerrar lo que ya debía estar cerrado o reabrir lo
// que este mismo proceso cerró. Llamarla de más no hace daño, y los reintentos
// están frenados en la base (2 minutos por tienda).
//
//   · cerrar → CLOSED_TODAY (PedidosYa la reabre sola al día siguiente), motivo
//              CLOSED. Si la plataforma no ofrece CLOSED_TODAY, CLOSED.
//   · abrir  → red de seguridad: sólo si PedidosYa la sigue mostrando cerrada
//              con motivo CLOSED (el nuestro). Un cierre del gerente
//              (TOO_BUSY_KITCHEN…) o de PedidosYa (changeable:false) no se toca.
//
// Las llamadas a la API son las mismas que `peya-responder` (accion = "tienda"):
// consultar primero qué permite cada plataforma y mandarle sólo esos valores.
import { createClient } from "jsr:@supabase/supabase-js@2";

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const USUARIO = Deno.env.get("PEYA_USERNAME") ?? "";
const PASSWORD = Deno.env.get("PEYA_PASSWORD") ?? "";
const BASE = (Deno.env.get("PEYA_BASE_URL") ??
  "https://integration-middleware.us.restaurant-partners.com").replace(/\/+$/, "");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let tokenCache: { valor: string; venceEn: number } | null = null;

async function obtenerToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.venceEn) return tokenCache.valor;
  if (!USUARIO || !PASSWORD) throw new Error("faltan PEYA_USERNAME / PEYA_PASSWORD");
  const r = await fetch(`${BASE}/v2/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: USUARIO, password: PASSWORD, grant_type: "client_credentials" }),
  });
  if (!r.ok) throw new Error(`login ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  if (!d?.access_token) throw new Error("login sin access_token");
  tokenCache = {
    valor: d.access_token,
    venceEn: Date.now() + Math.max(Number(d.expires_in ?? 3600) * 1000 - 300_000, 60_000),
  };
  return tokenCache.valor;
}

async function llamar(url: string, cuerpo: unknown | null, metodo: "GET" | "PUT") {
  for (let intento = 1; intento <= 2; intento++) {
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
    // Token vencido antes de lo anunciado: se tira el cache y se reintenta una vez.
    if (r.status === 401 && intento === 1) { tokenCache = null; continue; }
    return { status: r.status, texto };
  }
  return { status: 0, texto: "" };
}

Deno.serve(async (req) => {
  if (req.method === "GET") return json({ status: "ok", service: "freakie-dogs-peya-horario" });
  if (req.method !== "POST") return json({ error: "metodo_no_permitido" }, 405);

  const { data: pend, error } = await svc.rpc("peya_horario_pendientes");
  if (error) return json({ error: "base", message: error.message }, 500);

  const salida: Record<string, unknown>[] = [];
  for (const p of (pend ?? []) as Record<string, any>[]) {
    const marcar = (ok: boolean, detalle: Record<string, unknown>) =>
      svc.rpc("peya_horario_marcar", {
        p_remote_id: p.remote_id, p_accion: p.accion, p_ok: ok,
        p_cierre_hasta: p.accion === "cerrar" ? p.cierre_hasta : null,
        p_detalle: detalle,
      });

    const { data: vm } = await svc.from("peya_vendor_map")
      .select("remote_id, chain_code").eq("remote_id", p.remote_id).maybeSingle();
    if (!vm?.chain_code) {
      await marcar(false, { error: "sin_chain_code" });
      salida.push({ remoteId: p.remote_id, accion: p.accion, ok: false, error: "sin_chain_code" });
      continue;
    }

    const urlDisp = `${BASE}/v2/chains/${encodeURIComponent(vm.chain_code)}` +
      `/remoteVendors/${encodeURIComponent(vm.remote_id)}/availability`;

    let plataformas: Record<string, any>[] = [];
    try {
      const get = await llamar(urlDisp, null, "GET");
      if (get.status < 200 || get.status >= 300) throw new Error(`GET ${get.status}: ${get.texto.slice(0, 200)}`);
      const d = JSON.parse(get.texto);
      plataformas = Array.isArray(d) ? d : [d];
    } catch (e) {
      await marcar(false, { error: "no_se_pudo_consultar", detalle: String(e) });
      salida.push({ remoteId: p.remote_id, accion: p.accion, ok: false, error: String(e) });
      continue;
    }
    await svc.rpc("peya_guardar_plataformas", { p_remote_id: vm.remote_id, p_plataformas: plataformas });

    const resultados: Record<string, unknown>[] = [];
    let reabierta = false;
    for (const pl of plataformas) {
      const permitidos: string[] = Array.isArray(pl.availabilityStates) ? pl.availabilityStates : [];
      const motivos: string[] = Array.isArray(pl.closingReasons) ? pl.closingReasons : [];
      const actual = String(pl.availabilityState ?? "");
      const base = { platformKey: pl.platformKey, platformRestaurantId: String(pl.platformRestaurantId) };

      if (pl.changeable !== true) { resultados.push({ ...base, omitida: "no_cambiable", actual }); continue; }

      let cuerpoPut: Record<string, unknown>;
      if (p.accion === "cerrar") {
        if (actual === "CLOSED_TODAY" || actual === "CLOSED") {
          resultados.push({ ...base, omitida: "ya_cerrada", actual });
          continue;
        }
        const estado = permitidos.includes("CLOSED_TODAY") ? "CLOSED_TODAY"
          : permitidos.includes("CLOSED") ? "CLOSED" : "";
        if (!estado) {
          resultados.push({ ...base, ok: false, error: "no_acepta_cierre_del_dia", permitidos });
          continue;
        }
        cuerpoPut = {
          availabilityState: estado, ...base,
          closedReason: motivos.includes("CLOSED") ? "CLOSED"
            : motivos.includes("OTHER") ? "OTHER" : (motivos[0] ?? "CLOSED"),
        };
      } else {
        const nuestro = (actual === "CLOSED_TODAY" || actual === "CLOSED") &&
          String(pl.closedReason ?? "CLOSED") === "CLOSED";
        if (!nuestro || !permitidos.includes("OPEN")) {
          resultados.push({ ...base, omitida: nuestro ? "no_acepta_OPEN" : "no_es_cierre_por_horario",
            actual, motivo: pl.closedReason ?? null });
          continue;
        }
        cuerpoPut = { availabilityState: "OPEN", ...base };
      }

      const put = await llamar(urlDisp, cuerpoPut, "PUT");
      const okPut = put.status >= 200 && put.status < 300;
      if (okPut && p.accion === "abrir") reabierta = true;
      resultados.push({ ...base, enviado: cuerpoPut, http: put.status, ok: okPut,
        respuesta: okPut ? undefined : put.texto });
    }

    const ok = resultados.every((r) => r.ok === true || r.omitida);
    await marcar(ok, { resultados, reabierta });
    salida.push({ remoteId: p.remote_id, accion: p.accion, ok, reabierta, resultados });
  }
  return json({ ok: true, procesadas: salida });
});
