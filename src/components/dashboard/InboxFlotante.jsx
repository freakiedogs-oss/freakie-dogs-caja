// InboxFlotante.jsx — Bandeja de entrada del ERP (notificaciones del cerebro IA).
// Campanita flotante (abajo-derecha, arriba del asistente) con contador de no leídos.
// El brief diario y las alertas llegan acá para Jose, Cesar y Francisco.
// Montar UNA vez en el root de App.jsx:  <InboxFlotante user={user} />
// Estilos INLINE (no dependen de Tailwind).
import { useState, useEffect, useCallback } from "react";
import { URL_SB, KEY_SB } from "../../supabase";

const ROJO = "#E62329";
const BG = "#141414", CARD = "#1c1c1c", BORDER = "#2a2a2a", TXT = "#e8e8e8", MUT = "#9a9a9a";
const ROLES_PERMITIDOS = ["ejecutivo", "superadmin", "super", "admin"];

const rpc = (fn, params) =>
  fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY_SB, Authorization: `Bearer ${KEY_SB}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((r) => r.json());

function fechaCorta(iso) {
  try { return new Date(iso).toLocaleString("es-SV", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

export default function InboxFlotante({ user = {} }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const uid = user?.id || null;
  const rol = (user?.rol || "").toLowerCase();
  const visible = !!uid && ROLES_PERMITIDOS.includes(rol);

  const cargarUnread = useCallback(() => {
    if (!uid) return;
    rpc("fn_ai_inbox_no_leidos", { p_user_id: uid }).then((n) => setUnread(Number(n) || 0)).catch(() => {});
  }, [uid]);

  const cargarItems = useCallback(() => {
    if (!uid) return;
    rpc("fn_ai_inbox_listar", { p_user_id: uid, p_limit: 30 }).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  }, [uid]);

  useEffect(() => {
    if (!visible) return;
    cargarUnread();
    const t = setInterval(cargarUnread, 60000);
    return () => clearInterval(t);
  }, [visible, cargarUnread]);

  useEffect(() => { if (open) cargarItems(); }, [open, cargarItems]);

  async function marcarLeido(it) {
    if (it.leido) return;
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, leido: true } : x)));
    setUnread((u) => Math.max(0, u - 1));
    try { await rpc("fn_ai_inbox_marcar_leido", { p_id: it.id, p_user_id: uid }); } catch (_) {}
  }
  async function marcarTodo() {
    setItems((prev) => prev.map((x) => ({ ...x, leido: true })));
    setUnread(0);
    try { await rpc("fn_ai_inbox_marcar_todo", { p_user_id: uid }); } catch (_) {}
  }

  if (!visible) return null;

  const panelStyle = {
    position: "fixed", bottom: 152, right: 16,
    width: typeof window !== "undefined" && window.innerWidth < 480 ? "calc(100vw - 32px)" : 380,
    height: "62vh", maxHeight: 560, zIndex: 2147483000,
    background: BG, borderRadius: 16, boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
    border: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", overflow: "hidden",
  };
  const bellStyle = {
    position: "fixed", bottom: 88, right: 20, width: 52, height: 52, borderRadius: 9999,
    background: "#1f1f1f", color: "#fff", border: `1px solid ${BORDER}`, cursor: "pointer",
    boxShadow: "0 8px 20px rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 2147483000,
  };

  return (
    <>
      {open && (
        <div style={panelStyle} role="dialog" aria-label="Bandeja">
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontWeight: 700, color: "#fff", flex: 1 }}>📥 Bandeja</div>
            {unread > 0 && (
              <button onClick={marcarTodo} style={{ background: "none", border: "none", color: MUT, fontSize: 12, cursor: "pointer" }}>Marcar todo leído</button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Cerrar" style={{ background: "none", border: "none", color: MUT, fontSize: 22, lineHeight: 1, cursor: "pointer", padding: "0 2px" }}>×</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {items.length === 0 && <div style={{ color: MUT, fontSize: 13, textAlign: "center", marginTop: 20 }}>No hay mensajes.</div>}
            {items.map((it) => (
              <div key={it.id} onClick={() => marcarLeido(it)} style={{
                background: CARD, border: `1px solid ${it.leido ? BORDER : ROJO}`, borderRadius: 12, padding: 12, cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {!it.leido && <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROJO, flexShrink: 0 }} />}
                  <div style={{ fontWeight: 700, color: "#fff", fontSize: 14, flex: 1 }}>{it.titulo}</div>
                  <div style={{ fontSize: 11, color: MUT }}>{fechaCorta(it.created_at)}</div>
                </div>
                <div style={{ fontSize: 13, color: TXT, lineHeight: 1.5, marginTop: 6, whiteSpace: "pre-wrap" }}>{it.cuerpo}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button style={bellStyle} onClick={() => setOpen((o) => !o)} aria-label="Bandeja" title="Bandeja">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, padding: "0 5px",
            background: ROJO, color: "#fff", borderRadius: 9999, fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center" }}>{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
    </>
  );
}
