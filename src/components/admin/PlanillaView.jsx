import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { n, fmtDate } from '../../config';
import { useToast } from '../../hooks/useToast';

// PINs ejecutivos para aprobación
const EXECUTIVE_PINS = ['1000', '2000']; // Jose, Cesar
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
    aprobada: { bg: '#3b82f6', label: 'Aprobada' },
    pagada: { bg: '#10b981', label: 'Pagada' },
  };
  const s = map[estado] || { bg: '#6b7280', label: estado };
  return (
    <span style={{ background: s.bg, color: '#fff', padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
      {s.label}
    </span>
  );
};

export default function PlanillaView({ user }) {
  const { show } = useToast();
  const [planillas, setPlanillas] = useState([]);
  const [detalles, setDetalles] = useState({});
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNewPlanilla, setShowNewPlanilla] = useState(false);
  const [newPeriodo, setNewPeriodo] = useState('quincenal_1');
  const [newMesAno, setNewMesAno] = useState(new Date().toISOString().split('T')[0].slice(0, 7));
  const [showPINModal, setShowPINModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinAction, setPinAction] = useState(null); // 'aprobar' o 'pagar'
  const [saving, setSaving] = useState(false);
  const [recalculando, setRecalculando] = useState(false);

  // Check acceso
  const canView = ALLOWED_ROLES.includes(user?.role);
  const canApprove = EXECUTIVE_PINS.includes(user?.pin);

  // Cargar planillas
  const cargarPlanillas = useCallback(async () => {
    setLoading(true);
    const res = await db.from('planillas').select('*').order('fecha_inicio', { ascending: false });
    setPlanillas(res.data || []);
    setLoading(false);
  }, []);

  // Cargar empleados activos
  const cargarEmpleados = useCallback(async () => {
    const res = await db.from('empleados').select('*').eq('activo', true).order('nombre');
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
    const inicio = newPeriodo === 'quincenal_1'
      ? `${year}-${month}-01`
      : `${year}-${month}-16`;

    const diasEnMes = new Date(year, month, 0).getDate();
    const fin = newPeriodo === 'quincenal_1'
      ? `${year}-${month}-15`
      : `${year}-${month}-${diasEnMes}`;

    const mes = `${year}-${month}`;

    setSaving(true);
    try {
      // Crear planilla
      const { data: planilla, error: errPlanilla } = await db.from('planillas').insert({
        periodo: newPeriodo,
        fecha_inicio: inicio,
        fecha_fin: fin,
        fecha_pago: fin, // Por defecto, mismo día de fin
        estado: 'borrador',
        total_bruto: 0,
        total_deducciones: 0,
        total_neto: 0,
        created_by: user.nombre,
      }).select().single();

      if (errPlanilla) throw errPlanilla;

      // Cargar todos los empleados y calcular detalle para cada uno
      const detallesInsert = [];
      for (const emp of empleados) {
        // Llamar RPC calcular_detalle_empleado
        const { data: detalle, error: errCalc } = await db.rpc('calcular_detalle_empleado', {
          p_planilla_id: planilla.id,
          p_empleado_id: emp.id,
        });

        if (!errCalc && detalle) {
          // El RPC retorna los valores calculados
          detallesInsert.push({
            planilla_id: planilla.id,
            empleado_id: emp.id,
            salario_base: emp.salario_base,
            dias_trabajados: detalle.dias_trabajados || 15,
            horas_extra: detalle.horas_extra || 0,
            monto_horas_extra: detalle.monto_horas_extra || 0,
            propina: detalle.propina || 0,
            bono_delivery: detalle.bono_delivery || 0,
            otros_ingresos: detalle.otros_ingresos || 0,
            // Los siguientes son GENERATED, Supabase los calcula
            // devengado, isss_empleado, afp_empleado, isr, otras_deducciones, total_deducciones, neto
          });
        }
      }

      // Insertar detalles
      if (detallesInsert.length > 0) {
        const { error: errDet } = await db.from('planilla_detalle').insert(detallesInsert);
        if (errDet) throw errDet;
      }

      show('✓ Planilla creada');
      setNewPeriodo('quincenal_1');
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

  // Cargar detalle de una planilla
  const abrirDetalle = async (planilla) => {
    setSelected(planilla);
    const res = await db.from('planilla_detalle').select('*, empleados(id,codigo,nombre,cargo)').eq('planilla_id', planilla.id);
    setDetalles(res.data || []);
  };

  // Recalcular detalle
  const recalcular = async () => {
    if (!selected) return;
    setRecalculando(true);
    try {
      // Ejecutar RPC para cada empleado
      for (const emp of empleados) {
        await db.rpc('calcular_detalle_empleado', {
          p_planilla_id: selected.id,
          p_empleado_id: emp.id,
        });
      }
      show('✓ Recalculado');
      await abrirDetalle(selected);
    } catch (err) {
      console.error(err);
      show('Error al recalcular');
    } finally {
      setRecalculando(false);
    }
  };

  // Solicitar PIN para aprobar/pagar
  const solicitarPIN = (accion) => {
    setPinAction(accion);
    setPinInput('');
    setShowPINModal(true);
  };

  // Procesar aprobación/pago
  const procesarAccion = async () => {
    if (!EXECUTIVE_PINS.includes(pinInput)) {
      show('PIN incorrecto');
      return;
    }

    if (!selected) return;
    setSaving(true);
    try {
      let updates = {};
      if (pinAction === 'aprobar') {
        updates = { estado: 'aprobada', aprobado_por: user.nombre, aprobado_at: new Date().toISOString() };
      } else if (pinAction === 'pagar') {
        updates = { estado: 'pagada', pagado_at: new Date().toISOString() };
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
            + Nueva Planilla
          </button>
        </div>

        {/* Modal nueva planilla */}
        {showNewPlanilla && (
          <div className="modal-bg" onClick={() => setShowNewPlanilla(false)}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ padding: 20 }}>
              <h3 style={{ margin: '0 0 12px', color: '#fff' }}>Nueva Planilla</h3>

              <label style={lbl}>Período</label>
              <select style={inp} value={newPeriodo} onChange={e => setNewPeriodo(e.target.value)}>
                <option value="quincenal_1">Quincenal 1 (1-15)</option>
                <option value="quincenal_2">Quincenal 2 (16-fin)</option>
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
          <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay planillas</div>
        ) : (
          <div>
            {planillas.map(p => (
              <div key={p.id} className="card" onClick={() => abrirDetalle(p)}
                style={{ cursor: 'pointer', padding: '12px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#fff' }}>
                      {p.periodo === 'quincenal_1' ? 'Quincenal 1' : 'Quincenal 2'} - {fmtDate(p.fecha_inicio)}
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
  const totalBruto = det.reduce((sum, d) => sum + n(d.devengado || 0), 0);
  const totalDeducciones = det.reduce((sum, d) => sum + n(d.total_deducciones || 0), 0);
  const totalNeto = det.reduce((sum, d) => sum + n(d.neto || 0), 0);

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
              {selected.periodo === 'quincenal_1' ? 'Quincenal 1' : 'Quincenal 2'}
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
            {selected.created_by && (
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Por: {selected.created_by}</div>
            )}
          </div>
        </div>

        {/* Acciones */}
        {selected.estado === 'borrador' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px' }}
              onClick={recalcular} disabled={recalculando}>
              🔄 {recalculando ? 'Recalculando...' : 'Recalcular'}
            </button>
            {canApprove && (
              <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#3b82f6' }}
                onClick={() => solicitarPIN('aprobar')}>
                ✓ Aprobar
              </button>
            )}
          </div>
        )}

        {selected.estado === 'aprobada' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {canApprove && (
              <button className="btn-primary" style={{ fontSize: 12, padding: '6px 12px', background: '#10b981' }}
                onClick={() => solicitarPIN('pagar')}>
                💳 Marcar Pagada
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabla de detalle */}
      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 14 }}>Detalle por Empleado ({det.length})</h3>

        {det.length === 0 ? (
          <div style={{ color: '#666', fontSize: 13 }}>Sin empleados</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #333' }}>
                <th style={{ ...th, minWidth: 120 }}>Empleado</th>
                <th style={{ ...th, minWidth: 80 }}>Cargo</th>
                <th style={{ ...th, textAlign: 'right' }}>Sal. Base</th>
                <th style={{ ...th, textAlign: 'right' }}>Días</th>
                <th style={{ ...th, textAlign: 'right' }}>HE</th>
                <th style={{ ...th, textAlign: 'right' }}>Propina</th>
                <th style={{ ...th, textAlign: 'right' }}>Bono DLV</th>
                <th style={{ ...th, textAlign: 'right' }}>Devengado</th>
                <th style={{ ...th, textAlign: 'right' }}>ISSS (3%)</th>
                <th style={{ ...th, textAlign: 'right' }}>AFP (7.25%)</th>
                <th style={{ ...th, textAlign: 'right' }}>ISR</th>
                <th style={{ ...th, textAlign: 'right' }}>Otros Desc.</th>
                <th style={{ ...th, textAlign: 'right' }}>Total Desc.</th>
                <th style={{ ...th, textAlign: 'right' }}>Neto</th>
              </tr>
            </thead>
            <tbody>
              {det.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #222' }}>
                  <td style={{ ...td }}>
                    <div style={{ fontWeight: 600 }}>{d.empleados?.nombre || '?'}</div>
                  </td>
                  <td style={{ ...td }}>{d.empleados?.cargo || '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt$(d.salario_base)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.dias_trabajados)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{n(d.horas_extra)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#e9c46a' }}>{fmt$(d.propina)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#e9c46a' }}>{fmt$(d.bono_delivery)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{fmt$(d.devengado)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.isss_empleado)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.afp_empleado)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.isr)}</td>
                  <td style={{ ...td, textAlign: 'right', color: '#aaa' }}>{fmt$(d.otras_deducciones)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#e63946' }}>{fmt$(d.total_deducciones)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{fmt$(d.neto)}</td>
                </tr>
              ))}

              {/* Fila de totales */}
              <tr style={{ borderTop: '2px solid #444', background: '#1a1a2e' }}>
                <td colSpan={7} style={{ ...td, fontWeight: 700, color: '#fff' }}>TOTALES</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#fff' }}>{fmt$(totalBruto)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.isss_empleado || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.afp_empleado || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.isr || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#aaa' }}>
                  {fmt$(det.reduce((sum, d) => sum + n(d.otras_deducciones || 0), 0))}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#e63946' }}>{fmt$(totalDeducciones)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#4ade80' }}>{fmt$(totalNeto)}</td>
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
const td = { padding: '8px 4px', fontSize: 12, color: '#ddd' };
