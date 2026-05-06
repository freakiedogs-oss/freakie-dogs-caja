import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES, today } from '../../config';

const fmt$ = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt$2 = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (v) => v == null ? '—' : Number(v).toLocaleString('en-US');
const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(1) + '%';

const ROLES_PERMITIDOS = ['admin', 'superadmin', 'ejecutivo', 'gerente'];
const STORES_ACTIVAS = ['M001', 'S001', 'S002', 'S003', 'S004'];

// Colores por canal
const CH_COLOR = {
  mesa: '#f59e0b',
  para_llevar: '#3b82f6',
  delivery_propio: '#ec4899',
  drivethrough: '#14b8a6',
};
const CH_LABEL = {
  mesa: '🍴 Mesa',
  para_llevar: '🥡 Llevar',
  delivery_propio: '🛵 Delivery Propio',
  drivethrough: '🚗 Drive Thru',
};

export default function KpisVentaDashboard({ user, onBack }) {
  const [tab, setTab] = useState('resumen');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mesSel, setMesSel] = useState(() => {
    const d = new Date(Date.now() - 6 * 3600 * 1000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().split('T')[0];
  });
  const [kpisRaw, setKpisRaw] = useState([]);
  const [topItems, setTopItems] = useState({});
  const [empleados, setEmpleados] = useState({});
  const [tendencia, setTendencia] = useState([]);
  const [insights, setInsights] = useState(null);
  const [insightsOpen, setInsightsOpen] = useState(false);

  // Bloqueo por rol (defensa en profundidad)
  if (!ROLES_PERMITIDOS.includes(user?.rol)) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Acceso denegado</div>
        <div style={{ fontSize: 13, color: '#888' }}>Este dashboard requiere rol admin, superadmin, ejecutivo o gerente.</div>
        <button onClick={onBack} style={{ marginTop: 16, background: '#1f2937', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}>← Volver</button>
      </div>
    );
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const fechaDesde = mesSel;
        const fechaHasta = mesSiguiente(mesSel);

        // 1. KPIs por canal × sucursal (RPC con validación de rol)
        const { data: kpis, error: e1 } = await db.rpc('obtener_kpis_venta_canal', {
          p_pin: user.pin,
          p_fecha_desde: fechaDesde,
          p_fecha_hasta: fechaHasta,
        });
        if (e1) throw e1;
        setKpisRaw(kpis || []);

        // 2. Top items por sucursal (Pareto 80/20)
        const items = await fetchTopItemsPareto(fechaDesde, fechaHasta);
        setTopItems(items);

        // 3. Empleados por sucursal
        const emps = await fetchEmpleados(fechaDesde, fechaHasta);
        setEmpleados(emps);

        // 4. Tendencia 5 meses
        const tend = await fetchTendencia(user.pin);
        setTendencia(tend);

        // 5. Insights pre-generados (silencioso si no hay)
        const { data: ins } = await db.rpc('obtener_insights_kpis', {
          p_pin: user.pin,
          p_mes: mesSel,
        });
        setInsights(ins?.[0] || null);
      } catch (e) {
        console.error('KpisVentaDashboard load error:', e);
        setError(e.message || 'Error cargando KPIs');
      }
      setLoading(false);
    };
    load();
  }, [mesSel, user?.pin]);

  // --- Cálculos derivados ---
  const datos = useMemo(() => calcularDatos(kpisRaw), [kpisRaw]);

  // --- Render ---
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1a1a1a', background: '#111' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6 }}>← Volver</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>📊 KPIs de Venta</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Fuente: <code style={{ color: '#f59e0b' }}>quanto_ordenes</code> · 4 canales · Excluye PeYa
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={mesSel} onChange={e => setMesSel(e.target.value)}
              style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
              {mesesOptions().map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
            </select>
            <button onClick={() => setInsightsOpen(true)}
              style={{
                background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%)',
                color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
              }}>✨ Insights del día</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', overflowX: 'auto', background: '#0d0d0d' }}>
        {[
          ['resumen', '📊 Resumen'],
          ['items', '🍔 Top Items 80/20'],
          ['empleados', '👥 Por Empleado'],
          ['tendencia', '📈 Tendencia'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              background: 'none', border: 'none', color: tab === k ? '#fff' : '#666',
              padding: '12px 18px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
              borderBottom: tab === k ? '2px solid #6366f1' : '2px solid transparent',
              fontWeight: tab === k ? 700 : 400,
            }}>{l}</button>
        ))}
      </div>

      {loading && <Loading />}
      {error && <ErrorBox msg={error} />}

      {!loading && !error && (
        <div style={{ padding: 16 }}>
          {tab === 'resumen' && <TabResumen datos={datos} />}
          {tab === 'items' && <TabItems items={topItems} />}
          {tab === 'empleados' && <TabEmpleados emps={empleados} />}
          {tab === 'tendencia' && <TabTendencia tend={tendencia} />}
        </div>
      )}

      {insightsOpen && (
        <InsightsModal insights={insights} mesSel={mesSel} onClose={() => setInsightsOpen(false)} />
      )}
    </div>
  );
}

