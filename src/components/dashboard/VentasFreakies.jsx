import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';

/**
 * VentasFreakies — Reporte de ventas en vivo del POS propio + Quanto (legacy).
 * ------------------------------------------------------------------------
 * Réplica (mejorada, con theme Freakie Dogs) del reporte de ventas de Kaeru,
 * pero MULTI-SUCURSAL. Cada orden se lee de una de dos fuentes:
 *
 *   • pos_cuentas      → POS PROPIO en vivo   (hoy: Metro Centro / S006)
 *   • quanto_ordenes   → POS LEGACY "Quanto"  (hoy: M001, S001..S004)
 *
 * ┌─ TRANSICIÓN QUANTO → POS PROPIO ─────────────────────────────────────┐
 * │ A medida que cada sucursal DEJA de usar Quanto y pasa al POS propio,  │
 * │ solo hay que registrar su FECHA DE CORTE en `CUTOVER_POS` (abajo).    │
 * │ Antes de esa fecha se lee de Quanto; ese día en adelante, del POS.    │
 * │ Así nunca se doble-contabiliza y la venta "en vivo" del POS propio    │
 * │ va reemplazando a Quanto sucursal por sucursal.                       │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * KPIs + Venta por hora + Mapa de calor día×hora + Desglose por canal +
 * Top productos + Métodos de pago. Filtrable por sucursal y rango de fechas.
 *
 * Nota: PeYa (PedidosYa) se sube por separado desde el portal PeYa a su
 * propia tabla (pedidos_peya) y NO se incluye en este reporte.
 *
 * Acceso: admin, superadmin, ejecutivo, gerente.
 */

// ── Sucursales con venta (POS propio o Quanto) ──
const STORES_VENTAS = ['S006', 'M001', 'S001', 'S002', 'S003', 'S004'];

// ── Fuente ACTUAL por sucursal (cuando NO hay fecha de corte en CUTOVER_POS) ──
//   'pos'    → lee de pos_cuentas   (POS propio en vivo)
//   'quanto' → lee de quanto_ordenes (POS legacy Quanto)
const FUENTE_ACTUAL = {
  S006: 'pos',      // Metro Centro 8va Etapa — nació directo en POS propio (07-Jul-2026)
  M001: 'quanto',   // Plaza Cafetalón
  S001: 'quanto',   // Plaza Mundo Soyapango
  S002: 'quanto',   // Plaza Mundo Usulután
  S003: 'quanto',   // Grand Plaza Lourdes
  S004: 'quanto',   // Paseo Venecia
};

// ── Fechas de corte Quanto → POS propio (YYYY-MM-DD) ──
// Cuando una sucursal MIGRA de Quanto al POS propio, agrega aquí su fecha.
// Ejemplo: cuando Soyapango pase al POS propio el 1-Ago-2026:
//   S001: '2026-08-01',
// (Antes de esa fecha: Quanto. Ese día en adelante: POS propio.)
const CUTOVER_POS = {
  // S006 no lleva corte: nunca tuvo Quanto, siempre fue POS propio.
};

// ── Theme Freakie Dogs (mismo palette que el resto del ERP) ──
const C = {
  bg: '#0a0a0a', panel: '#111', card: '#1a1a1a', border: '#2a2a2a',
  text: '#e5e5e5', muted: '#666', muted2: '#888',
  red: '#e63946', green: '#4ade80', blue: '#60a5fa', amber: '#f59e0b',
  teal: '#14b8a6', pink: '#ec4899', cyan: '#22d3ee', purple: '#a78bfa',
};
// Colores de canal (consistentes con KPIs de Venta)
const CH_COLOR = {
  mesa: '#f59e0b', para_llevar: '#3b82f6', delivery_propio: '#ec4899',
  drivethrough: '#14b8a6', delivery_app: '#22d3ee', otro: '#888',
};
const CH_LABEL = {
  mesa: 'Mesa', para_llevar: 'Para llevar', delivery_propio: 'Delivery propio',
  drivethrough: 'Drive-thru', delivery_app: 'Delivery app', otro: 'Otro',
};
const CH_ORDER = ['mesa', 'para_llevar', 'delivery_propio', 'drivethrough', 'delivery_app', 'otro'];
// Métodos de pago Quanto (códigos DTE MH) → etiqueta
const METODO_QUANTO = { '01': 'Efectivo', '02': 'Tarjeta', '03': 'Tarjeta', '04': 'Cheque', '05': 'Transferencia', '08': 'Otros' };
const METODO_COLOR = { Efectivo: '#4ade80', Tarjeta: '#60a5fa', Transferencia: '#a78bfa', Cheque: '#f59e0b', Otros: '#888', Mixto: '#ec4899' };

