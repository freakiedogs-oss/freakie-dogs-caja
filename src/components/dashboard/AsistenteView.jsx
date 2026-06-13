// AsistenteView.jsx — Chat IA del ERP Freakie Dogs (tema oscuro)
// ------------------------------------------------------------------
// Consume el backend de IA y muestra la respuesta (cifra real desde un
// SELECT en BD). Usa el proxy/cliente de la app (src/supabase.js).
// Estilos INLINE (no dependen de Tailwind) para verse consistente.
// ------------------------------------------------------------------
import { useState, useRef, useEffect } from "react";
import { URL_SB, KEY_SB } from "../../supabase";

// 'f1' -> ai-query | 'gateway' -> ai-gateway (multi-ERP, cutover)
const BACKEND = "gateway";
const FN_SLUG = { f1: "ai-query", gateway: "ai-gateway" };

// Paleta (alineada al ERP oscuro)
const ROJO = "#E62329";
const AMARILLO = "#FFD900";
const BG = "#141414";
const CARD = "#1c1c1c";
const BORDER = "#2a2a2a";
const TXT = "#e8e8e8";
const MUT = "#9a9a9a";
const INPUTBG = "#1f1f1f";

const SUPABASE_URL = URL_SB;
const ANON_KEY = KEY_SB;

const SUGERENCIAS = [
  "Ventas por sucursal este mes",
  "¿Cuánto gastamos este mes?",
  "Top 10 proveedores del año",
  "¿Cuántos empleados activos hay?",
  "Saldos de banco",
  "Stock de bebidas bajo",
  "¿Hasta qué fecha está la data?",
];

const BrainIcon = ({ size = 18, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.6 6.5a3 3 0 0 0 .4-1.4" />
    <path d="M6 5.1a3 3 0 0 0 .4 1.4" />
    <path d="M6 18a4 4 0 0 1-2-.5" />
    <path d="M20 17.5a4 4 0 0 1-2 .5" />
  </svg>
);

function fmtCell(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("es-SV") : v.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v);
}

