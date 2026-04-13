import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, today } from '../../config';

// ── Estilos ──
const c = {
  bg: '#0f0f23', card: '#16213e', border: '#333', red: '#e63946',
  green: '#4ade80', blue: '#3b82f6', yellow: '#f59e0b',
  text: '#eee', dim: '#888', input: '#1a1a2e',
};

const STATUS = {
  ok:      { emoji: '🟢', color: c.green,  label: 'OK' },
  warning: { emoji: '🟡', color: c.yellow, label: 'Atención' },
  error:   { emoji: '🔴', color: c.red,    label: 'Fallo' },
  loading: { emoji: '⏳', color: c.dim,    label: 'Cargando...' },
};

// ── Helpers ──
const daysAgo = (n) => {
  const d = new Date(Date.now() - 6 * 3600 * 1000); // El Salvador UTC-6
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

const todaySV = () => today();

// ── Mini Spark Bar (SVG inline) ──
function SparkBar({ data, color = c.blue, height = 36, width = 180 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const barW = Math.floor((width - (data.length - 1) * 2) / data.length);

  return (
    <svg width={width} height={height + 16} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / max) * height);
        const x = i * (barW + 2);
        const y = height - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} rx={2}
              fill={d.value === 0 ? '#333' : color} opacity={d.value === 0 ? 0.4 : 0.8} />
            <text x={x + barW / 2} y={height + 12} textAnchor="middle"
              fontSize={8} fill={c.dim}>{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ══════════════════════════════════════════
// KPI Card
// ══════════════════════════════════════════
function KPICard({ title, icon, status, summary, detail, sparkData, sparkColor, children }) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS[status] || STATUS.loading;

  return (
    <div style={{
      background: c.card, borderRadius: 10, padding: 14, marginBottom: 10,
      border: `1px solid ${status === 'error' ? c.red : status === 'warning' ? c.yellow : c.border}`,
    }}>
      {/* Header */}
      <div onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.text }}>{title}</div>
          <div style={{ fontSize: 11, color: s.color, marginTop: 2 }}>
            {s.emoji} {summary || s.label}
          </div>
        </div>
        <span style={{ fontSize: 11, color: c.dim }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Spark graph always visible */}
      {sparkData && sparkData.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <SparkBar data={sparkData} color={sparkColor || s.color} />
        </div>
      )}

      {/* Detail (expandable) */}
      {expanded && (
        <div style={{ marginTop: 10, fontSize: 12, color: c.dim, lineHeight: 1.6 }}>
          {detail}
          {children}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════
export default function DevOpsTab() {
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  // ── KPI States ──
  const [dteKPI, setDteKPI] = useState({ status: 'loading', summary: '', detail: '', spark: [] });
  const [posKPI, setPosKPI] = useState({ status: 'loading', summary: '', detail: '', spark: [] });
  const [serfinsaKPI, setSerfinsaKPI] = useState({ status: 'loading', summary: '', detail: '', spark: [] });
  const [cierresKPI, setCierresKPI] = useState({ status: 'loading', summary: '', detail: '', spark: [] });
  const [edgeFnKPI, setEdgeFnKPI] = useState({ status: 'loading', summary: '', detail: '', spark: [] });

  // ── Refresh all ──
  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      checkDTEs(),
      checkPOS(),
      checkSerfinsa(),
      checkCierres(),
      checkEdgeFunctions(),
    ]);
    setLastRefresh(new Date().toLocaleTimeString('es-SV'));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ══════════════════════════════════════════
  // 1. DTEs Pipeline (compras table)
  // ══════════════════════════════════════════
  async function checkDTEs() {
    try {
      const sevenAgo = daysAgo(7);
      const { data: comprasData, error } = await db
        .from('compras')
        .select('created_at')
        .gte('created_at', sevenAgo);

      if (error) throw new Error(error.message);

      // Group by day manually
      const grouped = {};
      (comprasData || []).forEach(r => {
        const d = r.created_at?.split('T')[0];
        if (d) grouped[d] = (grouped[d] || 0) + 1;
      });
      const rows = Object.entries(grouped).map(([dia, total]) => ({ dia, total })).sort((a, b) => a.dia.localeCompare(b.dia));

      // Build spark data for 7 days
      const spark = [];
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      for (let i = 6; i >= 0; i--) {
        const d = daysAgo(i);
        const row = (rows || []).find(r => r.dia === d);
        const dayOfWeek = new Date(d + 'T12:00:00').getDay();
        spark.push({ label: dayNames[dayOfWeek], value: row ? Number(row.total) : 0 });
      }

      const todayCount = spark[spark.length - 1]?.value || 0;
      const weekTotal = spark.reduce((s, d) => s + d.value, 0);
      const todayStr = todaySV();
      const isWeekday = [1, 2, 3, 4, 5].includes(new Date(todayStr + 'T12:00:00').getDay());

      let status = 'ok';
      let summary = `${todayCount} hoy · ${weekTotal} esta semana`;
      if (todayCount === 0 && isWeekday) {
        const hour = new Date(Date.now() - 6 * 3600 * 1000).getHours();
        status = hour >= 14 ? 'error' : 'warning';
        summary = `⚠️ 0 DTEs hoy (${weekTotal} esta semana)`;
      }

      const detail = (rows || []).map(r => `${r.dia}: ${r.total} DTEs`).join('\n');
      setDteKPI({ status, summary, detail, spark });
    } catch (err) {
      setDteKPI({ status: 'error', summary: `Error: ${err.message}`, detail: '', spark: [] });
    }
  }

  // ══════════════════════════════════════════
  // 2. POS — últimas ventas (ventas_diarias)
  // ══════════════════════════════════════════
  async function checkPOS() {
    try {
      const sevenAgo = daysAgo(7);
      const { data: ventas } = await db
        .from('ventas_diarias')
        .select('fecha, store_code, total_ventas_quanto, estado')
        .gte('fecha', sevenAgo)
        .order('fecha', { ascending: true });

      // Spark: total cierres por día
      const spark = [];
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      for (let i = 6; i >= 0; i--) {
        const d = daysAgo(i);
        const count = (ventas || []).filter(v => v.fecha === d).length;
        const dayOfWeek = new Date(d + 'T12:00:00').getDay();
        spark.push({ label: dayNames[dayOfWeek], value: count });
      }

      const todayVentas = (ventas || []).filter(v => v.fecha === todaySV());
      const totalWeek = (ventas || []).length;
      const storesActivas = Object.keys(STORES).filter(k => k !== 'CM001');
      const storesHoy = new Set(todayVentas.map(v => v.store_code));
      const faltantes = storesActivas.filter(s => !storesHoy.has(s));

      // Check for any with estado 'error' or weird values
      const conError = (ventas || []).filter(v => v.estado === 'error');

      let status = 'ok';
      let summary = `${todayVentas.length}/${storesActivas.length} sucursales hoy · ${totalWeek} cierres semana`;
      const details = [];

      if (conError.length > 0) {
        status = 'error';
        details.push(`${conError.length} cierres con estado ERROR`);
      }
      if (faltantes.length > 0 && faltantes.length < storesActivas.length) {
        if (status !== 'error') status = 'warning';
        details.push(`Faltan: ${faltantes.map(s => STORES[s] || s).join(', ')}`);
      }
      if (todayVentas.length === 0) {
        const hour = new Date(Date.now() - 6 * 3600 * 1000).getHours();
        status = hour >= 20 ? 'error' : hour >= 14 ? 'warning' : 'ok';
        if (hour >= 14) details.push('Ninguna sucursal ha cerrado hoy');
      }

      if (details.length > 0) summary = details[0];

      const detail = faltantes.length > 0
        ? `Sucursales sin cierre hoy: ${faltantes.map(s => `${STORES[s]} (${s})`).join(', ')}\n\nTotal cierres semana: ${totalWeek}`
        : `Todas las sucursales con cierre hoy. Total semana: ${totalWeek}`;

      setPosKPI({ status, summary, detail, spark });
    } catch (err) {
      setPosKPI({ status: 'error', summary: `Error: ${err.message}`, detail: '', spark: [] });
    }
  }

  // ══════════════════════════════════════════
  // 3. Serfinsa Liquidaciones
  // ══════════════════════════════════════════
  async function checkSerfinsa() {
    try {
      const sevenAgo = daysAgo(7);
      const { data: serfinsa, error } = await db
        .from('serfinsa_detalle_diario')
        .select('fecha, sucursal_nombre, valor_operaciones')
        .gte('fecha', sevenAgo)
        .order('fecha', { ascending: true });

      if (error) throw new Error(error.message);

      // Spark: last 7 days
      const spark = [];
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      for (let i = 6; i >= 0; i--) {
        const d = daysAgo(i);
        const count = (serfinsa || []).filter(s => s.fecha === d).length;
        const dayOfWeek = new Date(d + 'T12:00:00').getDay();
        spark.push({ label: dayNames[dayOfWeek], value: count });
      }

      const todayData = (serfinsa || []).filter(s => s.fecha === todaySV());
      const yesterdayData = (serfinsa || []).filter(s => s.fecha === daysAgo(1));
      const latestData = todayData.length > 0 ? todayData : yesterdayData;
      const latestLabel = todayData.length > 0 ? 'hoy' : 'ayer';

      let status = 'ok';
      let summary = `${latestData.length} terminales ${latestLabel}`;
      const expectedTerminals = 5;

      if (latestData.length === 0) {
        status = 'warning';
        summary = 'Sin datos recientes (últimas 48h)';
      } else if (latestData.length < expectedTerminals) {
        status = 'warning';
        summary = `${latestData.length}/${expectedTerminals} terminales ${latestLabel}`;
      }

      const total = latestData.reduce((s, r) => s + (parseFloat(r.valor_operaciones) || 0), 0);
      const detail = `Terminales ${latestLabel}: ${latestData.length}\nMonto total: $${total.toFixed(2)}\n\nDetalle:\n${latestData.map(r => `  ${r.sucursal_nombre}: $${parseFloat(r.valor_operaciones || 0).toFixed(2)}`).join('\n') || '  (sin datos)'}`;

      setSerfinsaKPI({ status, summary, detail, spark });
    } catch (err) {
      setSerfinsaKPI({ status: 'error', summary: `Error: ${err.message}`, detail: '', spark: [] });
    }
  }

  // ══════════════════════════════════════════
  // 4. Cierres Pendientes / Faltantes
  // ══════════════════════════════════════════
  async function checkCierres() {
    try {
      const sevenAgo = daysAgo(7);
      const { data: ventas } = await db
        .from('ventas_diarias')
        .select('fecha, store_code, estado, diferencia_deposito')
        .gte('fecha', sevenAgo);

      const storesActivas = Object.keys(STORES).filter(k => k !== 'CM001');
      const spark = [];
      const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

      const pendientesList = [];
      const discrepancias = [];

      for (let i = 6; i >= 0; i--) {
        const d = daysAgo(i);
        const dayData = (ventas || []).filter(v => v.fecha === d);
        const storesConCierre = new Set(dayData.map(v => v.store_code));
        const faltantes = storesActivas.filter(s => !storesConCierre.has(s));
        const dayOfWeek = new Date(d + 'T12:00:00').getDay();

        // Solo contar faltantes en días laborales (lun-dom, todos operan)
        spark.push({ label: dayNames[dayOfWeek], value: dayData.length });

        if (faltantes.length > 0 && i <= 2) {
          pendientesList.push({ fecha: d, faltantes });
        }

        // Check discrepancias
        dayData.forEach(v => {
          const diff = Math.abs(parseFloat(v.diferencia_deposito) || 0);
          if (diff > 5) discrepancias.push({ fecha: v.fecha, store: v.store_code, diff });
        });
      }

      // Estado pendientes (no aprobados)
      const sinAprobar = (ventas || []).filter(v =>
        v.estado && !['aprobado', 'depositado'].includes(v.estado)
      );

      let status = 'ok';
      let summary = `${sinAprobar.length} sin aprobar · ${discrepancias.length} discrepancias >$5`;
      const details = [];

      if (pendientesList.length > 0) {
        status = 'warning';
        details.push(`Sucursales sin cierre en últimos 3 días:`);
        pendientesList.forEach(p => {
          details.push(`  ${p.fecha}: ${p.faltantes.map(s => STORES[s] || s).join(', ')}`);
        });
      }
      if (discrepancias.length > 0) {
        if (status !== 'error') status = 'warning';
        details.push(`\nDiscrepancias >$5:`);
        discrepancias.slice(0, 5).forEach(d => {
          details.push(`  ${d.fecha} ${STORES[d.store] || d.store}: $${d.diff.toFixed(2)}`);
        });
      }
      if (sinAprobar.length > 10) {
        status = 'error';
        summary = `⚠️ ${sinAprobar.length} cierres sin aprobar`;
      }

      const detail = details.join('\n') || 'Todo al día — sin pendientes ni discrepancias.';
      setCierresKPI({ status, summary, detail, spark });
    } catch (err) {
      setCierresKPI({ status: 'error', summary: `Error: ${err.message}`, detail: '', spark: [] });
    }
  }

  // ══════════════════════════════════════════
  // 5. Edge Functions / DTE Service Health
  // ══════════════════════════════════════════
  async function checkEdgeFunctions() {
    try {
      const details = [];
      let issues = 0;

      // 1. Check DTE pipeline health via last compras insertion
      try {
        const { data: lastCompra } = await db
          .from('compras')
          .select('created_at, proveedor_nombre')
          .order('created_at', { ascending: false })
          .limit(1);
        if (lastCompra && lastCompra.length > 0) {
          const ago = Math.round((Date.now() - new Date(lastCompra[0].created_at).getTime()) / 3600000);
          const isStale = ago > 26; // más de 26h sin DTEs nuevos = alerta
          details.push(`${isStale ? '🟡' : '🟢'} Pipeline DTE GAS: último hace ${ago}h (${lastCompra[0].proveedor_nombre})`);
          if (isStale) issues++;
        } else {
          details.push('🔴 Pipeline DTE GAS: sin datos');
          issues += 2;
        }
      } catch {
        details.push('🔴 Pipeline DTE GAS: error al consultar');
        issues += 2;
      }

      // 2. Check POS DTE standalone (last emitted DTE from POS)
      try {
        const { data: lastPOS } = await db
          .from('pos_dte_standalone')
          .select('created_at, tipo_dte, estado_hacienda')
          .order('created_at', { ascending: false })
          .limit(1);
        if (lastPOS && lastPOS.length > 0) {
          const ago = Math.round((Date.now() - new Date(lastPOS[0].created_at).getTime()) / 3600000);
          details.push(`🟢 POS DTE: último ${lastPOS[0].tipo_dte} (${lastPOS[0].estado_hacienda}) hace ${ago}h`);
        } else {
          details.push('🟡 POS DTE: sin emisiones registradas');
        }
      } catch {
        // table might not exist yet
        details.push('⚪ POS DTE: tabla no disponible');
      }

      // 3. Check Serfinsa GAS pipeline health
      try {
        const { data: lastSerfinsa } = await db
          .from('serfinsa_detalle_diario')
          .select('fecha')
          .order('fecha', { ascending: false })
          .limit(1);
        if (lastSerfinsa && lastSerfinsa.length > 0) {
          const lastDate = lastSerfinsa[0].fecha;
          const todayStr = todaySV();
          const diffDays = Math.round((new Date(todayStr) - new Date(lastDate)) / 86400000);
          const isStale = diffDays > 2;
          details.push(`${isStale ? '🟡' : '🟢'} Serfinsa GAS: último dato ${lastDate} (hace ${diffDays}d)`);
          if (isStale) issues++;
        } else {
          details.push('🔴 Serfinsa GAS: sin datos');
          issues += 2;
        }
      } catch {
        details.push('🔴 Serfinsa GAS: error al consultar');
        issues += 2;
      }

      // 4. Check acciones_pendientes (open incidents)
      try {
        const { data: pendientes } = await db
          .from('acciones_pendientes')
          .select('id, estado')
          .in('estado', ['pendiente', 'abierta', 'en_progreso']);
        const count = (pendientes || []).length;
        if (count > 5) {
          details.push(`🟡 Acciones pendientes: ${count} abiertas`);
          issues++;
        } else {
          details.push(`🟢 Acciones pendientes: ${count} abiertas`);
        }
      } catch {
        details.push('⚪ Acciones pendientes: tabla no consultable');
      }

      // Determine overall status
      let status = 'ok';
      let summary = 'Todos los servicios operativos';
      if (issues >= 2) {
        status = 'error';
        summary = `${issues} problema(s) detectado(s)`;
      } else if (issues === 1) {
        status = 'warning';
        summary = '1 alerta menor';
      }

      setEdgeFnKPI({ status, summary, detail: details.join('\n'), spark: [] });
    } catch (err) {
      setEdgeFnKPI({ status: 'error', summary: `Error: ${err.message}`, detail: '', spark: [] });
    }
  }

  // ══════════════════════════════════════════
  // Summary bar
  // ══════════════════════════════════════════
  const allKPIs = [dteKPI, posKPI, serfinsaKPI, cierresKPI, edgeFnKPI];
  const errCount = allKPIs.filter(k => k.status === 'error').length;
  const warnCount = allKPIs.filter(k => k.status === 'warning').length;
  const okCount = allKPIs.filter(k => k.status === 'ok').length;

  const overallStatus = errCount > 0 ? 'error' : warnCount > 0 ? 'warning' : 'ok';
  const overallEmoji = errCount > 0 ? '🔴' : warnCount > 0 ? '🟡' : '🟢';

  return (
    <div>
      {/* Summary Header */}
      <div style={{
        background: overallStatus === 'error' ? '#3b0a0a' : overallStatus === 'warning' ? '#3b2e0a' : '#0a3b1a',
        borderRadius: 10, padding: 14, marginBottom: 14,
        border: `1px solid ${STATUS[overallStatus].color}33`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: c.text }}>
              {overallEmoji} Sistema {overallStatus === 'ok' ? 'Operativo' : overallStatus === 'warning' ? 'Con Alertas' : 'Con Fallos'}
            </div>
            <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>
              🟢 {okCount} OK · 🟡 {warnCount} Alertas · 🔴 {errCount} Fallos
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <button onClick={refresh} disabled={loading}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: c.blue, color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                opacity: loading ? 0.5 : 1,
              }}>
              {loading ? '⏳' : '🔄'} Refresh
            </button>
            {lastRefresh && (
              <div style={{ fontSize: 10, color: c.dim, marginTop: 4 }}>
                Último: {lastRefresh}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <KPICard
        title="Pipeline DTEs (Compras)"
        icon="📄"
        status={dteKPI.status}
        summary={dteKPI.summary}
        detail={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{dteKPI.detail}</pre>}
        sparkData={dteKPI.spark}
        sparkColor={c.blue}
      />

      <KPICard
        title="POS / Cierres de Caja"
        icon="💰"
        status={posKPI.status}
        summary={posKPI.summary}
        detail={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{posKPI.detail}</pre>}
        sparkData={posKPI.spark}
        sparkColor={c.green}
      />

      <KPICard
        title="Serfinsa Liquidaciones"
        icon="🏦"
        status={serfinsaKPI.status}
        summary={serfinsaKPI.summary}
        detail={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{serfinsaKPI.detail}</pre>}
        sparkData={serfinsaKPI.spark}
        sparkColor={c.yellow}
      />

      <KPICard
        title="Cierres Pendientes & Discrepancias"
        icon="⚠️"
        status={cierresKPI.status}
        summary={cierresKPI.summary}
        detail={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{cierresKPI.detail}</pre>}
        sparkData={cierresKPI.spark}
        sparkColor="#a78bfa"
      />

      <KPICard
        title="Edge Functions & Servicios"
        icon="⚡"
        status={edgeFnKPI.status}
        summary={edgeFnKPI.summary}
        detail={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{edgeFnKPI.detail}</pre>}
      />

      {/* Footer */}
      <div style={{ fontSize: 10, color: '#444', textAlign: 'center', marginTop: 16, padding: 8 }}>
        DevOps Monitor · Los datos son en tiempo real desde Supabase
      </div>
    </div>
  );
}