// ────────────────────── Helpers ──────────────────────
function mesSiguiente(mesISO) {
  const d = new Date(mesISO + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0); // último día del mes anterior
  return d.toISOString().split('T')[0];
}

function mesesOptions() {
  const out = [];
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  for (let i = 0; i < 6; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push({
      value: m.toISOString().split('T')[0],
      label: m.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' }) + (i === 0 ? ' (en curso)' : ''),
    });
  }
  return out;
}

function calcularDatos(kpisRaw) {
  const sucursales = {};
  const totalCanal = { mesa: 0, para_llevar: 0, delivery_propio: 0, drivethrough: 0 };
  const ordCanal = { mesa: 0, para_llevar: 0, delivery_propio: 0, drivethrough: 0 };
  let total = 0, ordTotal = 0;

  for (const r of kpisRaw) {
    const sc = r.store_code;
    if (!sucursales[sc]) {
      sucursales[sc] = {
        store_code: sc,
        nombre: STORES[sc] || sc,
        canales: {},
        total: 0,
        ord: 0,
      };
    }
    if (!sucursales[sc].canales[r.canal_venta]) {
      sucursales[sc].canales[r.canal_venta] = { ord: 0, monto: 0 };
    }
    sucursales[sc].canales[r.canal_venta].ord += Number(r.ordenes);
    sucursales[sc].canales[r.canal_venta].monto += Number(r.monto);
    sucursales[sc].total += Number(r.monto);
    sucursales[sc].ord += Number(r.ordenes);

    totalCanal[r.canal_venta] = (totalCanal[r.canal_venta] || 0) + Number(r.monto);
    ordCanal[r.canal_venta] = (ordCanal[r.canal_venta] || 0) + Number(r.ordenes);
    total += Number(r.monto);
    ordTotal += Number(r.ordenes);
  }

  // ticket promedio por canal global
  const ticketCanal = {};
  for (const k of Object.keys(totalCanal)) {
    ticketCanal[k] = ordCanal[k] > 0 ? totalCanal[k] / ordCanal[k] : 0;
  }

  // ordenar sucursales por monto desc
  const sucArr = STORES_ACTIVAS.map(sc => sucursales[sc]).filter(Boolean)
    .sort((a, b) => b.total - a.total);

  return { sucursales: sucArr, totalCanal, ordCanal, ticketCanal, total, ordTotal };
}

