import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { fmtDate, n, STORES } from '../../config';
import AsistenciaDigital from './AsistenciaDigital';

// ── Control de acceso ──
const ALLOWED_ROLES = ['ejecutivo', 'rrhh', 'admin', 'superadmin'];

// ── Cargos reales en producción ──
const CARGOS_REALES = [
  'Cajera', 'Cocina', 'Cocinero', 'Encargada de cocina', 'Mesera', 'Mesero',
  'Motorista', 'Plancha', 'Tablet', 'Produccion', 'Auxiliar de Produccion',
  'Talento Humano', 'Mercadeo', 'Ingeniera en Alimentos', 'Gerente',
  'Encargada de Tablet', 'Motorista Interno', 'Encargada de meseros'
];

// ── TIPOS DE DESCUENTOS ──
const TIPOS_DESCUENTOS = ['prestamo', 'uniforme', 'adelanto', 'daño', 'otro'];

// ── Colores del tema ──
const C = {
  bg:       '#111',
  bgCard:   '#1a1a1a',
  bgInput:  '#222',
  red:      '#e63946',
  green:    '#4ade80',
  yellow:   '#f59e0b',
  blue:     '#3b82f6',
  border:   '#2a2a2a',
  text:     '#eee',
  textDim:  '#666',
};

// ── Roles que NO se pueden editar ──
const ROLES_PROTEGIDOS = ['ejecutivo', 'admin', 'superadmin'];

// ── Roles disponibles para asignar (excluye protegidos) ──
const ROLES_EDITABLES = [
  'gerente', 'cajero', 'cajera', 'cocina', 'mesero', 'mesera',
  'motorista', 'motorista_interno', 'despachador', 'domicilios',
  'bodeguero', 'jefe_casa_matriz', 'compras', 'produccion',
  'contador', 'marketing', 'rrhh', 'tablet', 'telefono', 'empleado',
];

// ── Helpers de estilo reutilizables ──
const inp = {
  padding: '8px 10px', borderRadius: 6,
  border: `1px solid ${C.border}`, background: C.bgInput,
  color: C.text, fontSize: 13, boxSizing: 'border-box', width: '100%',
  fontFamily: 'inherit',
};
const btn = (variant = 'primary') => ({
  padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
  ...(variant === 'primary'   ? { background: C.red,     color: '#fff' }         : {}),
  ...(variant === 'success'   ? { background: C.green,   color: '#000' }         : {}),
  ...(variant === 'ghost'     ? { background: C.bgInput, color: C.textDim, border: `1px solid ${C.border}` } : {}),
  ...(variant === 'icon'      ? { background: 'none', border: 'none', color: C.yellow, padding: '4px 6px' } : {}),
});

