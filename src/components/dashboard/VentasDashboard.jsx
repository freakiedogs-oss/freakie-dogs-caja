import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES, today, yesterday, n } from '../../config';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';

const STORE_ORDER = ['M001', 'S004', 'S003', 'S001', 'S002'];
const COLORES = { M001: '#4ade80', S004: '#fb923c', S003: '#facc15', S001: '#60a5fa', S002: '#f472b6' };
const CANAL_COLORES = { Local: '#4ade80', BUHO: '#60a5fa', PEYA: '#facc15', 'Drive Thru': '#fb923c' };
const DELIVERY_PCT = {
  M001: { pct: 0.101, buho: 0.96, peya: 0.04 },
  S003: { pct: 0.471, buho: 0.33, peya: 0.67, dt: 0.033 },
  S001: { pct: 0.146, buho: 0.76, peya: 0.24 },
  S004: { pct: 0.088, buho: 0.02, peya: 0.98 },
  S002: { pct: 0.006, buho: 1.00, peya: 0.00 },
};
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const fmt$ = (v) => v == null ? '—' : '$' + Math.round(Number(v)).toLocaleString('en-US');
const fmtK = (v) => v >= 1000 ? `$${(v/1000).toFixed(1)}K` : `$${Math.round(v)}`;
const pE = (p) => p >= 90 ? '🟢' : p >= 60 ? '🟡' : '🔴';
const svDate = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];

function canalDesglose(sc, venta) {
  const d = DELIVERY_PCT[sc];
  if (!d || venta === 0) return { local: venta, buho: 0, peya: 0, dt: 0 };
  const dt = d.dt ? venta * d.dt : 0;
  const del_ = venta * d.pct;
  return { local: venta - del_ - dt, buho: del_ * d.buho, peya: del_ * d.peya, dt };
}

// Presets de rango
function getPresetDates(preset) {
  const hoy = svDate();
  const d = new Date(hoy + 'T12:00:00Z');
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
  switch (preset) {
    case 'hoy': return [hoy, hoy];
    case 'ayer': { const a = new Date(Date.UTC(y, m, dd - 1)); return [a.toISOString().slice(0,10), a.toISOString().slice(0,10)]; }
    case 'semana': { const s = new Date(Date.UTC(y, m, dd - 6)); return [s.toISOString().slice(0,10), hoy]; }
    case 'mes': return [`${y}-${String(m+1).padStart(2,'0')}-01`, hoy];
    case 'mes_ant': {
      const maY = m === 0 ? y-1 : y, maM = m === 0 ? 11 : m-1;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return [`${maY}-${String(maM+1).padStart(2,'0')}-01`, `${maY}-${String(maM+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`];
    }
    default: return [hoy, hoy];
  }
}

