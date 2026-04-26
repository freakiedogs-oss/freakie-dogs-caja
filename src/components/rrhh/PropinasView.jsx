import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

// ─── Paleta ────────────────────────────────────────────────────────────────
const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#16a34a',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa',
  purple: '#a78bfa', border: '#333', text: '#f0f0f0',
  textDim: '#888', textOff: '#555', teal: '#2dd4bf',
};
const card  = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 16, marginBottom: 12 };
const btn   = (bg, fg = '#fff') => ({ padding: '8px 16px', borderRadius: 8, background: bg, color: fg, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 });
const input = { background: c.input, border: `1px solid ${c.border}`, borderRadius: 8, padding: '8px 12px', color: c.text, fontSize: 13 };

// ─── Helpers ───────────────────────────────────────────────────────────────
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function mesLabel(mes) {   // 'YYYY-MM' → 'Marzo 2026'
  if (!mes) return '';
  const [y, m] = mes.split('-');
  return `${MESES[parseInt(m, 10) - 1]} ${y}`;
}

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mesAnterior(mes) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function calcMontoPorPersona(total, numGana) {
  // fórmula: total × 90% ÷ (empleados_que_ganan + 1 producción)
  if (!total || numGana <= 0) return 0;
  return (total * 0.9) / (numGana + 1);
}

// ─── SUCURSALES CON PROPINAS ───────────────────────────────────────────────
const SUCKS_PROPINA = ['M001', 'S003', 'S004'];

// Roles que pueden aprobar (admin/ejecutivo/rrhh/superadmin)
function puedeAprobar(rol) {
  return ['admin', 'ejecutivo', 'rrhh', 'superadmin'].includes(rol);
}

// Roles que ven menú Evaluar de su propia sucursal
function puedeEvaluar(rol) {
  return ['gerente', 'admin', 'ejecutivo', 'rrhh', 'superadmin'].includes(rol);
}