const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const fmtUSD = (v) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtUSD0 = (v) => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
const fmtN = (v) => (Number(v) || 0).toLocaleString('en-US');

// Fechas locales El Salvador (UTC-6, sin DST)
const hoyISO = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];
const addDays = (iso, nd) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + nd); return d.toISOString().split('T')[0]; };
const fmtDMY = (iso) => { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }); };
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) + 1;

// ── Resolver segmentos de fuente para una sucursal en el rango [desde,hasta] ──
function segmentsFor(store, desde, hasta) {
  const cut = CUTOVER_POS[store];
  if (cut) {
    const segs = [];
    const qHasta = addDays(cut, -1);
    if (desde <= qHasta) segs.push({ store, fuente: 'quanto', desde, hasta: hasta < qHasta ? hasta : qHasta });
    const pDesde = desde > cut ? desde : cut;
    if (pDesde <= hasta) segs.push({ store, fuente: 'pos', desde: pDesde, hasta });
    return segs;
  }
  return [{ store, fuente: FUENTE_ACTUAL[store] || 'quanto', desde, hasta }];
}

// ── Fetch paginado (evita el tope de filas de PostgREST) ──
async function fetchPOS(stores, desde, hasta) {
  const desdeTs = `${desde}T00:00:00-06:00`, hastaTs = `${hasta}T23:59:59-06:00`;
  const page = 1000; let out = [], from = 0;
  for (;;) {
    const { data, error } = await db.from('pos_cuentas')
      .select('id,total,iva,propina,descuento,tipo,store_code,cobrada_at,pax_total')
      .eq('estado', 'cobrada').in('store_code', stores)
      .gte('cobrada_at', desdeTs).lte('cobrada_at', hastaTs)
      .order('cobrada_at', { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const sv = new Date(Date.parse(r.cobrada_at) - 6 * 3600 * 1000); // wall-clock SV
      out.push({
        id: r.id, fuente: 'pos', store: r.store_code,
        hour: sv.getUTCHours(), dow: sv.getUTCDay(), dia: sv.toISOString().slice(0, 10),
        venta: (Number(r.total) || 0) - (Number(r.propina) || 0),
        propina: Number(r.propina) || 0, descuento: Number(r.descuento) || 0, iva: Number(r.iva) || 0,
        canal: r.tipo || 'otro', pax: Number(r.pax_total) || 0, metodo: null,
      });
    }
    if (rows.length < page) break; from += page;
  }
  return out;
}
async function fetchQuanto(stores, desde, hasta) {
  const page = 1000; let out = [], from = 0;
  for (;;) {
    const { data, error } = await db.from('quanto_ordenes')
      .select('id,total_pagar,total_iva,propina,total_descuento,canal_venta,metodo_pago,store_code,fecha,hora')
      .in('store_code', stores).gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending: true }).range(from, from + page - 1);
    if (error) throw error;
    const rows = data || [];
    for (const r of rows) {
      const hora = r.hora || '00:00:00';
      const sv = new Date(`${r.fecha}T${hora}Z`); // naive = wall-clock SV
      out.push({
        id: r.id, fuente: 'quanto', store: r.store_code,
        hour: sv.getUTCHours(), dow: sv.getUTCDay(), dia: r.fecha,
        venta: (Number(r.total_pagar) || 0) - (Number(r.propina) || 0),
        propina: Number(r.propina) || 0, descuento: Number(r.total_descuento) || 0, iva: Number(r.total_iva) || 0,
        canal: r.canal_venta || 'otro', pax: 0, metodo: METODO_QUANTO[r.metodo_pago] || 'Otros',
      });
    }
    if (rows.length < page) break; from += page;
  }
  return out;
}

