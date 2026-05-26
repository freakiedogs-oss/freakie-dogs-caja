// ============================================================
// kaeru-pin-setup — Edge Function que sincroniza PIN → auth.users
// Kaeru Chan ERP · v2 (2026-05-24 con CORS fix)
//
// POST /functions/v1/kaeru-pin-setup
// Headers requeridos: x-setup-secret: kaeru-pin-setup-2026
// Body: { "email": "user@kaeruchan.local", "pin": "123456" }
//
// Si el user ya existe en auth.users → updateUserById(password=pin)
// Si no existe → createUser({ email, password=pin, email_confirm=true })
//
// Importante: tiene CORS abierto porque el browser hace OPTIONS preflight
// antes del POST (header x-setup-secret es custom). Sin CORS → "Failed to fetch".
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SETUP_SECRET = "kaeru-pin-setup-2026";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-setup-secret, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: CORS_HEADERS });
  }

  const auth = req.headers.get("x-setup-secret");
  if (auth !== SETUP_SECRET) {
    return new Response("unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  try {
    const { email, pin } = await req.json();
    if (!email || !pin || !/^[0-9]{6}$/.test(pin)) {
      return json({ error: "email + pin (6 dígitos) requeridos" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: { users }, error: e1 } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (e1) return json({ error: e1.message }, 500);

    const existing = users.find((u: any) => u.email === email);

    if (existing) {
      const { error: e2 } = await admin.auth.admin.updateUserById(existing.id, {
        password: pin,
        email_confirm: true,
      });
      if (e2) return json({ error: e2.message }, 500);
      return json({ ok: true, action: "updated", user_id: existing.id, email });
    }

    const { data: newUser, error: e3 } = await admin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
    });
    if (e3) return json({ error: e3.message }, 500);
    return json({ ok: true, action: "created", user_id: newUser.user?.id, email });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
