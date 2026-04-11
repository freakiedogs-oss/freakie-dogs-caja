import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n, shiftDate } from '../../config';

// ── Control de acceso ──
const ALLOWED_ROLES = ['ejecutivo', 'admin', 'contador', 'superadmin'];

// ── Helpers ──
const fmt$ = (v) => `$${parseFloat(v || 0).toFixed(2)}`;

// ── CONCILIACIÓN BANCARIA Y DTEs ──────────────────────────────────────────
export default function ConciliacionView({ user, onBack }) {
  // Control de acceso
  if (!ALLOWED_ROLES.includes(user?.rol)) {
    return (
      <div style={{ padding: '20px', color: '#e63946', textAlign: 'center' }}>
        <h3>Acceso denegado</h3>
        <p>Se requiere rol: {ALLOWED_ROLES.join(', ')}</p>
        {onBack && <button onClick={onBack} style={{marginTop:'10px'}}>Volver</button>}
      </div>
    );
  }

  const [tab, setTab] = useState('serfinsa');
  const [loading, setLoading] = useState(true);

  // ── CRUCE SERFINSA ──
  const [serfinsa, setSerfinsa] = useState([]);
  const [validaciones, setValidaciones] = useState([]);
  const [expandedRows, setExpandedRows] = useState({});
  const [fechaIni, setFechaIni] = useState(shiftDate(today(), -7));
  const [fechaFin, setFechaFin] = useState(today());

  // ── CRUCE DTES ──
  const [compras, setCompras] = useState([]);
  const [dteEstado, setDteEstado] = useState('todos');
  const [dteProveedor, setDteProveedor] = useState('todos');
  const [dteFechaIni, setDteFechaIni] = useState(shiftDate(today(), -30));
  const [dteFechaFin, setDteFechaFin] = useState(today());

  // ── RESUMEN ──
  const [ajustes, setAjustes] = useState([]);
  const [mesResumen, setMesResumen] = useState(today().slice(0, 7));

  // ── Cargar datos ──
  const cargarDatos = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, vRes, cRes, aRes] = await Promise.all([
        db.from('serfinsa_detalle_diario')
          .select('*')
          .gte('fecha', fechaIni)
          .lte('fecha', fechaFin)
          .order('fecha', { ascending: false })
          .order('sucursal_id'),
        db.from('serfinsa_validacion_diaria')
          .select('*')
          .gte('fecha', fechaIni)
          .lte('fecha', fechaFin)
          .order('fecha', { ascending: false }),
        db.from('compras_dte')
          .select('*')
          .gte('fecha', dteFechaIni)
          .lte('fecha', dteFechaFin)
          .order('fecha', { ascending: false })
          .order('numero_dte'),
        db.from('v_ajustes_cruce_resumen')
          .select('*')
          .gte('fecha', mesResumen + '-01')
          .lt('fecha', shiftDate(mesResumen + '-01', 32).slice(0, 7) + '-01'),
      ]);

      setSerfinsa(sRes.data || []);
      setValidaciones(vRes.data || []);
      setCompras(cRes.data || []);
      setAjustes(aRes.data || []);
      setLoading(false);
    } catch (e) {
      console.error('Error cargando datos conciliación:', e);
      setLoading(false);
    }
  }, [fechaIni, fechaFin, dteFechaIni, dteFechaFin, mesResumen]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // ────────────────────────────────────────────────────────────────
  // TAB 1: CRUCE SERFINSA (TARJETAS)
  // ────────────────────────────────────────────────────────────────

  const serfinsaPorDia = useMemo(() => {
    const m = {};
    validaciones.forEach((v) => {
      const k = `${v.fecha}-${v.sucursal_id}`;
      m[k] = v;
    });
    return m;
  }, [validaciones]);

  const estadoEstilo = (estado, diff) => {
    if (estado === 'ok') return { color: '#4ade80', bg: '#1a3a0a' };
    if (estado === 'revisar') return { color: '#f59e0b', bg: '#452a03' };
    if (estado === 'pendiente') return { color: '#8b5cf6', bg: '#3a2a4a' };
    // fallback por diferencia
    if (n(diff) < 5) return { color: '#4ade80', bg: '#1a3a0a' };
    if (n(diff) < 20) return { color: '#f59e0b', bg: '#452a03' };
    return { color: '#e63946', bg: '#4a1a1a' };
  };

  const serfinsaGrupado = useMemo(() => {
    const m = {};
    serfinsa.forEach((s) => {
      if (!m[s.fecha]) m[s.fecha] = {};
      if (!m[s.fecha][s.sucursal_id]) m[s.fecha][s.sucursal_id] = [];
      m[s.fecha][s.sucursal_id].push(s);
    });
    // Convertir a array de días
    return Object.entries(m)
      .sort(([aF], [bF]) => bF.localeCompare(aF))
      .map(([fecha, sucursales]) => ({
        fecha,
        sucursales: Object.entries(sucursales).map(([sid, rows]) => {
          const val = serfinsaPorDia[`${fecha}-${sid}`];
          const monto_s = rows.reduce((s, r) => s + n(r.monto_venta), 0);
          const monto_q = n(val?.monto_quanto || 0);
          const diff = Math.abs(monto_s - monto_q);
          const estado = val?.estado || 'pendiente';
          return {
            fecha,
            sucursal_id: sid,
            sucursal_nombre: STORES[sid] || sid,
            monto_serfinsa: monto_s,
            monto_quanto: monto_q,
            diferencia: diff,
            estado,
            rows,
            validacion: val,
          };
        }),
      }));
  }, [serfinsa, serfinsaPorDia]);

  const serfinsaTotales = useMemo(() => {
    let totS = 0, totQ = 0, totDiff = 0, okCount = 0, revCount = 0, pendCount = 0;
    serfinsaGrupado.forEach((d) => {
      d.sucursales.forEach((s) => {
        totS += n(s.monto_serfinsa);
        totQ += n(s.monto_quanto);
        totDiff += n(s.diferencia);
        if (s.estado === 'ok') okCount++;
        if (s.estado === 'revisar') revCount++;
        if (s.estado === 'pendiente') pendCount++;
      });
    });
    return { totS, totQ, totDiff, okCount, revCount, pendCount };
  }, [serfinsaGrupado]);

  // ────────────────────────────────────────────────────────────────
  // TAB 2: CRUCE DTEs COMPRAS
  // ────────────────────────────────────────────────────────────────

  const proveedoresUnicos = useMemo(
    () => [...new Set(compras.map((c) => c.proveedor))],
    [compras]
  );

  const comprasFiltradas = useMemo(() => {
    return compras.filter((c) => {
      if (dteEstado !== 'todos' && c.match_status !== dteEstado) return false;
      if (dteProveedor !== 'todos' && c.proveedor !== dteProveedor) return false;
      return true;
    });
  }, [compras, dteEstado, dteProveedor]);

  const comprasResumen = useMemo(() => {
    let totalMatched = 0,
      totalPending = 0,
      totalRevision = 0,
      montoMatched = 0,
      montoPending = 0,
      montoRevision = 0;
    comprasFiltradas.forEach((c) => {
      if (c.match_status === 'matched') {
        totalMatched++;
        montoMatched += n(c.monto);
      } else if (c.match_status === 'pending') {
        totalPending++;
        montoPending += n(c.monto);
      } else if (c.match_status === 'revision_manual') {
        totalRevision++;
        montoRevision += n(c.monto);
      }
    });
    return { totalMatched, totalPending, totalRevision, montoMatched, montoPending, montoRevision };
  }, [comprasFiltradas]);

  const handleDteAprobación = useCallback(
    async (compraId, nuevoStatus) => {
      try {
        await db.from('compras_dte').update({ match_status: nuevoStatus }).eq('id', compraId);
        await cargarDatos();
      } catch (e) {
        console.error('Error actualizando DTE:', e);
      }
    },
    [cargarDatos]
  );

  // ────────────────────────────────────────────────────────────────
  // TAB 3: RESUMEN CONCILIACIÓN
  // ────────────────────────────────────────────────────────────────

  const resumenMes = useMemo(() => {
    const validacionesMes = validaciones.filter(
      (v) => v.fecha >= mesResumen + '-01' && v.fecha < shiftDate(mesResumen + '-01', 32).slice(0, 7) + '-01'
    );
    let totalVal = validacionesMes.length;
    let okVal = validacionesMes.filter((v) => v.estado === 'ok').length;
    let revVal = validacionesMes.filter((v) => v.estado === 'revisar').length;

    const comprasMes = compras.filter(
      (c) => c.fecha >= mesResumen + '-01' && c.fecha < shiftDate(mesResumen + '-01', 32).slice(0, 7) + '-01'
    );
    let totalDte = comprasMes.length;
    let matchedDte = comprasMes.filter((c) => c.match_status === 'matched').length;

    let difAcum = 0;
    validacionesMes.forEach((v) => (difAcum += n(v.diferencia || 0)));

    return {
      totalVal,
      okVal,
      revVal,
      pctOk: totalVal > 0 ? ((okVal / totalVal) * 100).toFixed(1) : 0,
      pctRev: totalVal > 0 ? ((revVal / totalVal) * 100).toFixed(1) : 0,
      totalDte,
      matchedDte,
      pctMatched: totalDte > 0 ? ((matchedDte / totalDte) * 100).toFixed(1) : 0,
      difAcum,
    };
  }, [validaciones, compras, mesResumen]);

  const itemsAtencion = useMemo(() => {
    const items = [];
    // Validaciones que requieren revisión
    validaciones
      .filter((v) => v.estado === 'revisar')
      .slice(0, 10)
      .forEach((v) => {
        items.push({
          tipo: 'serfinsa',
          fecha: v.fecha,
          titulo: `Serfinsa ${STORES[v.sucursal_id] || v.sucursal_id}`,
          detalle: `Diferencia: ${fmt$(n(v.diferencia))}`,
          estado: 'revisar',
        });
      });
    // DTEs en revisión manual
    compras
      .filter((c) => c.match_status === 'revision_manual')
      .slice(0, 10)
      .forEach((c) => {
        items.push({
          tipo: 'dte',
          fecha: c.fecha,
          titulo: `DTE ${c.numero_dte} - ${c.proveedor}`,
          detalle: `Monto: ${fmt$(n(c.monto))}`,
          estado: 'revision',
        });
      });
    return items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [validaciones, compras]);

  // ────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#aaa' }}>Cargando datos...</div>;
  }

  const TABS = [
    { k: 'serfinsa', label: '💳 Cruce Serfinsa' },
    { k: 'dtes', label: '📋 DTEs Compras' },
    { k: 'resumen', label: '📊 Resumen' },
  ];

  return (
    <div style={{ minHeight: '100vh', padding: '0 0 40px', background: '#1a1a2e', color: '#eee' }}>
      {/* Header */}
      <div style={{ background: '#16213e', padding: '20px', borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>🏦 Conciliación Bancaria</h1>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                padding: '8px 16px',
                background: '#333',
                color: '#eee',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              ← Volver
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          padding: '15px 20px',
          background: '#0f3460',
          borderBottom: '2px solid #333',
          overflowX: 'auto',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: '10px 16px',
              background: tab === t.k ? '#e63946' : '#1a1a2e',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: tab === t.k ? 'bold' : 'normal',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '20px' }}>
        {/* ──────────────────────────────────────── */}
        {/* TAB: SERFINSA */}
        {/* ──────────────────────────────────────── */}
        {tab === 'serfinsa' && (
          <div>
            <div style={{ marginBottom: '20px', display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                  Desde:
                </label>
                <input
                  type="date"
                  value={fechaIni}
                  onChange={(e) => setFechaIni(e.target.value)}
                  style={{
                    padding: '10px',
                    background: '#16213e',
                    color: '#eee',
                    border: '1px solid #333',
                    borderRadius: 6,
                    width: '150px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                  Hasta:
                </label>
                <input
                  type="date"
                  value={fechaFin}
                  onChange={(e) => setFechaFin(e.target.value)}
                  style={{
                    padding: '10px',
                    background: '#16213e',
                    color: '#eee',
                    border: '1px solid #333',
                    borderRadius: 6,
                    width: '150px',
                  }}
                />
              </div>
              <button
                onClick={() => cargarDatos()}
                style={{
                  padding: '10px 20px',
                  background: '#4ade80',
                  color: '#000',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                Actualizar
              </button>
            </div>

            {/* Tabla Serfinsa */}
            <div className="card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#0f3460', borderBottom: '2px solid #333' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Fecha</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Sucursal</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Serfinsa ($)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>QUANTO ($)</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Diferencia</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Estado</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {serfinsaGrupado.map((dia, didx) =>
                    dia.sucursales.map((s, sidx) => {
                      const isExpanded = expandedRows[`${dia.fecha}-${s.sucursal_id}`];
                      const estilo = estadoEstilo(s.estado, s.diferencia);
                      return (
                        <div key={`${dia.fecha}-${s.sucursal_id}`}>
                          <tr
                            style={{
                              background: sidx % 2 === 0 ? '#1a1a2e' : '#16213e',
                              borderBottom: '1px solid #333',
                            }}
                          >
                            <td style={{ padding: '12px' }}>{fmtDate(dia.fecha)}</td>
                            <td style={{ padding: '12px' }}>{s.sucursal_nombre}</td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>{fmt$(s.monto_serfinsa)}</td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>{fmt$(s.monto_quanto)}</td>
                            <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold' }}>
                              {fmt$(s.diferencia)}
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <span
                                style={{
                                  background: estilo.bg,
                                  color: estilo.color,
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                }}
                              >
                                {s.estado.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <button
                                onClick={() =>
                                  setExpandedRows((prev) => ({
                                    ...prev,
                                    [`${dia.fecha}-${s.sucursal_id}`]: !isExpanded,
                                  }))
                                }
                                style={{
                                  background: '#457b9d',
                                  color: '#fff',
                                  border: 'none',
                                  padding: '6px 12px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: '12px',
                                }}
                              >
                                {isExpanded ? '−' : '+'}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr style={{ background: '#0f3460', borderBottom: '2px solid #333' }}>
                              <td colSpan="7" style={{ padding: '15px' }}>
                                <div style={{ marginBottom: '10px', fontSize: '12px' }}>
                                  <strong>Detalles por terminal:</strong>
                                </div>
                                <table style={{ width: '100%', fontSize: '12px', marginBottom: '10px' }}>
                                  <thead>
                                    <tr style={{ borderBottom: '1px solid #555' }}>
                                      <th style={{ textAlign: 'left', padding: '5px' }}>Terminal</th>
                                      <th style={{ textAlign: 'right', padding: '5px' }}>Venta</th>
                                      <th style={{ textAlign: 'right', padding: '5px' }}>Propina</th>
                                      <th style={{ textAlign: 'right', padding: '5px' }}>Comisión</th>
                                      <th style={{ textAlign: 'right', padding: '5px' }}>Retención</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {s.rows.map((r, idx) => (
                                      <tr key={idx} style={{ borderBottom: '1px solid #333' }}>
                                        <td style={{ padding: '5px' }}>{r.terminal}</td>
                                        <td style={{ textAlign: 'right', padding: '5px' }}>{fmt$(n(r.monto_venta))}</td>
                                        <td style={{ textAlign: 'right', padding: '5px' }}>{fmt$(n(r.monto_propina))}</td>
                                        <td style={{ textAlign: 'right', padding: '5px' }}>{fmt$(n(r.monto_comision))}</td>
                                        <td style={{ textAlign: 'right', padding: '5px' }}>
                                          {fmt$(n(r.monto_retencion))}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {s.validacion?.notas && (
                                  <div style={{ fontSize: '12px', color: '#bbb', fontStyle: 'italic' }}>
                                    <strong>Notas:</strong> {s.validacion.notas}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </div>
                      );
                    })
                  )}
                </tbody>
              </table>

              {/* Fila de totales */}
              <div style={{ padding: '15px', background: '#0f3460', borderTop: '2px solid #333' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', fontSize: '14px' }}>
                  <div>
                    <div style={{ color: '#bbb', fontSize: '11px' }}>TOTAL SERFINSA</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4ade80' }}>
                      {fmt$(serfinsaTotales.totS)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#bbb', fontSize: '11px' }}>TOTAL QUANTO</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#86efac' }}>
                      {fmt$(serfinsaTotales.totQ)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#bbb', fontSize: '11px' }}>DIFERENCIA ACUMULADA</div>
                    <div
                      style={{
                        fontSize: '18px',
                        fontWeight: 'bold',
                        color: serfinsaTotales.totDiff < 5 ? '#4ade80' : serfinsaTotales.totDiff < 20 ? '#f59e0b' : '#e63946',
                      }}
                    >
                      {fmt$(serfinsaTotales.totDiff)}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#bbb', fontSize: '11px' }}>ESTADO</div>
                    <div style={{ fontSize: '13px', marginTop: '5px' }}>
                      <div style={{ color: '#4ade80', marginBottom: '3px' }}>
                        ✓ OK: {serfinsaTotales.okCount}
                      </div>
                      <div style={{ color: '#f59e0b', marginBottom: '3px' }}>
                        ⚠ Revisar: {serfinsaTotales.revCount}
                      </div>
                      <div style={{ color: '#8b5cf6' }}>◆ Pendiente: {serfinsaTotales.pendCount}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────── */}
        {/* TAB: DTEs COMPRAS */}
        {/* ──────────────────────────────────────── */}
        {tab === 'dtes' && (
          <div>
            <div
              style={{
                marginBottom: '20px',
                display: 'flex',
                gap: '15px',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                  Estado:
                </label>
                <select
                  value={dteEstado}
                  onChange={(e) => setDteEstado(e.target.value)}
                  style={{
                    padding: '10px',
                    background: '#16213e',
                    color: '#eee',
                    border: '1px solid #333',
                    borderRadius: 6,
                    width: '150px',
                  }}
                >
                  <option value="todos">Todos</option>
                  <option value="matched">Coincidencias</option>
                  <option value="pending">Pendientes</option>
                  <option value="revision_manual">Revisión Manual</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                  Proveedor:
                </label>
                <select
                  value={dteProveedor}
                  onChange={(e) => setDteProveedor(e.target.value)}
                  style={{
                    padding: '10px',
                    background: '#16213e',
                    color: '#eee',
                    border: '1px solid #333',
                    borderRadius: 6,
                    width: '180px',
                  }}
                >
                  <option value="todos">Todos</option>
                  {proveedoresUnicos.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                  Desde:
                </label>
                <input
                  type="date"
                  value={dteFechaIni}
                  onChange={(e) => setDteFechaIni(e.target.value)}
                  style={{
                    padding: '10px',
                    background: '#16213e',
                    color: '#eee',
                    border: '1px solid #333',
                    borderRadius: 6,
                    width: '150px',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                  Hasta:
                </label>
                <input
                  type="date"
                  value={dteFechaFin}
                  onChange={(e) => setDteFechaFin(e.target.value)}
                  style={{
                    padding: '10px',
                    background: '#16213e',
                    color: '#eee',
                    border: '1px solid #333',
                    borderRadius: 6,
                    width: '150px',
                  }}
                />
              </div>
            </div>

            {/* Tabla DTEs */}
            <div className="card" style={{ overflowX: 'auto', marginBottom: '20px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#0f3460', borderBottom: '2px solid #333' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Fecha</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Proveedor</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}># DTE</th>
                    <th style={{ padding: '12px', textAlign: 'right' }}>Monto ($)</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Estado</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {comprasFiltradas.map((c, idx) => {
                    const statusColors = {
                      matched: { color: '#4ade80', bg: '#1a3a0a', label: 'Coincide' },
                      pending: { color: '#8b5cf6', bg: '#3a2a4a', label: 'Pendiente' },
                      revision_manual: { color: '#f59e0b', bg: '#452a03', label: 'Revisión Manual' },
                    };
                    const st = statusColors[c.match_status] || { color: '#999', bg: '#333', label: c.match_status };
                    return (
                      <tr
                        key={c.id}
                        style={{
                          background: idx % 2 === 0 ? '#1a1a2e' : '#16213e',
                          borderBottom: '1px solid #333',
                        }}
                      >
                        <td style={{ padding: '12px' }}>{fmtDate(c.fecha)}</td>
                        <td style={{ padding: '12px' }}>{c.proveedor}</td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: 'bold' }}>
                          {c.numero_dte}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>{fmt$(n(c.monto))}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <span
                            style={{
                              background: st.bg,
                              color: st.color,
                              padding: '4px 8px',
                              borderRadius: 4,
                              fontSize: '11px',
                              fontWeight: 'bold',
                            }}
                          >
                            {st.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {c.match_status === 'revision_manual' && (
                            <div style={{ display: 'flex', gap: '5px', justifyContent: 'center' }}>
                              <button
                                onClick={() => handleDteAprobación(c.id, 'matched')}
                                style={{
                                  padding: '6px 10px',
                                  background: '#4ade80',
                                  color: '#000',
                                  border: 'none',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                }}
                              >
                                ✓ Aprobar
                              </button>
                              <button
                                onClick={() => handleDteAprobación(c.id, 'pending')}
                                style={{
                                  padding: '6px 10px',
                                  background: '#e63946',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: '11px',
                                  fontWeight: 'bold',
                                }}
                              >
                                ✗ Sin match
                              </button>
                            </div>
                          )}
                          {c.match_status !== 'revision_manual' && (
                            <span style={{ color: '#bbb', fontSize: '11px' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Resumen DTEs */}
            <div className="card" style={{ padding: '20px' }}>
              <h3 style={{ marginTop: 0 }}>📊 Resumen DTEs</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                <div style={{ background: '#0f3460', padding: '15px', borderRadius: 8 }}>
                  <div style={{ color: '#bbb', fontSize: '12px', marginBottom: '5px' }}>Total Coincidencias</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#4ade80' }}>
                    {comprasResumen.totalMatched}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
                    {fmt$(comprasResumen.montoMatched)}
                  </div>
                </div>
                <div style={{ background: '#0f3460', padding: '15px', borderRadius: 8 }}>
                  <div style={{ color: '#bbb', fontSize: '12px', marginBottom: '5px' }}>Total Pendientes</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#8b5cf6' }}>
                    {comprasResumen.totalPending}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
                    {fmt$(comprasResumen.montoPending)}
                  </div>
                </div>
                <div style={{ background: '#0f3460', padding: '15px', borderRadius: 8 }}>
                  <div style={{ color: '#bbb', fontSize: '12px', marginBottom: '5px' }}>Total Revisión Manual</div>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>
                    {comprasResumen.totalRevision}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
                    {fmt$(comprasResumen.montoRevision)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────── */}
        {/* TAB: RESUMEN CONCILIACIÓN */}
        {/* ──────────────────────────────────────── */}
        {tab === 'resumen' && (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '12px', color: '#bbb', marginBottom: '5px' }}>
                Mes a consultar (YYYY-MM):
              </label>
              <input
                type="month"
                value={mesResumen}
                onChange={(e) => setMesResumen(e.target.value)}
                style={{
                  padding: '10px',
                  background: '#16213e',
                  color: '#eee',
                  border: '1px solid #333',
                  borderRadius: 6,
                  width: '150px',
                }}
              />
            </div>

            {/* Tarjetas de resumen */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '20px',
                marginBottom: '30px',
              }}
            >
              <div className="card">
                <h3 style={{ margin: '0 0 15px 0' }}>💳 Validaciones Serfinsa</h3>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#4ade80', marginBottom: '10px' }}>
                  {resumenMes.totalVal}
                </div>
                <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
                  <div>
                    <div style={{ color: '#bbb' }}>OK</div>
                    <div style={{ fontWeight: 'bold', color: '#4ade80' }}>
                      {resumenMes.okVal} ({resumenMes.pctOk}%)
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#bbb' }}>Revisar</div>
                    <div style={{ fontWeight: 'bold', color: '#f59e0b' }}>
                      {resumenMes.revVal} ({resumenMes.pctRev}%)
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 style={{ margin: '0 0 15px 0' }}>📋 DTEs Cruzados</h3>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#4ade80', marginBottom: '10px' }}>
                  {resumenMes.totalDte}
                </div>
                <div style={{ display: 'flex', gap: '20px', fontSize: '13px' }}>
                  <div>
                    <div style={{ color: '#bbb' }}>Coincidencias</div>
                    <div style={{ fontWeight: 'bold', color: '#4ade80' }}>
                      {resumenMes.matchedDte} ({resumenMes.pctMatched}%)
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#bbb' }}>Pendientes</div>
                    <div style={{ fontWeight: 'bold', color: '#8b5cf6' }}>
                      {resumenMes.totalDte - resumenMes.matchedDte}
                    </div>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 style={{ margin: '0 0 15px 0' }}>💰 Diferencia Acumulada</h3>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 'bold',
                    color: resumenMes.difAcum < 50 ? '#4ade80' : resumenMes.difAcum < 200 ? '#f59e0b' : '#e63946',
                    marginBottom: '10px',
                  }}
                >
                  {fmt$(resumenMes.difAcum)}
                </div>
                <div style={{ fontSize: '12px', color: '#bbb' }}>
                  {resumenMes.difAcum < 50
                    ? '✓ Dentro de límites normales'
                    : resumenMes.difAcum < 200
                    ? '⚠ Requiere revisión'
                    : '⚠ Alerta: revisar urgente'}
                </div>
              </div>
            </div>

            {/* Items que necesitan atención */}
            <div className="card">
              <h3 style={{ margin: '0 0 15px 0' }}>🚨 Items que Necesitan Atención</h3>
              {itemsAtencion.length === 0 ? (
                <div style={{ color: '#bbb', padding: '20px', textAlign: 'center' }}>
                  ✓ Todo está en orden. No hay items pendientes.
                </div>
              ) : (
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {itemsAtencion.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '12px',
                        background: item.estado === 'revisar' ? '#452a03' : '#3a2a4a',
                        borderLeft: `4px solid ${item.estado === 'revisar' ? '#f59e0b' : '#8b5cf6'}`,
                        marginBottom: '10px',
                        borderRadius: 4,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>{item.titulo}</div>
                          <div style={{ fontSize: '12px', color: '#bbb', marginBottom: '3px' }}>
                            {fmtDate(item.fecha)} • {item.detalle}
                          </div>
                        </div>
                        <span
                          style={{
                            background: item.estado === 'revisar' ? '#f59e0b' : '#8b5cf6',
                            color: '#000',
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: '11px',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.estado === 'revisar' ? '⚠ REVISAR' : '◆ REVISIÓN'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