export default function VentasDashboard({ user, onBack }) {
  const [tab, setTab] = useState('resumen');
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('mes');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [filtroSuc, setFiltroSuc] = useState('todas');

  // Data
  const [ventasRaw, setVentasRaw] = useState([]);
  const [metasRaw, setMetasRaw] = useState([]);
  const [ventasAntRaw, setVentasAntRaw] = useState([]);

  // Inicializar fechas
  useEffect(() => {
    const [d, h] = getPresetDates('mes');
    setDesde(d); setHasta(h);
  }, []);

  // Cargar datos cuando cambian fechas
  useEffect(() => {
    if (!desde || !hasta) return;
    const cargar = async () => {
      setLoading(true);
      try {
        // Calcular mes anterior equivalente
        const dObj = new Date(desde + 'T12:00:00Z');
        const hObj = new Date(hasta + 'T12:00:00Z');
        const diasRango = Math.round((hObj - dObj) / 86400000) + 1;
        const maY = dObj.getUTCMonth() === 0 ? dObj.getUTCFullYear() - 1 : dObj.getUTCFullYear();
        const maM = dObj.getUTCMonth() === 0 ? 11 : dObj.getUTCMonth() - 1;
        const desdeAnt = `${maY}-${String(maM + 1).padStart(2, '0')}-${String(dObj.getUTCDate()).padStart(2, '0')}`;
        const hastaAntD = new Date(Date.UTC(maY, maM, dObj.getUTCDate() + diasRango - 1));
        const hastaAnt = hastaAntD.toISOString().slice(0, 10);

        const [vR, mR, vaR] = await Promise.all([
          db.from('ventas_diarias')
            .select('fecha, store_code, total_ventas_quanto, efectivo_quanto, tarjeta_quanto, ventas_transferencia, ventas_link_pago')
            .gte('fecha', desde).lte('fecha', hasta),
          db.from('metas_ventas')
            .select('fecha, meta_diaria, sucursales(store_code)')
            .gte('fecha', desde).lte('fecha', hasta),
          db.from('ventas_diarias')
            .select('fecha, store_code, total_ventas_quanto')
            .gte('fecha', desdeAnt).lte('fecha', hastaAnt),
        ]);
        setVentasRaw(vR.data || []);
        setMetasRaw(mR.data || []);
        setVentasAntRaw(vaR.data || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    };
    cargar();
  }, [desde, hasta]);

  // Preset handler
  const cambiarPreset = (p) => {
    setPreset(p);
    if (p !== 'custom') {
      const [d, h] = getPresetDates(p);
      setDesde(d); setHasta(h);
    }
  };

  // ── Datos procesados ──
  const datos = useMemo(() => {
    const stores = filtroSuc === 'todas' ? STORE_ORDER : [filtroSuc];

    // Ventas por sucursal
    const ventaSuc = {};
    ventasRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      ventaSuc[r.store_code] = (ventaSuc[r.store_code] || 0) + n(r.total_ventas_quanto);
    });

    // Metas por sucursal
    const metaSuc = {};
    metasRaw.forEach(r => {
      const sc = r.sucursales?.store_code;
      if (!sc || !stores.includes(sc)) return;
      metaSuc[sc] = (metaSuc[sc] || 0) + n(r.meta_diaria);
    });

    // Ventas mes anterior
    const ventaAntSuc = {};
    ventasAntRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      ventaAntSuc[r.store_code] = (ventaAntSuc[r.store_code] || 0) + n(r.total_ventas_quanto);
    });

    // Totales
    let totalVenta = 0, totalMeta = 0, totalAnt = 0;
    stores.forEach(sc => {
      totalVenta += ventaSuc[sc] || 0;
      totalMeta += metaSuc[sc] || 0;
      totalAnt += ventaAntSuc[sc] || 0;
    });

    // Transacciones count
    const txCount = ventasRaw.filter(r => stores.includes(r.store_code)).length;
    const ticketProm = txCount > 0 ? totalVenta / txCount : 0;

    // Mejor sucursal
    let mejorSuc = '', mejorVenta = 0;
    stores.forEach(sc => {
      if ((ventaSuc[sc] || 0) > mejorVenta) { mejorSuc = STORES[sc] || sc; mejorVenta = ventaSuc[sc] || 0; }
    });

    // Barras por sucursal
    const barras = stores.map(sc => ({
      sucursal: STORES[sc] || sc,
      store_code: sc,
      venta: Math.round(ventaSuc[sc] || 0),
      meta: Math.round(metaSuc[sc] || 0),
      pct: (metaSuc[sc] || 0) > 0 ? Math.round((ventaSuc[sc] || 0) / metaSuc[sc] * 100) : 0,
      vsAnt: (ventaAntSuc[sc] || 0) > 0 ? Math.round((ventaSuc[sc] || 0) / ventaAntSuc[sc] * 100) : 0,
      ...canalDesglose(sc, ventaSuc[sc] || 0),
    }));

    // Tendencia diaria
    const tendMap = {};
    ventasRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      tendMap[r.fecha] = (tendMap[r.fecha] || 0) + n(r.total_ventas_quanto);
    });
    const tendencia = Object.entries(tendMap)
      .map(([f, v]) => ({ fecha: f, dia: f.slice(5), total: Math.round(v) }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    // Tendencia mes anterior
    const tendAntMap = {};
    ventasAntRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      tendAntMap[r.fecha] = (tendAntMap[r.fecha] || 0) + n(r.total_ventas_quanto);
    });

    // Canal desglose total
    let tLocal = 0, tBuho = 0, tPeya = 0, tDT = 0;
    stores.forEach(sc => {
      const c = canalDesglose(sc, ventaSuc[sc] || 0);
      tLocal += c.local; tBuho += c.buho; tPeya += c.peya; tDT += c.dt;
    });
    const canales = [
      { name: 'Local', value: Math.round(tLocal), color: CANAL_COLORES.Local },
      { name: 'BUHO', value: Math.round(tBuho), color: CANAL_COLORES.BUHO },
      { name: 'PEYA', value: Math.round(tPeya), color: CANAL_COLORES.PEYA },
    ];
    if (tDT > 0) canales.push({ name: 'Drive Thru', value: Math.round(tDT), color: CANAL_COLORES['Drive Thru'] });

    // Canal × Sucursal matrix
    const canalMatrix = stores.map(sc => {
      const c = canalDesglose(sc, ventaSuc[sc] || 0);
      return { sucursal: STORES[sc], store_code: sc, local: Math.round(c.local), buho: Math.round(c.buho), peya: Math.round(c.peya), dt: Math.round(c.dt), total: Math.round(ventaSuc[sc] || 0) };
    });

    // Heatmap DOW
    const dowMap = {};
    ventasRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      const dow = new Date(r.fecha + 'T12:00:00').getDay();
      const key = `${r.store_code}_${dow}`;
      dowMap[key] = (dowMap[key] || 0) + n(r.total_ventas_quanto);
    });

    // Detalle diario
    const detalleMap = {};
    ventasRaw.forEach(r => {
      if (!stores.includes(r.store_code)) return;
      const key = `${r.fecha}_${r.store_code}`;
      if (!detalleMap[key]) detalleMap[key] = { fecha: r.fecha, store_code: r.store_code, sucursal: STORES[r.store_code], venta: 0, efectivo: 0, tarjeta: 0, transfer: 0, link: 0 };
      detalleMap[key].venta += n(r.total_ventas_quanto);
      detalleMap[key].efectivo += n(r.efectivo_quanto);
      detalleMap[key].tarjeta += n(r.tarjeta_quanto);
      detalleMap[key].transfer += n(r.ventas_transferencia);
      detalleMap[key].link += n(r.ventas_link_pago);
    });
    // Add meta to detalle
    metasRaw.forEach(r => {
      const sc = r.sucursales?.store_code;
      if (!sc || !stores.includes(sc)) return;
      const key = `${r.fecha}_${sc}`;
      if (detalleMap[key]) detalleMap[key].meta = (detalleMap[key].meta || 0) + n(r.meta_diaria);
    });
    const detalle = Object.values(detalleMap).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.store_code.localeCompare(b.store_code));

    return {
      totalVenta, totalMeta, totalAnt, ticketProm, mejorSuc, mejorVenta,
      pctCump: totalMeta > 0 ? Math.round(totalVenta / totalMeta * 100) : 0,
      pctVsAnt: totalAnt > 0 ? Math.round(totalVenta / totalAnt * 100) : 0,
      barras, tendencia, canales, canalMatrix, detalle, dowMap,
    };
  }, [ventasRaw, metasRaw, ventasAntRaw, filtroSuc]);

  const TABS = [
    { k: 'resumen', l: '📊 Resumen' },
    { k: 'tendencia', l: '📈 Tendencia' },
    { k: 'canales', l: '🛵 Canales' },
    { k: 'detalle', l: '📋 Detalle' },
  ];

  const PRESETS = [
    { k: 'hoy', l: 'Hoy' }, { k: 'ayer', l: 'Ayer' }, { k: 'semana', l: '7 días' },
    { k: 'mes', l: 'Mes' }, { k: 'mes_ant', l: 'Mes Ant' }, { k: 'custom', l: '📅' },
  ];

  // Estilos
  const S = {
    card: { background: '#111', border: '1px solid #222', borderRadius: 10, padding: 14, marginBottom: 12 },
    kpi: { textAlign: 'center', padding: '14px 8px' },
    kpiVal: { fontSize: 22, fontWeight: 800 },
    kpiLabel: { fontSize: 10, color: '#555', marginBottom: 4 },
    kpiSub: { fontSize: 10, color: '#555', marginTop: 2 },
    btnPreset: (active) => ({ background: active ? '#14532d' : '#1a1a1a', border: active ? '1px solid #4ade80' : '1px solid #333', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: active ? '#4ade80' : '#888', cursor: 'pointer' }),
    btnTab: (active) => ({ background: 'none', border: 'none', color: active ? '#4ade80' : '#555', padding: '10px 14px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: active ? '2px solid #4ade80' : '2px solid transparent', fontWeight: active ? 700 : 400 }),
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 11 },
    th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #333', color: '#888', fontSize: 10 },
    td: { padding: '6px 8px', borderBottom: '1px solid #1a1a1a' },
  };

  const exportCSV = () => {
    const headers = ['Fecha', 'Sucursal', 'Venta', 'Meta', '% Cump', 'Efectivo', 'Tarjeta', 'Transferencia', 'Link'];
    const rows = datos.detalle.map(r => [
      r.fecha, r.sucursal, r.venta.toFixed(2), (r.meta || 0).toFixed(2),
      r.meta > 0 ? Math.round(r.venta / r.meta * 100) + '%' : '—',
      r.efectivo.toFixed(2), r.tarjeta.toFixed(2), r.transfer.toFixed(2), r.link.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ventas_${desde}_${hasta}.csv`; a.click();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a1a1a', background: '#111' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#4ade80', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 4 }}>← Volver</button>
          <div style={{ fontWeight: 800, fontSize: 18 }}>📊 Ventas Diarias</div>
          <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Dashboard Ejecutivo</div>
        </div>
        <div style={{ fontSize: 10, color: '#333', textAlign: 'right' }}>Solo<br />Ejecutivos</div>
      </div>

      {/* Filtros */}
      <div style={{ padding: '10px 16px', background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', position: 'sticky', top: 0, zIndex: 10 }}>
        {/* Presets */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto' }}>
          {PRESETS.map(p => (
            <button key={p.k} onClick={() => cambiarPreset(p.k)} style={S.btnPreset(preset === p.k)}>{p.l}</button>
          ))}
        </div>
        {/* Date pickers + sucursal */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={desde} onChange={e => { setDesde(e.target.value); setPreset('custom'); }}
            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: '#ccc' }} />
          <span style={{ color: '#555', fontSize: 11 }}>→</span>
          <input type="date" value={hasta} onChange={e => { setHasta(e.target.value); setPreset('custom'); }}
            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: '#ccc' }} />
          <select value={filtroSuc} onChange={e => setFiltroSuc(e.target.value)}
            style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, padding: '5px 8px', fontSize: 11, color: '#ccc', marginLeft: 'auto' }}>
            <option value="todas">Todas</option>
            {STORE_ORDER.map(sc => <option key={sc} value={sc}>{STORES[sc]}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
        {TABS.map(t => <button key={t.k} onClick={() => setTab(t.k)} style={S.btnTab(tab === t.k)}>{t.l}</button>)}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60 }}><div className="spin" style={{ width: 36, height: 36, margin: '0 auto' }} /></div>}

      {!loading && (
        <div style={{ padding: 16 }}>

          {/* ── KPI Cards (siempre visibles) ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            <div style={{ ...S.card, ...S.kpi, borderColor: '#14532d', background: '#0a1a0a' }}>
              <div style={S.kpiLabel}>VENTA TOTAL</div>
              <div style={{ ...S.kpiVal, color: '#4ade80' }}>{fmt$(datos.totalVenta)}</div>
              <div style={S.kpiSub}>
                {datos.pctVsAnt > 0 && <span style={{ color: datos.pctVsAnt >= 100 ? '#4ade80' : '#f87171' }}>
                  {datos.pctVsAnt >= 100 ? '↑' : '↓'} {datos.pctVsAnt}% vs ant
                </span>}
              </div>
            </div>
            <div style={{ ...S.card, ...S.kpi, borderColor: '#1e3a5f', background: '#0a0f1a' }}>
              <div style={S.kpiLabel}>TICKET PROM</div>
              <div style={{ ...S.kpiVal, color: '#60a5fa' }}>{fmt$(datos.ticketProm)}</div>
              <div style={S.kpiSub}>{ventasRaw.length} cierres</div>
            </div>
            <div style={{ ...S.card, ...S.kpi, borderColor: datos.pctCump >= 90 ? '#14532d' : '#451a03' }}>
              <div style={S.kpiLabel}>% CUMPLIMIENTO</div>
              <div style={{ ...S.kpiVal, color: datos.pctCump >= 90 ? '#4ade80' : datos.pctCump >= 60 ? '#facc15' : '#f87171' }}>
                {datos.pctCump > 0 ? `${datos.pctCump}%` : '—'}
              </div>
              <div style={S.kpiSub}>{pE(datos.pctCump)} Meta: {fmt$(datos.totalMeta)}</div>
            </div>
            <div style={{ ...S.card, ...S.kpi, borderColor: '#3d1a00', background: '#150a00' }}>
              <div style={S.kpiLabel}>MEJOR SUCURSAL</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#fb923c' }}>{datos.mejorSuc}</div>
              <div style={S.kpiSub}>{fmt$(datos.mejorVenta)}</div>
            </div>
          </div>

          {/* ── TAB: RESUMEN ── */}
          {tab === 'resumen' && (
            <>
              {/* Barras por sucursal */}
              <div style={S.card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>Venta vs Meta por Sucursal</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={datos.barras} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <XAxis dataKey="sucursal" tick={{ fill: '#888', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#555', fontSize: 9 }} tickFormatter={v => fmtK(v)} />
                    <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} />
                    <Bar dataKey="venta" fill="#4ade80" radius={[4, 4, 0, 0]} name="Venta" />
                    <Bar dataKey="meta" fill="#333" radius={[4, 4, 0, 0]} name="Meta" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabla resumen */}
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Sucursal</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Venta</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Meta</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>%</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>vs Ant</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>~BUHO</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>~PEYA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.barras.map(r => (
                      <tr key={r.store_code}>
                        <td style={{ ...S.td, color: COLORES[r.store_code], fontWeight: 600 }}>{r.sucursal}</td>
                        <td style={{ ...S.td, textAlign: 'right' }}>{fmt$(r.venta)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#555' }}>{fmt$(r.meta)}</td>
                        <td style={{ ...S.td, textAlign: 'center', color: r.pct >= 90 ? '#4ade80' : r.pct >= 60 ? '#facc15' : '#f87171' }}>
                          {r.pct > 0 ? `${r.pct}%` : '—'}
                        </td>
                        <td style={{ ...S.td, textAlign: 'right', color: r.vsAnt >= 100 ? '#4ade80' : '#f87171' }}>
                          {r.vsAnt > 0 ? `${r.vsAnt}%` : '—'}
                        </td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#60a5fa' }}>{fmt$(r.buho)}</td>
                        <td style={{ ...S.td, textAlign: 'right', color: '#facc15' }}>{fmt$(r.peya)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── TAB: TENDENCIA ── */}
          {tab === 'tendencia' && (
            <>
              <div style={S.card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>Venta Diaria — Tendencia</div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={datos.tendencia} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <XAxis dataKey="dia" tick={{ fill: '#888', fontSize: 9 }} />
                    <YAxis tick={{ fill: '#555', fontSize: 9 }} tickFormatter={v => fmtK(v)} />
                    <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} />
                    <Line type="monotone" dataKey="total" stroke="#4ade80" strokeWidth={2} dot={false} name="Venta" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Heatmap DOW */}
              <div style={S.card}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', marginBottom: 10 }}>Patrón Semanal (promedio)</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Día</th>
                        {(filtroSuc === 'todas' ? STORE_ORDER : [filtroSuc]).map(sc => (
                          <th key={sc} style={{ ...S.th, textAlign: 'right', color: COLORES[sc] }}>{STORES[sc]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((dia, i) => (
                        <tr key={i}>
                          <td style={{ ...S.td, fontWeight: 600 }}>{dia}</td>
                          {(filtroSuc === 'todas' ? STORE_ORDER : [filtroSuc]).map(sc => {
                            const v = datos.dowMap[`${sc}_${i}`] || 0;
                            const opacity = v > 0 ? Math.max(0.3, Math.min(1, v / 5000)) : 0.1;
                            return (
                              <td key={sc} style={{ ...S.td, textAlign: 'right', background: `rgba(74,222,128,${opacity})`, borderRadius: 4 }}>
                                {v > 0 ? fmtK(v) : '—'}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── TAB: CANALES ── */}
          {tab === 'canales' && (
            <>
              <div style={{ ...S.card, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', marginBottom: 10, alignSelf: 'flex-start' }}>Desglose por Canal (~estimado)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={datos.canales} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {datos.canales.map((c, i) => <Cell key={i} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt$(v)} contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>~ = estimado con proporciones históricas</div>
              </div>

              {/* Matrix canal × sucursal */}
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#facc15', marginBottom: 10 }}>Canal × Sucursal</div>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Sucursal</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>🏪 Local</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>🛵 BUHO</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>🟡 PEYA</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>🚗 DT</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
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

          {/* ── TAB: DETALLE ── */}
          {tab === 'detalle' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button onClick={exportCSV} style={{ background: '#14532d', border: '1px solid #4ade80', borderRadius: 6, padding: '6px 14px', fontSize: 11, color: '#4ade80', cursor: 'pointer' }}>
                  📥 Exportar CSV
                </button>
              </div>
              <div style={{ ...S.card, overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Fecha</th>
                      <th style={S.th}>Sucursal</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Venta</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Meta</th>
                      <th style={{ ...S.th, textAlign: 'center' }}>%</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Efectivo</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Tarjeta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.detalle.slice(0, 100).map((r, i) => {
                      const pct = r.meta > 0 ? Math.round(r.venta / r.meta * 100) : 0;
                      return (
                        <tr key={i}>
                          <td style={{ ...S.td, fontSize: 10 }}>{r.fecha}</td>
                          <td style={{ ...S.td, color: COLORES[r.store_code], fontWeight: 600 }}>{r.sucursal}</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>{fmt$(r.venta)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#555' }}>{r.meta > 0 ? fmt$(r.meta) : '—'}</td>
                          <td style={{ ...S.td, textAlign: 'center', color: pct >= 90 ? '#4ade80' : pct >= 60 ? '#facc15' : '#f87171' }}>
                            {pct > 0 ? `${pct}%` : '—'}
                          </td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{fmt$(r.efectivo)}</td>
                          <td style={{ ...S.td, textAlign: 'right', color: '#888' }}>{fmt$(r.tarjeta)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {datos.detalle.length > 100 && <div style={{ textAlign: 'center', padding: 10, color: '#555', fontSize: 11 }}>Mostrando 100 de {datos.detalle.length} registros</div>}
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
