// cancelaciones-push — manda la notificación del ERP cuando se cancela algo que ya
// estaba en cocina (1-oct-2026). La llama la base (trigger + cron cada minuto)
// con el secreto interno `cancel_push_secret` en el header x-cancel-secret.
//
// Body:
//   { id, nivel: 'nueva' | 'grupo' }  → avisa (la base decide a quién y qué texto)
//   { accion: 'init' }                → crea las claves VAPID si no existen y
//                                        devuelve SOLO la pública
//   { accion: 'probar', usuario_id }  → manda una notificación de prueba a los
//                                        dispositivos de ese usuario
//
// Las claves VAPID viven en app_secretos (vapid_public / vapid_private): se
// generan acá adentro y la privada nunca sale de la base ni de esta función.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUBJECT = "https://freakiedogs.com";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "solo POST" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: secs, error: eSec } = await sb.from("app_secretos").select("clave,valor")
    .in("clave", ["cancel_push_secret", "vapid_public", "vapid_private"]);
  if (eSec) return json({ error: "no se pudo leer la configuración" }, 500);
  const S: Record<string, string> = Object.fromEntries((secs ?? []).map((r) => [r.clave, r.valor]));

  if (!S.cancel_push_secret || req.headers.get("x-cancel-secret") !== S.cancel_push_secret) {
    return json({ error: "no autorizado" }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* vacío */ }

  // ── init: claves VAPID ──
  if (body.accion === "init") {
    if (S.vapid_public && S.vapid_private) return json({ ok: true, ya_existia: true, publica: S.vapid_public });
    const k = webpush.generateVAPIDKeys();
    const { data: pub, error } = await sb.rpc("push_guardar_vapid", { p_publica: k.publicKey, p_privada: k.privateKey });
    if (error) return json({ error: "no se pudieron guardar las claves: " + error.message }, 500);
    return json({ ok: true, creada: true, publica: pub });
  }

  if (!S.vapid_public || !S.vapid_private) return json({ error: "faltan las claves VAPID (llamar init)" }, 500);
  webpush.setVapidDetails(SUBJECT, S.vapid_public, S.vapid_private);

  type Sub = { id: number; endpoint: string; p256dh: string; auth: string };
  const enviar = async (subs: Sub[], payload: Record<string, unknown>) => {
    const res = { ok: 0, fallos: 0, borradas: 0, errores: [] as string[] };
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 6, urgency: "high" },
        );
        res.ok++;
        await sb.rpc("push_marcar_resultado", { p_sub_id: s.id, p_ok: true, p_borrar: false });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode ?? 0;
        const borrar = code === 404 || code === 410; // el dispositivo ya no existe
        if (borrar) res.borradas++; else res.fallos++;
        res.errores.push(`${code} ${String((e as Error).message ?? e).slice(0, 120)}`);
        await sb.rpc("push_marcar_resultado", { p_sub_id: s.id, p_ok: false, p_borrar: borrar });
      }
    }));
    return res;
  };

  // ── probar: notificación de prueba a un usuario ──
  if (body.accion === "probar") {
    const { data: subs } = await sb.from("push_suscripciones").select("id,endpoint,p256dh,auth")
      .eq("usuario_id", String(body.usuario_id ?? ""));
    const r = await enviar((subs ?? []) as Sub[], {
      titulo: "✅ Avisos de cancelaciones activados",
      cuerpo: "Así te va a llegar cada cancelación que tengás que decidir.",
      url: "/?ir=cancelaciones", tag: "cancel-prueba",
    });
    return json({ ok: true, dispositivos: subs?.length ?? 0, ...r });
  }

  // ── aviso de una cancelación ──
  const id = Number(body.id);
  const nivel = body.nivel === "grupo" ? "grupo" : "nueva";
  if (!id) return json({ error: "falta id" }, 400);

  const { data: prep, error: ePrep } = await sb.rpc("cancelaciones_push_preparar", { p_id: id, p_nivel: nivel });
  if (ePrep) return json({ error: ePrep.message }, 500);
  if (!prep?.enviar) return json({ ok: true, enviado: false, razon: prep?.razon ?? "sin dispositivos", nivel: prep?.nivel });

  const r = await enviar(prep.subs as Sub[], {
    titulo: prep.titulo, cuerpo: prep.cuerpo, url: prep.url, tag: prep.tag,
  });
  return json({ ok: true, enviado: true, nivel: prep.nivel, ...r });
});