async function fetchTopItemsPareto(fechaDesde, fechaHasta) {
  // RPC pareto: implementación inline con dos queries (no tenemos RPC dedicada)
  const { data: ords } = await db.from('quanto_ordenes')
    .select('id,store_code')
    .gte('fecha', fechaDesde).lte('fecha', fechaHasta)
    .in('store_code', STORES_ACTIVAS)
    .in('canal_venta', ['mesa', 'para_llevar', 'delivery_propio', 'drivethrough']);

  if (!ords || ords.length === 0) return {};

  const idsBySuc = {};
  ords.forEach(o => {
    if (!idsBySuc[o.store_code]) idsBySuc[o.store_code] = [];
    idsBySuc[o.store_code].push(o.id);
  });

  const result = {};
  for (const sc of Object.keys(idsBySuc)) {
    const ids = idsBySuc[sc];
    // paginar en chunks de 500 para query en .in
    let allItems = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const { data } = await db.from('quanto_orden_items')
        .select('descripcion,cantidad,precio_unitario,es_propina')
        .in('orden_id', chunk);
      if (data) allItems = allItems.concat(data);
    }

    // agregar
    const agg = {};
    for (const it of allItems) {
      if (it.es_propina) continue;
      const desc = (it.descripcion || '').trim();
      if (!desc || desc.toLowerCase() === 'domicilio') continue;
      if (!agg[desc]) agg[desc] = { producto: titulize(desc), unidades: 0, monto: 0 };
      agg[desc].unidades += Number(it.cantidad || 0);
      agg[desc].monto += Number(it.cantidad || 0) * Number(it.precio_unitario || 0);
    }

    const total = Object.values(agg).reduce((s, x) => s + x.monto, 0);
    const sorted = Object.values(agg).sort((a, b) => b.monto - a.monto);

    let acum = 0;
    const corte80 = [];
    for (const x of sorted) {
      acum += x.monto;
      corte80.push({ ...x, pct: (x.monto / total) * 100, pct_acum: (acum / total) * 100 });
      if (acum / total >= 0.80) break;
    }

    result[sc] = { items: corte80, total, totalItems: sorted.length };
  }

  return result;
}

async function fetchEmpleados(fechaDesde, fechaHasta) {
  const { data } = await db.from('quanto_ordenes')
    .select('store_code,autorizado_por,total_pagar')
    .gte('fecha', fechaDesde).lte('fecha', fechaHasta)
    .in('store_code', STORES_ACTIVAS)
    .not('autorizado_por', 'is', null);

  const result = {};
  if (!data) return result;

  for (const r of data) {
    const sc = r.store_code;
    const emp = r.autorizado_por.trim();
    if (!result[sc]) result[sc] = { total: 0, ord: 0, empleados: {} };
    if (!result[sc].empleados[emp]) result[sc].empleados[emp] = { nombre: emp, ord: 0, monto: 0 };
    result[sc].empleados[emp].ord += 1;
    result[sc].empleados[emp].monto += Number(r.total_pagar || 0);
    result[sc].total += Number(r.total_pagar || 0);
    result[sc].ord += 1;
  }

  // calcular ticket prom y ordenar
  for (const sc of Object.keys(result)) {
    const emps = Object.values(result[sc].empleados).map(e => ({
      ...e,
      ticket: e.ord > 0 ? e.monto / e.ord : 0,
      pct: result[sc].total > 0 ? (e.monto / result[sc].total) * 100 : 0,
    })).sort((a, b) => b.monto - a.monto);
    result[sc].lista = emps;
  }
  return result;
}

async function fetchTendencia(pin) {
  // Últimos 5 meses
  const now = new Date(Date.now() - 6 * 3600 * 1000);
  const out = [];
  for (let i = 4; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    const desde = m.toISOString().split('T')[0];
    const hasta = next.toISOString().split('T')[0];
    const { data } = await db.rpc('obtener_kpis_venta_canal', {
      p_pin: pin, p_fecha_desde: desde, p_fecha_hasta: hasta,
    });
    const sum = { mes: m, mesa: { ord: 0, monto: 0 }, llevar: { ord: 0, monto: 0 }, delivery: { ord: 0, monto: 0 }, drive: { ord: 0, monto: 0 } };
    (data || []).forEach(r => {
      const k = r.canal_venta === 'mesa' ? 'mesa'
        : r.canal_venta === 'para_llevar' ? 'llevar'
        : r.canal_venta === 'delivery_propio' ? 'delivery'
        : r.canal_venta === 'drivethrough' ? 'drive' : null;
      if (k) {
        sum[k].ord += Number(r.ordenes);
        sum[k].monto += Number(r.monto);
      }
    });
    out.push(sum);
  }
  return out;
}