function Tabla({ filas }) {
  if (!Array.isArray(filas) || filas.length === 0)
    return <div style={{ fontSize: 13, color: MUT, fontStyle: "italic" }}>Sin resultados.</div>;

  const cols = Object.keys(filas[0]);
  if (filas.length === 1 && cols.length === 1) {
    return (
      <div style={{ fontSize: 28, fontWeight: 800, color: ROJO }}>
        {fmtCell(filas[0][cols[0]])}
        <span style={{ marginLeft: 8, fontSize: 13, fontWeight: 400, color: MUT }}>{cols[0]}</span>
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${BORDER}` }}>
      <table style={{ minWidth: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: AMARILLO }}>
            {cols.map((c) => (
              <th key={c} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "#1a1a1a", whiteSpace: "nowrap" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((row, i) => (
            <tr key={i} style={{ background: i % 2 ? "#171717" : "#1c1c1c" }}>
              {cols.map((c) => (
                <td key={c} style={{ padding: "5px 10px", whiteSpace: "nowrap", color: TXT, fontVariantNumeric: "tabular-nums" }}>{fmtCell(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AsistenteView({ user = {}, onClose }) {
  const [pregunta, setPregunta] = useState("");
  const [cargando, setCargando] = useState(false);
  const [items, setItems] = useState([]);
  const [feedbackDado, setFeedbackDado] = useState({});
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, cargando]);

  const usuario = { rol: user?.rol ?? null, nombre: user?.nombre ?? null, store_code: user?.store_code ?? null };

  const endpoint = `${SUPABASE_URL}/functions/v1/${FN_SLUG[BACKEND]}`;
  const headers = { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };
  const buildBody = (q) =>
    BACKEND === "gateway" ? { tenant_hint: "freakie", usuario, pregunta: q } : { pregunta: q, usuario };

  async function preguntar(qTexto) {
    const q = (qTexto ?? pregunta).trim();
    if (!q || cargando) return;
    setPregunta("");
    setItems((prev) => [...prev, { pregunta: q }]);
    setCargando(true);
    try {
      const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(buildBody(q)) });
      const data = await r.json();
      setItems((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (!r.ok || data.error) {
          last.error =
            r.status === 429 ? "Llegaste al límite diario de consultas IA." :
            r.status === 422 ? "La consulta generada no pasó el validador de seguridad." :
            data.error || "No se pudo procesar la pregunta.";
          last.motivo = data.motivo || data.detalle || null;
          last.sql = data.sql || null;
        } else if (data.llm_disponible === false) {
          last.error = data.mensaje || "El LLM no está configurado para esta pregunta.";
        } else {
          last.resp = data;
        }
        return next;
      });
    } catch (e) {
      setItems((prev) => {
        const next = [...prev];
        next[next.length - 1].error = "Error de red al consultar el asistente.";
        next[next.length - 1].motivo = String(e);
        return next;
      });
    } finally {
      setCargando(false);
    }
  }

  async function enviarFeedback(id, valor) {
    if (!id || feedbackDado[id]) return;
    setFeedbackDado((p) => ({ ...p, [id]: valor }));
    try {
      await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ feedback_id: id, feedback: valor }) });
    } catch (_) { /* best-effort */ }
  }

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", background: BG, color: TXT }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: ROJO, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <BrainIcon size={18} color="#fff" />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: "#fff", lineHeight: 1.2 }}>Asistente Freakie</div>
          <div style={{ fontSize: 11, color: MUT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Preguntá por ventas, gastos, planilla, banco…</div>
        </div>
        <span style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1, padding: "3px 7px", borderRadius: 999, background: "#2a2a2a", color: "#9a9a9a" }}>
          {BACKEND === "gateway" ? "gateway" : "F1"}
        </span>
        {onClose && (
          <button onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", color: MUT, fontSize: 22, lineHeight: 1, cursor: "pointer", padding: "0 2px" }}>×</button>
        )}
      </div>

      {/* Body */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SUGERENCIAS.map((s) => (
              <button
                key={s}
                onClick={() => preguntar(s)}
                onMouseOver={(e) => (e.currentTarget.style.borderColor = ROJO)}
                onMouseOut={(e) => (e.currentTarget.style.borderColor = "#3a3a3a")}
                style={{ fontSize: 12.5, padding: "6px 12px", borderRadius: 999, border: "1px solid #3a3a3a", background: "#1f1f1f", color: "#ddd", cursor: "pointer" }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {items.map((it, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ alignSelf: "flex-end", maxWidth: "85%", background: ROJO, color: "#fff", padding: "8px 12px", borderRadius: "14px 14px 4px 14px", fontSize: 14 }}>
              {it.pregunta}
            </div>

            {it.resp && (
              <div style={{ alignSelf: "flex-start", maxWidth: "100%", background: CARD, border: `1px solid ${BORDER}`, borderRadius: "14px 14px 14px 4px", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {it.resp.nota && <div style={{ fontSize: 12, color: MUT }}>{it.resp.nota}</div>}
                <Tabla filas={it.resp.filas} />
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11, color: MUT }}>
                  <span>{it.resp.ruta === "heuristica" ? `⚡ ${it.resp.intent}` : "🧠 IA"}</span>
                  {typeof it.resp.latencia_ms === "number" && <span>{it.resp.latencia_ms} ms</span>}
                  {it.resp.id && (
                    <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button onClick={() => enviarFeedback(it.resp.id, "up")} style={{ background: "none", border: "none", cursor: "pointer", opacity: feedbackDado[it.resp.id] === "up" ? 1 : 0.5 }}>👍</button>
                      <button onClick={() => enviarFeedback(it.resp.id, "down")} style={{ background: "none", border: "none", cursor: "pointer", opacity: feedbackDado[it.resp.id] === "down" ? 1 : 0.5 }}>👎</button>
                    </span>
                  )}
                </div>
                {it.resp.sql && (
                  <details style={{ fontSize: 11, color: MUT }}>
                    <summary style={{ cursor: "pointer", userSelect: "none" }}>Ver SQL</summary>
                    <pre style={{ marginTop: 6, padding: 8, background: "#0d0d0d", color: "#ddd", borderRadius: 6, overflowX: "auto", whiteSpace: "pre-wrap" }}>{it.resp.sql}</pre>
                  </details>
                )}
              </div>
            )}

            {it.error && (
              <div style={{ alignSelf: "flex-start", maxWidth: "100%", background: "#3a1414", border: "1px solid #5a2a2a", color: "#ffb4b4", padding: "8px 12px", borderRadius: "14px 14px 14px 4px", fontSize: 13 }}>
                {it.error}
                {it.motivo && <div style={{ fontSize: 11, color: "#d98a8a", marginTop: 4 }}>{it.motivo}</div>}
              </div>
            )}
          </div>
        ))}

        {cargando && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: MUT }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROJO, animation: "fdbounce 1s infinite" }} />
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROJO, animation: "fdbounce 1s infinite 0.15s" }} />
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: ROJO, animation: "fdbounce 1s infinite 0.3s" }} />
            <style>{"@keyframes fdbounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-5px);opacity:1}}"}</style>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={(e) => { e.preventDefault(); preguntar(); }} style={{ display: "flex", gap: 8, padding: "12px 14px", borderTop: `1px solid ${BORDER}` }}>
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="Escribí tu pregunta…"
          disabled={cargando}
          style={{ flex: 1, padding: "9px 14px", borderRadius: 999, border: "1px solid #3a3a3a", background: INPUTBG, color: "#fff", outline: "none", fontSize: 14 }}
        />
        <button type="submit" disabled={cargando || !pregunta.trim()} style={{ padding: "9px 18px", borderRadius: 999, border: "none", background: ROJO, color: "#fff", fontWeight: 600, cursor: cargando || !pregunta.trim() ? "default" : "pointer", opacity: cargando || !pregunta.trim() ? 0.45 : 1 }}>
          Enviar
        </button>
      </form>
    </div>
  );
}
