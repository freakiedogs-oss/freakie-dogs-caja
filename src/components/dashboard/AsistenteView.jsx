// AsistenteView.jsx — Chat IA del ERP Freakie Dogs
// ------------------------------------------------------------------
// Consume el backend de IA y muestra la respuesta (cifra real desde un
// SELECT en BD). Toggle de 1 linea entre F1 (ai-query, recomendado hoy)
// y el gateway multi-ERP (ai-gateway, cutover futuro).
//
// Integracion:
//   import AsistenteView from "./components/AsistenteView";
//   <AsistenteView user={user} />     // user.rol, user.nombre, user.store_code
//
// Requiere VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el entorno.
// ------------------------------------------------------------------
import { useState, useRef, useEffect } from "react";
import { URL_SB, KEY_SB } from "../../supabase";

// === CONFIG ===
// 'f1'      -> ai-query  : heuristicas + LLM. Mejor para Freakie HOY ($0, deterministico en lo comun).
// 'gateway' -> ai-gateway: multi-ERP, log central con tenant_id. Es el cutover (LLM-only hasta portar heuristicas).
const BACKEND = "gateway";

const FN_SLUG = { f1: "ai-query", gateway: "ai-gateway" };
const ROJO = "#E62329";
const AMARILLO = "#FFD900";

// Usa el cliente/proxy de la app (src/supabase.js): en PROD va por /sb, en dev directo.
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

function fmtCell(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("es-SV") : v.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v);
}

function Tabla({ filas }) {
  if (!Array.isArray(filas) || filas.length === 0)
    return <div className="text-sm text-gray-500 italic">Sin resultados.</div>;

  // Una sola fila con un solo valor -> mostrar como cifra grande
  const cols = Object.keys(filas[0]);
  if (filas.length === 1 && cols.length === 1) {
    return (
      <div className="text-3xl font-bold" style={{ color: ROJO }}>
        {fmtCell(filas[0][cols[0]])}
        <span className="ml-2 text-sm font-normal text-gray-500">{cols[0]}</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: AMARILLO }}>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-semibold text-gray-900 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((row, i) => (
            <tr key={i} className={i % 2 ? "bg-gray-50" : "bg-white"}>
              {cols.map((c) => (
                <td key={c} className="px-3 py-1.5 whitespace-nowrap tabular-nums">{fmtCell(row[c])}</td>
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
  const [items, setItems] = useState([]); // {pregunta, resp?, error?, motivo?, sql?}
  const [feedbackDado, setFeedbackDado] = useState({});
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items, cargando]);

  const usuario = {
    rol: user?.rol ?? null,
    nombre: user?.nombre ?? null,
    store_code: user?.store_code ?? null,
  };

  const endpoint = `${SUPABASE_URL}/functions/v1/${FN_SLUG[BACKEND]}`;
  const headers = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  };
  const buildBody = (q) =>
    BACKEND === "gateway"
      ? { tenant_hint: "freakie", usuario, pregunta: q }
      : { pregunta: q, usuario };

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
    <div className="flex flex-col h-full max-w-3xl mx-auto" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <header className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: AMARILLO }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-black" style={{ backgroundColor: ROJO }}>IA</div>
        <div>
          <h1 className="font-bold text-gray-900 leading-tight">Asistente Freakie</h1>
          <p className="text-xs text-gray-500">Preguntá por ventas, gastos, planilla, banco, inventario…</p>
        </div>
        <span className="ml-auto text-[10px] uppercase tracking-wide px-2 py-1 rounded-full bg-gray-100 text-gray-500">
          {BACKEND === "gateway" ? "gateway" : "F1"}
        </span>
        {onClose && (
          <button onClick={onClose} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-1">×</button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {items.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGERENCIAS.map((s) => (
              <button key={s} onClick={() => preguntar(s)}
                className="text-sm px-3 py-1.5 rounded-full border border-gray-300 hover:border-gray-400 bg-white transition">
                {s}
              </button>
            ))}
          </div>
        )}

        {items.map((it, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="px-3 py-2 rounded-2xl rounded-br-sm text-white text-sm max-w-[85%]" style={{ backgroundColor: ROJO }}>
                {it.pregunta}
              </div>
            </div>

            {it.resp && (
              <div className="px-3 py-3 rounded-2xl rounded-bl-sm bg-gray-50 border border-gray-200 space-y-2">
                {it.resp.nota && <div className="text-xs text-gray-500">{it.resp.nota}</div>}
                <Tabla filas={it.resp.filas} />
                <div className="flex items-center gap-3 pt-1 text-[11px] text-gray-400">
                  <span>{it.resp.ruta === "heuristica" ? `⚡ ${it.resp.intent}` : "🤖 IA"}</span>
                  {typeof it.resp.latencia_ms === "number" && <span>{it.resp.latencia_ms} ms</span>}
                  {it.resp.id && (
                    <span className="ml-auto flex items-center gap-1">
                      <button onClick={() => enviarFeedback(it.resp.id, "up")}
                        className={feedbackDado[it.resp.id] === "up" ? "opacity-100" : "opacity-50 hover:opacity-100"}>👍</button>
                      <button onClick={() => enviarFeedback(it.resp.id, "down")}
                        className={feedbackDado[it.resp.id] === "down" ? "opacity-100" : "opacity-50 hover:opacity-100"}>👎</button>
                    </span>
                  )}
                </div>
                {it.resp.sql && (
                  <details className="text-[11px] text-gray-400">
                    <summary className="cursor-pointer select-none">Ver SQL</summary>
                    <pre className="mt-1 p-2 bg-gray-900 text-gray-100 rounded overflow-x-auto whitespace-pre-wrap">{it.resp.sql}</pre>
                  </details>
                )}
              </div>
            )}

            {it.error && (
              <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-red-50 border border-red-200 text-sm text-red-700">
                {it.error}
                {it.motivo && <div className="text-xs text-red-400 mt-1">{it.motivo}</div>}
              </div>
            )}
          </div>
        ))}

        {cargando && (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: ROJO }} />
            <span className="w-2 h-2 rounded-full animate-bounce [animation-delay:120ms]" style={{ backgroundColor: ROJO }} />
            <span className="w-2 h-2 rounded-full animate-bounce [animation-delay:240ms]" style={{ backgroundColor: ROJO }} />
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); preguntar(); }}
        className="flex gap-2 px-4 py-3 border-t border-gray-200">
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          placeholder="Escribí tu pregunta…"
          className="flex-1 px-3 py-2 rounded-full border border-gray-300 focus:outline-none focus:ring-2"
          style={{ "--tw-ring-color": ROJO }}
          disabled={cargando}
        />
        <button type="submit" disabled={cargando || !pregunta.trim()}
          className="px-5 py-2 rounded-full text-white font-semibold disabled:opacity-40 transition"
          style={{ backgroundColor: ROJO }}>
          Enviar
        </button>
      </form>
    </div>
  );
}
