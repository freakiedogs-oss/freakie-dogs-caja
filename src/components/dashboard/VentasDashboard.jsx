import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES, today, yesterday, n } from '../../config';

const STORE_ORDER = ['M001', 'S004', 'S003', 'S001', 'S002'];
const COLORES = { M001: '#4ade80', S004: '#fb923c', S003: '#facc15', S001: '#60a5fa', S002: '#f472b6' };
const CANAL_COLORES = { Local: '#4ade80', BUHO: '#60a5fa', PEYA: '#facc15', DT: '#fb923c' };
const DELIVERY_PCT = {
  M001: { pct: 0.101, buho: 0.96, peya: 0.04 },
  S003: { pct: 0.471, buho: 0.33, peya: 0.67, dt: 0.033 },
  S001: { pct: 0.146, buho: 0.76, peya: 0.24 },
  S004: { pct: 0.088, buho: 0.02, peya: 0.98 },
  S002: { pct: 0.006, buho: 1.00, peya: 0.00 },
};

const fmt$ = (v) => v == null ? '—' : '$' + Math.round(Number(v)).toLocaleString('en-US');
const fmtK = (v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${Math.round(v)}`;
const pE = (p) => p >= 90 ? '🟢' : p >= 60 ? '🟡' : '🔴';
const svDate = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];

function canalDesglose(sc, venta) {
  const d = DELIVERY_PCT[sc];
  if (!d || venta === 0) return { local: venta, buho: 0, peya: 0, dt: 0 };
  const dt = d.dt ? venta * d.dt : 0;
  const del_ = venta * d.pct;
  return { local: venta - del_ - dt, buho: del_ * d.buho, peya: del_ * d.peya, dt };
}

function getPresetDates(preset) {
  const hoy = svDate();
  const d = new Date(hoy + 'T12:00:00Z');
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
  switch (preset) {
    case 'hoy': return [hoy, hoy];
    case 'ayer': { const a = new Date(Date.UTC(y, m, dd - 1)); return [a.toISOString().slice(0, 10), a.toISOString().slice(0, 10)]; }
    case 'semana': { const s = new Date(Date.UTC(y, m, dd - 6)); return [s.toISOString().slice(0, 10), hoy]; }
    case 'mes': return [`${y}-${String(m + 1).padStart(2, '0')}-01`, hoy];
    case 'mes_ant': {
      const maY = m === 0 ? y - 1 : y, maM = m === 0 ? 11 : m - 1;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return [`${maY}-${String(maM + 1).padStart(2, '0')}-01`, `${maY}-${String(maM + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
    }
    default: return [hoy, hoy];
  }
}