// ═══════════════════════════════════════════════════════════════════════════
export default function PropinasView({ user }) {
  const [tab, setTab] = useState('resumen');

  // ── shared state ──
  const [sucursales, setSucursales]   = useState([]);
  const [loadingInit, setLoadingInit] = useState(true);

  // ── tab Resumen ──
  const [mesResumen, setMesResumen]   = useState(mesAnterior(mesActual()));
  const [kpis, setKpis]               = useState([]); // [{sucursal, store_code, total, dias}]

  // ── tab Evaluar ──
  const [mesEval, setMesEval]         = useState(mesAnterior(mesActual()));
  const [storeEval, setStoreEval]     = useState('');
  const [empleados, setEmpleados]     = useState([]);
  const [evaluacion, setEvaluacion]   = useState(null); // propina_evaluacion_mensual row
  const [detalles, setDetalles]       = useState({});   // { emp_id: { gano: bool, motivo: '' } }
  const [saving, setSaving]           = useState(false);
  const [msgEval, setMsgEval]         = useState('');
  const [loadingEval, setLoadingEval] = useState(false);

  // ── tab Historial ──
  const [historial, setHistorial]     = useState([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [expandedId, setExpandedId]   = useState(null);
  const [expandDetalles, setExpandDetalles] = useState({});

  // ─── Init: sucursales con propina ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      const { data } = await db.from('sucursales')
        .select('id, nombre, store_code')
        .eq('tiene_propina', true)
        .order('store_code');
      setSucursales(data || []);
      // default store para gerente
      if (user?.rol === 'gerente') {
        setStoreEval(user.store_code || '');
      } else {
        setStoreEval(data?.[0]?.store_code || '');
      }
      setLoadingInit(false);
    })();
  }, [user]);

  // ─── Cargar KPIs de Resumen ────────────────────────────────────────────
  const loadResumen = useCallback(async () => {
    if (!mesResumen) return;
    const [y, m] = mesResumen.split('-').map(Number);
    const inicio = `${y}-${String(m).padStart(2,'0')}-01`;
    const fin    = new Date(y, m, 0).toISOString().split('T')[0]; // último día del mes

    const { data } = await db
      .from('propinas_diarias')
      .select('sucursal_id, propina_total, fecha, sucursales(nombre, store_code)')
      .gte('fecha', inicio).lte('fecha', fin);

    // Agrupar por sucursal
    const map = {};
    (data || []).forEach(r => {
      const sc = r.sucursales?.store_code;
      if (!sc || !SUCKS_PROPINA.includes(sc)) return;
      if (!map[sc]) map[sc] = { nombre: r.sucursales.nombre, store_code: sc, total: 0, dias: 0 };
      map[sc].total += parseFloat(r.propina_total || 0);
      map[sc].dias++;
    });
    setKpis(Object.values(map).sort((a,b) => a.store_code < b.store_code ? -1 : 1));
  }, [mesResumen]);

  useEffect(() => { if (tab === 'resumen') loadResumen(); }, [tab, loadResumen]);

  // ─── Cargar Evaluar ────────────────────────────────────────────────────
  const loadEvaluar = useCallback(async () => {
    if (!mesEval || !storeEval) return;
    setLoadingEval(true);
    setMsgEval('');

    const sucursal = sucursales.find(s => s.store_code === storeEval);
    if (!sucursal) { setLoadingEval(false); return; }

    // Empleados activos de esa sucursal
    const { data: emps } = await db
      .from('usuarios_erp')
      .select('id, nombre, apellido, rol')
      .eq('store_code', storeEval)
      .eq('activo', true)
      .not('rol', 'in', '("ejecutivo","admin","superadmin","tablet")')
      .order('nombre');
    setEmpleados(emps || []);

    // Propina total del mes para esa sucursal
    const [y, m] = mesEval.split('-').map(Number);
    const inicio = `${y}-${String(m).padStart(2,'0')}-01`;
    const fin    = new Date(y, m, 0).toISOString().split('T')[0];
    const { data: pd } = await db
      .from('propinas_diarias')
      .select('propina_total')
      .eq('sucursal_id', sucursal.id)
      .gte('fecha', inicio).lte('fecha', fin);
    const totalMes = (pd || []).reduce((s, r) => s + parseFloat(r.propina_total || 0), 0);

    // Evaluación existente para ese mes + sucursal
    const { data: eval_ } = await db
      .from('propina_evaluacion_mensual')
      .select('*')
      .eq('mes', mesEval)
      .eq('sucursal_id', sucursal.id)
      .maybeSingle();

    if (eval_) {
      setEvaluacion({ ...eval_, propina_total_mes: totalMes });
      // Cargar detalles existentes
      const { data: dets } = await db
        .from('propina_evaluacion_detalle')
        .select('*')
        .eq('evaluacion_id', eval_.id);
      const map = {};
      (dets || []).forEach(d => { map[d.empleado_id] = { gano: d.gano_propina, motivo: d.motivo_perdida || '' }; });
      // Agregar empleados nuevos con default gana=true
      (emps || []).forEach(e => { if (!map[e.id]) map[e.id] = { gano: true, motivo: '' }; });
      setDetalles(map);
    } else {
      // Evaluación nueva — todos ganan por defecto
      setEvaluacion({ id: null, mes: mesEval, sucursal_id: sucursal.id, propina_total_mes: totalMes, estado: 'pendiente' });
      const map = {};
      (emps || []).forEach(e => { map[e.id] = { gano: true, motivo: '' }; });
      setDetalles(map);
    }
    setLoadingEval(false);
  }, [mesEval, storeEval, sucursales]);

  useEffect(() => { if (tab === 'evaluar') loadEvaluar(); }, [tab, loadEvaluar]);

  // ─── Cargar Historial ──────────────────────────────────────────────────
  const loadHistorial = useCallback(async () => {
    setLoadingHist(true);
    let q = db.from('propina_evaluacion_mensual')
      .select('*, sucursales(nombre, store_code)')
      .order('mes', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(36);
    // Gerente solo ve su sucursal
    if (user?.rol === 'gerente') {
      const suc = sucursales.find(s => s.store_code === user.store_code);
      if (suc) q = q.eq('sucursal_id', suc.id);
    }
    const { data } = await q;
    setHistorial(data || []);
    setLoadingHist(false);
  }, [sucursales, user]);

  useEffect(() => { if (tab === 'historial' && sucursales.length) loadHistorial(); }, [tab, loadHistorial, sucursales]);

  // ─── Guardar Evaluación ────────────────────────────────────────────────
  async function guardarEvaluacion() {
    if (!evaluacion) return;
    setSaving(true);
    setMsgEval('');

    const numGana  = Object.values(detalles).filter(d => d.gano).length;
    const monto    = calcMontoPorPersona(evaluacion.propina_total_mes, numGana);
    const sucursal = sucursales.find(s => s.store_code === storeEval);

    let evalId = evaluacion.id;

    if (!evalId) {
      // Crear nueva evaluación
      const { data, error } = await db
        .from('propina_evaluacion_mensual')
        .insert({
          mes: mesEval,
          sucursal_id: sucursal.id,
          propina_total_mes: evaluacion.propina_total_mes,
          pct_reparto: 90,
          num_beneficiarios: numGana,
          evaluada_por: user?.id || null,
          fecha_evaluacion: new Date().toISOString().split('T')[0],
          estado: 'pendiente',
        })
        .select('id')
        .single();
      if (error) { setMsgEval('❌ Error al crear evaluación: ' + error.message); setSaving(false); return; }
      evalId = data.id;
    } else {
      // Actualizar cabecera
      const { error } = await db
        .from('propina_evaluacion_mensual')
        .update({ num_beneficiarios: numGana, pct_reparto: 90, evaluada_por: user?.id || null, fecha_evaluacion: new Date().toISOString().split('T')[0] })
        .eq('id', evalId);
      if (error) { setMsgEval('❌ Error al actualizar evaluación: ' + error.message); setSaving(false); return; }
    }

    // Upsert detalles
    const rows = Object.entries(detalles).map(([emp_id, d]) => ({
      evaluacion_id: evalId,
      empleado_id:   emp_id,
      gano_propina:  d.gano,
      motivo_perdida: d.gano ? null : (d.motivo || 'Sin motivo'),
      monto_asignado: d.gano ? monto : 0,
      es_produccion:  false,
    }));

    // Borrar detalles anteriores y reinsertar (evita conflictos)
    await db.from('propina_evaluacion_detalle').delete().eq('evaluacion_id', evalId);
    const { error: e2 } = await db.from('propina_evaluacion_detalle').insert(rows);
    if (e2) { setMsgEval('❌ Error al guardar detalles: ' + e2.message); setSaving(false); return; }

    setMsgEval('✅ Evaluación guardada correctamente');
    setEvaluacion(ev => ({ ...ev, id: evalId, num_beneficiarios: numGana }));
    setSaving(false);
  }

  // ─── Aprobar evaluación ────────────────────────────────────────────────
  async function aprobarEvaluacion(id) {
    const { error } = await db
      .from('propina_evaluacion_mensual')
      .update({ estado: 'aprobada' })
      .eq('id', id);
    if (!error) loadHistorial();
  }

  // ─── Expandir detalles en historial ───────────────────────────────────
  async function toggleExpand(evalRow) {
    if (expandedId === evalRow.id) { setExpandedId(null); return; }
    setExpandedId(evalRow.id);
    if (expandDetalles[evalRow.id]) return;
    const { data } = await db
      .from('propina_evaluacion_detalle')
      .select('*, usuarios_erp(nombre, apellido, rol)')
      .eq('evaluacion_id', evalRow.id)
      .order('gano_propina', { ascending: false });
    setExpandDetalles(prev => ({ ...prev, [evalRow.id]: data || [] }));
  }

  // ─── Meses disponibles para selector ──────────────────────────────────
  function mesesDisponibles(n = 12) {
    const lista = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return lista;
  }

  // ─── Cálculo preview ──────────────────────────────────────────────────
  const numGanaPreview  = Object.values(detalles).filter(d => d.gano).length;
  const montoPreview    = calcMontoPorPersona(evaluacion?.propina_total_mes || 0, numGanaPreview);
  const totalDistribuir = (evaluacion?.propina_total_mes || 0) * 0.9;

  // ─── Sucursales que el usuario puede evaluar ──────────────────────────
  const sucEvaluables = user?.rol === 'gerente'
    ? sucursales.filter(s => s.store_code === user.store_code)
    : sucursales;

  // ─── RENDER ───────────────────────────────────────────────────────────
  if (loadingInit) return (
    <div style={{ textAlign: 'center', padding: 60, color: c.textDim }}>Cargando…</div>
  );

  const TABS = [
    { key: 'resumen',  label: '📊 Resumen'  },
    ...(puedeEvaluar(user?.rol) ? [{ key: 'evaluar', label: '✅ Evaluar' }] : []),
    { key: 'historial', label: '📋 Historial' },
  ];

  return (
    <div style={{ background: c.bg, minHeight: '100vh', padding: 16, fontFamily: 'system-ui, sans-serif', color: c.text }}>
      {/* Encabezado */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>💰 Propinas Mensuales</h2>
        <p style={{ margin: '4px 0 0', color: c.textDim, fontSize: 13 }}>
          Evaluación y distribución — 3 sucursales · Reparto 90%
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: `1px solid ${c.border}`, paddingBottom: 8 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            ...btn(tab === t.key ? c.red : c.card, tab === t.key ? '#fff' : c.textDim),
            border: `1px solid ${tab === t.key ? c.red : c.border}`,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ══ TAB RESUMEN ══════════════════════════════════════════════════════ */}
      {tab === 'resumen' && (
        <div>
          {/* Selector mes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <label style={{ color: c.textDim, fontSize: 13 }}>Mes:</label>
            <select value={mesResumen} onChange={e => setMesResumen(e.target.value)} style={input}>
              {mesesDisponibles(18).map(m => (
                <option key={m} value={m}>{mesLabel(m)}</option>
              ))}
            </select>
          </div>

          {/* KPI cards */}
          {kpis.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', color: c.textDim, padding: 40 }}>
              Sin datos de propinas para {mesLabel(mesResumen)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 20 }}>
              {kpis.map(k => {
                const reparto = k.total * 0.9;
                return (
                  <div key={k.store_code} style={{ ...card, borderTop: `3px solid ${c.teal}` }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{k.nombre}</div>
                    <div style={{ color: c.textDim, fontSize: 12, marginBottom: 12 }}>{k.store_code} · {k.dias} días</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: c.teal }}>${k.total.toFixed(2)}</div>
                    <div style={{ color: c.textDim, fontSize: 12, marginTop: 2 }}>Total propina recaudada</div>
                    <div style={{ marginTop: 12, padding: '8px 12px', background: '#0d2d2a', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: c.textDim }}>A distribuir (90%)</span>
                        <span style={{ color: c.green, fontWeight: 700 }}>${reparto.toFixed(2)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                        <span style={{ color: c.textDim }}>Empresa (10%)</span>
                        <span style={{ color: c.textDim }}>${(k.total * 0.1).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Total consolidado */}
          {kpis.length > 0 && (
            <div style={{ ...card, borderTop: `3px solid ${c.yellow}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Total consolidado — {mesLabel(mesResumen)}</div>
                <div style={{ color: c.textDim, fontSize: 12 }}>3 sucursales</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c.yellow }}>
                  ${kpis.reduce((s, k) => s + k.total, 0).toFixed(2)}
                </div>
                <div style={{ color: c.green, fontSize: 13 }}>
                  ${kpis.reduce((s, k) => s + k.total * 0.9, 0).toFixed(2)} a distribuir
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB EVALUAR ══════════════════════════════════════════════════════ */}
      {tab === 'evaluar' && (
        <div>
          {/* Selectores mes + sucursal */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
            <select value={mesEval} onChange={e => setMesEval(e.target.value)} style={input}>
              {mesesDisponibles(12).map(m => (
                <option key={m} value={m}>{mesLabel(m)}</option>
              ))}
            </select>
            {user?.rol !== 'gerente' && (
              <select value={storeEval} onChange={e => setStoreEval(e.target.value)} style={input}>
                {sucEvaluables.map(s => (
                  <option key={s.store_code} value={s.store_code}>{s.nombre}</option>
                ))}
              </select>
            )}
            <button onClick={loadEvaluar} style={btn(c.blue)}>Cargar</button>
          </div>

          {loadingEval && <div style={{ color: c.textDim, padding: 20 }}>Cargando…</div>}

          {!loadingEval && evaluacion && (
            <>
              {/* Panel de totales */}
              <div style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap', borderTop: `3px solid ${c.teal}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: c.textDim, fontSize: 12, marginBottom: 2 }}>Propina del mes</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c.teal }}>${(evaluacion.propina_total_mes || 0).toFixed(2)}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: c.textDim, fontSize: 12, marginBottom: 2 }}>A distribuir (90%)</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c.green }}>${totalDistribuir.toFixed(2)}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: c.textDim, fontSize: 12, marginBottom: 2 }}>Beneficiarios</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c.yellow }}>{numGanaPreview}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: c.textDim, fontSize: 12, marginBottom: 2 }}>Por persona</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: c.orange }}>${montoPreview.toFixed(2)}</div>
                  <div style={{ color: c.textDim, fontSize: 11 }}>÷ ({numGanaPreview} + 1 prod.)</div>
                </div>
              </div>

              {/* Estado evaluación */}
              {evaluacion.id && (
                <div style={{ marginBottom: 12, padding: '8px 12px', background: evaluacion.estado === 'aprobada' ? '#0d2d1a' : '#1a1a0d',
                  borderRadius: 8, border: `1px solid ${evaluacion.estado === 'aprobada' ? c.green : c.yellow}`, fontSize: 13 }}>
                  Estado: <strong style={{ color: evaluacion.estado === 'aprobada' ? c.green : c.yellow }}>
                    {evaluacion.estado === 'aprobada' ? '✅ Aprobada' : '⏳ Pendiente de aprobación'}
                  </strong>
                </div>
              )}

              {/* Lista empleados */}
              <div style={{ marginBottom: 12, color: c.textDim, fontSize: 12 }}>
                {empleados.length} empleados · Marca ❌ para descontar propina (motivo obligatorio)
              </div>

              {empleados.map(emp => {
                const d = detalles[emp.id] || { gano: true, motivo: '' };
                return (
                  <div key={emp.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8,
                    borderLeft: `3px solid ${d.gano ? c.green : c.red}`,
                    opacity: evaluacion.estado === 'aprobada' ? 0.7 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* Avatar */}
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: d.gano ? c.greenDark : '#5c1a1a',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                        {emp.nombre[0]}
                      </div>
                      {/* Nombre + rol */}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{emp.nombre} {emp.apellido}</div>
                        <div style={{ color: c.textDim, fontSize: 12, textTransform: 'capitalize' }}>{emp.rol}</div>
                      </div>
                      {/* Toggle ✅/❌ */}
                      {evaluacion.estado !== 'aprobada' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => setDetalles(prev => ({ ...prev, [emp.id]: { ...d, gano: true } }))}
                            style={{ ...btn(d.gano ? c.greenDark : c.card, d.gano ? c.green : c.textDim),
                              border: `1px solid ${d.gano ? c.green : c.border}`, fontSize: 18, padding: '4px 10px' }}>
                            ✅
                          </button>
                          <button onClick={() => setDetalles(prev => ({ ...prev, [emp.id]: { ...d, gano: false } }))}
                            style={{ ...btn(!d.gano ? '#5c1a1a' : c.card, !d.gano ? c.red : c.textDim),
                              border: `1px solid ${!d.gano ? c.red : c.border}`, fontSize: 18, padding: '4px 10px' }}>
                            ❌
                          </button>
                        </div>
                      )}
                      {/* Monto si gana */}
                      {d.gano && (
                        <div style={{ color: c.green, fontWeight: 700, fontSize: 14, minWidth: 64, textAlign: 'right' }}>
                          ${montoPreview.toFixed(2)}
                        </div>
                      )}
                      {!d.gano && (
                        <div style={{ color: c.red, fontWeight: 700, fontSize: 14, minWidth: 64, textAlign: 'right' }}>
                          $0.00
                        </div>
                      )}
                    </div>
                    {/* Motivo si perdió */}
                    {!d.gano && evaluacion.estado !== 'aprobada' && (
                      <input
                        placeholder="Motivo (obligatorio)…"
                        value={d.motivo}
                        onChange={e => setDetalles(prev => ({ ...prev, [emp.id]: { ...d, motivo: e.target.value } }))}
                        style={{ ...input, width: '100%', boxSizing: 'border-box' }}
                      />
                    )}
                    {!d.gano && evaluacion.estado === 'aprobada' && d.motivo && (
                      <div style={{ color: c.textDim, fontSize: 12 }}>Motivo: {d.motivo}</div>
                    )}
                  </div>
                );
              })}

              {/* Mensaje feedback */}
              {msgEval && (
                <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                  background: msgEval.startsWith('✅') ? '#0d2d1a' : '#2d0d0d',
                  color: msgEval.startsWith('✅') ? c.green : c.red, fontSize: 13 }}>
                  {msgEval}
                </div>
              )}

              {/* Botones acción */}
              {evaluacion.estado !== 'aprobada' && (
                <button onClick={guardarEvaluacion} disabled={saving}
                  style={{ ...btn(c.red), width: '100%', padding: 14, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                  {saving ? 'Guardando…' : '💾 Guardar Evaluación'}
                </button>
              )}
              {puedeAprobar(user?.rol) && evaluacion.id && evaluacion.estado !== 'aprobada' && (
                <button onClick={() => aprobarEvaluacion(evaluacion.id)}
                  style={{ ...btn(c.greenDark, c.green), width: '100%', padding: 12, fontSize: 14, fontWeight: 700 }}>
                  ✅ Aprobar y Pasar a Planilla
                </button>
              )}

              {evaluacion.estado === 'aprobada' && (
                <div style={{ textAlign: 'center', color: c.green, fontWeight: 700, fontSize: 15, padding: 16 }}>
                  ✅ Evaluación aprobada — montos integrados en planilla
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══ TAB HISTORIAL ════════════════════════════════════════════════════ */}
      {tab === 'historial' && (
        <div>
          {loadingHist && <div style={{ color: c.textDim, padding: 20 }}>Cargando…</div>}

          {!loadingHist && historial.length === 0 && (
            <div style={{ ...card, textAlign: 'center', color: c.textDim, padding: 40 }}>
              Todavía no hay evaluaciones guardadas
            </div>
          )}

          {!loadingHist && historial.map(ev => {
            const expanded = expandedId === ev.id;
            const dets = expandDetalles[ev.id] || [];
            const esAprobada = ev.estado === 'aprobada';
            const monto = calcMontoPorPersona(ev.propina_total_mes, ev.num_beneficiarios || 0);
            return (
              <div key={ev.id} style={{ ...card, borderTop: `3px solid ${esAprobada ? c.green : c.yellow}` }}>
                {/* Cabecera */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{mesLabel(ev.mes)}</div>
                    <div style={{ color: c.textDim, fontSize: 12 }}>{ev.sucursales?.nombre} · {ev.sucursales?.store_code}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: esAprobada ? c.green : c.yellow,
                      background: esAprobada ? '#0d2d1a' : '#1a1a0d', padding: '2px 8px', borderRadius: 20 }}>
                      {esAprobada ? '✅ Aprobada' : '⏳ Pendiente'}
                    </span>
                    <div style={{ color: c.teal, fontWeight: 700, fontSize: 16 }}>${(ev.propina_total_mes || 0).toFixed(2)}</div>
                  </div>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
                  <span><span style={{ color: c.textDim }}>Beneficiarios: </span><strong>{ev.num_beneficiarios || 0}</strong></span>
                  <span><span style={{ color: c.textDim }}>Por persona: </span><strong style={{ color: c.green }}>${monto.toFixed(2)}</strong></span>
                  <span><span style={{ color: c.textDim }}>A distribuir: </span><strong>${((ev.propina_total_mes || 0) * 0.9).toFixed(2)}</strong></span>
                  {ev.fecha_evaluacion && (
                    <span><span style={{ color: c.textDim }}>Evaluada: </span>{ev.fecha_evaluacion}</span>
                  )}
                </div>

                {/* Botones */}
                <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => toggleExpand(ev)} style={btn(c.card, c.blue)}>
                    {expanded ? '▲ Ocultar detalle' : '▼ Ver empleados'}
                  </button>
                  {puedeAprobar(user?.rol) && !esAprobada && (
                    <button onClick={() => aprobarEvaluacion(ev.id)} style={btn(c.greenDark, c.green)}>
                      ✅ Aprobar
                    </button>
                  )}
                </div>

                {/* Detalle expandible */}
                {expanded && (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${c.border}`, paddingTop: 12 }}>
                    {dets.length === 0
                      ? <div style={{ color: c.textDim, fontSize: 13 }}>Sin detalles cargados</div>
                      : dets.map(d => (
                          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '6px 0', borderBottom: `1px solid ${c.cardBorder}`, fontSize: 13 }}>
                            <div>
                              <span style={{ color: d.gano_propina ? c.text : c.textDim }}>
                                {d.usuarios_erp ? `${d.usuarios_erp.nombre} ${d.usuarios_erp.apellido}` : '—'}
                              </span>
                              {!d.gano_propina && d.motivo_perdida && (
                                <span style={{ color: c.textDim, fontSize: 11, marginLeft: 8 }}>({d.motivo_perdida})</span>
                              )}
                            </div>
                            <div style={{ fontWeight: 700, color: d.gano_propina ? c.green : c.red }}>
                              {d.gano_propina ? `$${(d.monto_asignado || 0).toFixed(2)}` : '$0.00'}
                            </div>
                          </div>
                        ))
                    }
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