// ── Toast global ──
function useToast() {
  const [toast, setToast] = useState(null);
  const show = (text, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 2800);
  };
  const Toast = toast ? (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      zIndex: 1100, whiteSpace: 'nowrap',
      background: toast.ok ? 'rgba(74,222,128,0.12)' : 'rgba(230,57,70,0.12)',
      color: toast.ok ? C.green : C.red,
      border: `1px solid ${toast.ok ? C.green : C.red}`,
      backdropFilter: 'blur(4px)',
    }}>{toast.text}</div>
  ) : null;
  return { show, Toast };
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function RRHHView({ user }) {
  const [tab, setTab] = useState('empleados');
  const [sucursales, setSucursales] = useState([]);
  const [loading, setLoading] = useState(true);
  const { show, Toast } = useToast();

  const canEdit = ['ejecutivo', 'rrhh', 'admin', 'superadmin'].includes(user?.rol);

  useEffect(() => {
    db.from('sucursales')
      .select('id, nombre, store_code, lat, lng, radio_metros')
      .order('nombre')
      .then(({ data }) => setSucursales(data || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
      Cargando RRHH...
    </div>
  );

  const TABS = [
    { id: 'empleados',          label: '👤 Empleados' },
    { id: 'asistencia-digital', label: '📍 GPS Asistencia' },
    { id: 'asistencia',         label: '📋 Asistencia Manual' },
    { id: 'descuentos',         label: '💰 Descuentos' },
    ...(canEdit ? [{ id: 'usuarios-pin', label: '🔑 Usuarios PIN' }] : []),
  ];

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      {/* Tab nav — pills */}
      <div style={{ display: 'flex', overflowX: 'auto', gap: 6, padding: '12px 12px 8px', borderBottom: `1px solid ${C.border}` }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '6px 12px', borderRadius: 20, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600,
              background: tab === t.id ? C.red : '#222',
              color:      tab === t.id ? '#fff' : C.textDim,
              transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido por tab */}
      <div style={{ padding: 16 }}>
        {tab === 'empleados'          && <TabEmpleados    canEdit={canEdit} sucursales={sucursales} show={show} />}
        {tab === 'asistencia-digital' && <AsistenciaDigital sucursales={sucursales} user={user} />}
        {tab === 'asistencia'         && <TabAsistencia   sucursales={sucursales} show={show} />}
        {tab === 'descuentos'         && <TabDescuentos   canEdit={canEdit} show={show} />}
        {tab === 'usuarios-pin'       && <TabUsuariosPIN  canEdit={canEdit} sucursales={sucursales} show={show} />}
      </div>

      {Toast}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: EMPLEADOS
// ═══════════════════════════════════════════════════════════════
function TabEmpleados({ canEdit, sucursales, show }) {
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(null);
  const [cargosUnicos, setCargosUnicos] = useState([]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await db
        .from('empleados')
        .select('*, sucursales(nombre)')
        .order('nombre_completo');
      setEmpleados(data || []);
      const cargos = [...new Set((data || []).map(e => e.cargo).filter(Boolean))].sort();
      setCargosUnicos(cargos);
    } catch (err) {
      console.error('Error cargando empleados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = empleados.filter(e => {
    if (filtroSucursal && e.sucursal_id !== filtroSucursal) return false;
    if (filtroCargo   && e.cargo !== filtroCargo)           return false;
    if (filtroEstado === 'activos'   && !e.activo) return false;
    if (filtroEstado === 'inactivos' &&  e.activo) return false;
    return true;
  });

  const openForm = (emp = null) => {
    if (emp) {
      setFormData({ ...emp });
      setEditingId(emp.id);
    } else {
      setFormData({
        nombre_completo: '', codigo_empleado: '', dui: '', nit: '', cargo: '',
        tipo_empleado: '', sucursal_id: '', salario_mensual: '', tipo_contrato: '',
        banco: '', cuenta_bancaria: '', telefono: '', contacto_emergencia: '',
        fecha_ingreso: new Date().toISOString().split('T')[0],
        recibe_propina: false, es_delivery_driver: false, activo: true,
      });
      setEditingId(null);
    }
    setShowForm(true);
  };

  const saveEmpleado = async () => {
    if (!formData.nombre_completo || !formData.cargo || !formData.sucursal_id) {
      show('Nombre, cargo y sucursal son requeridos', false); return;
    }
    try {
      const data = {
        nombre_completo: formData.nombre_completo,
        codigo_empleado: formData.codigo_empleado,
        dui: formData.dui, nit: formData.nit, cargo: formData.cargo,
        tipo_empleado: formData.tipo_empleado, sucursal_id: formData.sucursal_id,
        salario_mensual: n(formData.salario_mensual) || 0,
        tipo_contrato: formData.tipo_contrato, banco: formData.banco,
        cuenta_bancaria: formData.cuenta_bancaria, telefono: formData.telefono,
        contacto_emergencia: formData.contacto_emergencia,
        fecha_ingreso: formData.fecha_ingreso,
        recibe_propina: !!formData.recibe_propina,
        es_delivery_driver: !!formData.es_delivery_driver,
        activo: !!formData.activo,
      };
      if (editingId) {
        await db.from('empleados').update(data).eq('id', editingId);
      } else {
        await db.from('empleados').insert(data);
      }
      setShowForm(false); setFormData(null); setEditingId(null);
      show('✓ Empleado guardado');
      await cargar();
    } catch (err) {
      show('Error: ' + err.message, false);
    }
  };

  const toggleActivo = async (id, activo) => {
    try {
      await db.from('empleados').update({ activo: !activo }).eq('id', id);
      await cargar();
    } catch (err) {
      show('Error: ' + err.message, false);
    }
  };

  if (loading) return <div style={{ color: C.textDim, fontSize: 13 }}>Cargando empleados...</div>;

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)}
          style={{ ...inp, width: 'auto' }}>
          <option value="">Todas sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)}
          style={{ ...inp, width: 'auto' }}>
          <option value="">Todos cargos</option>
          {cargosUnicos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          style={{ ...inp, width: 'auto' }}>
          <option value="todos">Todos</option>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
        </select>
        {canEdit && (
          <button onClick={() => openForm()} style={btn('primary')}>+ Nuevo</button>
        )}
      </div>

      {/* Tabla */}
      <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ background: C.bgCard }}>
              <th style={thS}>Código</th>
              <th style={thS}>Nombre</th>
              <th style={thS}>Cargo</th>
              <th style={thS}>Sucursal</th>
              <th style={{ ...thS, textAlign: 'right' }}>Salario</th>
              <th style={thS}>Estado</th>
              {canEdit && <th style={thS}>Acc.</th>}
            </tr>
          </thead>
          <tbody>
            {filtrados.map(emp => (
              <tr key={emp.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={tdS}>{emp.codigo_empleado || '—'}</td>
                <td style={{ ...tdS, fontWeight: 600 }}>{emp.nombre_completo}</td>
                <td style={tdS}>{emp.cargo || '—'}</td>
                <td style={tdS}>{emp.sucursales?.nombre || '—'}</td>
                <td style={{ ...tdS, textAlign: 'right' }}>${n(emp.salario_mensual).toFixed(2)}</td>
                <td style={tdS}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                    background: emp.activo ? 'rgba(74,222,128,0.12)' : 'rgba(230,57,70,0.12)',
                    color: emp.activo ? C.green : C.red,
                  }}>
                    {emp.activo ? '✓ Activo' : '✗ Inactivo'}
                  </span>
                </td>
                {canEdit && (
                  <td style={tdS}>
                    <button onClick={() => openForm(emp)} style={btn('icon')}>✏️</button>
                    <button onClick={() => toggleActivo(emp.id, emp.activo)}
                      style={{ ...btn('icon'), color: emp.activo ? C.red : C.green }}>
                      {emp.activo ? '▼' : '▲'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtrados.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textDim, padding: 24, fontSize: 13 }}>
          No hay empleados que coincidan con los filtros
        </div>
      )}

      {showForm && formData && (
        <ModalEmpleado
          formData={formData}
          setFormData={setFormData}
          onSave={saveEmpleado}
          onCancel={() => { setShowForm(false); setFormData(null); }}
          sucursales={sucursales}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: ASISTENCIA
// ═══════════════════════════════════════════════════════════════
function TabAsistencia({ sucursales, show }) {
  const [fechaSeleccionada, setFechaSeleccionada] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [sucursalSel, setSucursalSel] = useState(sucursales[0]?.id || '');
  const [empleados, setEmpleados] = useState([]);
  const [asistencia, setAsistencia] = useState({});
  const [loading, setLoading] = useState(false);

  const cargarEmpleados = useCallback(async () => {
    if (!sucursalSel) return;
    setLoading(true);
    try {
      const { data } = await db
        .from('empleados')
        .select('id, nombre_completo, cargo')
        .eq('sucursal_id', sucursalSel)
        .eq('activo', true)
        .order('nombre_completo');
      setEmpleados(data || []);

      const { data: asistData } = await db
        .from('asistencia_diaria')
        .select('empleado_id, estado, hora_entrada')
        .eq('fecha', fechaSeleccionada)
        .in('empleado_id', (data || []).map(e => e.id));

      const asistMap = {};
      (asistData || []).forEach(a => {
        asistMap[a.empleado_id] = { estado: a.estado, hora: a.hora_entrada };
      });
      setAsistencia(asistMap);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, [sucursalSel, fechaSeleccionada]);

  useEffect(() => { cargarEmpleados(); }, [cargarEmpleados]);

  const marcarPresente = async (empId, nuevoEstado) => {
    try {
      const hora = new Date().toISOString().substring(11, 16);
      const { data: existe } = await db
        .from('asistencia_diaria').select('id')
        .eq('empleado_id', empId).eq('fecha', fechaSeleccionada).maybeSingle();

      if (existe) {
        if (nuevoEstado === 'presente') {
          await db.from('asistencia_diaria')
            .update({ estado: 'presente', hora_entrada: hora }).eq('id', existe.id);
        } else {
          await db.from('asistencia_diaria').delete().eq('id', existe.id);
        }
      } else if (nuevoEstado === 'presente') {
        await db.from('asistencia_diaria').insert({
          empleado_id: empId, fecha: fechaSeleccionada, estado: 'presente', hora_entrada: hora,
        });
      }
      setAsistencia(prev => ({
        ...prev,
        [empId]: nuevoEstado === 'presente' ? { estado: 'presente', hora } : undefined,
      }));
    } catch (err) {
      show('Error: ' + err.message, false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="date" value={fechaSeleccionada}
          onChange={e => setFechaSeleccionada(e.target.value)}
          style={{ ...inp, width: 'auto' }} />
        <select value={sucursalSel} onChange={e => setSucursalSel(e.target.value)}
          style={{ ...inp, width: 'auto' }}>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ color: C.textDim, fontSize: 13 }}>Cargando...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {empleados.map(emp => {
            const asist = asistencia[emp.id];
            const presente = asist?.estado === 'presente';
            return (
              <div key={emp.id} style={{
                padding: '12px 14px', borderRadius: 8,
                background: C.bgCard, border: `1px solid ${C.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>
                    {emp.nombre_completo}
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{emp.cargo}</div>
                  {asist?.hora && (
                    <div style={{ fontSize: 11, color: C.green, marginTop: 4 }}>
                      Entrada: {asist.hora}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => marcarPresente(emp.id, presente ? 'ausente' : 'presente')}
                  style={{
                    ...btn(presente ? 'success' : 'ghost'),
                    padding: '6px 14px',
                  }}
                >
                  {presente ? '✓ Presente' : 'Marcar'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {empleados.length === 0 && !loading && (
        <div style={{ textAlign: 'center', color: C.textDim, padding: 24, fontSize: 13 }}>
          No hay empleados activos en esta sucursal
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: DESCUENTOS
// ═══════════════════════════════════════════════════════════════
function TabDescuentos({ canEdit, show }) {
  const [descuentos, setDescuentos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [descRes, empRes] = await Promise.all([
        db.from('descuentos_empleado')
          .select('*, empleados(id, nombre_completo, codigo_empleado)')
          .eq('activo', true)
          .order('created_at', { ascending: false }),
        db.from('empleados')
          .select('id, nombre_completo, codigo_empleado')
          .eq('activo', true)
          .order('nombre_completo'),
      ]);
      setDescuentos(descRes.data || []);
      setEmpleados(empRes.data || []);
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const openForm = (desc = null) => {
    if (desc) {
      setFormData({ ...desc });
    } else {
      setFormData({
        empleado_id: '', tipo: '', descripcion: '',
        monto_total: '', monto_cuota: '', cuotas_totales: '', cuotas_pagadas: 0,
      });
    }
    setShowForm(true);
  };

  const saveDescuento = async () => {
    if (!formData.empleado_id || !formData.tipo || !formData.monto_total || !formData.cuotas_totales) {
      show('Empleado, tipo, monto total y cuotas son requeridos', false); return;
    }
    try {
      const data = {
        empleado_id:    formData.empleado_id,
        tipo:           formData.tipo,
        descripcion:    formData.descripcion,
        monto_total:    n(formData.monto_total),
        monto_cuota:    n(formData.monto_total) / parseInt(formData.cuotas_totales),
        cuotas_totales: parseInt(formData.cuotas_totales),
        cuotas_pagadas: parseInt(formData.cuotas_pagadas) || 0,
        activo: true,
      };
      if (formData.id) {
        await db.from('descuentos_empleado').update(data).eq('id', formData.id);
      } else {
        await db.from('descuentos_empleado').insert(data);
      }
      setShowForm(false); setFormData(null);
      show('✓ Descuento guardado');
      await cargar();
    } catch (err) {
      show('Error: ' + err.message, false);
    }
  };

  if (loading) return <div style={{ color: C.textDim, fontSize: 13 }}>Cargando descuentos...</div>;

  return (
    <div>
      {canEdit && (
        <button onClick={() => openForm()} style={{ ...btn('primary'), marginBottom: 16 }}>+ Nuevo</button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {descuentos.map(desc => {
          const pct = (desc.cuotas_pagadas / desc.cuotas_totales) * 100;
          return (
            <div key={desc.id} style={{
              padding: '12px 14px', borderRadius: 8,
              background: C.bgCard, border: `1px solid ${C.border}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>
                    {desc.empleados?.nombre_completo}
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                    {desc.tipo}{desc.descripcion ? ` — ${desc.descripcion}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.yellow }}>
                    ${n(desc.monto_total).toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                    {desc.cuotas_pagadas}/{desc.cuotas_totales} cuotas
                  </div>
                </div>
              </div>

              <div style={{ width: '100%', height: 5, background: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3,
                  background: pct >= 100 ? C.green : C.yellow, transition: 'width 0.3s' }} />
              </div>

              {canEdit && (
                <button onClick={() => openForm(desc)}
                  style={{ background: 'none', border: 'none', color: C.textDim,
                    cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0 }}>
                  Editar
                </button>
              )}
            </div>
          );
        })}
      </div>

      {descuentos.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textDim, padding: 24, fontSize: 13 }}>
          No hay descuentos activos
        </div>
      )}

      {showForm && formData && (
        <ModalDescuento
          formData={formData}
          setFormData={setFormData}
          empleados={empleados}
          onSave={saveDescuento}
          onCancel={() => { setShowForm(false); setFormData(null); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 5: USUARIOS PIN (usuarios_erp)
// ═══════════════════════════════════════════════════════════════
function TabUsuariosPIN({ canEdit, sucursales, show }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [editando, setEditando] = useState(null);
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    const { data } = await db.from('usuarios_erp')
      .select('id, nombre, apellido, pin, rol, store_code, activo')
      .order('nombre');
    setUsuarios(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = usuarios.filter(u => {
    if (filtroSucursal === '__sin_sucursal__') { if (u.store_code) return false; }
    else if (filtroSucursal && u.store_code !== filtroSucursal) return false;
    if (filtroRol && u.rol !== filtroRol) return false;
    return true;
  });

  const rolesUnicos = [...new Set(usuarios.map(u => u.rol).filter(Boolean))].sort();

  const guardar = async () => {
    if (!editando.store_code || !editando.rol) {
      show('Sucursal y rol son requeridos', false); return;
    }
    setSaving(true);
    try {
      const { error } = await db.from('usuarios_erp').update({
        store_code: editando.store_code,
        rol:        editando.rol,
        nombre:     editando.nombre,
        apellido:   editando.apellido,
      }).eq('id', editando.id);
      if (error) { show('Error: ' + error.message, false); setSaving(false); return; }
      show('✓ Usuario actualizado');
      setEditando(null);
      await cargar();
    } catch (e) { show(e.message, false); }
    setSaving(false);
  };

  if (loading) return <div style={{ color: C.textDim, fontSize: 13 }}>Cargando usuarios...</div>;

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)}
          style={{ ...inp, width: 'auto' }}>
          <option value="">Todas las sucursales</option>
          <option value="__sin_sucursal__">⚠️ Sin sucursal asignada</option>
          {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
        </select>
        <select value={filtroRol} onChange={e => setFiltroRol(e.target.value)}
          style={{ ...inp, width: 'auto' }}>
          <option value="">Todos los roles</option>
          {rolesUnicos.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12,
        padding: '6px 10px', borderRadius: 6,
        background: 'rgba(230,57,70,0.07)', border: '1px solid rgba(230,57,70,0.18)' }}>
        🔒 Los usuarios con rol <strong>ejecutivo</strong> y <strong>admin</strong> no se pueden editar desde aquí.
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 8, border: `1px solid ${C.border}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ background: C.bgCard }}>
              <th style={thS}>Nombre</th>
              <th style={thS}>PIN</th>
              <th style={thS}>Rol</th>
              <th style={thS}>Sucursal</th>
              {canEdit && <th style={thS}>Acc.</th>}
            </tr>
          </thead>
          <tbody>
            {filtrados.map(u => {
              const esProtegido = ROLES_PROTEGIDOS.includes(u.rol);
              const isEditing = editando?.id === u.id;
              return (
                <tr key={u.id} style={{ borderBottom: `1px solid ${C.border}`, opacity: u.activo ? 1 : 0.45 }}>
                  <td style={tdS}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input value={editando.nombre}
                          onChange={e => setEditando({ ...editando, nombre: e.target.value })}
                          style={{ ...inp, fontSize: 12 }} placeholder="Nombre" />
                        <input value={editando.apellido}
                          onChange={e => setEditando({ ...editando, apellido: e.target.value })}
                          style={{ ...inp, fontSize: 12 }} placeholder="Apellido" />
                      </div>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{u.nombre} {u.apellido}</span>
                    )}
                  </td>
                  <td style={{ ...tdS, fontFamily: 'monospace', color: C.yellow }}>{u.pin}</td>
                  <td style={tdS}>
                    {isEditing ? (
                      <select value={editando.rol}
                        onChange={e => setEditando({ ...editando, rol: e.target.value })}
                        style={{ ...inp, fontSize: 12 }}>
                        {ROLES_EDITABLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span style={{
                        padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                        background: esProtegido ? 'rgba(230,57,70,0.12)' : 'rgba(96,165,250,0.1)',
                        color: esProtegido ? C.red : C.blue,
                      }}>
                        {esProtegido ? '🔒 ' : ''}{u.rol}
                      </span>
                    )}
                  </td>
                  <td style={tdS}>
                    {isEditing ? (
                      <select value={editando.store_code}
                        onChange={e => setEditando({ ...editando, store_code: e.target.value })}
                        style={{ ...inp, fontSize: 12 }}>
                        <option value="">— Seleccionar —</option>
                        {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: C.textDim, fontSize: 12 }}>
                        {sucursales.find(s => s.store_code === u.store_code)?.nombre || u.store_code || '—'}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={tdS}>
                      {esProtegido ? (
                        <span style={{ fontSize: 11, color: C.textDim }}>—</span>
                      ) : isEditing ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={guardar} disabled={saving}
                            style={{ ...btn('success'), padding: '4px 10px', fontSize: 11 }}>
                            {saving ? '...' : '✓ Guardar'}
                          </button>
                          <button onClick={() => setEditando(null)}
                            style={{ ...btn('ghost'), padding: '4px 8px', fontSize: 11 }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setEditando({ ...u })} style={btn('icon')}>✏️</button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtrados.length === 0 && (
        <div style={{ textAlign: 'center', color: C.textDim, padding: 20, fontSize: 13 }}>
          Sin resultados
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════════════
function ModalEmpleado({ formData, setFormData, onSave, onCancel, sucursales }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 16,
    }} onClick={onCancel}>
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12,
        maxWidth: 500, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: C.text }}>
          {formData.id ? 'Editar Empleado' : 'Nuevo Empleado'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <InputField label="Nombre Completo *" value={formData.nombre_completo}
            onChange={e => setFormData({ ...formData, nombre_completo: e.target.value })} />
          <InputField label="Código" value={formData.codigo_empleado}
            onChange={e => setFormData({ ...formData, codigo_empleado: e.target.value })} />
          <InputField label="DUI" value={formData.dui} placeholder="123456789"
            onChange={e => setFormData({ ...formData, dui: e.target.value })} />
          <InputField label="NIT" value={formData.nit}
            onChange={e => setFormData({ ...formData, nit: e.target.value })} />
          <SelectField label="Cargo *" value={formData.cargo} options={CARGOS_REALES}
            onChange={e => setFormData({ ...formData, cargo: e.target.value })} />
          <InputField label="Tipo Empleado" value={formData.tipo_empleado}
            onChange={e => setFormData({ ...formData, tipo_empleado: e.target.value })} />
          <SelectField label="Sucursal *" value={formData.sucursal_id}
            onChange={e => setFormData({ ...formData, sucursal_id: e.target.value })}
            options={sucursales} optionKey="id" optionLabel="nombre" />
          <InputField label="Salario Mensual" type="number" value={formData.salario_mensual}
            onChange={e => setFormData({ ...formData, salario_mensual: e.target.value })} />
          <InputField label="Tipo Contrato" value={formData.tipo_contrato}
            onChange={e => setFormData({ ...formData, tipo_contrato: e.target.value })} />
          <InputField label="Banco" value={formData.banco}
            onChange={e => setFormData({ ...formData, banco: e.target.value })} />
          <InputField label="Cuenta Bancaria" value={formData.cuenta_bancaria}
            onChange={e => setFormData({ ...formData, cuenta_bancaria: e.target.value })} />
          <InputField label="Teléfono" type="tel" value={formData.telefono}
            onChange={e => setFormData({ ...formData, telefono: e.target.value })} />
          <InputField label="Contacto Emergencia" value={formData.contacto_emergencia}
            onChange={e => setFormData({ ...formData, contacto_emergencia: e.target.value })} />
          <InputField label="Fecha Ingreso" type="date" value={formData.fecha_ingreso}
            onChange={e => setFormData({ ...formData, fecha_ingreso: e.target.value })} />
          <div style={{ gridColumn: '1 / -1' }}>
            <CheckboxField label="Recibe Propina" checked={formData.recibe_propina}
              onChange={e => setFormData({ ...formData, recibe_propina: e.target.checked })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <CheckboxField label="Es Delivery Driver" checked={formData.es_delivery_driver}
              onChange={e => setFormData({ ...formData, es_delivery_driver: e.target.checked })} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <CheckboxField label="Activo" checked={formData.activo}
              onChange={e => setFormData({ ...formData, activo: e.target.checked })} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ ...btn('ghost'), flex: 1, padding: 10 }}>Cancelar</button>
          <button onClick={onSave}   style={{ ...btn('success'), flex: 1, padding: 10 }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function ModalDescuento({ formData, setFormData, empleados, onSave, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 16,
    }} onClick={onCancel}>
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 12,
        maxWidth: 400, width: '100%', padding: 20,
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: C.text }}>
          {formData.id ? 'Editar Descuento' : 'Nuevo Descuento'}
        </h2>

        <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <SelectField label="Empleado *" value={formData.empleado_id}
            onChange={e => setFormData({ ...formData, empleado_id: e.target.value })}
            options={empleados} optionKey="id" optionLabel="nombre_completo" />
          <SelectField label="Tipo *" value={formData.tipo}
            onChange={e => setFormData({ ...formData, tipo: e.target.value })}
            options={TIPOS_DESCUENTOS} />
          <InputField label="Descripción" value={formData.descripcion}
            onChange={e => setFormData({ ...formData, descripcion: e.target.value })} />
          <InputField label="Monto Total *" type="number" value={formData.monto_total}
            onChange={e => setFormData({ ...formData, monto_total: e.target.value })} />
          <InputField label="Cuotas Totales *" type="number" value={formData.cuotas_totales}
            onChange={e => setFormData({ ...formData, cuotas_totales: e.target.value })} min="1" />
          <InputField label="Cuotas Pagadas" type="number" value={formData.cuotas_pagadas}
            onChange={e => setFormData({ ...formData, cuotas_pagadas: e.target.value })} min="0" />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ ...btn('ghost'), flex: 1, padding: 10 }}>Cancelar</button>
          <button onClick={onSave}   style={{ ...btn('success'), flex: 1, padding: 10 }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTES REUTILIZABLES
// ═══════════════════════════════════════════════════════════════
function InputField({ label, value, onChange, type = 'text', placeholder = '', min = undefined }) {
  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: 11, color: C.textDim, marginBottom: 4 }}>{label}</label>}
      <input type={type} value={value} onChange={onChange}
        placeholder={placeholder} min={min} style={inp} />
    </div>
  );
}

function SelectField({ label, value, onChange, options, optionKey = null, optionLabel = null }) {
  return (
    <div>
      {label && <label style={{ display: 'block', fontSize: 11, color: C.textDim, marginBottom: 4 }}>{label}</label>}
      <select value={value} onChange={onChange} style={inp}>
        <option value="">— Seleccionar —</option>
        {options.map(opt => optionKey
          ? <option key={opt[optionKey]} value={opt[optionKey]}>{opt[optionLabel]}</option>
          : <option key={opt} value={opt}>{opt}</option>
        )}
      </select>
    </div>
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={onChange}
        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: C.red }} />
      <span style={{ fontSize: 13, color: C.text }}>{label}</span>
    </label>
  );
}

// ── Estilos tabla compartidos ──
const thS = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11,
  fontWeight: 700, color: C.textDim, whiteSpace: 'nowrap',
};
const tdS = {
  padding: '10px 12px', fontSize: 13, color: C.text,
};