// ── SVG Mini Charts ──
function MiniBarChart({ data, colors }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 320, H = 100, bw = Math.max(8, Math.floor(W / data.length) - 4);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: 'visible' }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * H);
        const x = i * (bw + 4) + 2;
        return (
          <g key={i}>
            <rect x={x} y={H - h} width={bw} height={h} rx={3} fill={colors?.[i] || d.color || '#4ade80'} opacity={0.85} />
            {d.meta > 0 && <line x1={x} x2={x + bw} y1={H - (d.meta / max) * H} y2={H - (d.meta / max) * H} stroke="#555" strokeWidth={1.5} strokeDasharray="3,2" />}
            <text x={x + bw / 2} y={H + 12} textAnchor="middle" fontSize={8} fill="#666">{d.label}</text>
            <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" fontSize={8} fill="#aaa">{fmtK(d.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MiniLineChart({ data }) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 320, H = 100;
  const step = W / (data.length - 1);
  const pts = data.map((d, i) => `${i * step},${H - (d.value / max) * H}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke="#4ade80" strokeWidth={2} />
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={i * step} cy={H - (d.value / max) * H} r={2.5} fill="#4ade80" />
          {i % Math.max(1, Math.floor(data.length / 8)) === 0 && (
            <text x={i * step} y={H + 14} textAnchor="middle" fontSize={7} fill="#666">{d.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function DonutChart({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const R = 60, cx = 80, cy = 80;
  let angle = -90;
  const arcs = data.map(d => {
    const pct = d.value / total;
    const startAngle = angle;
    angle += pct * 360;
    const endAngle = angle;
    const start = { x: cx + R * Math.cos(startAngle * Math.PI / 180), y: cy + R * Math.sin(startAngle * Math.PI / 180) };
    const end = { x: cx + R * Math.cos(endAngle * Math.PI / 180), y: cy + R * Math.sin(endAngle * Math.PI / 180) };
    const largeArc = pct > 0.5 ? 1 : 0;
    return { ...d, pct, path: `M ${start.x} ${start.y} A ${R} ${R} 0 ${largeArc} 1 ${end.x} ${end.y}` };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <svg width={160} height={160} viewBox="0 0 160 160">
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill="none" stroke={a.color} strokeWidth={20} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={14} fill="#fff" fontWeight={700}>{fmt$(total)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="#555">Total</text>
      </svg>
      <div>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color }} />
            <span style={{ fontSize: 11, color: '#aaa' }}>{d.name}: {fmt$(d.value)} ({Math.round(d.value / total * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function VentasDashboard({ user, onBack }) {
  const [tab, setTab] = useState('resumen');
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filtroSuc, setFiltroSuc] = useState('todas');
  const [ventasRaw, setVentasRaw] = useState([]);
  const [metasRaw, setMetasRaw] = useState([]);
  const [ventasAntRaw, setVentasAntRaw] = useState([]);

  useEffect(() => { const [d, h] = getPresetDates('mes'); setDesde(d); setHasta(h); }, []);

  useEffect(() => {
    if (!desde || !hasta) return;
    const cargar = async () => {
      setLoading(true);
      try {
        const dObj = new Date(desde + 'T12:00:00Z');
        const hObj = new Date(hasta + 'T12:00:00Z');
        const dias = Math.round((hObj - dObj) / 86400000) + 1;
        const maY = dObj.getUTCMonth() === 0 ? dObj.getUTCFullYear() - 1 : dObj.getUTCFullYear();
        const maM = dObj.getUTCMonth() === 0 ? 11 : dObj.getUTCMonth() - 1;
        const desdeAnt = `${maY}-${String(maM + 1).padStart(2, '0')}-${String(dObj.getUTCDate()).padStart(2, '0')}`;
        const hastaAntD = new Date(Date.UTC(maY, maM, dObj.getUTCDate() + dias - 1));
        const hastaAnt = hastaAntD.toISOString().slice(0, 10);
        const [vR, mR, vaR] = await Promise.all([
          db.from('ventas_diarias').select('fecha, store_code, total_ventas_quanto, efectivo_quanto, tarjeta_quanto, ventas_transferencia, ventas_link_pago').gte('fecha', desde).lte('fecha', hasta),
          db.from('metas_ventas').select('fecha, meta_diaria, sucursales(store_code)').gte('fecha', desde).lte('fecha', hasta),
          db.from('ventas_diarias').select('fecha, store_code, total_ventas_quanto').gte('fecha', desdeAnt).lte('fecha', hastaAnt),
        ]);
        setVentasRaw(vR.data || []); setMetasRaw(mR.data || []); setVentasAntRaw(vaR.data || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    cargar();
  }, [desde, hasta]);

  const cambiarPreset = (p) => { setPreset(p); if (p !== 'custom') { const [d, h] = getPresetDates(p); setDesde(d); setHasta(h); } };

  const datos = useMemo(() => {
    const stores = filtroSuc === 'todas' ? STORE_ORDER : [filtroSuc];
    const ventaSuc = {}, metaSuc = {}, ventaAntSuc = {};
    ventasRaw.forEach(r => { if (!stores.includes(r.store_code)) return; ventaSuc[r.store_code] = (ventaSuc[r.store_code] || 0) + n(r.total_ventas_quanto); });
    metasRaw.forEach(r => { const sc = r.sucursales?.store_code; if (!sc || !stores.includes(sc)) return; metaSuc[sc] = (metaSuc[sc] || 0) + n(r.meta_diaria); });
    ventasAntRaw.forEach(r => { if (!stores.includes(r.store_code)) return; ventaAntSuc[r.store_code] = (ventaAntSuc[r.store_code] || 0) + n(r.total_ventas_quanto); });

    let totalVenta = 0, totalMeta = 0, totalAnt = 0;
    stores.forEach(sc => { totalVenta += ventaSuc[sc] || 0; totalMeta += metaSuc[sc] || 0; totalAnt += ventaAntSuc[sc] || 0; });
    const txCount = ventasRaw.filter(r => stores.includes(r.store_code)).length;
    let mejorSuc = '', mejorVenta = 0;
    stores.forEach(sc => { if ((ventaSuc[sc] || 0) > mejorVenta) { mejorSuc = STORES[sc] || sc; mejorVenta = ventaSuc[sc] || 0; } });

    const barras = stores.map(sc => ({
      sucursal: STORES[sc] || sc, store_code: sc,
      venta: Math.round(ventaSuc[sc] || 0), meta: Math.round(metaSuc[sc] || 0),
      pct: (metaSuc[sc] || 0) > 0 ? Math.round((ventaSuc[sc] || 0) / metaSuc[sc] * 100) : 0,
      vsAnt: (ventaAntSuc[sc] || 0) > 0 ? Math.round((ventaSuc[sc] || 0) / ventaAntSuc[sc] * 100) : 0,
      ...canalDesglose(sc, ventaSuc[sc] || 0),
    }));

    const tendMap = {};
    ventasRaw.forEach(r => { if (!stores.includes(r.store_code)) return; tendMap[r.fecha] = (tendMap[r.fecha] || 0) + n(r.total_ventas_quanto); });
    const tendencia = Object.entries(tendMap).map(([f, v]) => ({ fecha: f, label: f.slice(5), value: Math.round(v) })).sort((a, b) => a.fecha.localeCompare(b.fecha));

    let tL = 0, tB = 0, tP = 0, tDT = 0;
    stores.forEach(sc => { const c = canalDesglose(sc, ventaSuc[sc] || 0); tL += c.local; tB += c.buho; tP += c.peya; tDT += c.dt; });
    const canales = [
      { name: 'Local', value: Math.round(tL), color: CANAL_COLORES.Local },
      { name: 'BUHO', value: Math.round(tB), color: CANAL_COLORES.BUHO },
      { name: 'PEYA', value: Math.round(tP), color: CANAL_COLORES.PEYA },
    ];
    if (tDT > 0) canales.push({ name: 'Drive Thru', value: Math.round(tDT), color: CANAL_COLORES.DT });

    const canalMatrix = stores.map(sc => {
      const c = canalDesglose(sc, ventaSuc[sc] || 0);
      return { sucursal: STORES[sc], store_code: sc, local: Math.round(c.local), buho: Math.round(c.buho), peya: Math.round(c.peya), dt: Math.round(c.dt), total: Math.round(ventaSuc[sc] || 0) };
    });

    const detalleMap = {};
    ventasRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      const key = `${r.fecha}_${r.store_code}`;
      if (!detalleMap[key]) detalleMap[key] = { fecha: r.fecha, store_code: r.store_code, sucursal: STORES[r.store_code], venta: 0, efectivo: 0, tarjeta: 0, meta: 0 };
      detalleMap[key].venta += n(r.total_ventas_quanto); detalleMap[key].efectivo += n(r.efectivo_quanto); detalleMap[key].tarjeta += n(r.tarjeta_quanto);
    });
    metasRaw.forEach(r => { const sc = r.sucursales?.store_code; if (!sc || !stores.includes(sc)) return; const key = `${r.fecha}_${sc}`; if (detalleMap[key]) detalleMap[key].meta += n(r.meta_diaria); });
    const detalle = Object.values(detalleMap).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.store_code.localeCompare(b.store_code));

    return {
      totalVenta, totalMeta, totalAnt, ticketProm: txCount > 0 ? totalVenta / txCount : 0,
      mejorSuc, mejorVenta,
      pctCump: totalMeta > 0 ? Math.round(totalVenta / totalMeta * 100) : 0,
      pctVsAnt: totalAnt > 0 ? Math.round(totalVenta / totalAnt * 100) : 0,
      barras, tendencia, canales, canalMatrix, detalle,
    };
  }, [ventasRaw, metasRaw, ventasAntRaw, filtroSuc]);

  const TABS = [{ k: 'resumen', l: '📊 Resumen' }, { k: 'tendencia', l: '📈 Tendencia' }, { k: 'canales', l: '🛵 Canales' }, { k: 'detalle', l: '📋 Detalle' }];
  const PRESETS = [{ k: 'hoy', l: 'Hoy' }, { k: 'ayer', l: 'Ayer' }, { k: 'semana', l: '7d' }, { k: 'mes', l: 'Mes' }, { k: 'mes_ant', l: 'Ant' }, { k: 'custom', l: '📅' }];

  const S = {
    card: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 },
    kpi: { textAlign: 'center', padding: '14px 8px' },
    kpiVal: { fontSize: 22, fontWeight: 800 },
    kpiLabel: { fontSize: 10, color: '#555', marginBottom: 4 },
    kpiSub: { fontSize: 10, color: '#555', marginTop: 2 },
    btnP: (a) => ({ background: a ? '#14532d' : '#1a1a1a', border: a ? '1px solid #4ade80' : '1px solid #333', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: a ? '#4ade80' : '#888', cursor: 'pointer' }),
    btnT: (a) => ({ background: 'none', border: 'none', color: a ? '#4ade80' : '#555', padding: '10px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: a ? '2px solid #4ade80' : '2px solid transparent', fontWeight: a ? 700 : 400 }),
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 11 },
    th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #333', color: '#888', fontSize: 10 },
    td: { padding: '6px 8px', borderBottom: '1px solid #1a1a1a' },
  };

  const exportCSV = () => {
    const rows = [['Fecha', 'Sucursal', 'Venta', 'Meta', '%', 'Efectivo', 'Tarjeta']];
    datos.detalle.forEach(r => rows.push([r.fecha, r.sucursal, r.venta.toFixed(2), (r.meta || 0).toFixed(2), r.meta > 0 ? Math.round(r.venta / r.meta * 100) + '%' : '', r.efectivo.toFixed(2), r.tarjeta.toFixed(2)]));
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `ventas_${desde}_${hasta}.csv`; a.click();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d' }}>
      <div style={{ padding: '20px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a1a1a', background: '#111' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#4ade80', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← Volver</button>
          <div style={{ fontWeight: 800, fontSize: 18 }}>📊 Ventas Diarias</div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Dashboard Ejecutivo</div>
        </div>
        <div style={{ fontSize: 10, color: '#333', textAlign: 'right' }}>Solo<br />Ejecutivos</div>
      </div>

      <div style={{ padding: '10px 16px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
          {PRESETS.map(p => <button key={p.k} onClick={() => cambiarPreset(p.k)} style={S.btnP(preset === p.k)}>{p.l}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={desde} onChange={e => { setDesde(e.target.value); setPreset('custom'); }} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: '#ccc' }} />
          <span style={{ color: '#555', fontSize: 11 }}>→</span>
          <input type="date" value={hasta} onChange={e => { setHasta(e.target.value); setPreset('custom'); }} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: '#ccc' }} />
          <select value={filtroSuc} onChange={e => setFiltroSuc(e.target.value)} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: '#ccc', marginLeft: 'auto' }}>
            <option value="todas">Todas</option>
            {STORE_ORDER.map(sc => <option key={sc} value={sc}>{STORES[sc]}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
        {TABS.map(t => <button key={t.k} onClick={() => setTab(t.k)} style={S.btnT(tab === t.k)}>{t.l}</button>)}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60 }}><div className="spin" style={{ width: 36, height: 36, margin: '0 auto' }} /></div>}

      {!loading && (
        <div style={{ padding: 16 }}>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div style={{ ...S.card, ...S.kpi, borderColor: '#14532d', background: '#0a1a0a' }}>
              <div style={S.kpiLabel}>VENTA TOTAL</div>
              <div style={{ ...S.kpiVal, color: '#4ade80' }}>{fmt$(datos.totalVenta)}</div>
              <div style={S.kpiSub}>{datos.pctVsAnt > 0 && <span style={{ color: datos.pctVsAnt >= 100 ? '#4ade80' : '#f87171' }}>{datos.pctVsAnt >= 100 ? '↑' : '↓'} {datos.pctVsAnt}% vs ant</span>}</div>
            </div>
            <div style={{ ...S.card, ...S.kpi, borderColor: '#1e3a5f', background: '#0a0f1a' }}>
              <div style={S.kpiLabel}>TICKET PROM</div>
              <div style={{ ...S.kpiVal, color: '#60a5fa' }}>{fmt$(datos.ticketProm)}</div>
              <div style={S.kpiSub}>{ventasRaw.length} cierres</div>
            </div>
            <div style={{ ...S.card, ...S.kpi, borderColor: datos.pctCump >= 90 ? '#14532d' : '#451a03' }}>
              <div style={S.kpiLabel}>% META</div>
              <div style={{ ...S.kpiVal, color: datos.pctCump >= 90 ? '#4ade80' : datos.pctCump >= 60 ? '#facc15' : '#f87171' }}>{datos.pctCump > 0 ? `${datos.pctCump}%` : '—'}</div>
              <div style={S.kpiSub}>{pE(datos.pctCump)} {fmt$(datos.totalMeta)}</div>
            </div>
            <div style={{ ...S.card, ...S.kpi, borderColor: '#3d1a00', background: '#150a00' }}>
              <div style={S.kpiLabel}>MEJOR</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fb923c' }}>{datos.mejorSuc}</div>
              <div style={S.kpiSub}>{fmt$(datos.mejorVenta)}</div>
            </div>
          </div>

          {/* RESUMEN */}
          {tab === 'resumen' && (
            <>
              <div style={S.card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>Venta vs Meta por Sucursal</div>
                <MiniBarChart data={datos.barras.map(b => ({ label: b.sucursal.slice(0, 5), value: b.venta, meta: b.meta, color: COLORES[b.store_code] }))} />
              </div>
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Sucursal</th><th style={{ ...S.th, textAlign: 'right' }}>Venta</th><th style={{ ...S.th, textAlign: 'right' }}>Meta</th>
                    <th style={{ ...S.th, textAlign: 'center' }}>%</th><th style={{ ...S.th, textAlign: 'right' }}>vs Ant</th><th style={{ ...S.th, textAlign: 'right' }}>~BUHO</th><th style={{ ...S.th, textAlign: 'right' }}>~PEYA</th>
                  </tr></thead>
                  <tbody>
                    {datos.barras.map(r => (
                      <tr key={r.store_code}>
                        <td style={{ ...S.td, color: COLORES[r.store_code], fontWeight: 600 }}>{r.sucursal}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{fmt$(r.venta)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#555' }}>{fmt$(r.meta)}</td>
                        <td style={{ ...S.td, textAlign: 'center', color: r.pct >= 90 ? '#4ade80' : r.pct >= 60 ? '#facc15' : '#f87171' }}>{r.pct > 0 ? `${r.pct}%` : '—'}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: r.vsAnt >= 100 ? '#4ade80' : '#f87171' }}>{r.vsAnt > 0 ? `${r.vsAnt}%` : '—'}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#60a5fa' }}>{fmt$(r.buho)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#facc15' }}>{fmt$(r.peya)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* TENDENCIA */}
          {tab === 'tendencia' && (
            <div style={S.card}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>Venta Diaria — Tendencia</div>
              <MiniLineChart data={datos.tendencia} />
            </div>
          )}

          {/* CANALES */}
          {tab === 'canales' && (
            <>
              <div style={{ ...S.card }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', marginBottom: 10 }}>Desglose por Canal (~estimado)</div>
                <DonutChart data={datos.canales} />
                <div style={{ fontSize: 10, color: '#555', marginTop: 8 }}>~ = estimado con proporciones históricas</div>
              </div>
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#facc15', marginBottom: 10 }}>Canal × Sucursal</div>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Sucursal</th><th style={{ ...S.th, textAlign: 'right' }}>🏪 Local</th><th style={{ ...S.th, textAlign: 'right' }}>🛵 BUHO</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>🟡 PEYA</th><th style={{ ...S.th, textAlign: 'right' }}>🚗 DT</th><th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                  </tr></thead>
                  <tbody>
                    {datos.canalMatrix.map(r => (
                      <tr key={r.store_code}>
                        <td style={{ ...S.td, color: COLORES[r.store_code], fontWeight: 600 }}>{r.sucursal}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{fmt$(r.local)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#60a5fa' }}>{fmt$(r.buho)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#facc15' }}>{fmt$(r.peya)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#fb923c' }}>{r.dt > 0 ? fmt$(r.dt) : '—'}</td>
                        <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>{fmt$(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* DETALLE */}
          {tab === 'detalle' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button onClick={exportCSV} style={{ background: '#14532d', border: '1px solid #4ade80', borderRadius: 6, padding: '6px 14px', fontSize: 11, color: '#4ade80', cursor: 'pointer' }}>📥 Exportar CSV</button>
              </div>
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead><tr>
                    <th style={S.th}>Fecha</th><th style={S.th}>Sucursal</th><th style={{ ...S.th, textAlign: 'right' }}>Venta</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Meta</th><th style={{ ...S.th, textAlign: 'center' }}>%</th><th style={{ ...S.th, textAlign: 'right' }}>Efect</th><th style={{ ...S.th, textAlign: 'right' }}>Tarj</th>
                  </tr></thead>
                  <tbody>
                    {datos.detalle.slice(0, 100).map((r, i) => {
                      const pct = r.meta > 0 ? Math.round(r.venta / r.meta * 100) : 0;
                      return (
                        <tr key={i}>
                          <td style={{ ...S.td, fontSize: 10 }}>{r.fecha}</td>
                          <td style={{ ...S.td, color: COLORES[r.store_code], fontWeight: 600 }}>{r.sucursal}</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{fmt$(r.venta)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#555' }}>{r.meta > 0 ? fmt$(r.meta) : '—'}</td>
                          <td style={{ ...S.td, textAlign: 'center', color: pct >= 90 ? '#4ade80' : pct >= 60 ? '#facc15' : '#f87171' }}>{pct > 0 ? `${pct}%` : '—'}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{fmt$(r.efectivo)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{fmt$(r.tarjeta)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {datos.detalle.length > 100 && <div style={{ textAlign: 'center', padding: 10, color: '#555', fontSize: 11 }}>100 de {datos.detalle.length}</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
