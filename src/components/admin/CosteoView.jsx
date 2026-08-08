import { useState, useEffect } from 'react';
import { db } from '../../supabase';

// ── COSTEO / MÁRGENES ─────────────────────────────────────────────────
// Tabla de márgenes por plato del menú con el costo REAL (promedio ponderado
// de compras, vía receta_costo_total). Ordena peor margen primero. Marca las
// recetas "no confiables" (sin ingredientes / costo implausible) para revisar.
const C = { card: '#1a1a1a', border: '#2a2a2a', text: '#f0f0f0', dim: '#8a8a8a',
  green: '#4ade80', red: '#e63946', yellow: '#fbbf24' };
const money = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;
const pct = (v) => v == null ? '—' : `${Number(v).toFixed(1)}%`;

export default function CosteoView() {
  const [rows, setRows] = useState(null);
  const [soloRevisar, setSoloRevisar] = useState(false);

  const cargar = async () => {
    const { data } = await db.rpc('costeo_menu');
    setRows(data || []);
  };
  useEffect(() => { cargar(); }, []);

  if (!rows) return <div style={{ padding: 24, color: C.dim }}>Cargando costeo…</div>;

  const vista = soloRevisar ? rows.filter(r => !r.confiable) : rows;
  const nRev = rows.filter(r => !r.confiable).length;
  // color del margen: rojo <15%, amarillo 15-30%, verde >30% (food cost inverso)
  const colMargen = (m) => m == null ? C.dim : m < 15 ? C.red : m < 30 ? C.yellow : C.green;

  return (
    <div style={{ padding: 16, color: C.text, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>💰 Costeo / Márgenes</div>
        <div style={{ flex: 1 }} />
        {nRev > 0 && (
          <button onClick={() => setSoloRevisar(v => !v)}
            style={{ background: soloRevisar ? C.yellow : '#333', color: soloRevisar ? '#1a1a1a' : C.text,
                     border: 'none', borderRadius: 8, padding: '7px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
            ⚠️ {nRev} por revisar
          </button>
        )}
        <button onClick={cargar} style={{ background: '#333', color: C.text, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>↻</button>
      </div>

      <div style={{ fontSize: 12, color: C.dim, marginBottom: 10 }}>
        Costo real (promedio ponderado de compras). Ordenado por peor margen. Las filas grises son recetas
        incompletas (sin ingredientes o costo implausible) — corregilas en Recetas/BOM y el costo se actualiza solo.
      </div>

      <div style={{ overflowX: 'auto', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: C.dim, textAlign: 'right' }}>
              <th style={{ ...th, textAlign: 'left' }}>Plato</th>
              <th style={th}>Costo</th>
              <th style={th}>Precio</th>
              <th style={th}>Margen $</th>
              <th style={th}>Margen %</th>
              <th style={th}>Food cost</th>
            </tr>
          </thead>
          <tbody>
            {vista.map(r => (
              <tr key={r.id} style={{ borderTop: `1px solid ${C.border}`, opacity: r.confiable ? 1 : 0.5, textAlign: 'right' }}>
                <td style={{ ...td, textAlign: 'left' }}>
                  {r.nombre}
                  {!r.confiable && <span style={{ color: C.yellow, fontSize: 10, marginLeft: 6 }}>⚠️ revisar</span>}
                  <div style={{ fontSize: 10, color: C.dim }}>{r.tipo}{r.n_ingredientes ? ` · ${r.n_ingredientes} ing` : ' · sin ingredientes'}</div>
                </td>
                <td style={td}>{money(r.costo)}</td>
                <td style={td}>{money(r.precio_venta)}</td>
                <td style={{ ...td, color: colMargen(r.margen_pct), fontWeight: 700 }}>{money(r.margen)}</td>
                <td style={{ ...td, color: colMargen(r.margen_pct), fontWeight: 700 }}>{pct(r.margen_pct)}</td>
                <td style={{ ...td, color: r.food_cost_pct > 40 ? C.red : C.dim }}>{pct(r.food_cost_pct)}</td>
              </tr>
            ))}
            {vista.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: C.dim, padding: 24 }}>Sin datos.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th = { padding: '10px 12px', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' };
const td = { padding: '8px 12px', whiteSpace: 'nowrap' };