// ── Top productos (items) por fuente, en chunks de ids ──
async function fetchItemsPOS(ids) {
  const acc = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let from = 0; const page = 1000;
    for (;;) {
      const { data, error } = await db.from('pos_cuenta_items')
        .select('nombre,cantidad,subtotal,cuenta_id').in('cuenta_id', chunk)
        .range(from, from + page - 1);
      if (error) throw error;
      const rows = data || [];
      for (const d of rows) {
        const nom = (d.nombre || '—').trim();
        if (!acc[nom]) acc[nom] = { cantidad: 0, revenue: 0 };
        acc[nom].cantidad += Number(d.cantidad) || 0;
        acc[nom].revenue += Number(d.subtotal) || 0;
      }
      if (rows.length < page) break; from += page;
    }
  }
  return acc;
}
async function fetchItemsQuanto(ids) {
  const acc = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let from = 0; const page = 1000;
    for (;;) {
      const { data, error } = await db.from('quanto_orden_items')
        .select('descripcion,cantidad,venta_gravada,venta_exenta,no_gravado,es_propina,orden_id').in('orden_id', chunk)
        .range(from, from + page - 1);
      if (error) throw error;
      const rows = data || [];
      for (const d of rows) {
        if (d.es_propina) continue;
        const nom = (d.descripcion || '—').trim();
        if (!acc[nom]) acc[nom] = { cantidad: 0, revenue: 0 };
        acc[nom].cantidad += Number(d.cantidad) || 0;
        acc[nom].revenue += (Number(d.venta_gravada) || 0) + (Number(d.venta_exenta) || 0) + (Number(d.no_gravado) || 0);
      }
      if (rows.length < page) break; from += page;
    }
  }
  return acc;
}
async function fetchPagosPOS(ids) {
  const acc = {};
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let from = 0; const page = 1000;
    for (;;) {
      const { data, error } = await db.from('pos_cuenta_pagos')
        .select('metodo,monto,cuenta_id').in('cuenta_id', chunk).range(from, from + page - 1);
      if (error) throw error;
      const rows = data || [];
      for (const d of rows) {
        const m = d.metodo === 'efectivo' ? 'Efectivo' : d.metodo === 'tarjeta' ? 'Tarjeta'
          : d.metodo === 'transferencia' ? 'Transferencia' : d.metodo === 'mixto' ? 'Mixto' : 'Otros';
        acc[m] = (acc[m] || 0) + (Number(d.monto) || 0);
      }
      if (rows.length < page) break; from += page;
    }
  }
  return acc;
}

