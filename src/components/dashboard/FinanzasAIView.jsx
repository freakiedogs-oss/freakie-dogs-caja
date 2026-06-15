// FinanzasAIView.jsx — Sección "Finanzas AI" del ERP Freakie Dogs.
// P&L (Estado de Resultados) + Tendencia + Variaciones + Liquidez + Diagnóstico con reglas.
// Una sola llamada: fn_ai_finanzas_analizar(false) devuelve TODO.
// Uso:  import FinanzasAIView from "./components/dashboard/FinanzasAIView";  <FinanzasAIView user={user} />
// Estilos INLINE (no dependen de Tailwind). Sin localStorage.
import { useState, useEffect, useCallback } from "react";
import { URL_SB, KEY_SB } from "../../supabase";

const ROJO = "#E62329", BG = "#0f0f0f", CARD = "#1a1a1a", BORDER = "#2a2a2a", TXT = "#e8e8e8", MUT = "#9a9a9a";
const VERDE = "#16a34a", AMBAR = "#f59e0b", ROJ2 = "#dc2626";
const ROLES = ["superadmin", "super", "admin", "ejecutivo"];
const ESTADO_COL = { verde: VERDE, amarillo: AMBAR, rojo: ROJ2 };
const SEV_COL = { alta: ROJ2, media: AMBAR, baja: MUT };

const rpc = (fn, params = {}) =>
  fetch(`${URL_SB}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY_SB, Authorization: `Bearer ${KEY_SB}`, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((r) => r.json());

const money = (n) => "$" + (Number(n) || 0).toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-SV");
const pct = (n) => (n == null ? "—" : Number(n).toFixed(1) + "%");

function Badge({ estado }) {
  const c = ESTADO_COL[estado] || MUT;
  const t = { verde: "Saludable", amarillo: "Atención", rojo: "Riesgo" }[estado] || estado;
  return <span style={{ fontSize: 12, fontWeight: 700, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "3px 12px" }}>{t}</span>;
}

// Fila del P&L con barra de % sobre ventas
function PLRow({ label, valor, porcentaje, color, fuerte }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ width: 150, fontSize: fuerte ? 14 : 13, color: fuerte ? "#fff" : TXT, fontWeight: fuerte ? 700 : 500 }}>{label}</div>
      <div style={{ flex: 1, height: 8, background: "#222", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, Math.abs(porcentaje || 0))}%`, height: "100%", background: color || ROJO }} />
      </div>
      <div style={{ width: 54, textAlign: "right", fontSize: 12, color: MUT }}>{porcentaje == null ? "" : pct(porcentaje)}</div>
      <div style={{ width: 110, textAlign: "right", fontSize: fuerte ? 14 : 13, color: fuerte ? "#fff" : TXT, fontWeight: fuerte ? 800 : 600 }}>{money(valor)}</div>
    </div>
  );
}

