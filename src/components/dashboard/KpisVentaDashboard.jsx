import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import InfoTip from '../ui/InfoTip'
import { STORES } from '../../config';

const fmt$ = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt$2 = (v) => v == null ? '—' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (v) => v == null ? '—' : Number(v).toLocaleString('en-US');
const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(1) + '%';

const ROLES_PERMITIDOS = ['admin', 'superadmin', 'ejecutivo', 'gerente'];
const STORES_ACTIVAS = ['M001', 'S001', 'S002', 'S003', 'S004', 'S006'];
const ROLES_VEN_TODAS = ['admin', 'superadmin', 'ejecutivo'];

const CH_COLOR = {
  mesa: '#f59e0b',
  para_llevar: '#3b82f6',
  delivery_propio: '#ec4899',
  drivethrough: '#14b8a6',
  pedidos_ya: '#a855f7',
  delivery_app: '#22d3ee',
  evento: '#f97316',
};
const CH_LABEL = {
  mesa: '🍴 Mesa',
  para_llevar: '🥡 Llevar',
  delivery_propio: '🛵 Delivery Propio',
  drivethrough: '🚗 Drive Thru',
  pedidos_ya: '🟣 PeYa',
  delivery_app: '📱 Hifumi',
  evento: '🎪 Eventos',
};
const CH_KEYS = ['mesa', 'para_llevar', 'delivery_propio', 'drivethrough', 'pedidos_ya', 'delivery_app', 'evento'];
// Eventos son ventas sueltas (un evento grande o nada): no se les reparte meta mensual ni diaria.
const CH_SIN_META = ['evento'];
const canalesEnCero = () => Object.fromEntries(CH_KEYS.map(k => [k, 0]));

// ── Asuetos El Salvador 2026 (fechas YYYY-MM-DD) ──
const ASUETOS_SV = {
  '2026-01-01': { nombre: 'Año Nuevo', factor: 0.7 },          // poco movimiento, locales cerrados
  '2026-04-02': { nombre: 'Jueves Santo', factor: 0.95 },
  '2026-04-03': { nombre: 'Viernes Santo', factor: 0.85 },
  '2026-04-04': { nombre: 'Sábado Santo', factor: 1.10 },
  '2026-05-01': { nombre: 'Día del Trabajador', factor: 1.10 },
  '2026-05-10': { nombre: 'Día de la Madre', factor: 1.65 },   // ★ boost máximo
  '2026-06-17': { nombre: 'Día del Padre', factor: 1.40 },
  '2026-08-04': { nombre: 'Fiestas Agostinas', factor: 0.90 },
  '2026-08-05': { nombre: 'Fiestas Agostinas', factor: 0.85 },
  '2026-08-06': { nombre: 'Día del Salvador del Mundo', factor: 0.90 },
  '2026-09-15': { nombre: 'Día de la Independencia', factor: 1.05 },
  '2026-11-02': { nombre: 'Día de los Difuntos', factor: 1.05 },
  '2026-12-24': { nombre: 'Nochebuena', factor: 0.80 },
  '2026-12-25': { nombre: 'Navidad', factor: 0.70 },
  '2026-12-31': { nombre: 'Fin de Año', factor: 0.85 },
};

// Factor por día de la semana (0=domingo, 1=lunes, ..., 6=sábado)
const FACTOR_DOW = {
  0: 1.05,  // domingo
  1: 0.85,  // lunes ↓
  2: 0.85,  // martes ↓
  3: 0.95,  // miércoles
  4: 1.00,  // jueves (referencia)
  5: 1.20,  // viernes ↑
  6: 1.15,  // sábado ↑
};

// Días de pago en El Salvador: 15 de cada mes y último día (28-31)
function esDiaDePago(fecha) {
  const d = fecha.getUTCDate();
  if (d === 15) return true;
  // último día del mes
  const next = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0));
  if (d === next.getUTCDate()) return true;
  // día siguiente al de pago (efecto coleta)
  if (d === 16 || d === 1) return true;  // post-quincena
  return false;
}

// dowF: factores por día de la semana calculados con venta real (ver factoresDowEmpiricos);
// sin ellos se usa la tabla fija FACTOR_DOW.
function factorDia(fecha, dowF = null) {
  const iso = fecha.toISOString().split('T')[0];
  if (ASUETOS_SV[iso]) return { factor: ASUETOS_SV[iso].factor, motivo: ASUETOS_SV[iso].nombre };
  const dow = fecha.getUTCDay();
  let factor = (dowF || FACTOR_DOW)[dow];
  let motivo = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][dow];
  if (esDiaDePago(fecha)) {
    factor *= 1.12;
    motivo += ' · día de pago';
  }
  return { factor, motivo };
}

// Suma de factores de TODOS los días del mes (para repartir meta mensual proporcionalmente)
function sumaFactoresMes(mesISO, dowF = null) {
  const start = new Date(mesISO + 'T00:00:00Z');
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  let suma = 0;
  for (let d = 1; d <= end.getUTCDate(); d++) {
    const f = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d));
    suma += factorDia(f, dowF).factor;
  }
  return suma;
}

// Puerta de acceso aparte del componente con hooks: un `return` antes de un hook
// hace que React cuente distinto los hooks entre renders y tira el error #300
// ("Esta pantalla se cayó") si el usuario cambia con la vista montada.
export default function KpisVentaDashboard(props) {
  const { user, onBack } = props;
  if (!ROLES_PERMITIDOS.includes(user?.rol)) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#ef4444' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Acceso denegado</div>
        <div style={{ fontSize: 13, color: '#888' }}>Este dashboard requiere rol admin, superadmin, ejecutivo o gerente.</div>
        <button onClick={onBack} style={{ marginTop: 16, background: '#1f2937', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}>← Volver</button>
      </div>
    );
  }
  return <KpisVentaDashboardInner {...props} />;
}

