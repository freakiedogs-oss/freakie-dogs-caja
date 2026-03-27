import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { n, fmtDate } from '../../config';
import { useToast } from '../../hooks/useToast';

// PINs ejecutivos: Jose=1000, Cesar=2000
const EDIT_PINS = ['1000', '2000'];
const ALLOWED_ROLES = ['ejecutivo', 'rrhh', 'contador', 'admin'];

// Formatear moneda USD
const fmt$ = (val) => {
  const num = n(val);
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Badge de estado
const EstadoBadge = ({ estado }) => {
  const map = {
    borrador: { bg: '#f59e0b', label: 'Borrador' },
    calculada: { bg: '#3b82f6', label: 'Calculada' },
    aprobada: { bg: '#2d6a4f', label: 'Aprobada' },
    pagada: { bg: '#4ade80', label: 'Pagada' },
  };
  const s = map[estado] || { bg: '#666', label: estado };
  return (
    <span style={{ background: s.bg, color: '#fff', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
};

export default function PlanillaView({ user }) {
  const { show } = useToast();
  const [planillas, setPlanillas] = useState([]);
  const [detalles, setDetalles] = useState([]);
  const [empleados, setEmpleados] = useState([]);
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

  // Check acceso
  const canView = ALLOWED_ROLES.includes(user?.rol);
  const canApprove = EDIT_PINS.includes(user?.pin);

  // Cargar planillas
  const cargarPlanillas = useCallback(async () => {
    setLoading(true);
    const res = await db.from('planillas').select('*').order('fecha_inicio', { ascending: false });
    setPlanillas(res.data || []);
    setLoading(false);
  }, []);

  // Cargar empleados activos
  const cargarEmpleados = useCallback(async () => {
    const res = await db.from('empleados').select('*').eq('activo', true).order('nombre_completo');
    setEmpleados(res.data || []);
  }, []);

  useEffect(() => {
    cargarPlanillas();
    cargarEmpleados();
  }, [cargarPlanillas, cargarEmpleados]);

  // Crear nueva planilla
  const crearPlanilla = async () => {
    if (!newMesAno) {
      show('Selecciona mes/año');
      return;
    }

    const [year, month] = newMesAno.split('-');
    const isFirst = newPeriodo === '1ra-quincena';
    const inicio = isFirst ? `${year}-${month}-01` : `${year}-${month}-16`;
    const diasEnMes = new Date(year, month, 0).getDate();
    const fin = isFirst ? `${year}-${month}-15` : `${year}-${month}-${diasEnMes}`;
    const periodo = `${newPeriodo} ${month}/${year}`;
    const fecha_pago = fin; // Por defecto

    setSaving(true);
    try {
      // Crear planilla
      const { data: planilla, error: errPlanilla } = await db.from('planillas').insert({
        periodo,
        fecha_inicio: inicio,
        fecha_fin: fin,
        fecha_pago,
        estado: 'borrador',
        total_bruto: 0,
        total_descuentos: 0,
        total_neto: 0,
        total_patronal: 0,
        calculada_por: user.id,
      }).select().single();

      if (errPlanilla) throw errPlanilla;

      show('✓ Planilla creada');
      setNewPeriodo('1ra-quincena');
      setNewMesAno(new Date().toISOString().split('T')[0].slice(0, 7));
      setShowNewPlanilla(false);
      await cargarPlanillas();
    } catch (err) {
      console.error(err);
      show('Error al crear planilla');
    } finally {
      setSaving(false);
    }
  };

  // Calcular detalles para todos los empleados activos
  const calcularPlanilla = async () => {
    if (!selected) return;
    setCalculating(true);
    try {
      // Para cada empleado activo
      const detallesInsert = [];
      for (const emp of empleados) {
        // Llamar RPC calcular_detalle_empleado
        const { data: detalle, error: errCalc } = await db.rpc('calcular_detalle_empleado', {
          p_empleado_id: emp.id,
          p_periodo: selected.periodo,
        });

        if (!errCalc && detalle) {
          detallesInsert.push({
            planilla_id: selected.id,
            empleado_id: emp.id,
            dias_trabajados: detalle.dias_trabajados || 15,
            dias_ausentes: detalle.dias_ausentes || 0,
            dias_justificados: detalle.dias_justificados || 0,
            llegadas_tarde: detalle.llegadas_tarde || 0,
            horas_extra_diurnas: detalle.horas_extra_diurnas || 0,
            horas_extra_nocturnas: detalle.horas_extra_nocturnas || 0,
            salario_base_quincenal: n(emp.salario_mensual) / 2,
            monto_horas_extra: detalle.monto_horas_extra || 0,
            propina_mensual: detalle.propina_mensual || 0,
            bono_delivery: detalle.bono_delivery || 0,
            total_devengado: detalle.total_devengado || (n(emp.salario_mensual) / 2),
            descuento_isss: Math.min(n(emp.salario_mensual), 1000) * 0.03 / 2,
            descuento_afp: n(emp.salario_mensual) * 0.0725 / 2,
            descuento_isr: detalle.descuento_isr || 0,
            descuento_adelantos: detalle.descuento_adelantos || 0,
            descuento_faltas: detalle.descuento_faltas || 0,
            descuento_tardanzas: detalle.descuento_tardanzas || 0,
            descuento_prestamos: detalle.descuento_prestamos || 0,
            descuento_otros: detalle.descuento_otros || 0,
            total_descuentos: detalle.total_descuentos || 0,
            neto_a_pagar: detalle.neto_a_pagar || 0,
            patronal_isss: Math.min(n(emp.salario_mensual), 1000) * 0.075 / 2,
            patronal_afp: n(emp.salario_mensual) * 0.0875 / 2,
            patronal_insaforp: n(emp.salario_mensual) * 0.01 / 2,
          });
        }
      }

      if (detallesInsert.length > 0) {
        // Eliminar detalles existentes
        await db.from('planilla_detalle').delete().eq('planilla_id', selected.id);
        // Insertar nuevos
        const { error: errDet } = await db.from('planilla_detalle').insert(detallesInsert);
        if (errDet) throw errDet;
      }

      // Calcular totales
      const totalDevengado = detallesInsert.reduce((s, d) => s + n(d.total_devengado), 0);
      const totalDesc = detallesInsert.reduce((s, d) => s + n(d.total_descuentos), 0);
      const totalNeto = detallesInsert.reduce((s, d) => s + n(d.neto_a_pagar), 0);
      const totalPatronal = detallesInsert.reduce((s, d) => s + (n(d.patronal_isss) + n(d.patronal_afp) + n(d.patronal_insaforp)), 0);

      // Actualizar planilla
      await db.from('planillas').update({
        estado: 'calculada',
        total_bruto: totalDevengado,
        total_descuentos: totalDesc,
        total_neto: totalNeto,
        total_patronal: totalPatronal,
      }).eq('id', selected.id);

      show('✓ Planilla calculada');
      await cargarPlanillas();
      setSelected({ ...selected, estado: 'calculada', total_bruto: totalDevengado, total_descuentos: totalDesc, total_neto: totalNeto });
      await abrirDetalle({ ...selected, id: selected.id });
    } catch (err) {
      console.error(err);
      show('Error al calcular planilla');
    } finally {
      setCalculating(false);
    }
  };

  // Cargar detalle de una planilla
  const abrirDetalle = async (planilla) => {
    setSelected(planilla);
    const res = await db.from('planilla_detalle')
      .select('*, empleados(id, nombre_completo, cargo)')
      .eq('planilla_id', planilla.id)
      .order('empleados(nombre_completo)');
    setDetalles(res.data || []);
  };

  // Solicitar PIN para aprobar/pagar
  const solicitarPIN = (accion) => {
    setPinAction(accion);
    setPinInput('');
    setShowPINModal(true);
  };

  // Procesar aprobación/pago
  const procesarAccion = async () => {
    if (!EDIT_PINS.includes(pinInput)) {
      show('PIN incorrecto');
      return;
    }

    if (!selected) return;
    setSaving(true);
    try {
      let updates = {};
      if (pinAction === 'aprobar') {
        updates = { estado: 'aprobada', aprobada_por: user.id };
      } else if (pinAction === 'pagar') {
        updates = { estado: 'pagada' };
      }

      await db.from('planillas').update(updates).eq('id', selected.id);
      show(`✓ Planilla ${pinAction === 'aprobar' ? 'aprobada' : 'pagada'}`);
      setShowPINModal(false);
      setPinInput('');
      await cargarPlanillas();
      setSelected(null);
    } catch (err) {
      console.error(err);
      show('Error');
    } finally {
      setSaving(false);
    }
  };

  if (!canView) {
    return <div style={{ padding: 20, color: '#e63946' }}>No tienes acceso a nómina</div>;
  }

  if (loading) {
    return <div style={{ padding: 20, textAlign: 'center', color: '#aaa' }}>Cargando planillas...</div>;
  }

  // ── LISTA ──
  if (!selected) {
    return (
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>💼 Nómina</h2>
          <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setShowNewPlanilla(true)}>
            + Nueva Corrida
          </button>
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
                <button style={{ flex: 1, ...btnSec }} onClick={() => setShowNewPlanilla(false)}>
                  Cancelar
                </button>
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
                <button className="btn-primary" style={{ flex: 1 }} onClick={procesarAccion} disabled={saving}>
                  Confirmar
                </button>
                <button style={{ flex: 1, ...btnSec }} onClick={() => setShowPINModal(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lista de planillas */}
        {planillas.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay corridas de nómina</div>
        ) : (
          <div>
            {planillas.map(p => (
              <div key={p.id} className="card" onClick={() => abrirDetalle(p)}
                style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                      {p.periodo}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {fmtDate(p.fecha_inicio)} - {fmtDate(p.fecha_fin)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <EstadoBadge estado={p.estado} />
                    <div style={{ fontSize: 13, color: '#4ade80', marginTop: 4, fontWeight: 600 }}>
                      {fmt$(p.total_neto)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── DETALLE ──
  const det = detalles || [];
  const totalDevengado = det.reduce((sum, d) => sum + n(d.total_devengado || 0), 0);
  const totalDescuentos = det.reduce((sum, d) => sum + n(d.total_descuentos || 0), 0);
  const totalNeto = det.reduce((sum, d) => sum + n(d.neto_a_pagar || 0), 0);
  const totalPatronal = det.reduce((sum, d) => sum + n(d.patronal_isss || 0) + n(d.patronal_afp || 0) + n(d.patronal_insaforp || 0), 0);

  return (
    <div style={{ padding: '16px' }}>
      <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Volver a lista
      </button>

      {/* Header */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>
              {selected.periodo}
            </h2>
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              {fmtDate(selected.fecha_inicio)} - {fmtDate(selected.fecha_fin)}
            </div>
            <div style={{ marginTop: 4 }}>
              <EstadoBadge estado={selected.estado} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: '#888' }}>Neto a pagar</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#4ade80' }}>
              {fmt$(totalNeto)}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Aporte patronal: {fmt$(totalPatronal)}
            </div>
          </div>
        </div>

        {/* Acciones */}
        {selected.estado === 'borrador' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={calcularPlanilla} disabled={calculating}>
              {calculating ? 'Calculando...' : '🔄 Calcular'}
            </button>
          </div>
        )}

        {selected.estado === 'calculada' && canApprove && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#2d6a4f' }}
              onClick={() => solicitarPIN('aprobar')}>
              ✓ Aprobar
            </button>
          </div>
        )}

        {selected.estado === 'aprobada' && canApprove && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#4ade80' }}
              onClick={() => solicitarPIN('pagar')}>
              💳 Marcar Pagada
            </button>
          </div>
        )}
      </div>

      {/* Tabla de detalle */}
      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 14 }}>Detalle por Empleado ({det.length})</h3>

        {det.length === 0 ? (
          <div style={{ color: '#666', fontSize: 13 }}>Sin cálculos. Presiona "Calcular" para generar detalle.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1200 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                <th style={{ ...th, minWidth: 140 }}>Empleado</th>
                <th style={{ ...th, minWidth: 80 }}>Cargo</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Días</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Falta</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Just.</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Tarde</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>HE D</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>HE N</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 100 }}>Sal. Base</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>HE $</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>Propina</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>Bono DLV</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 100 }}>Total Dev.</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>ISSS</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>AFP</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>ISR</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Adelantos</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Faltas</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Tardanza</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Préstamo</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 70 }}>Otros</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 100 }}>Total Desc.</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 100 }}>Neto</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>Patr. ISSS</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>Patr. AFP</th>
                <th style={{ ...th, textAlign: 'right', minWidth: 80 }}>INSAFORP</th>
              </tr>
            </thead>
            <tbody>
              {det.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ ...td }}>
                    <div style={{ fontWeight: 600 }}>{d.empleados?.nombre_completo || '?'}</div>
                  </td>
                  <td style={{ ...td }}>{d.empleados?.cargo || '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.dias_trabajados)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.dias_ausentes)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.dias_justificados)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.llegadas_tarde)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.horas_extra_diurnas)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.horas_extra_nocturnas)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmt$(d.salario_base_quincenal)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#e9c46a' }}>{fmt$(d.monto_horas_extra)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#e9c46a' }}>{fmt$(d.propina_mensual)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#e9c46a' }}>{fmt$(d.bono_delivery)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{fmt$(d.total_devengado)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_isss)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_afp)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_isr)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_adelantos)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_faltas)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_tardanzas)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_prestamos)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.descuento_otros)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#e63946' }}>{fmt$(d.total_descuentos)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{fmt$(d.neto_a_pagar)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#888', fontSize: 10 }}>{fmt$(d.patronal_isss)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#888', fontSize: 10 }}>{fmt$(d.patronal_afp)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#888', fontSize: 10 }}>{fmt$(d.patronal_insaforp)}</td>
                </tr>
              ))}

              {/* Fila de totales */}
              <tr style={{ borderTop: '2px solid #444', background: '#1a1a2e' }}>
                <td colSpan={12} style={{ ...td, fontWeight: 700, color: '#fff' }}>TOTALES</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt$(totalDevengado)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_isss || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_afp || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_isr || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_adelantos || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_faltas || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_tardanzas || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_prestamos || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.descuento_otros || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#e63946' }}>{fmt$(totalDescuentos)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{fmt$(totalNeto)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#888', fontSize: 10 }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.patronal_isss || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#888', fontSize: 10 }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.patronal_afp || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#888', fontSize: 10 }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.patronal_insaforp || 0), 0))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Estilos ──
const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
const btnSec = { padding: '8px 12px', borderRadius: 8, border: '1px solid #444', background: '#333', color: '#fff', fontSize: 13, cursor: 'pointer' };
const th = { padding: '6px 4px', fontSize: 11, color: '#666', textAlign: 'left', fontWeight: 600 };
const td = { padding: '8px 4px', fontSize: 11, color: '#ddd' };
