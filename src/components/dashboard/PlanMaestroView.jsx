// PlanMaestroView.jsx — Tab Super Admin: Plan Maestro IA (universo de agentes + progreso)
// Lee fn_ai_plan_dashboard() en vivo. Estilos inline (no dependen de Tailwind).
// Uso:  import PlanMaestroView from "./components/dashboard/PlanMaestroView";  <PlanMaestroView user={user} />
import { useState, useEffect, useCallback } from "react";
import { URL_SB, KEY_SB } from "../../supabase";

const ROJO = "#E62329", BG = "#0f0f0f", CARD = "#1a1a1a", BORDER = "#2a2a2a", TXT = "#e8e8e8", MUT = "#9a9a9a";
const ESTADO = {
  hecho: { c: "#16a34a", t: "Hecho" }, en_progreso: { c: "#f59e0b", t: "En progreso" },
  pendiente: { c: "#6b7280", t: "Pendiente" }, pausado: { c: "#52525b", t: "Pausado" },
};
const ROLES = ["superadmin", "super", "admin", "ejecutivo"];
const COLOR = { verde: "#16a34a", amarillo: "#f59e0b", rojo: "#dc2626", pausado: "#6b7280", gris: "#6b7280" };

function relTime(iso) {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
  if (d > 0) return `hace ${d}d`;
  if (h > 0) return `hace ${h}h`;
  return "hace minutos";
}

const rpc = (fn, params = {}) =>
  fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY_SB, Authorization: `Bearer ${KEY_SB}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((r) => r.json());

function KPI({ label, value, color }) {
  return (
    <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "12px 14px", minWidth: 110, flex: "1 1 110px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || "#fff" }}>{value}</div>
      <div style={{ fontSize: 11, color: MUT, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function Barra({ pct, color }) {
  return (
    <div style={{ height: 6, background: "#2a2a2a", borderRadius: 999, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color || ROJO }} />
    </div>
  );
}

export default function PlanMaestroView({ user = {} }) {
  const [data, setData] = useState(null);
  const [agentes, setAgentes] = useState(null);
  const [loading, setLoading] = useState(true);
  const rol = (user?.rol || "").toLowerCase();

  const cargar = useCallback(() => {
    setLoading(true);
    Promise.all([rpc("fn_ai_plan_dashboard"), rpc("fn_ai_agentes_listar")])
      .then(([d, a]) => { setData(d); setAgentes(a); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (!ROLES.includes(rol)) return <div style={{ padding: 24, color: MUT }}>Solo para administradores.</div>;

  const m = data?.metricas || {}, r = data?.resumen || {}, items = data?.items || [];
  const cats = [...new Set(items.map((i) => i.categoria))];

  return (
    <div style={{ background: BG, color: TXT, minHeight: "100%", padding: "18px 20px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>🧩 Plan Maestro IA</div>
        <span style={{ fontSize: 12, color: MUT }}>universo de agentes, memoria y herramientas</span>
        <button onClick={cargar} style={{ marginLeft: "auto", background: CARD, border: `1px solid ${BORDER}`, color: TXT, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>↻ Refrescar</button>
      </div>

      {loading && <div style={{ color: MUT, padding: 20 }}>Cargando…</div>}

      {!loading && data && (
        <>
          {/* Progreso global */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0 18px" }}>
            <div style={{ fontSize: 13, color: MUT, whiteSpace: "nowrap" }}>Progreso global</div>
            <Barra pct={r.progreso_global || 0} color="#16a34a" />
            <div style={{ fontWeight: 800, color: "#16a34a", minWidth: 44, textAlign: "right" }}>{r.progreso_global || 0}%</div>
          </div>

          {/* KPIs */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
            <KPI label={`Hechos / ${r.total}`} value={r.hecho} color="#16a34a" />
            <KPI label="En progreso" value={r.en_progreso} color="#f59e0b" />
            <KPI label="Pendientes" value={r.pendiente} color={MUT} />
            <KPI label="ERPs activos" value={m.tenants} />
            <KPI label="Crons IA" value={m.crons_ia} />
            <KPI label="Recetas memoria" value={m.recetas} />
            <KPI label="Diccionario" value={m.diccionario} />
            <KPI label="Backlog huecos" value={m.backlog_pendiente} color={m.backlog_pendiente > 0 ? "#f59e0b" : "#16a34a"} />
            <KPI label="Consultas hoy" value={m.interacciones_hoy} />
          </div>

          {/* Agentes en vivo */}
          {agentes && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 8 }}>🤖 Agentes (estado vivo)</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(agentes.cowork || []).map((a, i) => {
                  const col = a.enabled ? (COLOR[a.estado] || COLOR.gris) : COLOR.pausado;
                  return (
                    <div key={"a" + i} style={{ display: "flex", alignItems: "center", gap: 10, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px", opacity: a.enabled ? 1 : 0.6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: col, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{a.nombre} <span style={{ fontSize: 10, color: MUT }}>{a.categoria}</span></div>
                        <div style={{ fontSize: 11, color: MUT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.cadencia} · última {relTime(a.ultima)}{a.resumen ? ` · ${a.resumen}` : ""}</div>
                      </div>
                      <span style={{ fontSize: 10, color: col, border: `1px solid ${col}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{a.enabled ? a.estado : "pausado"}</span>
                    </div>
                  );
                })}
                {(agentes.crons_ia || []).map((c, i) => {
                  const col = COLOR[c.estado] || COLOR.gris;
                  return (
                    <div key={"c" + i} style={{ display: "flex", alignItems: "center", gap: 10, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "8px 12px" }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: col, flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{c.nombre} <span style={{ fontSize: 10, color: MUT }}>cron IA</span></div>
                        <div style={{ fontSize: 11, color: MUT }}>{c.cadencia} · última {relTime(c.ultima)}</div>
                      </div>
                      <span style={{ fontSize: 10, color: col, border: `1px solid ${col}`, borderRadius: 999, padding: "2px 8px" }}>{c.estado}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Categorías */}
          {cats.map((cat) => {
            const list = items.filter((i) => i.categoria === cat);
            const prom = Math.round(list.reduce((a, b) => a + (b.progreso || 0), 0) / (list.length || 1));
            return (
              <div key={cat} style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{cat}</div>
                  <span style={{ fontSize: 11, color: MUT }}>{list.length} ítems</span>
                  <div style={{ flex: 1, maxWidth: 220 }}><Barra pct={prom} /></div>
                  <span style={{ fontSize: 11, color: MUT }}>{prom}%</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {list.map((it, idx) => {
                    const e = ESTADO[it.estado] || ESTADO.pendiente;
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "9px 12px" }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: e.c, flexShrink: 0 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13.5, color: "#fff", fontWeight: 600 }}>{it.item}</div>
                          <div style={{ fontSize: 11.5, color: MUT }}>{it.descripcion}{it.cadencia ? ` · ${it.cadencia}` : ""}</div>
                        </div>
                        <span style={{ fontSize: 10, color: e.c, border: `1px solid ${e.c}`, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{e.t}</span>
                        <div style={{ width: 70, flexShrink: 0 }}><Barra pct={it.progreso} color={e.c} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div style={{ marginTop: 20, fontSize: 11, color: MUT }}>
            Fuente: <code>fn_ai_plan_dashboard()</code> · editar ítems en la tabla <code>ai_plan_maestro</code>.
          </div>
        </>
      )}
    </div>
  );
}