function titulize(s) {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function avatarLetters(nombre) {
  return nombre.split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase();
}

// ────────────────────── Subcomponentes UI ──────────────────────
function Loading() {
  return <div style={{ padding: 80, textAlign: 'center', color: '#666' }}>Cargando KPIs…</div>;
}

function ErrorBox({ msg }) {
  return (
    <div style={{ padding: 20, margin: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#fca5a5' }}>
      ⚠ {msg}
    </div>
  );
}

function MixStripe({ canales, total, width = 140 }) {
  if (!total) return null;
  const order = ['mesa', 'para_llevar', 'delivery_propio', 'drivethrough'];
  return (
    <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6, background: '#1f2937', width }}>
      {order.map(c => {
        const pct = canales[c] ? (canales[c].monto / total) * 100 : 0;
        if (pct === 0) return null;
        return <span key={c} style={{ background: CH_COLOR[c], width: pct + '%' }} />;
      })}
    </div>
  );
}

function KpiCard({ label, value, sub, color, pctMix, pctOrd }) {
  return (
    <div style={{
      background: '#141414', border: '1px solid #262626', borderLeft: color ? `3px solid ${color}` : '1px solid #262626',
      borderRadius: 8, padding: 14,
    }}>
      <div style={{ fontSize: 11, color: color || '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>{label}</span>
        {pctMix != null && <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 600 }}>{fmtPct(pctMix)} del total</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>{sub}</div>}
      {pctOrd != null && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{fmtPct(pctOrd)} de las órdenes</div>}
    </div>
  );
}

// ────────────────────── Tab Resumen ──────────────────────
function TabResumen({ datos }) {
  const { sucursales, totalCanal, ordCanal, ticketCanal, total, ordTotal } = datos;
  if (sucursales.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>No hay datos para el mes seleccionado.</div>;
  }
  const ticketGlobal = ordTotal > 0 ? total / ordTotal : 0;

  return (
    <>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Órdenes Totales" value={fmtN(ordTotal)} sub={`${fmt$(total)} · Ticket ${fmt$2(ticketGlobal)}`} />
        <KpiCard label="🍴 Mesa" value={fmtN(ordCanal.mesa)} sub={`${fmt$(totalCanal.mesa)} · Ticket ${fmt$2(ticketCanal.mesa)}`} color="#f59e0b" pctMix={total ? (totalCanal.mesa / total) * 100 : 0} pctOrd={ordTotal ? (ordCanal.mesa / ordTotal) * 100 : 0} />
        <KpiCard label="🥡 Llevar" value={fmtN(ordCanal.para_llevar)} sub={`${fmt$(totalCanal.para_llevar)} · Ticket ${fmt$2(ticketCanal.para_llevar)}`} color="#3b82f6" pctMix={total ? (totalCanal.para_llevar / total) * 100 : 0} pctOrd={ordTotal ? (ordCanal.para_llevar / ordTotal) * 100 : 0} />
        <KpiCard label="🛵 Delivery Propio" value={fmtN(ordCanal.delivery_propio)} sub={`${fmt$(totalCanal.delivery_propio)} · Ticket ${fmt$2(ticketCanal.delivery_propio)}`} color="#ec4899" pctMix={total ? (totalCanal.delivery_propio / total) * 100 : 0} pctOrd={ordTotal ? (ordCanal.delivery_propio / ordTotal) * 100 : 0} />
        <KpiCard label="🚗 Drive Thru" value={fmtN(ordCanal.drivethrough)} sub={`${fmt$(totalCanal.drivethrough)} · Solo S003`} color="#14b8a6" pctMix={total ? (totalCanal.drivethrough / total) * 100 : 0} pctOrd={ordTotal ? (ordCanal.drivethrough / ordTotal) * 100 : 0} />
      </div>

      {/* Tabla por sucursal */}
      <div style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Detalle por Sucursal</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>% gris = participación del canal sobre total de la sucursal</div>
          </div>
          <span style={{ background: '#1f2937', color: '#9ca3af', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>{sucursales.length} sucursales</span>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #262626' }}>
              <th rowSpan={2} style={thStyle}>Sucursal</th>
              <th colSpan={3} style={{ ...thStyle, color: '#f59e0b', background: 'rgba(245,158,11,0.05)' }}>🍴 Mesa</th>
              <th colSpan={3} style={{ ...thStyle, color: '#3b82f6', background: 'rgba(59,130,246,0.05)' }}>🥡 Llevar</th>
              <th colSpan={3} style={{ ...thStyle, color: '#ec4899', background: 'rgba(236,72,153,0.05)' }}>🛵 Delivery</th>
              <th colSpan={3} style={{ ...thStyle, color: '#14b8a6', background: 'rgba(20,184,166,0.05)' }}>🚗 Drive</th>
              <th colSpan={3} style={{ ...thStyle, color: '#a5b4fc', background: 'rgba(99,102,241,0.05)' }}>📊 Total</th>
            </tr>
            <tr style={{ borderBottom: '1px solid #262626' }}>
              {[...Array(5)].flatMap((_, i) => ([
                <th key={i + '-1'} style={thStyleSm}>Órd.</th>,
                <th key={i + '-2'} style={thStyleSm}>Monto</th>,
                <th key={i + '-3'} style={thStyleSm}>Ticket</th>,
              ]))}
            </tr>
          </thead>
          <tbody>
            {sucursales.map(s => <FilaSucursal key={s.store_code} s={s} />)}
            <FilaTotal datos={datos} />
          </tbody>
        </table>
      </div>
    </>
  );
}

function FilaSucursal({ s }) {
  const cells = [];
  ['mesa', 'para_llevar', 'delivery_propio', 'drivethrough'].forEach(ch => {
    const c = s.canales[ch];
    if (!c) {
      cells.push(<td style={tdStyleGray} colSpan={3} key={ch}>—</td>);
      return;
    }
    const ticket = c.ord > 0 ? c.monto / c.ord : 0;
    const pct = s.total > 0 ? (c.monto / s.total) * 100 : 0;
    cells.push(<td key={ch + '-o'} style={tdStyle}>{fmtN(c.ord)}</td>);
    cells.push(<td key={ch + '-m'} style={tdStyle}>{fmt$(c.monto)} <span style={pctMixStyle}>{fmtPct(pct)}</span></td>);
    cells.push(<td key={ch + '-t'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmt$2(ticket)}</td>);
  });
  const ticketTotal = s.ord > 0 ? s.total / s.ord : 0;
  return (
    <tr style={{ borderBottom: '1px solid #1a1a1a' }}>
      <td style={{ ...tdStyle, textAlign: 'left' }}>
        <div style={{ fontWeight: 500, color: '#fff' }}>{s.store_code} — {s.nombre}</div>
        <MixStripe canales={s.canales} total={s.total} />
      </td>
      {cells}
      <td style={tdStyle}>{fmtN(s.ord)}</td>
      <td style={{ ...tdStyle, fontWeight: 600, color: '#fff' }}>{fmt$(s.total)}</td>
      <td style={{ ...tdStyle, color: '#a5b4fc', fontWeight: 600 }}>{fmt$2(ticketTotal)}</td>
    </tr>
  );
}

function FilaTotal({ datos }) {
  const { totalCanal, ordCanal, ticketCanal, total, ordTotal } = datos;
  const ticketG = ordTotal > 0 ? total / ordTotal : 0;
  return (
    <tr style={{ background: '#0a0a0a', fontWeight: 700, borderTop: '2px solid #262626' }}>
      <td style={{ ...tdStyle, textAlign: 'left', color: '#fff' }}>
        TOTAL <span style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>(% sobre {fmt$(total)})</span>
      </td>
      {['mesa', 'para_llevar', 'delivery_propio', 'drivethrough'].map(ch => {
        const monto = totalCanal[ch] || 0;
        const ord = ordCanal[ch] || 0;
        const tk = ticketCanal[ch] || 0;
        const pct = total > 0 ? (monto / total) * 100 : 0;
        return [
          <td key={ch + '-o'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmtN(ord)}</td>,
          <td key={ch + '-m'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmt$(monto)} <span style={{ ...pctMixStyle, color: '#9ca3af' }}>{fmtPct(pct)}</span></td>,
          <td key={ch + '-t'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmt$2(tk)}</td>,
        ];
      })}
      <td style={{ ...tdStyle, color: '#fff' }}>{fmtN(ordTotal)}</td>
      <td style={{ ...tdStyle, color: '#fff' }}>{fmt$(total)}</td>
      <td style={{ ...tdStyle, color: '#a5b4fc' }}>{fmt$2(ticketG)}</td>
    </tr>
  );
}

// ────────────────────── Tab Top Items ──────────────────────
function TabItems({ items }) {
  const sucs = STORES_ACTIVAS.filter(sc => items[sc]);
  if (sucs.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Sin datos de items para el mes seleccionado.</div>;
  return (
    <>
      <div style={{ background: 'linear-gradient(90deg,rgba(99,102,241,0.1),transparent)', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, color: '#fff' }}>📐 Análisis Pareto 80/20 por sucursal</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Items ordenados por monto $ hasta acumular 80% de venta</div>
      </div>
      {/* Mini KPI cards de concentración */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sucs.length}, 1fr)`, gap: 10, marginBottom: 14 }}>
        {sucs.map(sc => {
          const n = items[sc].items.length;
          const concentrado = n <= 6;
          return (
            <div key={sc} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{sc}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: concentrado ? '#10b981' : '#fff', fontVariantNumeric: 'tabular-nums' }}>{n}</div>
              <div style={{ fontSize: 10, color: '#666' }}>items = 80%</div>
            </div>
          );
        })}
      </div>
      {/* Tablas */}
      {sucs.map(sc => (
        <div key={sc} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600, color: '#fff' }}>{sc} — {STORES[sc] || sc}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{items[sc].items.length} items · {items[sc].totalItems} total · {fmt$(items[sc].total)}</div>
            </div>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #262626' }}>
                <th style={thStyleSm}>#</th>
                <th style={{ ...thStyleSm, textAlign: 'left' }}>Producto</th>
                <th style={thStyleSm}>Unid.</th>
                <th style={thStyleSm}>Monto</th>
                <th style={thStyleSm}>%</th>
                <th style={thStyleSm}>% acum</th>
              </tr>
            </thead>
            <tbody>
              {items[sc].items.map((it, i) => {
                const isCorte = i === items[sc].items.length - 1;
                return (
                  <tr key={i} style={{
                    borderBottom: isCorte ? '1px solid rgba(16,185,129,0.3)' : '1px solid #1a1a1a',
                    background: isCorte ? 'rgba(16,185,129,0.05)' : 'transparent',
                  }}>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, textAlign: 'left', color: '#fff' }}>{it.producto}</td>
                    <td style={tdStyle}>{fmtN(Math.round(it.unidades))}</td>
                    <td style={tdStyle}>{fmt$(it.monto)}</td>
                    <td style={{ ...tdStyle, color: it.pct >= 5 ? '#6ee7b7' : '#9ca3af' }}>{fmtPct(it.pct)}</td>
                    <td style={{ ...tdStyle, color: isCorte ? '#6ee7b7' : '#9ca3af', fontWeight: isCorte ? 700 : 400 }}>
                      {fmtPct(it.pct_acum)}{isCorte ? ' ✓' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// ────────────────────── Tab Empleados ──────────────────────
function TabEmpleados({ emps }) {
  const sucsConData = STORES_ACTIVAS.filter(sc => emps[sc] && emps[sc].lista.length > 0);
  const sucsSinData = STORES_ACTIVAS.filter(sc => !emps[sc] || emps[sc].lista.length === 0);

  if (sucsConData.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Sin datos de empleados aún. La columna autorizado_por se está poblando.</div>;
  }

  return (
    <>
      <div style={{ background: 'linear-gradient(90deg,rgba(139,92,246,0.1),transparent)', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, color: '#fff' }}>👥 Ventas por Empleado</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Datos del campo autorizado_por · % indica participación sobre venta del local</div>
      </div>

      {sucsConData.map(sc => {
        const data = emps[sc];
        const top = data.lista[0];
        return (
          <div key={sc} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#fff' }}>{sc} — {STORES[sc] || sc}</div>
                <div style={{ fontSize: 11, color: '#666' }}>{data.lista.length} empleados · {fmtN(data.ord)} órd · {fmt$(data.total)}</div>
              </div>
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #262626' }}>
                  <th style={thStyleSm}>#</th>
                  <th style={{ ...thStyleSm, textAlign: 'left' }}>Empleado</th>
                  <th style={thStyleSm}>Órdenes</th>
                  <th style={thStyleSm}>Monto</th>
                  <th style={thStyleSm}>Ticket Prom.</th>
                  <th style={thStyleSm}>% local</th>
                  <th style={thStyleSm}>Distribución</th>
                </tr>
              </thead>
              <tbody>
                {data.lista.map((e, i) => {
                  const widthPct = top.monto > 0 ? (e.monto / top.monto) * 100 : 0;
                  const isTopTicket = e === [...data.lista].sort((a, b) => b.ticket - a.ticket)[0];
                  return (
                    <tr key={e.nombre} style={{ borderBottom: '1px solid #1a1a1a' }}>
                      <td style={tdStyle}>{i + 1}</td>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>
                        <span style={avatarStyle(isTopTicket)}>{avatarLetters(e.nombre)}</span>
                        <span style={{ color: '#fff' }}>{e.nombre}</span>
                        {isTopTicket && <span style={{ ...pillStyle, marginLeft: 6 }}>★ mejor ticket</span>}
                      </td>
                      <td style={tdStyle}>{fmtN(e.ord)}</td>
                      <td style={{ ...tdStyle, color: '#fff', fontWeight: 600 }}>{fmt$(e.monto)}</td>
                      <td style={{ ...tdStyle, color: e.ticket >= 25 ? '#6ee7b7' : e.ticket >= 18 ? '#fbbf24' : '#60a5fa', fontWeight: isTopTicket ? 700 : 400 }}>{fmt$2(e.ticket)}</td>
                      <td style={tdStyle}>{fmtPct(e.pct)}</td>
                      <td style={{ ...tdStyle, width: 120 }}>
                        <div style={{ height: 5, background: '#1f2937', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: widthPct + '%', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      {sucsSinData.length > 0 && (
        <div style={{ background: 'rgba(15,23,42,0.5)', border: '1px solid #262626', borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>⏳ Sin data de empleados aún</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sucsSinData.length}, 1fr)`, gap: 8 }}>
            {sucsSinData.map(sc => (
              <div key={sc} style={{ textAlign: 'center', padding: 10, background: '#0d0d0d', borderRadius: 6 }}>
                <div style={{ color: '#666', fontSize: 12 }}>{sc} — {STORES[sc] || sc}</div>
                <div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>backfill autorizado_por pendiente</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ────────────────────── Tab Tendencia ──────────────────────
function TabTendencia({ tend }) {
  if (!tend.length) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Cargando tendencia…</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {[
        { key: 'mesa', label: '🍴 Mesa', color: '#f59e0b' },
        { key: 'llevar', label: '🥡 Llevar', color: '#3b82f6' },
        { key: 'delivery', label: '🛵 Delivery Propio', color: '#ec4899' },
        { key: 'drive', label: '🚗 Drive Thru (S003)', color: '#14b8a6' },
      ].map(ch => (
        <div key={ch.key} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 600, color: ch.color, marginBottom: 10 }}>{ch.label}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #262626' }}>
                <th style={{ ...thStyleSm, textAlign: 'left' }}>Mes</th>
                <th style={thStyleSm}>Órdenes</th>
                <th style={thStyleSm}>Monto</th>
                <th style={thStyleSm}>Ticket prom.</th>
              </tr>
            </thead>
            <tbody>
              {tend.map((t, i) => {
                const c = t[ch.key];
                const tk = c.ord > 0 ? c.monto / c.ord : 0;
                const isLast = i === tend.length - 1;
                return (
                  <tr key={i} style={{ background: isLast ? '#0a0a0a' : 'transparent', borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ ...tdStyle, textAlign: 'left', color: isLast ? '#fff' : '#9ca3af', fontWeight: isLast ? 600 : 400 }}>
                      {t.mes.toLocaleDateString('es-SV', { month: 'short', year: 'numeric' })}
                    </td>
                    <td style={tdStyle}>{fmtN(c.ord)}</td>
                    <td style={tdStyle}>{fmt$(c.monto)}</td>
                    <td style={{ ...tdStyle, color: ch.color }}>{fmt$2(tk)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ────────────────────── Insights Modal ──────────────────────
function InsightsModal({ insights, mesSel, onClose }) {
  const list = insights?.insights || [];
  const fechaGen = insights?.fecha_generacion ? new Date(insights.fecha_generacion).toLocaleString('es-SV') : null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto'
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.05))',
        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, maxWidth: 800, width: '100%',
        padding: 24, color: '#e5e5e5', marginTop: 40,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 20 }}>✨</span>
              <h3 style={{ margin: 0, color: '#a5b4fc' }}>Top 5 Insights — generados por IA</h3>
            </div>
            {fechaGen && <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Generado: {fechaGen} · Modelo: {insights.modelo}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid #444', color: '#888', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}>✕</button>
        </div>
        {list.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
            <div style={{ fontSize: 14, marginBottom: 8 }}>Aún no hay insights pre-generados para este mes.</div>
            <div style={{ fontSize: 11 }}>Los insights se generan automáticamente cada día a las 06:00 SV.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {list.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: '#a5b4fc', fontWeight: 700, minWidth: 20 }}>{i + 1}.</span>
                <div>
                  <div style={{ color: '#fff', fontWeight: 500 }}>{it.titulo}</div>
                  <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>{it.descripcion}</div>
                  {it.accion_recomendada && (
                    <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, fontSize: 11, color: '#6ee7b7' }}>
                      → {it.accion_recomendada}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────── Estilos ──────────────────────
const thStyle = { padding: '8px 10px', textAlign: 'right', fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 };
const thStyleSm = { ...thStyle, padding: '6px 8px', fontSize: 10 };
const tdStyle = { padding: '8px 10px', textAlign: 'right', color: '#e5e5e5', fontVariantNumeric: 'tabular-nums', fontSize: 12 };
const tdStyleGray = { ...tdStyle, color: '#444' };
const pctMixStyle = { fontSize: 10, color: '#6b7280', fontWeight: 400, marginLeft: 4 };
const pillStyle = { background: 'rgba(16,185,129,0.15)', color: '#6ee7b7', fontSize: 10, padding: '1px 6px', borderRadius: 999 };
const avatarStyle = (highlight) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: '50%', marginRight: 8,
  background: highlight ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
  color: '#fff', fontWeight: 600, fontSize: 10,
});