// ════════════════════════════════════════════════════════════════════════
export default function VentasFreakies({ user, onBack }) {
  const sucDefault = STORES_VENTAS.includes(user?.store_code) ? user.store_code : 'todas';
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [sucursalSel, setSucursalSel] = useState(sucDefault);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ventas, setVentas] = useState([]);
  const [topProd, setTopProd] = useState([]);
  const [metodos, setMetodos] = useState([]);
  const [nombres, setNombres] = useState({}); // store_code → nombre (desde tabla sucursales)

  // Nombres de sucursal en vivo (config.js está desactualizado)
  useEffect(() => {
    (async () => {
      const { data } = await db.from('sucursales').select('store_code,nombre');
      const m = {}; (data || []).forEach((s) => { m[s.store_code] = s.nombre; });
      setNombres(m);
    })();
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const scope = sucursalSel === 'todas' ? STORES_VENTAS : [sucursalSel];
        // Agrupar segmentos por (fuente|desde|hasta) → [stores]
        const groups = {};
        scope.forEach((s) => segmentsFor(s, desde, hasta).forEach((seg) => {
          const k = `${seg.fuente}|${seg.desde}|${seg.hasta}`;
          (groups[k] = groups[k] || { ...seg, stores: [] }).stores.push(seg.store);
        }));
        let rows = [];
        for (const g of Object.values(groups)) {
          const part = g.fuente === 'pos'
            ? await fetchPOS(g.stores, g.desde, g.hasta)
            : await fetchQuanto(g.stores, g.desde, g.hasta);
          rows = rows.concat(part);
        }
        if (cancel) return;
        setVentas(rows);

        // Top productos + métodos de pago
        const posIds = rows.filter((r) => r.fuente === 'pos').map((r) => r.id);
        const qIds = rows.filter((r) => r.fuente === 'quanto').map((r) => r.id);
        const [itPos, itQ, pagosPos] = await Promise.all([
          posIds.length ? fetchItemsPOS(posIds) : {},
          qIds.length ? fetchItemsQuanto(qIds) : {},
          posIds.length ? fetchPagosPOS(posIds) : {},
        ]);
        if (cancel) return;
        // merge items
        const acc = {};
        for (const src of [itPos, itQ]) for (const [nom, v] of Object.entries(src)) {
          if (!acc[nom]) acc[nom] = { cantidad: 0, revenue: 0 };
          acc[nom].cantidad += v.cantidad; acc[nom].revenue += v.revenue;
        }
        setTopProd(Object.entries(acc).map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 12));
        // métodos: POS (child table) + Quanto (en la orden)
        const mAcc = { ...pagosPos };
        rows.filter((r) => r.fuente === 'quanto').forEach((r) => { mAcc[r.metodo] = (mAcc[r.metodo] || 0) + r.venta; });
        setMetodos(Object.entries(mAcc).map(([metodo, total]) => ({ metodo, total })).filter((m) => m.total > 0.005).sort((a, b) => b.total - a.total));
      } catch (ex) {
        if (!cancel) setError(ex.message || String(ex));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [desde, hasta, sucursalSel]);

  const nombreSuc = (sc) => nombres[sc] || sc;

  const kpis = useMemo(() => {
    let ingresos = 0, propinas = 0, descuentos = 0, iva = 0, clientes = 0, nPos = 0, nQ = 0;
    for (const v of ventas) {
      ingresos += v.venta; propinas += v.propina; descuentos += v.descuento; iva += v.iva; clientes += v.pax;
      if (v.fuente === 'pos') nPos++; else nQ++;
    }
    const ordenes = ventas.length;
    const clientesEff = clientes > 0 ? clientes : ordenes;
    return {
      ordenes, ingresos, propinas, descuentos, iva, clientes: clientesEff, sinPax: clientes === 0, nPos, nQ,
      ordenProm: ordenes ? ingresos / ordenes : 0,
      promCliente: clientesEff ? ingresos / clientesEff : 0,
    };
  }, [ventas]);

  const porHora = useMemo(() => {
    const h = {}; for (const v of ventas) h[v.hour] = (h[v.hour] || 0) + v.venta;
    const hrs = Object.keys(h).map(Number); if (!hrs.length) return [];
    const min = Math.min(...hrs), max = Math.max(...hrs); const out = [];
    for (let i = min; i <= max; i++) out.push({ hora: i, total: Math.round((h[i] || 0) * 100) / 100 });
    return out;
  }, [ventas]);

  const heat = useMemo(() => {
    const m = Array.from({ length: 7 }, () => Array(24).fill(0));
    let hMin = 23, hMax = 0, max = 0;
    for (const v of ventas) { m[v.dow][v.hour] += v.venta; if (v.hour < hMin) hMin = v.hour; if (v.hour > hMax) hMax = v.hour; }
    for (let d = 0; d < 7; d++) for (let hr = 0; hr < 24; hr++) if (m[d][hr] > max) max = m[d][hr];
    if (hMin > hMax) { hMin = 10; hMax = 22; }
    return { m, hMin, hMax, max };
  }, [ventas]);

  const canales = useMemo(() => {
    const acc = {}; let tot = 0;
    for (const v of ventas) { const k = CH_LABEL[v.canal] ? v.canal : 'otro'; acc[k] = (acc[k] || 0) + v.venta; tot += v.venta; }
    return CH_ORDER.filter((k) => acc[k] > 0.005).map((k) => ({ canal: k, total: acc[k], pct: tot ? acc[k] / tot * 100 : 0 }));
  }, [ventas]);

  const porFuente = useMemo(() => {
    let pos = 0, q = 0; for (const v of ventas) { if (v.fuente === 'pos') pos += v.venta; else q += v.venta; }
    return { pos, quanto: q, total: pos + q };
  }, [ventas]);

  const porSucursal = useMemo(() => {
    const acc = {};
    for (const v of ventas) {
      if (!acc[v.store]) acc[v.store] = { store: v.store, total: 0, canales: {} };
      const k = CH_LABEL[v.canal] ? v.canal : 'otro';
      acc[v.store].canales[k] = (acc[v.store].canales[k] || 0) + v.venta;
      acc[v.store].total += v.venta;
    }
    return Object.values(acc).sort((a, b) => b.total - a.total);
  }, [ventas]);

  const rangoDias = diasEntre(desde, hasta);

  // Nota de fuente para la selección actual
  const nota = (() => {
    if (sucursalSel === 'todas')
      return 'Metro Centro = POS propio en vivo · demás sucursales = Quanto (POS legacy). Cada orden va etiquetada por fuente.';
    const cut = CUTOVER_POS[sucursalSel];
    if (cut) return `${nombreSuc(sucursalSel)}: Quanto hasta ${fmtDMY(addDays(cut, -1))} · POS propio desde ${fmtDMY(cut)}.`;
    return (FUENTE_ACTUAL[sucursalSel] || 'quanto') === 'pos'
      ? `${nombreSuc(sucursalSel)}: POS propio en vivo (Freakie POS).`
      : `${nombreSuc(sucursalSel)}: Quanto (POS legacy) — aún no migra al POS propio.`;
  })();

  // ── UI helpers ──
  const selStyle = { background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 13 };
  const iconBtn = { background: '#1a1a1a', border: '1px solid #333', color: '#ccc', width: 30, height: 30, borderRadius: 6, cursor: 'pointer', fontSize: 15 };

  const KPI = ({ label, value, color, sub }) => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', minWidth: 132 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.text, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: C.muted2, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1a1a1a', background: C.panel }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.red, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 6 }}>← Volver</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20 }}>🐕 Ventas Freakies</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Venta en vivo del POS propio + Quanto legacy · por sucursal</div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={sucursalSel} onChange={(e) => setSucursalSel(e.target.value)} style={selStyle}>
              <option value="todas">Todas las sucursales</option>
              {STORES_VENTAS.map((sc) => <option key={sc} value={sc}>{sc} — {nombreSuc(sc)}</option>)}
            </select>
            <button style={iconBtn} title="Día anterior" onClick={() => { setDesde(addDays(desde, -1)); setHasta(addDays(hasta, -1)); }}>‹</button>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} style={{ ...selStyle, colorScheme: 'dark' }} />
            <span style={{ color: C.muted }}>→</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} style={{ ...selStyle, colorScheme: 'dark' }} />
            <button style={iconBtn} title="Día siguiente" onClick={() => { setDesde(addDays(desde, 1)); setHasta(addDays(hasta, 1)); }}>›</button>
            <button onClick={() => { setDesde(hoyISO()); setHasta(hoyISO()); }}
              style={{ background: C.red, border: 'none', color: '#fff', padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Hoy</button>
          </div>
        </div>
        {/* Nota de fuente */}
        <div style={{ fontSize: 11, color: C.muted2, marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ background: '#14532d', color: C.green, padding: '2px 8px', borderRadius: 20, fontWeight: 700, fontSize: 10 }}>ⓘ Fuente</span>
          {nota}
        </div>
      </div>

      {loading && <div style={{ padding: 80, textAlign: 'center', color: C.muted }}>● Consultando ventas…</div>}
      {error && <div style={{ padding: 16, margin: 16, background: 'rgba(230,57,70,0.1)', border: '1px solid rgba(230,57,70,0.35)', borderRadius: 10, color: '#fca5a5', fontSize: 13 }}>⚠ {error}</div>}

      {!loading && !error && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {rangoDias > 45 && (
            <div style={{ fontSize: 11, color: C.amber }}>⚠ Rango amplio ({rangoDias} días): la consulta puede tardar en sucursales Quanto.</div>
          )}

          {/* KPIs */}
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            <KPI label="Órdenes" value={fmtN(kpis.ordenes)} sub={`${kpis.nPos} POS · ${kpis.nQ} Quanto`} />
            <KPI label="Ingresos (sin propina)" value={fmtUSD(kpis.ingresos)} color={C.green} />
            <KPI label="Orden promedio" value={fmtUSD(kpis.ordenProm)} />
            <KPI label="Clientes" value={fmtN(kpis.clientes)} sub={kpis.sinPax ? '≈ órdenes (sin pax)' : 'pax registrados'} />
            <KPI label="Promedio x cliente" value={fmtUSD(kpis.promCliente)} />
            <KPI label="Propinas" value={fmtUSD(kpis.propinas)} color={C.purple} />
            <KPI label="Descuentos" value={fmtUSD(kpis.descuentos)} />
            <KPI label="IVA" value={fmtUSD(kpis.iva)} />
          </div>

          {/* Ventas por sucursal — composición por canal */}
          <Card title="Ventas por sucursal · cómo se construye la venta">
            {porSucursal.length ? (() => {
              const maxTot = Math.max(...porSucursal.map((s) => s.total), 1);
              const chPres = CH_ORDER.filter((k) => porSucursal.some((s) => (s.canales[k] || 0) > 0.005));
              return (
                <div>
                  {/* Leyenda de canales */}
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
                    {chPres.map((k) => (
                      <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted2 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: CH_COLOR[k] }} />{CH_LABEL[k]}
                      </span>
                    ))}
                  </div>
                  {/* Barras apiladas por sucursal */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {porSucursal.map((s) => (
                      <div key={s.store}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                          <span style={{ fontWeight: 600 }}>{s.store} · {nombreSuc(s.store)}</span>
                          <b>{fmtUSD(s.total)}</b>
                        </div>
                        <div style={{ display: 'flex', width: `${s.total / maxTot * 100}%`, minWidth: 3, height: 24, borderRadius: 5, overflow: 'hidden', background: '#161616', border: '1px solid #ffffff10' }}>
                          {chPres.map((k) => {
                            const val = s.canales[k] || 0; if (val <= 0.005) return null;
                            const segPct = s.total ? val / s.total * 100 : 0;
                            return (
                              <div key={k} title={`${CH_LABEL[k]}: ${fmtUSD(val)} · ${segPct.toFixed(1)}%`}
                                style={{ width: `${segPct}%`, background: CH_COLOR[k], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9.5, color: '#0a0a0a', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                {segPct >= 12 ? `${Math.round(segPct)}%` : ''}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>
                    El ancho de cada barra = venta total de la sucursal (relativo a la mayor). Cada color es un canal
                    y el % dentro del segmento es su peso en esa sucursal. Pasá el mouse para ver el monto exacto por canal.
                  </div>
                </div>
              );
            })() : <Empty />}
          </Card>

          {/* Venta por hora */}
          <Card title="Venta total por hora">
            {porHora.length ? <HourArea data={porHora} /> : <Empty />}
          </Card>

          {/* Mapa de calor */}
          <Card title="Mapa de calor · día × hora">
            {heat.max > 0 ? (() => {
              const horas = Array.from({ length: heat.hMax - heat.hMin + 1 }, (_, i) => heat.hMin + i);
              return (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: `40px repeat(${horas.length}, minmax(20px,1fr))`, gap: 3, marginTop: 8, minWidth: horas.length * 24 + 40 }}>
                    <div />
                    {horas.map((h) => <div key={h} style={{ textAlign: 'center', fontSize: 10, color: C.muted }}>{h}</div>)}
                    {DOW.map((dl, d) => (
                      <div key={d} style={{ display: 'contents' }}>
                        <div style={{ fontSize: 10, color: C.muted, display: 'flex', alignItems: 'center' }}>{dl}</div>
                        {horas.map((h) => {
                          const val = heat.m[d][h]; const op = heat.max ? val / heat.max : 0;
                          return <div key={h} title={`${dl} ${h}:00 · ${fmtUSD(val)}`}
                            style={{ height: 26, borderRadius: 4, background: op ? `rgba(230,57,70,${0.12 + op * 0.82})` : '#161616', border: '1px solid #ffffff08' }} />;
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })() : <Empty />}
          </Card>

          {/* Desglose por canal + Métodos de pago */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            <Card title="Venta por canal">
              {canales.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                  {canales.map((c) => (
                    <div key={c.canal}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: CH_COLOR[c.canal], fontWeight: 600 }}>{CH_LABEL[c.canal]}</span>
                        <span><b>{fmtUSD(c.total)}</b> <span style={{ color: C.muted }}>· {c.pct.toFixed(1)}%</span></span>
                      </div>
                      <div style={{ height: 8, background: '#ffffff10', borderRadius: 4 }}>
                        <div style={{ height: 8, width: `${c.pct}%`, background: CH_COLOR[c.canal], borderRadius: 4, transition: 'width .4s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <Empty />}
            </Card>

            <Card title="Métodos de pago">
              {metodos.length ? (() => {
                const max = Math.max(...metodos.map((m) => m.total));
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                    {metodos.map((m) => (
                      <div key={m.metodo}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: METODO_COLOR[m.metodo] || '#888', fontWeight: 600 }}>{m.metodo}</span>
                          <b>{fmtUSD(m.total)}</b>
                        </div>
                        <div style={{ height: 8, background: '#ffffff10', borderRadius: 4 }}>
                          <div style={{ height: 8, width: `${max ? m.total / max * 100 : 0}%`, background: METODO_COLOR[m.metodo] || '#888', borderRadius: 4, transition: 'width .4s' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })() : <Empty />}
            </Card>
          </div>

          {/* Top productos + Mix por fuente */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            <Card title="Top productos del período">
              {topProd.length ? (
                <table style={{ width: '100%', fontSize: 13, marginTop: 6, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: C.muted, textAlign: 'left', fontSize: 10.5, textTransform: 'uppercase' }}>
                      <th style={{ padding: '4px 0' }}>#</th><th>Producto</th>
                      <th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Venta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProd.map((p, i) => (
                      <tr key={p.nombre} style={{ borderTop: '1px solid #222' }}>
                        <td style={{ color: C.muted, padding: '6px 0' }}>{i + 1}</td>
                        <td style={{ paddingRight: 8 }}>{p.nombre}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(p.cantidad)}</td>
                        <td style={{ textAlign: 'right', color: C.green }}>{fmtUSD(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Empty />}
            </Card>

            <Card title="Mix por fuente">
              {porFuente.total > 0 ? (
                <div style={{ marginTop: 6 }}>
                  {[
                    { k: 'pos', label: 'POS propio (en vivo)', val: porFuente.pos, color: C.green },
                    { k: 'quanto', label: 'Quanto (legacy)', val: porFuente.quanto, color: C.amber },
                  ].map((f) => {
                    const pct = porFuente.total ? f.val / porFuente.total * 100 : 0;
                    return (
                      <div key={f.k} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: f.color, fontWeight: 600 }}>{f.label}</span>
                          <span><b>{fmtUSD(f.val)}</b> <span style={{ color: C.muted }}>· {pct.toFixed(1)}%</span></span>
                        </div>
                        <div style={{ height: 10, background: '#ffffff10', borderRadius: 5 }}>
                          <div style={{ height: 10, width: `${pct}%`, background: f.color, borderRadius: 5 }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
                    A medida que cada sucursal deje Quanto y pase al POS propio, la barra verde (POS en vivo)
                    irá reemplazando a la ámbar (Quanto). Registrá la fecha de corte en <code style={{ color: C.amber }}>CUTOVER_POS</code>.
                  </div>
                </div>
              ) : <Empty />}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Subcomponentes de presentación ──
function Card({ title, children }) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}
function Empty() {
  return <div style={{ color: '#555', padding: '28px 0', textAlign: 'center', fontSize: 13 }}>Sin ventas en el rango</div>;
}

// SVG area chart — venta por hora (sin dependencias)
function HourArea({ data }) {
  const W = 1000, H = 240, padL = 48, padR = 12, padT = 12, padB = 26;
  const maxV = Math.max(...data.map((d) => d.total), 1);
  const n = data.length;
  const xFor = (i) => padL + (n <= 1 ? 0 : (i * (W - padL - padR)) / (n - 1));
  const yFor = (v) => padT + (H - padT - padB) * (1 - v / maxV);
  const pts = data.map((d, i) => `${xFor(i)},${yFor(d.total)}`);
  const area = `M ${xFor(0)},${H - padB} L ${pts.join(' L ')} L ${xFor(n - 1)},${H - padB} Z`;
  const line = `M ${pts.join(' L ')}`;
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="240" preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="vfArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e63946" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#e63946" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (maxV * i) / ticks, y = yFor(v);
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#ffffff10" strokeWidth="1" />
            <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="11" fill="#666">{'$' + Math.round(v)}</text>
          </g>
        );
      })}
      <path d={area} fill="url(#vfArea)" />
      <path d={line} fill="none" stroke="#e63946" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      {data.map((d, i) => (
        <text key={i} x={xFor(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#666">{d.hora}:00</text>
      ))}
    </svg>
  );
}
