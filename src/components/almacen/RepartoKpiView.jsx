import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

// ── KPI DE REPARTO (reemplaza el KPI viejo de carga en CM) ───────────
// Por motorista/día: de la primera salida (bodega marcó despachado) a la
// última entrega marcada por el motorista. Mide tiempo de ruta, no de carga.
const C = { card:'#1a1a1a', border:'#2a2a2a', text:'#f0f0f0', dim:'#8a8a8a', green:'#4ade80', yellow:'#fbbf24', red:'#e63946' };

export default function RepartoKpiView() {
  const [rows, setRows] = useState(null);
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [hasta, setHasta] = useState(() => new Date().toISOString().slice(0, 10));

  const cargar = useCallback(async () => {
    const { data } = await db.rpc('kpi_reparto', { p_desde: desde, p_hasta: hasta });
    setRows(data || []);
  }, [desde, hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  const hhmm = (t) => t ? new Date(t).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : '—';
  const fdate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
  const colTiempo = (m) => m == null ? C.dim : m <= 60 ? C.green : m <= 120 ? C.yellow : C.red;

  return (
    <div style={{ padding: 16, color: C.text, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>⏱️ KPI de Reparto</div>
      <div style={{ fontSize: 12, color: C.dim, marginBottom: 12 }}>
        Tiempo de ruta por motorista/día: de la salida de Casa Matriz (bodega marcó despachado) a la última entrega marcada por el motorista.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={inp} />
        <span style={{ color: C.dim }}>→</span>
        <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={inp} />
        <button onClick={cargar} style={{ background: '#333', color: C.text, border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>↻</button>
      </div>

      {!rows ? <div style={{ color: C.dim }}>Cargando…</div> : rows.length === 0 ? (
        <div style={{ color: C.dim, textAlign: 'center', padding: 30 }}>Sin despachos con salida en el rango.</div>
      ) : (
        <div style={{ overflowX: 'auto', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: C.dim, textAlign: 'right' }}>
              <th style={{ ...th, textAlign: 'left' }}>Fecha</th>
              <th style={{ ...th, textAlign: 'left' }}>Motorista</th>
              <th style={th}>Paradas</th>
              <th style={th}>Entregadas</th>
              <th style={th}>Salida</th>
              <th style={th}>Últ. entrega</th>
              <th style={th}>Tiempo ruta</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}`, textAlign: 'right' }}>
                  <td style={{ ...td, textAlign: 'left' }}>{fdate(r.fecha)}</td>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{r.motorista}</td>
                  <td style={td}>{r.paradas}</td>
                  <td style={{ ...td, color: r.entregadas < r.paradas ? C.yellow : C.green }}>{r.entregadas}/{r.paradas}</td>
                  <td style={td}>{hhmm(r.primera_salida)}</td>
                  <td style={td}>{hhmm(r.ultima_entrega)}</td>
                  <td style={{ ...td, color: colTiempo(r.tiempo_min), fontWeight: 700 }}>{r.tiempo_min == null ? '⏳ en ruta' : `${r.tiempo_min} min`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: '10px 12px', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' };
const td = { padding: '8px 12px', whiteSpace: 'nowrap' };
const inp = { background: '#111', border: '1px solid #2a2a2a', color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 13 };