function KpisVentaDashboardInner({ user, onBack }) {
  const [tab, setTab] = useState('metas');  // ★ Metas como pestaña principal
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Período: un mes ('2026-11-01'), un atajo ('hoy', 'ayer', '7d', '30d') o 'rango' (desde/hasta a mano).
  // Resumen, Top Items y Por Empleado usan el rango exacto. Metas es mensual: usa el mes de la fecha final.
  const [periodo, setPeriodo] = useState(() => mesesOptions()[0].value);
  const [rangoManual, setRangoManual] = useState(() => {
    const hoy = isoDia(new Date(Date.now() - 6 * 3600 * 1000));
    return { desde: hoy.slice(0, 8) + '01', hasta: hoy };
  });
  const { desde: fechaDesde, hasta: fechaHasta } = rangoDePeriodo(periodo, rangoManual);
  const mesSel = fechaHasta.slice(0, 8) + '01';
  const esRango = !/^\d{4}-\d{2}-01$/.test(periodo);

  // Sucursal default = la del user si está en STORES_ACTIVAS, sino "Todas"
  // admin, superadmin y ejecutivo ven todas; los demás (gerentes) solo su sucursal.
  // La base aplica la misma regla (_kpis_sucursal_permitida), esto solo ajusta la pantalla.
  const veTodas = ROLES_VEN_TODAS.includes(user?.rol);
  const sucursalDefault = veTodas
    ? (STORES_ACTIVAS.includes(user?.store_code) ? user.store_code : 'todas')
    : (user?.store_code || 'todas');
  const [sucursalSel, setSucursalSel] = useState(sucursalDefault);

  const [kpisRaw, setKpisRaw] = useState([]);
  const [topItems, setTopItems] = useState({});
  const [empleados, setEmpleados] = useState({});
  const [tendencia, setTendencia] = useState([]);
  const [insights, setInsights] = useState(null);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [metasData, setMetasData] = useState(null);

  // Datos del rango elegido: Resumen, Top Items y Por Empleado.
  const [loadingRango, setLoadingRango] = useState(true);
  useEffect(() => {
    if (!fechaDesde || !fechaHasta || fechaDesde > fechaHasta) return;
    let vigente = true;
    (async () => {
      setLoadingRango(true);
      try {
        const [kpisResp, items, emps] = await Promise.all([
          db.rpc('obtener_kpis_venta_canal', { p_usuario_id: user.id, p_fecha_desde: fechaDesde, p_fecha_hasta: fechaHasta }),
          fetchTopItemsPareto(user.id, fechaDesde, fechaHasta),
          fetchEmpleados(user.id, fechaDesde, fechaHasta),
        ]);
        if (kpisResp.error) throw kpisResp.error;
        if (!vigente) return;
        setKpisRaw(kpisResp.data || []);
        setTopItems(items);
        setEmpleados(emps);
        setError(null);
      } catch (e) {
        console.error('KpisVentaDashboard load error:', e);
        if (vigente) setError(e.message || 'Error cargando KPIs');
      }
      if (vigente) setLoadingRango(false);
    })();
    return () => { vigente = false; };
  }, [fechaDesde, fechaHasta, user?.id]);

  // Datos del mes: Metas, Tendencia e Insights.
  useEffect(() => {
    let vigente = true;
    (async () => {
      setLoading(true);
      try {
        const [tend, insightsResp, md] = await Promise.all([
          fetchTendencia(user.id),
          db.rpc('obtener_insights_kpis', { p_usuario_id: user.id, p_mes: mesSel }),
          fetchMetasData(user.id, mesSel),
        ]);
        if (!vigente) return;
        setTendencia(tend);
        setInsights(insightsResp.data?.[0] || null);
        setMetasData(md);
      } catch (e) {
        console.error('KpisVentaDashboard load error:', e);
        if (vigente) setError(e.message || 'Error cargando KPIs');
      }
      if (vigente) setLoading(false);
    })();
    return () => { vigente = false; };
  }, [mesSel, user?.id]);

  // La venta de hoy y el ritmo esperado se refrescan solos cada 3 min mientras se ve el mes en curso.
  const esMesActualCargado = !!metasData?.esMesActual;
  useEffect(() => {
    if (!esMesActualCargado) return;
    const id = setInterval(async () => {
      try {
        const h = await fetchHoy(user.id);
        setMetasData(prev => {
          if (!prev?.esMesActual) return prev;
          // Si cambió el día (pasó la medianoche) recargar todo es más seguro: se pide al cambiar de mes/pestaña.
          if (h.hoyISO !== prev.hoyISO) return prev;
          return { ...prev, hoy: h.hoy, curva: h.curva, fechaHoy: h.fechaHoy, actualizado: h.actualizado, porDia: { ...prev.porDia, [h.hoyISO]: h.hoy } };
        });
      } catch (e) { console.warn('Refresco de hoy falló:', e); }
    }, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [esMesActualCargado, user?.id]);

  const datos = useMemo(() => calcularDatos(kpisRaw), [kpisRaw]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e5e5e5' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1a1a1a', background: '#111' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6 }}>← Volver</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>📊 KPIs de Venta <InfoTip text="Tablero de ventas: metas, resumen por canal y sucursal, Pareto de productos, desempeño por empleado y tendencia." /></div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Fuente: <code style={{ color: '#f59e0b' }}>POS interno</code> (desde 1-ago) · histórico Quanto antes de ago · 7 canales (incl. PeYa, Hifumi y Eventos)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Selector sucursal: solo quien ve todas puede cambiarla */}
            {veTodas ? (
              <select value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}
                style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
                <option value="todas">Todas las sucursales</option>
                {STORES_ACTIVAS.map(sc => <option key={sc} value={sc}>{sc} — {STORES[sc] || sc}</option>)}
              </select>
            ) : (
              <span style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
                {user?.store_code ? `${user.store_code} — ${STORES[user.store_code] || user.store_code}` : 'Sin sucursal asignada'}
              </span>
            )}
            <select value={periodo} onChange={e => setPeriodo(e.target.value)}
              style={{ background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
              <optgroup label="Mes">
                {mesesOptions().map(m => (<option key={m.value} value={m.value}>{m.label}</option>))}
              </optgroup>
              <optgroup label="Rango">
                <option value="hoy">Hoy</option>
                <option value="ayer">Ayer</option>
                <option value="7d">Últimos 7 días</option>
                <option value="30d">Últimos 30 días</option>
                <option value="rango">Elegir fechas…</option>
              </optgroup>
            </select>
            {periodo === 'rango' && (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#9ca3af' }}>
                <input type="date" value={rangoManual.desde} max={rangoManual.hasta}
                  onChange={e => e.target.value && setRangoManual(r => ({ ...r, desde: e.target.value }))} style={inputFecha} />
                a
                <input type="date" value={rangoManual.hasta} min={rangoManual.desde}
                  onChange={e => e.target.value && setRangoManual(r => ({ ...r, hasta: e.target.value }))} style={inputFecha} />
              </span>
            )}
            {veTodas && <button onClick={() => setInsightsOpen(true)}
              style={{
                background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#ec4899 100%)',
                color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
              }}>✨ Insights del día</button>}
          </div>
        </div>
      </div>

      {/* Tabs — Metas primero */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1a1a1a', overflowX: 'auto', background: '#0d0d0d' }}>
        {[
          ['metas', '🎯 Metas'],
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

      {error && <div style={{ padding: 20, margin: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, color: '#fca5a5' }}>⚠ {error}</div>}
      {!error && (tab === 'metas' || tab === 'tendencia' ? loading : loadingRango) && (
        <div style={{ padding: 80, textAlign: 'center', color: '#666' }}>Cargando KPIs…</div>
      )}

      {!error && !(tab === 'metas' || tab === 'tendencia' ? loading : loadingRango) && (
        <div style={{ padding: 16 }}>
          {esRango && tab !== 'tendencia' && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>
              {tab === 'metas'
                ? <>Las metas son mensuales: se muestra {diaUTC(mesSel).toLocaleDateString('es-SV', { month: 'long', year: 'numeric', timeZone: 'UTC' })}. El rango elegido aplica a Resumen, Top Items y Por Empleado.</>
                : <>Período: <strong style={{ color: '#fff' }}>{fmtFechaCorta(fechaDesde)}{fechaDesde !== fechaHasta ? ` – ${fmtFechaCorta(fechaHasta)}` : ''}</strong></>}
            </div>
          )}
          {tab === 'metas' && <TabMetas metasData={metasData} sucursalSel={sucursalSel} />}
          {tab === 'resumen' && <TabResumen datos={datos} sucursalSel={sucursalSel} />}
          {tab === 'items' && <TabItems items={topItems} sucursalSel={sucursalSel} />}
          {tab === 'empleados' && <TabEmpleados emps={empleados} sucursalSel={sucursalSel} />}
          {tab === 'tendencia' && <TabTendencia tend={tendencia} />}
        </div>
      )}

      {insightsOpen && <InsightsModal insights={insights} onClose={() => setInsightsOpen(false)} />}
    </div>
  );
}

// ──────────────────── Helpers ────────────────────
function mesSiguiente(mesISO) {
  const d = new Date(mesISO + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().split('T')[0];
}

const inputFecha = { background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '5px 8px', borderRadius: 6, fontSize: 13, colorScheme: 'dark' };
const fmtFechaCorta = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Fechas (YYYY-MM-DD, hora de El Salvador) que cubre el período elegido.
function rangoDePeriodo(periodo, manual) {
  const hoyD = new Date(Date.now() - 6 * 3600 * 1000);
  const hoy = hoyD.toISOString().split('T')[0];
  const menos = (n) => new Date(hoyD.getTime() - n * 86400000).toISOString().split('T')[0];
  switch (periodo) {
    case 'hoy': return { desde: hoy, hasta: hoy };
    case 'ayer': return { desde: menos(1), hasta: menos(1) };
    case '7d': return { desde: menos(6), hasta: hoy };
    case '30d': return { desde: menos(29), hasta: hoy };
    case 'rango': return manual;
    default: { // un mes; si es el actual, hasta hoy
      const fin = mesSiguiente(periodo);
      return { desde: periodo, hasta: fin > hoy ? hoy : fin };
    }
  }
}

function mesesOptions() {
  // FIX: usar timeZone:'UTC' para evitar shift de zona horaria que mostraba abril en mayo
  const out = [];
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  for (let i = 0; i < 6; i++) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push({
      value: m.toISOString().split('T')[0],
      label: m.toLocaleDateString('es-SV', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + (i === 0 ? ' (en curso)' : ''),
    });
  }
  return out;
}

function calcularDatos(kpisRaw) {
  const sucursales = {};
  const totalCanal = canalesEnCero();
  const ordCanal = canalesEnCero();
  let total = 0, ordTotal = 0;

  for (const r of kpisRaw) {
    const sc = r.store_code;
    if (!sucursales[sc]) sucursales[sc] = { store_code: sc, nombre: STORES[sc] || sc, canales: {}, total: 0, ord: 0 };
    if (!sucursales[sc].canales[r.canal_venta]) sucursales[sc].canales[r.canal_venta] = { ord: 0, monto: 0 };
    sucursales[sc].canales[r.canal_venta].ord += Number(r.ordenes);
    sucursales[sc].canales[r.canal_venta].monto += Number(r.monto);
    sucursales[sc].total += Number(r.monto);
    sucursales[sc].ord += Number(r.ordenes);
    totalCanal[r.canal_venta] = (totalCanal[r.canal_venta] || 0) + Number(r.monto);
    ordCanal[r.canal_venta] = (ordCanal[r.canal_venta] || 0) + Number(r.ordenes);
    total += Number(r.monto);
    ordTotal += Number(r.ordenes);
  }

  const ticketCanal = {};
  for (const k of Object.keys(totalCanal)) ticketCanal[k] = ordCanal[k] > 0 ? totalCanal[k] / ordCanal[k] : 0;

  const sucArr = STORES_ACTIVAS.map(sc => sucursales[sc]).filter(Boolean).sort((a, b) => b.total - a.total);
  return { sucursales: sucArr, totalCanal, ordCanal, ticketCanal, total, ordTotal };
}


// Top items (Pareto 80/20) desde el POS interno (RPC obtener_top_items_venta).
async function fetchTopItemsPareto(usuarioId, fechaDesde, fechaHasta) {
  const { data, error } = await db.rpc('obtener_top_items_venta', {
    p_usuario_id: usuarioId, p_fecha_desde: fechaDesde, p_fecha_hasta: fechaHasta,
  });
  if (error || !data) return {};

  const bySuc = {};
  for (const r of data) {
    const desc = (r.nombre || '').trim();
    if (!desc || desc.toLowerCase() === 'domicilio') continue;
    (bySuc[r.store_code] = bySuc[r.store_code] || []).push({
      producto: titulize(desc), unidades: Number(r.cantidad || 0), monto: Number(r.monto || 0),
    });
  }

  const result = {};
  for (const sc of Object.keys(bySuc)) {
    const sorted = bySuc[sc].sort((a, b) => b.monto - a.monto);
    const total = sorted.reduce((s, x) => s + x.monto, 0);
    let acum = 0;
    const corte80 = [];
    for (const x of sorted) {
      acum += x.monto;
      corte80.push({ ...x, pct: total > 0 ? (x.monto / total) * 100 : 0, pct_acum: total > 0 ? (acum / total) * 100 : 0 });
      if (total > 0 && acum / total >= 0.80) break;
    }
    result[sc] = { items: corte80, total, totalItems: sorted.length };
  }
  return result;
}

// Ventas por empleado desde el POS interno (RPC obtener_ventas_empleado).
async function fetchEmpleados(usuarioId, fechaDesde, fechaHasta) {
  const { data, error } = await db.rpc('obtener_ventas_empleado', {
    p_usuario_id: usuarioId, p_fecha_desde: fechaDesde, p_fecha_hasta: fechaHasta,
  });
  const result = {};
  if (error || !data) return result;

  for (const r of data) {
    const sc = r.store_code;
    const nombre = r.empleado_nombre || '—';
    const key = r.empleado_id || nombre;
    if (!result[sc]) result[sc] = { total: 0, ord: 0, empleados: {} };
    result[sc].empleados[key] = { nombre, ord: Number(r.ordenes || 0), monto: Number(r.monto || 0) };
    result[sc].total += Number(r.monto || 0);
    result[sc].ord += Number(r.ordenes || 0);
  }

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

async function fetchTendencia(usuarioId) {
  const now = new Date(Date.now() - 6 * 3600 * 1000);
  const out = [];
  for (let i = 4; i >= 0; i--) {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    const desde = m.toISOString().split('T')[0];
    const hasta = next.toISOString().split('T')[0];
    const { data } = await db.rpc('obtener_kpis_venta_canal', { p_usuario_id: usuarioId, p_fecha_desde: desde, p_fecha_hasta: hasta });
    const sum = { mes: m };
    CH_KEYS.forEach(k => { sum[k] = { ord: 0, monto: 0 }; });
    (data || []).forEach(r => {
      const k = r.canal_venta;
      if (sum[k]) { sum[k].ord += Number(r.ordenes); sum[k].monto += Number(r.monto); }
    });
    out.push(sum);
  }
  return out;
}

// ── Cálculo de Metas ──
const isoDia = (d) => d.toISOString().split('T')[0];

async function fetchMetasData(usuarioId, mesSelISO, { conMesAnterior = true } = {}) {
  const ahora = new Date(Date.now() - 6 * 3600 * 1000);
  const mesActualISO = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString().split('T')[0];
  const esMesActual = mesSelISO === mesActualISO;
  const hoyISO = isoDia(ahora);

  const mesStart = new Date(mesSelISO + 'T00:00:00Z');
  const diasDelMes = new Date(Date.UTC(mesStart.getUTCFullYear(), mesStart.getUTCMonth() + 1, 0)).getUTCDate();
  const diaHoy = esMesActual ? ahora.getUTCDate() : diasDelMes;
  // Días ya cerrados: en el mes en curso, hoy todavía no termina y no se compara contra un día completo.
  const diasCerrados = esMesActual ? diaHoy - 1 : diasDelMes;

  // Mes anterior, mismos días cerrados
  const mesAnt = new Date(Date.UTC(mesStart.getUTCFullYear(), mesStart.getUTCMonth() - 1, 1));
  const mesAntDesde = isoDia(mesAnt);
  const diasMesAnt = new Date(Date.UTC(mesAnt.getUTCFullYear(), mesAnt.getUTCMonth() + 1, 0)).getUTCDate();
  const mesAntHastaMismoDias = isoDia(new Date(Date.UTC(mesAnt.getUTCFullYear(), mesAnt.getUTCMonth(), Math.min(Math.max(diasCerrados, 1), diasMesAnt))));
  const mesAntHastaCompleto = isoDia(new Date(Date.UTC(mesAnt.getUTCFullYear(), mesAnt.getUTCMonth() + 1, 0)));

  // Mismo mes año anterior
  const mesAA = new Date(Date.UTC(mesStart.getUTCFullYear() - 1, mesStart.getUTCMonth(), 1));
  const mesAADesde = isoDia(mesAA);
  const mesAAHasta = isoDia(new Date(Date.UTC(mesAA.getUTCFullYear(), mesAA.getUTCMonth() + 1, 0)));

  // Últimos 3 meses (no incluye el actual)
  const last3 = [];
  for (let i = 1; i <= 3; i++) {
    const m = new Date(Date.UTC(mesStart.getUTCFullYear(), mesStart.getUTCMonth() - i, 1));
    const next = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
    last3.push({ desde: isoDia(m), hasta: isoDia(next) });
  }

  const rpc = (desde, hasta) => db.rpc('obtener_kpis_venta_canal', { p_usuario_id: usuarioId, p_fecha_desde: desde, p_fecha_hasta: hasta });
  const [actual, antMismoDias, antCompleto, mesAAtotal, curvaResp, ...promQueries] = await Promise.all([
    rpc(mesSelISO, mesSiguiente(mesSelISO)),
    rpc(mesAntDesde, mesAntHastaMismoDias),
    rpc(mesAntDesde, mesAntHastaCompleto),
    rpc(mesAADesde, mesAAHasta),
    esMesActual ? db.rpc('obtener_curva_venta_dia', { p_usuario_id: usuarioId }) : Promise.resolve({ data: [] }),
    ...last3.map(m => rpc(m.desde, m.hasta)),
  ]);

  const actualRows = actual.data || [];
  const last3Rows = promQueries.flatMap(q => q.data || []);

  // Venta por día ({fecha: {'S001|mesa': monto, ...}}) del mes y del mes anterior completo:
  // la usan el gráfico de últimos días y la comparación ajustada contra el mes anterior.
  const porDia = {};
  for (const r of [...actualRows, ...(antCompleto.data || [])]) {
    const d = (porDia[r.fecha] = porDia[r.fecha] || {});
    for (const k of [`${r.store_code}|${r.canal_venta}`, `TOTAL|${r.canal_venta}`, `${r.store_code}|TOTAL`, 'TOTAL|TOTAL']) {
      d[k] = (d[k] || 0) + Number(r.monto);
    }
  }

  // Los primeros días del mes, el gráfico de últimos días cae en el mes anterior y
  // necesita la meta de ese mes.
  const anterior = esMesActual && conMesAnterior && diaHoy <= 3
    ? await fetchMetasData(usuarioId, mesAntDesde, { conMesAnterior: false })
    : null;

  return {
    mesSel: mesSelISO,
    esMesActual,
    diaHoy,
    diasCerrados,
    diasDelMes,
    hoyISO,
    // Mes seleccionado sin el día de hoy (días cerrados) + hoy por separado
    cerrado: agruparPorCanalSucursal(esMesActual ? actualRows.filter(r => r.fecha < hoyISO) : actualRows),
    hoy: agruparPorCanalSucursal(esMesActual ? actualRows.filter(r => r.fecha === hoyISO) : []),
    antMismoDias: diasCerrados > 0 ? agruparPorCanalSucursal(antMismoDias.data) : {},
    antCompleto: agruparPorCanalSucursal(antCompleto.data),
    mismoMesAA: agruparPorCanalSucursal(mesAAtotal.data),
    last3: promQueries.map(q => agruparPorCanalSucursal(q.data)),
    diario: ventaDiariaPorSucursal(last3Rows),
    curva: curvaPorSucursal(curvaResp.data),
    porDia,
    mesAnt: mesAntDesde,
    anterior,
    fechaHoy: ahora,
    actualizado: new Date(),
  };
}

// Refresco liviano de "hoy" (cada pocos minutos): solo la venta del día y el ritmo esperado.
async function fetchHoy(usuarioId) {
  const ahora = new Date(Date.now() - 6 * 3600 * 1000);
  const hoyISO = isoDia(ahora);
  const [v, c] = await Promise.all([
    db.rpc('obtener_kpis_venta_canal', { p_usuario_id: usuarioId, p_fecha_desde: hoyISO, p_fecha_hasta: hoyISO }),
    db.rpc('obtener_curva_venta_dia', { p_usuario_id: usuarioId }),
  ]);
  if (v.error) throw v.error;
  return { hoyISO, hoy: agruparPorCanalSucursal(v.data), curva: curvaPorSucursal(c.data), fechaHoy: ahora, actualizado: new Date() };
}

function agruparPorCanalSucursal(rows) {
  // { 'M001|mesa': monto, ..., 'TOTAL|mesa': monto, 'M001|TOTAL': monto, 'TOTAL|TOTAL': monto }
  const m = {};
  (rows || []).forEach(r => {
    const v = Number(r.monto);
    for (const k of [`${r.store_code}|${r.canal_venta}`, `TOTAL|${r.canal_venta}`, `${r.store_code}|TOTAL`, 'TOTAL|TOTAL']) {
      m[k] = (m[k] || 0) + v;
    }
  });
  return m;
}

function ventaDiariaPorSucursal(rows) {
  // { 'S001': { '2026-10-01': monto }, 'TOTAL': {...} }
  const out = {};
  (rows || []).forEach(r => {
    for (const sc of [r.store_code, 'TOTAL']) {
      (out[sc] = out[sc] || {});
      out[sc][r.fecha] = (out[sc][r.fecha] || 0) + Number(r.monto);
    }
  });
  return out;
}

function curvaPorSucursal(rows) {
  const out = {};
  (rows || []).forEach(r => { out[r.store_code] = { pct: Number(r.pct_esperado || 0), horaFin: r.hora_fin, dias: r.dias_muestra }; });
  return out;
}

// Peso de cada día de la semana según la venta real de los últimos 3 meses (jueves = 1).
// Sin asuetos ni días de pago, que ya tienen su propio ajuste. Si falta historia, usa la tabla fija.
function factoresDowEmpiricos(diario) {
  if (!diario) return null;
  const acc = {};
  for (const [f, v] of Object.entries(diario)) {
    if (ASUETOS_SV[f]) continue;
    const d = new Date(f + 'T00:00:00Z');
    if (esDiaDePago(d)) continue;
    (acc[d.getUTCDay()] = acc[d.getUTCDay()] || []).push(v);
  }
  const prom = {};
  for (let i = 0; i < 7; i++) {
    if (!acc[i] || acc[i].length < 4) return null;
    prom[i] = acc[i].reduce((s, x) => s + x, 0) / acc[i].length;
  }
  if (!(prom[4] > 0)) return null;
  const out = {};
  for (let i = 0; i < 7; i++) out[i] = prom[i] / prom[4];
  return out;
}

function calcularMetaMensual(canal, sucursal, m) {
  if (CH_SIN_META.includes(canal)) return 0;
  const k = `${sucursal}|${canal}`;
  const ant = m.antCompleto[k] || 0;
  const aa = m.mismoMesAA[k] || 0;
  const prom3 = m.last3.reduce((s, x) => s + (x[k] || 0), 0) / 3;

  // Fallback si no hay año anterior: 65% mes anterior + 35% promedio 3 meses
  if (aa === 0) {
    return ant * 0.65 + prom3 * 0.35;
  }
  return ant * 0.40 + aa * 0.40 + prom3 * 0.20;
}

// Todo lo que depende de la sucursal elegida y no del canal: factores, ritmo del mes y del día.
function contextoMetas(m, sc) {
  const dowF = factoresDowEmpiricos(m.diario[sc]);
  const mesStart = new Date(m.mesSel + 'T00:00:00Z');
  const sumaFactores = sumaFactoresMes(m.mesSel, dowF);
  const fHoy = factorDia(m.fechaHoy, dowF);
  let factoresCerrados = 0;
  for (let d = 1; d <= m.diasCerrados; d++) {
    factoresCerrados += factorDia(new Date(Date.UTC(mesStart.getUTCFullYear(), mesStart.getUTCMonth(), d)), dowF).factor;
  }
  const curva = m.esMesActual ? (m.curva[sc] || m.curva.TOTAL || null) : null;
  const pctDia = curva ? curva.pct : null; // parte del día que normalmente ya se vendió a esta hora
  // Parte de la meta del mes que debería ir hecha a esta hora
  const pctMesEsperado = sumaFactores > 0
    ? (m.esMesActual ? (factoresCerrados + fHoy.factor * (pctDia ?? 0)) / sumaFactores : 1)
    : null;
  return { dowF, sumaFactores, fHoy, pctDia, pctMesEsperado, horaFin: curva?.horaFin || null };
}

const diaUTC = (iso) => new Date(iso + 'T00:00:00Z');
const diasDeMes = (mesISO) => { const d = diaUTC(mesISO); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };
const isoDeMes = (mesISO, dia) => { const d = diaUTC(mesISO); return isoDia(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dia))); };

// Cuánto se habría vendido en los días cerrados de este mes al ritmo del mes anterior,
// corrigiendo por día de la semana, días de pago y asuetos. Así el 1–8 de un mes que
// arrancó en domingo con quincena no se compara a ciegas con un 1–8 que arrancó en martes.
//   ritmo del mes anterior = venta del mes anterior ÷ Σ factores de sus días
//   esperado = ritmo × Σ factores de los días cerrados de este mes
function esperadoSegunMesAnterior(m, key, dowF) {
  if (!m.diasCerrados || !m.porDia) return null;
  let venta = 0, fAnt = 0;
  for (let d = 1; d <= diasDeMes(m.mesAnt); d++) {
    const iso = isoDeMes(m.mesAnt, d);
    venta += m.porDia[iso]?.[key] || 0;
    fAnt += factorDia(diaUTC(iso), dowF).factor;
  }
  if (!(venta > 0) || !(fAnt > 0)) return null;
  let fAct = 0;
  for (let d = 1; d <= m.diasCerrados; d++) fAct += factorDia(diaUTC(isoDeMes(m.mesSel, d)), dowF).factor;
  return (venta / fAnt) * fAct;
}

// Meta de un día (todos los canales con meta, o uno solo) usando la meta del mes de ese día.
function metaDelDia(m, sc, iso, canal = null) {
  const ctx = contextoMetas(m, sc);
  if (!(ctx.sumaFactores > 0)) return 0;
  const mensual = canal ? calcularMetaMensual(canal, sc, m) : CH_KEYS.reduce((s, ch) => s + calcularMetaMensual(ch, sc, m), 0);
  return (mensual / ctx.sumaFactores) * factorDia(diaUTC(iso), ctx.dowF).factor;
}

// Venta de un día sin eventos (los eventos no tienen meta, no cuentan para llegar a ella).
function ventaConMeta(porDiaDia, sc, canal = null) {
  if (!porDiaDia) return 0;
  if (canal) return porDiaDia[`${sc}|${canal}`] || 0;
  return CH_KEYS.filter(ch => !CH_SIN_META.includes(ch)).reduce((s, ch) => s + (porDiaDia[`${sc}|${ch}`] || 0), 0);
}

function titulize(s) { return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function avatarLetters(nombre) { return nombre.split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase(); }

// Horas que faltan desde ahora hasta la hora típica de cierre (HH:MI).
function horasRestantes(fechaHoy, horaFin) {
  if (!horaFin) return null;
  const [h, mi] = horaFin.split(':').map(Number);
  const ahoraMin = fechaHoy.getUTCHours() * 60 + fechaHoy.getUTCMinutes();
  const rest = (h * 60 + mi - ahoraMin) / 60;
  return rest > 0 ? rest : 0;
}

const colorRitmo = (real, esperado) => esperado == null || esperado <= 0 ? '#9ca3af'
  : real >= esperado ? '#10b981' : real >= esperado * 0.9 ? '#fbbf24' : '#ef4444';

// ──────────────────── Tab Metas ────────────────────
function TabMetas({ metasData, sucursalSel }) {
  if (!metasData) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Cargando metas…</div>;

  const m = metasData;
  const sc = sucursalSel === 'todas' ? 'TOTAL' : sucursalSel;
  const sucLabel = sucursalSel === 'todas' ? `Cadena completa (${STORES_ACTIVAS.length} sucursales)` : `${sucursalSel} — ${STORES[sucursalSel] || sucursalSel}`;
  const ctx = contextoMetas(m, sc);

  const cerradoTotal = m.cerrado[`${sc}|TOTAL`] || 0;
  const hoyTotal = m.hoy[`${sc}|TOTAL`] || 0;
  const totalActual = cerradoTotal + hoyTotal;
  const totalAnt = m.antMismoDias[`${sc}|TOTAL`] || 0;
  const esperadoAjTotal = esperadoSegunMesAnterior(m, `${sc}|TOTAL`, ctx.dowF);
  const deltaTotal = esperadoAjTotal > 0 ? ((cerradoTotal - esperadoAjTotal) / esperadoAjTotal) * 100 : null;

  const metaMensualTotal = CH_KEYS.reduce((s, ch) => s + calcularMetaMensual(ch, sc, m), 0);
  const metaDiariaTotal = ctx.sumaFactores > 0 ? (metaMensualTotal / ctx.sumaFactores) * ctx.fHoy.factor : 0;
  const esperadoHoy = ctx.pctDia != null ? metaDiariaTotal * ctx.pctDia : null;
  const esperadoMes = ctx.pctMesEsperado != null ? metaMensualTotal * ctx.pctMesEsperado : null;

  const fechaHoyStr = m.fechaHoy.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const mesAntNombre = new Date(Date.UTC(new Date(m.mesSel + 'T00:00:00Z').getUTCFullYear(), new Date(m.mesSel + 'T00:00:00Z').getUTCMonth() - 1, 1))
    .toLocaleDateString('es-SV', { month: 'short', timeZone: 'UTC' });
  const actualizadoStr = m.actualizado?.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' });

  return (
    <>
      {/* Header con sucursal y total */}
      <div style={{
        background: 'linear-gradient(90deg,rgba(99,102,241,0.12),rgba(139,92,246,0.05))',
        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: 16, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>🎯 Metas · {sucLabel}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {fmt$(totalActual)}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
              {m.esMesActual ? `Día ${m.diaHoy} de ${m.diasDelMes} · Mes en curso (incluye hoy)` : `Mes cerrado · ${m.diasDelMes} días`}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              {m.esMesActual ? `Días cerrados 1–${m.diasCerrados} vs ritmo de ${mesAntNombre}` : `Vs ritmo de ${mesAntNombre}`}
              <InfoTip text={`Lo que se habría vendido estos mismos días al ritmo de ${mesAntNombre}, ajustado por día de la semana, días de pago y asuetos. Calendario puro (1–${m.diasCerrados} ${mesAntNombre}): ${fmt$(totalAnt)}.`} />
            </div>
            {m.diasCerrados > 0 ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#a5b4fc', marginTop: 2 }}>{fmt$(cerradoTotal)} <span style={{ fontSize: 12, color: '#666' }}>vs {fmt$(esperadoAjTotal)}</span></div>
                {deltaTotal != null && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: deltaTotal >= 0 ? '#10b981' : '#ef4444', marginTop: 2 }}>
                    {deltaTotal >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(deltaTotal))}
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>Calendario 1–{m.diasCerrados} {mesAntNombre}: {fmt$(totalAnt)}</div>
              </>
            ) : <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Primer día del mes: aún no hay días cerrados</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>Meta mensual</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>{fmt$(metaMensualTotal)}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{metaMensualTotal > 0 ? fmtPct((totalActual / metaMensualTotal) * 100) + ' alcanzado' : '—'}</div>
            {m.esMesActual && esperadoMes != null && (
              <div style={{ fontSize: 11, color: colorRitmo(totalActual, esperadoMes), fontWeight: 600 }}>
                Ritmo: {fmtPct(ctx.pctMesEsperado * 100)} · {totalActual >= esperadoMes ? 'adelante' : 'atrás'} {fmt$(Math.abs(totalActual - esperadoMes))}
              </div>
            )}
          </div>
          {m.esMesActual && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>Hoy ({ctx.fHoy.motivo}) · meta {fmt$(metaDiariaTotal)}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginTop: 2 }}>
                {fmt$(hoyTotal)} <span style={{ fontSize: 12, color: '#10b981' }}>/ {fmt$(metaDiariaTotal)}</span>
              </div>
              {esperadoHoy != null ? (
                <div style={{ fontSize: 11, color: colorRitmo(hoyTotal, esperadoHoy), fontWeight: 600 }}>
                  A esta hora: {fmt$(esperadoHoy)} · {hoyTotal >= esperadoHoy ? 'adelante' : 'atrás'} {fmt$(Math.abs(hoyTotal - esperadoHoy))}
                </div>
              ) : <div style={{ fontSize: 11, color: '#9ca3af' }}>Factor ×{ctx.fHoy.factor.toFixed(2)}</div>}
            </div>
          )}
        </div>
      </div>

      {m.esMesActual && <UltimosDias m={m} sc={sc} />}

      {/* Grid filas (canales) × 3 columnas (Actual / Meta mensual / Hoy) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {CH_KEYS.filter(canal => {
          const k = `${sc}|${canal}`;
          return calcularMetaMensual(canal, sc, m) > 0 || (m.cerrado[k] || 0) + (m.hoy[k] || 0) > 0;
        }).map(canal => <FilaMeta key={canal} canal={canal} sucursal={sc} m={m} ctx={ctx} mesAntNombre={mesAntNombre} fechaHoyStr={fechaHoyStr} />)}
      </div>

      {/* Footer explicativo */}
      <div style={{ marginTop: 16, padding: 14, background: 'rgba(15,23,42,0.5)', border: '1px solid #262626', borderRadius: 8, fontSize: 11, color: '#9ca3af', lineHeight: 1.6 }}>
        <strong style={{ color: '#a5b4fc' }}>📐 Fórmula meta mensual:</strong> 40% mes anterior · 40% mismo mes año anterior · 20% promedio últimos 3 meses · Si no hay data de año anterior → 65% mes anterior + 35% promedio 3 meses
        <br />
        <strong style={{ color: '#a5b4fc' }}>📅 Meta diaria:</strong> Meta mensual ÷ Σ factores del mes × factor del día. {ctx.dowF
          ? <>Factores por día de la semana calculados con la venta real de los últimos 3 meses de esta vista: {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((d, i) => `${d} ${ctx.dowF[i].toFixed(2)}`).join(' · ')}.</>
          : <>Factores fijos (no hay 3 meses de historia): Lun/Mar 0.85, Mié 0.95, Jue 1.0, Vie 1.20, Sáb 1.15, Dom 1.05.</>
        } Días de pago (1, 15, 16 y último) ×1.12. Asuetos con factor propio (Día Madre ×1.65, Día Padre ×1.40, Año Nuevo/Navidad ×0.7).
        {m.esMesActual && <>
          <br />
          <strong style={{ color: '#a5b4fc' }}>⏱ Ritmo de hoy:</strong> qué parte de la venta de un {ctx.fHoy.motivo.split(' ')[0]} se hace normalmente antes de esta hora (cuentas cobradas en el POS, mismo día de la semana, últimas 8 semanas). Se actualiza cada 3 min{actualizadoStr ? ` · última actualización ${actualizadoStr}` : ''}.
        </>}
      </div>
    </>
  );
}