// Mini gráfico de EBITDA por mes (barras, con línea cero)
function TendenciaChart({ serie }) {
  if (!serie || !serie.length) return null;
  const W = 520, H = 150, pad = 24, bw = (W - pad * 2) / serie.length;
  const vals = serie.map((s) => Number(s.ebitda) || 0);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0), rng = max - min || 1;
  const y0 = pad + (max / rng) * (H - pad * 2); // posición del cero
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <line x1={pad} y1={y0} x2={W - pad} y2={y0} stroke={BORDER} strokeWidth="1" />
      {serie.map((s, i) => {
        const v = Number(s.ebitda) || 0;
        const h = (Math.abs(v) / rng) * (H - pad * 2);
        const x = pad + i * bw + bw * 0.18;
        const w = bw * 0.64;
        const y = v >= 0 ? y0 - h : y0;
        const col = v >= 0 ? VERDE : ROJ2;
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(1, h)} rx="2" fill={col} opacity="0.85" />
            <text x={x + w / 2} y={H - 7} fontSize="9" fill={MUT} textAnchor="middle">{(s.mes || "").slice(5)}</text>
            <text x={x + w / 2} y={v >= 0 ? y - 3 : y + h + 9} fontSize="8.5" fill={MUT} textAnchor="middle">{Math.round(v / 1000)}k</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function FinanzasAIView({ user = {} }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const rol = (user?.rol || "").toLowerCase();

  const cargar = useCallback(() => {
    setLoading(true); setErr(null);
    rpc("fn_ai_finanzas_analizar", { p_push: false })
      .then((r) => { if (r && r.pl) setD(r); else setErr("Sin datos"); })
      .catch(() => setErr("Error de conexión"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (!ROLES.includes(rol)) return <div style={{ padding: 24, color: MUT }}>Solo para administradores.</div>;

  const a = d?.pl?.actual || {}, prev = d?.pl?.anterior || {};
  const liq = d?.liquidez || {}, vari = d?.variaciones || {}, hall = d?.hallazgos || [], tend = d?.tendencia || [];

  return (
    <div style={{ background: BG, color: TXT, minHeight: "100%", padding: "18px 20px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>💰 Finanzas AI</div>
        {d && <Badge estado={d.estado} />}
        <span style={{ fontSize: 12, color: MUT }}>Estado de resultados, tendencia y diagnóstico</span>
        <button onClick={cargar} style={{ marginLeft: "auto", background: CARD, border: `1px solid ${BORDER}`, color: TXT, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>↻ Refrescar</button>
      </div>

      {loading && <div style={{ color: MUT, padding: 20 }}>Calculando P&L…</div>}
      {err && <div style={{ color: AMBAR, padding: 20 }}>{err}</div>}

      {!loading && d && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 14, marginTop: 8 }}>

          {/* P&L */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Estado de Resultados · {a.mes}</div>
              <span style={{ fontSize: 11, color: AMBAR }}>mes en curso (parcial)</span>
            </div>
            <PLRow label="Ventas" valor={a.ventas} porcentaje={100} color="#3b82f6" fuerte />
            <div style={{ fontSize: 11, color: MUT, padding: "4px 0 8px 150px" }}>
              Quanto {money0(a.ventas_quanto)} · PeYa {money0(a.ventas_peya)} · Eventos {money0(a.ventas_eventos)}
            </div>
            <PLRow label="− COGS (comida)" valor={a.cogs} porcentaje={a.cogs_pct} color={ROJO} />
            <PLRow label="− Gastos operativos" valor={a.opex} porcentaje={a.opex_pct} color="#a855f7" />
            <PLRow label="− Planilla" valor={a.planilla} porcentaje={a.planilla_pct} color="#f59e0b" />
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0 2px" }}>
              <div style={{ width: 150, fontSize: 15, color: "#fff", fontWeight: 800 }}>= EBITDA</div>
              <div style={{ flex: 1 }} />
              <div style={{ width: 54, textAlign: "right", fontSize: 13, color: (a.margen_pct || 0) >= 0 ? VERDE : ROJ2, fontWeight: 700 }}>{pct(a.margen_pct)}</div>
              <div style={{ width: 110, textAlign: "right", fontSize: 17, color: (a.ebitda || 0) >= 0 ? VERDE : ROJ2, fontWeight: 800 }}>{money(a.ebitda)}</div>
            </div>
            <div style={{ fontSize: 11.5, color: MUT, marginTop: 8 }}>
              Mes anterior ({prev.mes}): ventas {money0(prev.ventas)} · EBITDA <b style={{ color: (prev.ebitda || 0) >= 0 ? VERDE : ROJ2 }}>{money(prev.ebitda)}</b> ({pct(prev.margen_pct)})
            </div>
          </div>

          {/* Tendencia */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 }}>Tendencia EBITDA</div>
            <div style={{ fontSize: 11, color: MUT, marginBottom: 6 }}>últimos {tend.length} meses</div>
            <TendenciaChart serie={tend} />
          </div>

          {/* Variaciones */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 8 }}>Variaciones (último mes completo)</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              <Chip label="Ventas" val={vari.d_ventas_pct != null ? (vari.d_ventas_pct > 0 ? "+" : "") + vari.d_ventas_pct + "%" : "—"} pos={(vari.d_ventas_pct || 0) >= 0} />
              <Chip label="COGS" val={(vari.d_cogs_pp > 0 ? "+" : "") + (vari.d_cogs_pp ?? 0) + "pp"} pos={(vari.d_cogs_pp || 0) <= 0} />
              <Chip label="Planilla" val={(vari.d_planilla_pp > 0 ? "+" : "") + (vari.d_planilla_pp ?? 0) + "pp"} pos={(vari.d_planilla_pp || 0) <= 0} />
              <Chip label="EBITDA" val={money0(vari.d_ebitda)} pos={(vari.d_ebitda || 0) >= 0} />
              <Chip label="Margen" val={(vari.d_margen_pp > 0 ? "+" : "") + (vari.d_margen_pp ?? 0) + "pp"} pos={(vari.d_margen_pp || 0) >= 0} />
            </div>
            <div style={{ fontSize: 12, color: MUT, lineHeight: 1.5 }}>{vari.resumen}</div>
          </div>

          {/* Liquidez */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Liquidez</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <Mini label="Bancos" val={money0(liq.saldo_bancos)} col={VERDE} />
              <Mini label="Deuda préstamos" val={money0(liq.deuda_prestamos)} col={ROJ2} />
              <Mini label="Posición neta" val={money0(liq.posicion_neta)} col={(liq.posicion_neta || 0) >= 0 ? VERDE : ROJ2} />
            </div>
            {(liq.prestamos || []).slice(0, 4).map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: MUT, padding: "3px 0" }}>
                <span>{p.institucion}</span><span>{money0(p.capital_pendiente)}</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: MUT, marginTop: 8, fontStyle: "italic" }}>{liq.nota_cxp}</div>
          </div>

          {/* Hallazgos / Diagnóstico */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16, gridColumn: "1 / -1" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 10 }}>🔎 Diagnóstico · {hall.length} hallazgo(s)</div>
            {hall.length === 0 && <div style={{ fontSize: 13, color: VERDE }}>Sin alertas. Operación dentro de parámetros.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {hall.map((h, i) => {
                const c = SEV_COL[h.sev] || MUT;
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", borderLeft: `3px solid ${c}`, background: "#161616", borderRadius: 8, padding: "9px 12px" }}>
                    <span style={{ fontSize: 10, color: c, fontWeight: 700, textTransform: "uppercase", minWidth: 70 }}>{h.tema}</span>
                    <span style={{ fontSize: 13, color: TXT, lineHeight: 1.45 }}>{h.texto}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ label, val, pos }) {
  const c = pos ? VERDE : ROJ2;
  return (
    <div style={{ background: "#161616", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "6px 10px", minWidth: 78 }}>
      <div style={{ fontSize: 10, color: MUT, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c }}>{val}</div>
    </div>
  );
}
function Mini({ label, val, col }) {
  return (
    <div style={{ flex: 1, background: "#161616", border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: col }}>{val}</div>
      <div style={{ fontSize: 10.5, color: MUT, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}
