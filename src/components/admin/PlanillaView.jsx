import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '../../supabase';
import { n, fmtDate } from '../../config';
import { useToast } from '../../hooks/useToast';

// PINs ejecutivos: Jose=1000, Cesar=2000, Maria Jose=7700 (RRHH)
const EDIT_PINS = ['1000', '2000', '7700'];
const ALLOWED_ROLES = ['ejecutivo', 'rrhh', 'contador', 'admin'];

const fmt$ = (val) => {
  const num = n(val);
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const ESTADO_ASIST = {
  presente:            { emoji: '✅', label: 'Presente',    color: '#4ade80' },
  ausente:             { emoji: '❌', label: 'Ausente',     color: '#e63946' },
  ausente_justificado: { emoji: '🟡', label: 'Justificado', color: '#f59e0b' },
  vacaciones:          { emoji: '🏖️', label: 'Vacaciones',  color: '#3b82f6' },
  incapacidad:         { emoji: '🏥', label: 'Incapacidad', color: '#a855f7' },
};
const ESTADOS_CYCLE = ['presente', 'ausente', 'ausente_justificado', 'vacaciones', 'incapacidad'];

const EstadoBadge = ({ estado }) => {
  const map = {
    borrador:  { bg: '#f59e0b', label: 'Borrador' },
    calculada: { bg: '#3b82f6', label: 'Calculada' },
    aprobada:  { bg: '#2d6a4f', label: 'Aprobada' },
    pagada:    { bg: '#4ade80', label: 'Pagada' },
  };
  const s = map[estado] || { bg: '#666', label: estado };
  return (
    <span style={{ background: s.bg, color: '#fff', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
};

// ── Celda de asistencia clickeable ──
const AsistCell = ({ estado, onClick, editable }) => {
  const info = ESTADO_ASIST[estado] || ESTADO_ASIST.presente;
  return (
    <td
      onClick={editable ? onClick : undefined}
      title={info.label}
      style={{
        ...td, textAlign: 'center', fontSize: 14, cursor: editable ? 'pointer' : 'default',
        padding: '2px 1px', userSelect: 'none', minWidth: 28,
      }}
    >
      {info.emoji}
    </td>
  );
};

export default function PlanillaView({ user }) {
  const { show } = useToast();
  const [planillas, setPlanillas] = useState([]);
  const [detalles, setDetalles] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNewPlanilla, setShowNewPlanilla] = useState(false);
  const [newPeriodo, setNewPeriodo] = useState('1ra-quincena');
  const [newMesAno, setNewMesAno] = useState(new Date().toISOString().split('T')[0].slice(0, 7));
  const [showPINModal, setShowPINModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinAction, setPinAction] = useState(null);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);

  // Asistencia state
  const [tab, setTab] = useState('nomina'); // 'nomina' | 'asistencia'
  const [asistencia, setAsistencia] = useState([]); // raw records
  const [asistEdits, setAsistEdits] = useState({}); // {recordId: newEstado}
  const [sucFiltro, setSucFiltro] = useState('todas');
  const [loadingAsist, setLoadingAsist] = useState(false);
  const [savingAsist, setSavingAsist] = useState(false);

  const canView = ALLOWED_ROLES.includes(user?.rol);
  const canApprove = EDIT_PINS.includes(user?.pin);
  const canEditAsist = ['ejecutivo', 'rrhh', 'admin'].includes(user?.rol);

  // ── Cargar datos base ──
  const cargarPlanillas = useCallback(async () => {
    setLoading(true);
    const res = await db.from('planillas').select('*').order('fecha_inicio', { ascending: false });
    setPlanillas(res.data || []);
    setLoading(false);
  }, []);

  const cargarEmpleados = useCallback(async () => {
    const res = await db.from('empleados').select('id, nombre_completo, cargo, sucursal_id, salario_mensual, activo')
      .eq('activo', true).order('nombre_completo');
    setEmpleados(res.data || []);
  }, []);

  const cargarSucursales = useCallback(async () => {
    const res = await db.from('sucursales').select('id, nombre, store_code').order('nombre');
    setSucursales(res.data || []);
  }, []);

  useEffect(() => {
    cargarPlanillas();
    cargarEmpleados();
    cargarSucursales();
  }, [cargarPlanillas, cargarEmpleados, cargarSucursales]);

  // ── Mapa de sucursales ──
  const sucMap = useMemo(() => {
    const m = {};
    sucursales.forEach(s => { m[s.id] = s.nombre; });
    return m;
  }, [sucursales]);

  // Casa Matriz ID
  const casaMatrizId = useMemo(() => {
    const cm = sucursales.find(s => s.store_code === 'CM001');
    return cm?.id || null;
  }, [sucursales]);

  // ── Crear planilla ──
  const crearPlanilla = async () => {
    if (!newMesAno) { show('Selecciona mes/año'); return; }
    const [year, month] = newMesAno.split('-');
    const isFirst = newPeriodo === '1ra-quincena';
    const inicio = isFirst ? `${year}-${month}-01` : `${year}-${month}-16`;
    const diasEnMes = new Date(year, month, 0).getDate();
    const fin = isFirst ? `${year}-${month}-15` : `${year}-${month}-${diasEnMes}`;
    const periodo = `${newPeriodo} ${month}/${year}`;

    setSaving(true);
    try {
      const { error } = await db.from('planillas').insert({
        periodo, fecha_inicio: inicio, fecha_fin: fin, fecha_pago: fin,
        estado: 'borrador', total_bruto: 0, total_descuentos: 0, total_neto: 0, total_patronal: 0,
        calculada_por: user.id,
      }).select().single();
      if (error) throw error;
      show('✓ Planilla creada');
      setShowNewPlanilla(false);
      await cargarPlanillas();
    } catch (err) {
      console.error(err);
      show('Error al crear planilla');
    } finally { setSaving(false); }
  };

  // ── Calcular planilla con RPC único ──
  const calcularPlanilla = async () => {
    if (!selected) return;
    setCalculating(true);
    try {
      const { data, error } = await db.rpc('calcular_nomina_completa', {
        p_planilla_id: selected.id,
      });
      if (error) throw error;
      show(`✓ Planilla calculada — ${data?.empleados_procesados || '?'} empleados`);
      await cargarPlanillas();
      await abrirDetalle({ ...selected, estado: 'calculada' });
    } catch (err) {
      console.error(err);
      show('Error al calcular: ' + (err.message || err));
    } finally { setCalculating(false); }
  };

  // ── Cargar detalle ──
  const abrirDetalle = async (planilla) => {
    setSelected(planilla);
    setTab('nomina');
    setAsistEdits({});
    const res = await db.from('planilla_detalle')
      .select('*, empleados(id, nombre_completo, cargo, sucursal_id)')
      .eq('planilla_id', planilla.id)
      .order('empleados(nombre_completo)');
    setDetalles(res.data || []);
  };

  // ── Cargar asistencia para el período ──
  const cargarAsistencia = useCallback(async () => {
    if (!selected) return;
    setLoadingAsist(true);
    const res = await db.from('asistencia_diaria')
      .select('id, fecha, empleado_id, sucursal_id, estado')
      .gte('fecha', selected.fecha_inicio)
      .lte('fecha', selected.fecha_fin)
      .order('fecha');
    setAsistencia(res.data || []);
    setAsistEdits({});
    setLoadingAsist(false);
  }, [selected]);

  useEffect(() => {
    if (tab === 'asistencia' && selected) cargarAsistencia();
  }, [tab, selected, cargarAsistencia]);

  // ── Asistencia por sucursal ──
  const asistData = useMemo(() => {
    if (!selected || asistencia.length === 0) return { dates: [], byStore: {} };

    // Fechas del período
    const dates = [];
    const d = new Date(selected.fecha_inicio + 'T12:00:00');
    const end = new Date(selected.fecha_fin + 'T12:00:00');
    while (d <= end) {
      dates.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 1);
    }

    // Index de asistencia: { empId-fecha: record }
    const idx = {};
    asistencia.forEach(a => { idx[`${a.empleado_id}-${a.fecha}`] = a; });

    // Agrupar empleados por sucursal
    const byStore = {};
    empleados.forEach(emp => {
      const sid = emp.sucursal_id || casaMatrizId;
      if (!byStore[sid]) byStore[sid] = [];
      byStore[sid].push(emp);
    });

    return { dates, byStore, idx };
  }, [selected, asistencia, empleados, casaMatrizId]);

  // ── Click en celda de asistencia (cycle estados) ──
  const toggleEstado = (recordId, currentEstado) => {
    const resolved = asistEdits[recordId] || currentEstado;
    const i = ESTADOS_CYCLE.indexOf(resolved);
    const next = ESTADOS_CYCLE[(i + 1) % ESTADOS_CYCLE.length];
    setAsistEdits(prev => ({ ...prev, [recordId]: next }));
  };

  // Contar ediciones pendientes
  const pendingEdits = Object.keys(asistEdits).length;

  // ── Guardar ediciones de asistencia ──
  const guardarAsistencia = async () => {
    if (pendingEdits === 0) return;
    setSavingAsist(true);
    try {
      let ok = 0;
      for (const [recId, newEstado] of Object.entries(asistEdits)) {
        const { error } = await db.from('asistencia_diaria').update({ estado: newEstado }).eq('id', recId);
        if (!error) ok++;
      }
      show(`✓ ${ok} registros actualizados`);
      setAsistEdits({});
      await cargarAsistencia();
    } catch (err) {
      console.error(err);
      show('Error guardando asistencia');
    } finally { setSavingAsist(false); }
  };

  // ── Resumen de ausencias por sucursal ──
  const resumenAusencias = useMemo(() => {
    const all = asistencia.map(a => ({ ...a, estado: asistEdits[a.id] || a.estado }));
    const aus = all.filter(a => a.estado !== 'presente');
    const bySuc = {};
    aus.forEach(a => {
      const sn = sucMap[a.sucursal_id] || 'Sin asignar';
      if (!bySuc[sn]) bySuc[sn] = 0;
      bySuc[sn]++;
    });
    return { total: aus.length, bySuc };
  }, [asistencia, asistEdits, sucMap]);

  // ── PIN modal ──
  const solicitarPIN = (accion) => { setPinAction(accion); setPinInput(''); setShowPINModal(true); };

  const procesarAccion = async () => {
    if (!EDIT_PINS.includes(pinInput)) { show('PIN incorrecto'); return; }
    if (!selected) return;
    setSaving(true);
    try {
      const updates = pinAction === 'aprobar'
        ? { estado: 'aprobada', aprobada_por: user.id }
        : { estado: 'pagada' };
      await db.from('planillas').update(updates).eq('id', selected.id);
      show(`✓ Planilla ${pinAction === 'aprobar' ? 'aprobada' : 'pagada'}`);
      setShowPINModal(false); setPinInput('');
      await cargarPlanillas();
      setSelected(null);
    } catch (err) { console.error(err); show('Error'); }
    finally { setSaving(false); }
  };

  // ── Guards ──
  if (!canView) return <div style={{ padding: 20, color: '#e63946' }}>No tienes acceso a nómina</div>;
  if (loading) return <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>Cargando planillas...</div>;

  // ════════════════════════════════════════════
  //  LISTA DE PLANILLAS
  // ════════════════════════════════════════════
  if (!selected) {
    return (
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>💼 Nómina</h2>
          <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setShowNewPlanilla(true)}>+ Nueva Corrida</button>
        </div>

        {/* Modal nueva planilla */}
        {showNewPlanilla && (
          <div className="modal-bg" onClick={() => setShowNewPlanilla(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 20 }}>
              <h3 style={{ margin: '0 0 12px', color: '#fff' }}>Nueva Corrida de Nómina</h3>
              <label style={lbl}>Período</label>
              <select style={inp} value={newPeriodo} onChange={e => setNewPeriodo(e.target.value)}>
                <option value="1ra-quincena">1ra Quincena (1-15)</option>
                <option value="2da-quincena">2da Quincena (16-fin)</option>
              </select>
              <label style={lbl}>Mes/Año</label>
              <input style={inp} type="month" value={newMesAno} onChange={e => setNewMesAno(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={crearPlanilla} disabled={saving}>
                  {saving ? 'Creando...' : 'Crear'}
                </button>
                <button style={{ flex: 1, ...btnSec }} onClick={() => setShowNewPlanilla(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {/* Modal PIN */}
        {showPINModal && (
          <div className="modal-bg" onClick={() => setShowPINModal(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 20, maxWidth: 300 }}>
              <h3 style={{ margin: '0 0 12px', color: '#fff' }}>
                Ingresa PIN {pinAction === 'aprobar' ? '(Aprobación)' : '(Pago)'}
              </h3>
              <input style={inp} type="password" placeholder="PIN" value={pinInput}
                onChange={e => setPinInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && procesarAccion()} />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={procesarAccion} disabled={saving}>Confirmar</button>
                <button style={{ flex: 1, ...btnSec }} onClick={() => setShowPINModal(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}

        {planillas.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay corridas de nómina</div>
        ) : (
          <div>
            {planillas.map(p => (
              <div key={p.id} className="card" onClick={() => abrirDetalle(p)}
                style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>{p.periodo}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {fmtDate(p.fecha_inicio)} — {fmtDate(p.fecha_fin)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <EstadoBadge estado={p.estado} />
                    <div style={{ fontSize: 13, color: '#4ade80', marginTop: 4, fontWeight: 600 }}>{fmt$(p.total_neto)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════
  //  DETALLE DE PLANILLA (tabs: Nómina | Asistencia)
  // ════════════════════════════════════════════
  const det = detalles || [];
  const totalDevengado = det.reduce((s, d) => s + n(d.total_devengado || 0), 0);
  const totalDescuentos = det.reduce((s, d) => s + n(d.total_descuentos || 0), 0);
  const totalNeto = det.reduce((s, d) => s + n(d.neto_a_pagar || 0), 0);
  const totalPatronal = det.reduce((s, d) => s + n(d.patronal_isss || 0) + n(d.patronal_afp || 0) + n(d.patronal_insaforp || 0), 0);

  // Filtrar sucursales para el tab de asistencia
  const sucursalesConEmpleados = sucursales.filter(s => asistData.byStore?.[s.id]?.length > 0);
  const sucFiltered = sucFiltro === 'todas' ? sucursalesConEmpleados : sucursalesConEmpleados.filter(s => s.id === sucFiltro);

  return (
    <div style={{ padding: '16px' }}>
      {/* PIN Modal (reused) */}
      {showPINModal && (
        <div className="modal-bg" onClick={() => setShowPINModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 20, maxWidth: 300 }}>
            <h3 style={{ margin: '0 0 12px', color: '#fff' }}>
              Ingresa PIN {pinAction === 'aprobar' ? '(Aprobación)' : '(Pago)'}
            </h3>
            <input style={inp} type="password" placeholder="PIN" value={pinInput}
              onChange={e => setPinInput(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && procesarAccion()} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={procesarAccion} disabled={saving}>Confirmar</button>
              <button style={{ flex: 1, ...btnSec }} onClick={() => setShowPINModal(false)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Back + Header */}
      <button onClick={() => { setSelected(null); setTab('nomina'); }}
        style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Volver a lista
      </button>

      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>{selected.periodo}</h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              {fmtDate(selected.fecha_inicio)} — {fmtDate(selected.fecha_fin)}
            </div>
            <div style={{ marginTop: 4 }}><EstadoBadge estado={selected.estado} /></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#888' }}>Neto a pagar</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>{fmt$(totalNeto)}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Patronal: {fmt$(totalPatronal)}</div>
          </div>
        </div>

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {selected.estado === 'borrador' && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={calcularPlanilla} disabled={calculating}>
              {calculating ? '⏳ Calculando...' : '🔄 Calcular Nómina'}
            </button>
          )}
          {selected.estado === 'calculada' && canApprove && (
            <>
              <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#2d6a4f' }}
                onClick={() => solicitarPIN('aprobar')}>✓ Aprobar</button>
              <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#f59e0b' }}
                onClick={calcularPlanilla} disabled={calculating}>
                {calculating ? '⏳ Recalculando...' : '🔄 Recalcular'}
              </button>
            </>
          )}
          {selected.estado === 'aprobada' && canApprove && (
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#4ade80', color: '#000' }}
              onClick={() => solicitarPIN('pagar')}>💳 Marcar Pagada</button>
          )}
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
        {[
          { key: 'nomina', label: '💰 Nómina', count: det.length },
          { key: 'asistencia', label: '📋 Asistencia', count: resumenAusencias.total > 0 ? resumenAusencias.total : null },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: tab === t.key ? 700 : 400,
            background: tab === t.key ? '#1a1a2e' : 'transparent',
            color: tab === t.key ? '#fff' : '#888',
            border: 'none', borderBottom: tab === t.key ? '2px solid #e63946' : '2px solid transparent',
            cursor: 'pointer', transition: 'all .15s',
          }}>
            {t.label}
            {t.count != null && (
              <span style={{
                marginLeft: 6, background: t.key === 'asistencia' ? '#e63946' : '#444',
                color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 10,
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════ */}
      {/*  TAB: NÓMINA                                */}
      {/* ════════════════════════════════════════════ */}
      {tab === 'nomina' && (
        <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
          <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 14 }}>
            Detalle por Empleado ({det.length})
          </h3>

          {det.length === 0 ? (
            <div style={{ color: '#666', fontSize: 13 }}>
              Sin cálculos. Presiona "Calcular Nómina" para generar asistencia y calcular todo automáticamente.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #333' }}>
                  <th style={{ ...th, minWidth: 130, position: 'sticky', left: 0, background: '#0f0f23', zIndex: 2 }}>Empleado</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 55 }}>Días</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 55 }}>Falta</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 90 }}>Sal. Base</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 75 }}>Deveng.</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 60 }}>ISSS</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 60 }}>AFP</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 60 }}>ISR</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 60 }}>Adel.</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 60 }}>Otros</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>Desc.</th>
                  <th style={{ ...th, textAlign: 'right', minWidth: 85 }}>Neto</th>
                </tr>
              </thead>
              <tbody>
                {det.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid #222' }}>
                    <td style={{ ...td, position: 'sticky', left: 0, background: '#0f0f23', zIndex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 11 }}>{d.empleados?.nombre_completo || '?'}</div>
                      <div style={{ fontSize: 9, color: '#666' }}>{d.empleados?.cargo || ''}</div>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>{n(d.dias_trabajados)}</td>
                    <td style={{ ...td, textAlign: 'right', color: n(d.dias_ausentes) > 0 ? '#e63946' : '#666' }}>
                      {n(d.dias_ausentes)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(d.salario_base_quincenal)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#fff' }}>{fmt$(d.total_devengado)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_isss)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_afp)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_isr)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_adelantos)}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>
                      {fmt$(n(d.descuento_faltas) + n(d.descuento_tardanzas) + n(d.descuento_prestamos) + n(d.descuento_otros))}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#e63946' }}>{fmt$(d.total_descuentos)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{fmt$(d.neto_a_pagar)}</td>
                  </tr>
                ))}
                {/* Totales */}
                <tr style={{ borderTop: '2px solid #444', background: '#1a1a2e' }}>
                  <td style={{ ...td, fontWeight: 700, color: '#fff', position: 'sticky', left: 0, background: '#1a1a2e', zIndex: 1 }}>
                    TOTALES ({det.length})
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#fff' }}>
                    {Math.round(det.reduce((s, d) => s + n(d.dias_trabajados), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#e63946' }}>
                    {Math.round(det.reduce((s, d) => s + n(d.dias_ausentes), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#fff' }}>
                    {fmt$(det.reduce((s, d) => s + n(d.salario_base_quincenal), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt$(totalDevengado)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>
                    {fmt$(det.reduce((s, d) => s + n(d.descuento_isss), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>
                    {fmt$(det.reduce((s, d) => s + n(d.descuento_afp), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>
                    {fmt$(det.reduce((s, d) => s + n(d.descuento_isr), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>
                    {fmt$(det.reduce((s, d) => s + n(d.descuento_adelantos), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>
                    {fmt$(det.reduce((s, d) => s + n(d.descuento_faltas) + n(d.descuento_tardanzas) + n(d.descuento_prestamos) + n(d.descuento_otros), 0))}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#e63946' }}>{fmt$(totalDescuentos)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{fmt$(totalNeto)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════ */}
      {/*  TAB: ASISTENCIA                            */}
      {/* ════════════════════════════════════════════ */}
      {tab === 'asistencia' && (
        <div>
          {/* Controles */}
          <div className="card" style={{ padding: 12, marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: '#888' }}>Sucursal:</label>
            <select style={{ ...inp, width: 'auto', minWidth: 160 }} value={sucFiltro} onChange={e => setSucFiltro(e.target.value)}>
              <option value="todas">Todas las sucursales</option>
              {sucursalesConEmpleados.map(s => (
                <option key={s.id} value={s.id}>{s.nombre} ({asistData.byStore?.[s.id]?.length || 0})</option>
              ))}
            </select>

            <div style={{ flex: 1 }} />

            {/* Leyenda */}
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#888', flexWrap: 'wrap' }}>
              {ESTADOS_CYCLE.map(e => (
                <span key={e}>{ESTADO_ASIST[e].emoji} {ESTADO_ASIST[e].label}</span>
              ))}
            </div>

            <div style={{ flex: 1 }} />

            {/* Resumen rápido */}
            {resumenAusencias.total > 0 && (
              <div style={{ fontSize: 11, color: '#e63946', fontWeight: 600 }}>
                {resumenAusencias.total} ausencia{resumenAusencias.total !== 1 ? 's' : ''}
              </div>
            )}

            {/* Guardar */}
            {canEditAsist && pendingEdits > 0 && (
              <button className="btn-primary" style={{ fontSize: 11, padding: '5px 12px' }}
                onClick={guardarAsistencia} disabled={savingAsist}>
                {savingAsist ? '⏳ Guardando...' : `💾 Guardar ${pendingEdits} cambio${pendingEdits > 1 ? 's' : ''}`}
              </button>
            )}
          </div>

          {loadingAsist ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>Cargando asistencia...</div>
          ) : asistencia.length === 0 ? (
            <div className="card" style={{ padding: 20, textAlign: 'center', color: '#666' }}>
              No hay registros de asistencia para este período. Presiona "Calcular Nómina" para generarlos automáticamente.
            </div>
          ) : (
            <>
              {sucFiltered.map(suc => {
                const emps = asistData.byStore?.[suc.id] || [];
                if (emps.length === 0) return null;
                const ausCount = emps.reduce((sum, emp) => {
                  return sum + (asistData.dates || []).filter(dt => {
                    const rec = asistData.idx?.[`${emp.id}-${dt}`];
                    if (!rec) return false;
                    const est = asistEdits[rec.id] || rec.estado;
                    return est !== 'presente';
                  }).length;
                }, 0);

                return (
                  <div key={suc.id} className="card" style={{ padding: 12, marginBottom: 10, overflowX: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <h4 style={{ margin: 0, fontSize: 14, color: '#fff' }}>
                        📍 {suc.nombre}
                        <span style={{ fontSize: 11, color: '#888', fontWeight: 400, marginLeft: 8 }}>
                          {emps.length} empleados
                        </span>
                      </h4>
                      {ausCount > 0 && (
                        <span style={{ fontSize: 11, color: '#e63946', fontWeight: 600 }}>
                          {ausCount} ausencia{ausCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #333' }}>
                          <th style={{ ...th, minWidth: 120, position: 'sticky', left: 0, background: '#0f0f23', zIndex: 2 }}>
                            Empleado
                          </th>
                          {(asistData.dates || []).map(dt => (
                            <th key={dt} style={{ ...th, textAlign: 'center', padding: '4px 2px', minWidth: 30, fontSize: 9 }}>
                              {new Date(dt + 'T12:00:00').getDate()}
                            </th>
                          ))}
                          <th style={{ ...th, textAlign: 'center', minWidth: 40 }}>Aus.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {emps.map(emp => {
                          let ausEmp = 0;
                          return (
                            <tr key={emp.id} style={{ borderBottom: '1px solid #1a1a2e' }}>
                              <td style={{
                                ...td, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                                textOverflow: 'ellipsis', maxWidth: 130, position: 'sticky', left: 0,
                                background: '#0f0f23', zIndex: 1,
                              }}>
                                {emp.nombre_completo}
                              </td>
                              {(asistData.dates || []).map(dt => {
                                const rec = asistData.idx?.[`${emp.id}-${dt}`];
                                if (!rec) return <td key={dt} style={{ ...td, textAlign: 'center', color: '#333' }}>·</td>;
                                const est = asistEdits[rec.id] || rec.estado;
                                if (est !== 'presente') ausEmp++;
                                const isEdited = asistEdits[rec.id] != null;
                                return (
                                  <td key={dt}
                                    onClick={canEditAsist ? () => toggleEstado(rec.id, rec.estado) : undefined}
                                    title={`${emp.nombre_completo} — ${dt} — ${ESTADO_ASIST[est]?.label || est}`}
                                    style={{
                                      ...td, textAlign: 'center', fontSize: 13, padding: '2px 1px',
                                      cursor: canEditAsist ? 'pointer' : 'default',
                                      userSelect: 'none',
                                      background: isEdited ? '#2a2a44' : 'transparent',
                                      borderRadius: isEdited ? 4 : 0,
                                    }}
                                  >
                                    {ESTADO_ASIST[est]?.emoji || '?'}
                                  </td>
                                );
                              })}
                              <td style={{
                                ...td, textAlign: 'center', fontWeight: 700, fontSize: 11,
                                color: ausEmp > 0 ? '#e63946' : '#4ade80',
                              }}>
                                {ausEmp}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Estilos ──
const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const btnSec = { padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#333', color: '#fff', fontSize: 13, cursor: 'pointer' };
const th = { padding: '6px 4px', fontSize: 11, color: '#666', textAlign: 'left', fontWeight: 600 };
const td = { padding: '8px 4px', fontSize: 11, color: '#ddd' };