// ──────────────────── Últimos días: ¿llegamos a la meta? ────────────────────
// Los 3 días cerrados anteriores + hoy (en curso). Barra = venta (sin eventos),
// raya blanca = meta de ese día. Abajo, el mismo resultado por canal.
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const OK = '#10b981', MAL = '#ef4444', BARRA = '#818cf8';

function UltimosDias({ m, sc }) {
  const hoy = diaUTC(m.hoyISO);
  const dias = [3, 2, 1, 0].map(n => {
    const iso = isoDia(new Date(hoy.getTime() - n * 86400000));
    const mDia = iso.slice(0, 7) === m.mesSel.slice(0, 7) ? m : m.anterior;
    const esHoy = n === 0;
    const venta = ventaConMeta(m.porDia?.[iso], sc);
    const meta = mDia ? metaDelDia(mDia, sc, iso) : null;
    const ctxHoy = esHoy ? contextoMetas(m, sc) : null;
    const esperadoAhora = esHoy && meta != null && ctxHoy.pctDia != null ? meta * ctxHoy.pctDia : null;
    const d = diaUTC(iso);
    return { iso, esHoy, venta, meta, esperadoAhora, mDia, etiqueta: `${DIAS_CORTOS[d.getUTCDay()]} ${d.getUTCDate()}` };
  });
  const maxV = Math.max(1, ...dias.map(d => Math.max(d.venta, d.meta || 0)));
  const ALTO = 140;
  // Canales con meta de al menos ~$10 al día (Hifumi, con centavos de meta, solo mete ruido).
  const canales = CH_KEYS.filter(ch => !CH_SIN_META.includes(ch) && calcularMetaMensual(ch, sc, m) >= 300);
  const cerrados = dias.filter(d => !d.esHoy && d.meta);
  const logrados = cerrados.filter(d => d.venta >= d.meta).length;

  const estado = (venta, meta, esHoy) => {
    if (!meta) return { txt: 'sin meta', color: '#9ca3af' };
    const pct = (venta / meta) * 100;
    if (esHoy) return { txt: `${fmtPct(pct)} · en curso`, color: '#9ca3af' };
    return venta >= meta ? { txt: `✅ ${fmtPct(pct)}`, color: OK } : { txt: `❌ ${fmtPct(pct)}`, color: MAL };
  };

  return (
    <div style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Últimos días: ¿llegamos a la meta?</div>
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          {cerrados.length > 0 && <>Meta cumplida {logrados} de {cerrados.length} días · </>}
          <span style={{ display: 'inline-block', width: 10, height: 10, background: BARRA, borderRadius: 2, verticalAlign: 'middle' }} /> venta
          {' '}<span style={{ display: 'inline-block', width: 14, height: 2, background: '#fff', verticalAlign: 'middle', marginLeft: 6 }} /> meta del día
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dias.length}, 1fr)`, gap: 12, marginTop: 14 }}>
        {dias.map(d => {
          const h = (d.venta / maxV) * ALTO;
          const hMeta = d.meta ? (d.meta / maxV) * ALTO : null;
          const hEsp = d.esperadoAhora ? (d.esperadoAhora / maxV) * ALTO : null;
          const e = estado(d.venta, d.meta, d.esHoy);
          const tip = `${d.etiqueta}${d.esHoy ? ' (hoy)' : ''}\nVenta: ${fmt$(d.venta)}\nMeta: ${d.meta ? fmt$(d.meta) : '—'}`
            + (d.esperadoAhora ? `\nA esta hora debería llevar: ${fmt$(d.esperadoAhora)}` : '');
          return (
            <div key={d.iso} title={tip} style={{ textAlign: 'center', cursor: 'default' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{fmt$(d.venta)}</div>
              <div style={{ position: 'relative', height: ALTO, marginTop: 4, borderBottom: '1px solid #333' }}>
                <div style={{
                  position: 'absolute', bottom: 0, left: '25%', width: '50%', height: Math.max(h, d.venta > 0 ? 2 : 0),
                  background: BARRA, opacity: d.esHoy ? 0.55 : 1, borderRadius: '4px 4px 0 0',
                }} />
                {hMeta != null && (
                  <div style={{ position: 'absolute', bottom: hMeta - 1, left: '15%', width: '70%', height: 2, background: '#fff' }} />
                )}
                {hEsp != null && (
                  <div style={{ position: 'absolute', bottom: hEsp - 1, left: '15%', width: '70%', borderTop: '2px dashed #9ca3af' }} />
                )}
              </div>
              <div style={{ fontSize: 11, color: d.esHoy ? '#fff' : '#9ca3af', marginTop: 6, fontWeight: d.esHoy ? 700 : 400 }}>{d.etiqueta}{d.esHoy ? ' · hoy' : ''}</div>
              <div style={{ fontSize: 11, color: '#666' }}>meta {d.meta ? fmt$(d.meta) : '—'}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: e.color, marginTop: 2 }}>{e.txt}</div>
            </div>
          );
        })}
      </div>
      {dias.some(d => d.esperadoAhora) && (
        <div style={{ fontSize: 10, color: '#666', marginTop: 6 }}>Raya punteada de hoy: lo que normalmente ya se vendió a esta hora.</div>
      )}

      {/* Por canal */}
      {canales.length > 1 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #262626' }}>
                <th style={{ ...thStyleSm, textAlign: 'left' }}>Canal</th>
                {dias.map(d => <th key={d.iso} style={thStyleSm}>{d.etiqueta}{d.esHoy ? ' · hoy' : ''}</th>)}
              </tr>
            </thead>
            <tbody>
              {canales.map(ch => (
                <tr key={ch} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  <td style={{ ...tdStyle, textAlign: 'left', fontSize: 11, color: '#e5e5e5' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: CH_COLOR[ch], marginRight: 6 }} />
                    {CH_LABEL[ch].replace(/^\S+\s/, '')}
                  </td>
                  {dias.map(d => {
                    const v = ventaConMeta(m.porDia?.[d.iso], sc, ch);
                    const mt = d.mDia ? metaDelDia(d.mDia, sc, d.iso, ch) : null;
                    const e = estado(v, mt, d.esHoy);
                    return (
                      <td key={d.iso} style={{ ...tdStyle, fontSize: 11 }} title={`Venta ${fmt$(v)} · meta ${mt ? fmt$(mt) : '—'}`}>
                        <span style={{ color: '#e5e5e5' }}>{fmt$(v)}</span>{' '}
                        <span style={{ color: e.color, fontWeight: 600 }}>{e.txt}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaMeta({ canal, sucursal, m, ctx, mesAntNombre, fechaHoyStr }) {
  const k = `${sucursal}|${canal}`;
  const cerrado = m.cerrado[k] || 0;
  const hoy = m.hoy[k] || 0;
  const actual = cerrado + hoy;
  const ant = m.antMismoDias[k] || 0;
  const esperadoAj = esperadoSegunMesAnterior(m, k, ctx.dowF);
  const delta = esperadoAj > 0 ? ((cerrado - esperadoAj) / esperadoAj) * 100 : null;

  const metaMensual = calcularMetaMensual(canal, sucursal, m);
  const pctMeta = metaMensual > 0 ? (actual / metaMensual) * 100 : 0;
  const esperadoMes = ctx.pctMesEsperado != null ? metaMensual * ctx.pctMesEsperado : null;
  const metaDiaria = ctx.sumaFactores > 0 ? (metaMensual / ctx.sumaFactores) * ctx.fHoy.factor : 0;
  const esperadoHoy = ctx.pctDia != null ? metaDiaria * ctx.pctDia : null;
  const pctHoy = metaDiaria > 0 ? (hoy / metaDiaria) * 100 : 0;
  const faltaHoy = Math.max(0, metaDiaria - hoy);
  const horas = horasRestantes(m.fechaHoy, ctx.horaFin);

  const color = CH_COLOR[canal];
  const card = { background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14 };
  const etiqueta = (txt, c) => <div style={{ fontSize: 11, color: c, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{txt}</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {/* Card 1: Acumulado del mes + comparativa de días cerrados */}
      <div style={{ ...card, borderLeft: `3px solid ${color}` }}>
        <div style={{ fontSize: 13, color, fontWeight: 600 }}>{CH_LABEL[canal]}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{fmt$(actual)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6, fontSize: 11, gap: 8 }}>
          <span style={{ color: '#666' }}>
            {m.diasCerrados > 0
              ? (esperadoAj > 0
                ? `1–${m.diasCerrados}: ${fmt$(cerrado)} vs ${fmt$(esperadoAj)} al ritmo de ${mesAntNombre} (calendario ${fmt$(ant)})`
                : `1–${m.diasCerrados}: ${fmt$(cerrado)} · sin venta en ${mesAntNombre} para comparar`)
              : 'Sin días cerrados para comparar'}
          </span>
          {delta != null && (
            <span style={{ color: delta >= 0 ? '#10b981' : '#ef4444', fontWeight: 700, whiteSpace: 'nowrap' }}>
              {delta >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(delta))}
            </span>
          )}
        </div>
      </div>

      {/* Eventos: sin meta, solo lo vendido en el mes y hoy */}
      {CH_SIN_META.includes(canal) ? (
        <div style={{ ...card, gridColumn: 'span 2', color: '#9ca3af', fontSize: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
          <div>Sin meta: las ventas de eventos dependen de que haya evento, no del día.</div>
          {m.esMesActual && <div>Hoy: <strong style={{ color: '#fff' }}>{fmt$(hoy)}</strong></div>}
        </div>
      ) : (<>
      {/* Card 2: Meta mensual + progreso contra el ritmo esperado */}
      <div style={card}>
        {etiqueta('Meta del mes', '#fbbf24')}
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{fmt$(metaMensual)}</div>
        <BarraMeta pct={pctMeta} pctEsperado={ctx.pctMesEsperado != null ? ctx.pctMesEsperado * 100 : null} color={colorRitmo(actual, esperadoMes)} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
          <span>{fmtPct(pctMeta)} alcanzado</span>
          <span>Falta {fmt$(Math.max(0, metaMensual - actual))}</span>
        </div>
        {m.esMesActual && esperadoMes != null && metaMensual > 0 && (
          <div style={{ marginTop: 4, fontSize: 11, color: colorRitmo(actual, esperadoMes), fontWeight: 600 }}>
            Debería ir en {fmt$(esperadoMes)} · {actual >= esperadoMes ? 'adelante' : 'atrás'} {fmt$(Math.abs(actual - esperadoMes))}
          </div>
        )}
      </div>

      {/* Card 3: Hoy — venta real contra meta del día */}
      {m.esMesActual ? (
        <div style={card}>
          {etiqueta('Hoy · ' + fechaHoyStr, '#10b981')}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{fmt$(hoy)}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#10b981' }}>/ {fmt$(metaDiaria)}</span>
          </div>
          <BarraMeta pct={pctHoy} pctEsperado={ctx.pctDia != null ? ctx.pctDia * 100 : null} color={colorRitmo(hoy, esperadoHoy)} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
            <span>{fmtPct(pctHoy)} de la meta</span>
            <span>{faltaHoy > 0 ? `Falta ${fmt$(faltaHoy)}` : '✅ Meta cumplida'}</span>
          </div>
          {esperadoHoy != null && metaDiaria > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: colorRitmo(hoy, esperadoHoy), fontWeight: 600 }}>
              A esta hora debería llevar {fmt$(esperadoHoy)} · {hoy >= esperadoHoy ? 'adelante' : 'atrás'} {fmt$(Math.abs(hoy - esperadoHoy))}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 11, color: '#666' }}>
            {ctx.fHoy.motivo} · factor ×{ctx.fHoy.factor.toFixed(2)}
            {faltaHoy > 0 && horas != null && horas > 0.25 && ` · necesita ${fmt$2(faltaHoy / horas)}/hora hasta ~${ctx.horaFin}`}
          </div>
        </div>
      ) : (
        <div style={{ ...card, color: '#666', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          La meta del día solo aplica al mes en curso
        </div>
      )}
      </>)}
    </div>
  );
}

// Barra de avance con una marca blanca donde debería ir según el ritmo esperado.
function BarraMeta({ pct, pctEsperado, color }) {
  return (
    <div style={{ position: 'relative', height: 6, background: '#1f2937', borderRadius: 3, marginTop: 8 }}>
      <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: color, borderRadius: 3, transition: 'width 0.4s' }} />
      {pctEsperado != null && pctEsperado > 0 && pctEsperado < 100 && (
        <div title={`Ritmo esperado: ${fmtPct(pctEsperado)}`}
          style={{ position: 'absolute', top: -3, left: `calc(${pctEsperado}% - 1px)`, width: 2, height: 12, background: '#fff', borderRadius: 1 }} />
      )}
    </div>
  );
}

// ──────────────────── Tab Resumen ────────────────────
function TabResumen({ datos, sucursalSel }) {
  let { sucursales, totalCanal, ordCanal, ticketCanal, total, ordTotal } = datos;

  // Filtrar por sucursal seleccionada
  if (sucursalSel !== 'todas') {
    const s = sucursales.find(x => x.store_code === sucursalSel);
    sucursales = s ? [s] : [];
    totalCanal = canalesEnCero();
    ordCanal = canalesEnCero();
    total = 0; ordTotal = 0;
    if (s) {
      CH_KEYS.forEach(ch => {
        if (s.canales[ch]) {
          totalCanal[ch] = s.canales[ch].monto;
          ordCanal[ch] = s.canales[ch].ord;
          total += s.canales[ch].monto;
          ordTotal += s.canales[ch].ord;
        }
      });
      ticketCanal = {};
      CH_KEYS.forEach(ch => { ticketCanal[ch] = ordCanal[ch] > 0 ? totalCanal[ch] / ordCanal[ch] : 0; });
    }
  }

  if (sucursales.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>No hay datos para el período seleccionado.</div>;
  const ticketGlobal = ordTotal > 0 ? total / ordTotal : 0;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
        <KpiCard label="Órdenes Totales" value={fmtN(ordTotal)} sub={`${fmt$(total)} · Ticket ${fmt$2(ticketGlobal)}`} />
        {CH_KEYS.filter(ch => ordCanal[ch] > 0 || ['mesa', 'para_llevar', 'delivery_propio', 'pedidos_ya'].includes(ch)).map(ch => (
          <KpiCard key={ch} label={CH_LABEL[ch]} value={fmtN(ordCanal[ch])}
            sub={`${fmt$(totalCanal[ch])} · Ticket ${fmt$2(ticketCanal[ch])}${ch === 'drivethrough' ? ' · Solo S003' : ''}`}
            color={CH_COLOR[ch]} pctMix={total ? (totalCanal[ch] / total) * 100 : 0} pctOrd={ordTotal ? (ordCanal[ch] / ordTotal) * 100 : 0} />
        ))}
      </div>

      <div style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Detalle por Sucursal</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>% gris = participación del canal sobre total de la sucursal</div>
          </div>
          <span style={{ background: '#1f2937', color: '#9ca3af', fontSize: 11, padding: '2px 8px', borderRadius: 999 }}>{sucursales.length} sucursal{sucursales.length !== 1 ? 'es' : ''}</span>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #262626' }}>
              <th rowSpan={2} style={thStyle}>Sucursal</th>
              {CH_KEYS.map(ch => (
                <th key={ch} colSpan={3} style={{ ...thStyle, color: CH_COLOR[ch], background: CH_COLOR[ch] + '0d' }}>{CH_LABEL[ch]}</th>
              ))}
              <th colSpan={3} style={{ ...thStyle, color: '#a5b4fc', background: 'rgba(99,102,241,0.05)' }}>📊 Total</th>
            </tr>
            <tr style={{ borderBottom: '1px solid #262626' }}>
              {[...Array(CH_KEYS.length + 1)].flatMap((_, i) => ([
                <th key={i + '-1'} style={thStyleSm}>Órd.</th>,
                <th key={i + '-2'} style={thStyleSm}>Monto</th>,
                <th key={i + '-3'} style={thStyleSm}>Ticket</th>,
              ]))}
            </tr>
          </thead>
          <tbody>
            {sucursales.map(s => <FilaSucursal key={s.store_code} s={s} />)}
            {sucursales.length > 1 && <FilaTotal datos={datos} />}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FilaSucursal({ s }) {
  const cells = [];
  CH_KEYS.forEach(ch => {
    const c = s.canales[ch];
    if (!c) {
      cells.push(<td style={tdStyleGray} key={ch + '-1'}>—</td>);
      cells.push(<td style={tdStyleGray} key={ch + '-2'}>—</td>);
      cells.push(<td style={tdStyleGray} key={ch + '-3'}>—</td>);
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
  const cells = [];
  CH_KEYS.forEach(ch => {
    const monto = totalCanal[ch] || 0;
    const ord = ordCanal[ch] || 0;
    const tk = ticketCanal[ch] || 0;
    const pct = total > 0 ? (monto / total) * 100 : 0;
    cells.push(<td key={ch + '-o'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmtN(ord)}</td>);
    cells.push(<td key={ch + '-m'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmt$(monto)} <span style={{ ...pctMixStyle, color: '#9ca3af' }}>{fmtPct(pct)}</span></td>);
    cells.push(<td key={ch + '-t'} style={{ ...tdStyle, color: CH_COLOR[ch] }}>{fmt$2(tk)}</td>);
  });
  return (
    <tr style={{ background: '#0a0a0a', fontWeight: 700, borderTop: '2px solid #262626' }}>
      <td style={{ ...tdStyle, textAlign: 'left', color: '#fff' }}>
        TOTAL <span style={{ fontSize: 10, color: '#666', fontWeight: 400 }}>(% sobre {fmt$(total)})</span>
      </td>
      {cells}
      <td style={{ ...tdStyle, color: '#fff' }}>{fmtN(ordTotal)}</td>
      <td style={{ ...tdStyle, color: '#fff' }}>{fmt$(total)}</td>
      <td style={{ ...tdStyle, color: '#a5b4fc' }}>{fmt$2(ticketG)}</td>
    </tr>
  );
}

// ──────────────────── Tab Items ────────────────────
function TabItems({ items, sucursalSel }) {
  const sucsTodas = STORES_ACTIVAS.filter(sc => items[sc]);
  const sucs = sucursalSel === 'todas' ? sucsTodas : sucsTodas.filter(sc => sc === sucursalSel);
  if (sucs.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Sin datos de items para el período/sucursal seleccionado.</div>;
  return (
    <>
      <div style={{ background: 'linear-gradient(90deg,rgba(99,102,241,0.1),transparent)', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 600, color: '#fff' }}>📐 Análisis Pareto 80/20 por sucursal</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Items ordenados por monto $ hasta acumular 80% de venta</div>
      </div>
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

// ──────────────────── Tab Empleados ────────────────────
function TabEmpleados({ emps, sucursalSel }) {
  const todosConData = STORES_ACTIVAS.filter(sc => emps[sc] && emps[sc].lista.length > 0);
  const todosSinData = STORES_ACTIVAS.filter(sc => !emps[sc] || emps[sc].lista.length === 0);

  const sucsConData = sucursalSel === 'todas' ? todosConData : todosConData.filter(sc => sc === sucursalSel);
  const sucsSinData = sucursalSel === 'todas' ? todosSinData : todosSinData.filter(sc => sc === sucursalSel);

  if (sucsConData.length === 0 && sucsSinData.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Sin datos para sucursal seleccionada.</div>;
  }

  if (sucsConData.length === 0) {
    return (
      <>
        <div style={{ background: 'linear-gradient(90deg,rgba(139,92,246,0.1),transparent)', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 600, color: '#fff' }}>👥 Ventas por Empleado</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Sin data de empleados aún. La columna autorizado_por se está poblando desde CSV TICKETS.</div>
        </div>
      </>
    );
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
        const empMejorTicket = [...data.lista].sort((a, b) => b.ticket - a.ticket)[0];
        return (
          <div key={sc} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div><div style={{ fontWeight: 600, color: '#fff' }}>{sc} — {STORES[sc] || sc}</div><div style={{ fontSize: 11, color: '#666' }}>{data.lista.length} empleados · {fmtN(data.ord)} órd · {fmt$(data.total)}</div></div>
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead><tr style={{ borderBottom: '1px solid #262626' }}><th style={thStyleSm}>#</th><th style={{ ...thStyleSm, textAlign: 'left' }}>Empleado</th><th style={thStyleSm}>Órdenes</th><th style={thStyleSm}>Monto</th><th style={thStyleSm}>Ticket Prom.</th><th style={thStyleSm}>% local</th><th style={thStyleSm}>Distribución</th></tr></thead>
              <tbody>
                {data.lista.map((e, i) => {
                  const widthPct = top.monto > 0 ? (e.monto / top.monto) * 100 : 0;
                  const isTopTicket = e === empMejorTicket;
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
                      <td style={{ ...tdStyle, width: 120 }}><div style={{ height: 5, background: '#1f2937', borderRadius: 3, overflow: 'hidden' }}><div style={{ height: '100%', width: widthPct + '%', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)' }} /></div></td>
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
            {sucsSinData.map(sc => (<div key={sc} style={{ textAlign: 'center', padding: 10, background: '#0d0d0d', borderRadius: 6 }}><div style={{ color: '#666', fontSize: 12 }}>{sc} — {STORES[sc] || sc}</div><div style={{ fontSize: 10, color: '#444', marginTop: 4 }}>backfill autorizado_por pendiente</div></div>))}
          </div>
        </div>
      )}
    </>
  );
}

// ──────────────────── Tab Tendencia ────────────────────
function TabTendencia({ tend }) {
  if (!tend.length) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Cargando tendencia…</div>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {CH_KEYS.map(k => ({ key: k, label: CH_LABEL[k] + (k === 'drivethrough' ? ' (S003)' : ''), color: CH_COLOR[k] })).map(ch => (
        <div key={ch.key} style={{ background: '#141414', border: '1px solid #262626', borderRadius: 8, padding: 14 }}>
          <div style={{ fontWeight: 600, color: ch.color, marginBottom: 10 }}>{ch.label}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ borderBottom: '1px solid #262626' }}><th style={{ ...thStyleSm, textAlign: 'left' }}>Mes</th><th style={thStyleSm}>Órdenes</th><th style={thStyleSm}>Monto</th><th style={thStyleSm}>Ticket prom.</th></tr></thead>
            <tbody>
              {tend.map((t, i) => {
                const c = t[ch.key];
                const tk = c.ord > 0 ? c.monto / c.ord : 0;
                const isLast = i === tend.length - 1;
                return (
                  <tr key={i} style={{ background: isLast ? '#0a0a0a' : 'transparent', borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ ...tdStyle, textAlign: 'left', color: isLast ? '#fff' : '#9ca3af', fontWeight: isLast ? 600 : 400 }}>
                      {/* FIX: timezone UTC para que no muestre mes equivocado */}
                      {t.mes.toLocaleDateString('es-SV', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
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

// ──────────────────── Insights Modal ────────────────────
function InsightsModal({ insights, onClose }) {
  const list = insights?.insights || [];
  const fechaGen = insights?.fecha_generacion ? new Date(insights.fecha_generacion).toLocaleString('es-SV') : null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.05))',
        border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, maxWidth: 800, width: '100%',
        padding: 24, color: '#e5e5e5', marginTop: 40,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ fontSize: 20 }}>✨</span><h3 style={{ margin: 0, color: '#a5b4fc' }}>Top 5 Insights — generados por IA</h3></div>
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
                  {it.accion_recomendada && (<div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 6, fontSize: 11, color: '#6ee7b7' }}>→ {it.accion_recomendada}</div>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────── Helpers UI ────────────────────
function MixStripe({ canales, total, width = 140 }) {
  if (!total) return null;
  return (
    <div style={{ display: 'flex', height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 6, background: '#1f2937', width }}>
      {CH_KEYS.map(c => {
        const pct = canales[c] ? (canales[c].monto / total) * 100 : 0;
        if (pct === 0) return null;
        return <span key={c} style={{ background: CH_COLOR[c], width: pct + '%' }} />;
      })}
    </div>
  );
}

function KpiCard({ label, value, sub, color, pctMix, pctOrd }) {
  return (
    <div style={{ background: '#141414', border: '1px solid #262626', borderLeft: color ? `3px solid ${color}` : '1px solid #262626', borderRadius: 8, padding: 14 }}>
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
