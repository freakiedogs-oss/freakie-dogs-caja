import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { fmtDate, n, STORES } from '../../config';
import AsistenciaDigital from './AsistenciaDigital';

// ── Control de acceso ──
const EDIT_PINS = ['1000', '2000', '7700', '231155']; // Jose, Cesar, Maria Jose (RRHH), Super Admin
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
const colors = {
  bg: '#1a1a2e',
  bgCard: '#16213e',
  red: '#e63946',
  green: '#4ade80',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  border: '#333',
  text: '#eee',
  textDim: '#888',
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

// ── MAIN COMPONENT ──
export default function RRHHView({ user }) {
  const [tab, setTab] = useState('empleados'); // empleados, asistencia-digital, asistencia, descuentos, usuarios-pin
  const [sucursales, setSucursales] = useState([]);
  const [loading, setLoading] = useState(true);

  const canEdit = EDIT_PINS.includes(user?.pin);

  // Cargar sucursales al montar
  useEffect(() => {
    db.from('sucursales')
      .select('id, nombre, store_code, lat, lng, radio_metros')
      .order('nombre')
      .then(({ data }) => setSucursales(data || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 20, textAlign: 'center', color: colors.textDim }}>Cargando RRHH...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid #1a1a1a' }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: colors.text }}>👥 Gestión RRHH</h1>
        <div style={{ fontSize: 12, color: colors.textDim, marginTop: 4 }}>Empleados, Asistencia y Descuentos</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', overflowX: 'auto', borderBottom: '1px solid #1a1a1a', padding: '0 8px' }}>
        {[
          { id: 'empleados', label: '👤 Empleados' },
          { id: 'asistencia-digital', label: '📍 GPS Asistencia' },
          { id: 'asistencia', label: '📋 Asistencia Manual' },
          { id: 'descuentos', label: '💰 Descuentos' },
          ...(canEdit ? [{ id: 'usuarios-pin', label: '🔑 Usuarios PIN' }] : []),
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: 'none',
              border: 'none',
              color: tab === t.id ? colors.green : colors.textDim,
              padding: '10px 10px',
              fontSize: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              borderBottom: tab === t.id ? `2px solid ${colors.green}` : '2px solid transparent',
              fontWeight: tab === t.id ? 700 : 400,
              transition: 'all 0.2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido por tab */}
      <div style={{ padding: '16px' }}>
        {tab === 'empleados' && <TabEmpleados canEdit={canEdit} sucursales={sucursales} />}
        {tab === 'asistencia-digital' && <AsistenciaDigital sucursales={sucursales} user={user} />}
        {tab === 'asistencia' && <TabAsistencia sucursales={sucursales} />}
        {tab === 'descuentos' && <TabDescuentos canEdit={canEdit} />}
        {tab === 'usuarios-pin' && <TabUsuariosPIN canEdit={canEdit} sucursales={sucursales} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: EMPLEADOS
// ═══════════════════════════════════════════════════════════════
function TabEmpleados({ canEdit, sucursales }) {
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos'); // todos, activos, inactivos
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

      // Extraer cargos únicos
      const cargos = [...new Set((data || []).map(e => e.cargo).filter(Boolean))].sort();
      setCargosUnicos(cargos);
    } catch (err) {
      console.error('Error cargando empleados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filtrados = empleados.filter((e) => {
    if (filtroSucursal && e.sucursal_id !== filtroSucursal) return false;
    if (filtroCargo && e.cargo !== filtroCargo) return false;
    if (filtroEstado === 'activos' && !e.activo) return false;
    if (filtroEstado === 'inactivos' && e.activo) return false;
    return true;
  });

  const openForm = (emp = null) => {
    if (emp) {
      setFormData({ ...emp });
      setEditingId(emp.id);
    } else {
      setFormData({
        nombre_completo: '',
        codigo_empleado: '',
        dui: '',
        nit: '',
        cargo: '',
        tipo_empleado: '',
        sucursal_id: '',
        salario_mensual: '',
        tipo_contrato: '',
        banco: '',
        cuenta_bancaria: '',
        telefono: '',
        contacto_emergencia: '',
        fecha_ingreso: new Date().toISOString().split('T')[0],
        recibe_propina: false,
        es_delivery_driver: false,
        activo: true,
      });
      setEditingId(null);
    }
    setShowForm(true);
  };

  const saveEmpleado = async () => {
    if (!formData.nombre_completo || !formData.cargo || !formData.sucursal_id) {
      alert('Nombre, cargo y sucursal son requeridos');
      return;
    }

    try {
      const data = {
        nombre_completo: formData.nombre_completo,
        codigo_empleado: formData.codigo_empleado,
        dui: formData.dui,
        nit: formData.nit,
        cargo: formData.cargo,
        tipo_empleado: formData.tipo_empleado,
        sucursal_id: formData.sucursal_id,
        salario_mensual: n(formData.salario_mensual) || 0,
        tipo_contrato: formData.tipo_contrato,
        banco: formData.banco,
        cuenta_bancaria: formData.cuenta_bancaria,
        telefono: formData.telefono,
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

      setShowForm(false);
      setFormData(null);
      setEditingId(null);
      await cargar();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  const toggleActivo = async (id, activo) => {
    try {
      await db.from('empleados').update({ activo: !activo }).eq('id', id);
      await cargar();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  if (loading) {
    return <div style={{ color: colors.textDim }}>Cargando empleados...</div>;
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filtroSucursal}
          onChange={(e) => setFiltroSucursal(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bgCard,
            color: colors.text,
            fontSize: 13,
          }}
        >
          <option value="">Todas sucursales</option>
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>

        <select
          value={filtroCargo}
          onChange={(e) => setFiltroCargo(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bgCard,
            color: colors.text,
            fontSize: 13,
          }}
        >
          <option value="">Todos cargos</option>
          {cargosUnicos.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bgCard,
            color: colors.text,
            fontSize: 13,
          }}
        >
          <option value="todos">Todos</option>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
        </select>

        {canEdit && (
          <button
            onClick={() => openForm()}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: colors.green,
              color: '#000',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            + Nuevo
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="card" style={{ overflowX: 'auto', padding: 0, marginBottom: 20 }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            minWidth: 600,
          }}
        >
          <thead>
            <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Nombre</th>
              <th style={thStyle}>Cargo</th>
              <th style={thStyle}>Sucursal</th>
              <th style={thStyle}>Salario</th>
              <th style={thStyle}>Estado</th>
              {canEdit && <th style={thStyle}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filtrados.map((emp) => (
              <tr key={emp.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                <td style={tdStyle}>{emp.codigo_empleado || '—'}</td>
                <td style={tdStyle}>{emp.nombre_completo}</td>
                <td style={tdStyle}>{emp.cargo || '—'}</td>
                <td style={tdStyle}>{emp.sucursales?.nombre || '—'}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>
                  ${n(emp.salario_mensual).toFixed(2)}
                </td>
                <td style={tdStyle}>
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: emp.activo ? colors.green + '26' : colors.red + '26',
                      color: emp.activo ? colors.green : colors.red,
                    }}
                  >
                    {emp.activo ? '✓ Activo' : '✗ Inactivo'}
                  </span>
                </td>
                {canEdit && (
                  <td style={tdStyle}>
                    <button
                      onClick={() => openForm(emp)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: colors.yellow,
                        cursor: 'pointer',
                        fontSize: 13,
                        marginRight: 8,
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => toggleActivo(emp.id, emp.activo)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: emp.activo ? colors.red : colors.green,
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
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
        <div style={{ textAlign: 'center', color: colors.textDim, padding: 20 }}>
          No hay empleados que coincidan con los filtros
        </div>
      )}

      {/* Modal Formulario */}
      {showForm && formData && (
        <ModalEmpleado
          formData={formData}
          setFormData={setFormData}
          onSave={saveEmpleado}
          onCancel={() => {
            setShowForm(false);
            setFormData(null);
          }}
          sucursales={sucursales}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: ASISTENCIA
// ═══════════════════════════════════════════════════════════════
function TabAsistencia({ sucursales }) {
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

      // Cargar asistencia del día
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

  useEffect(() => {
    cargarEmpleados();
  }, [cargarEmpleados]);

  const marcarPresente = async (empId, nuevoEstado) => {
    try {
      const hora = new Date().toISOString().substring(11, 16);

      // Verificar si ya existe
      const { data: existe } = await db
        .from('asistencia_diaria')
        .select('id')
        .eq('empleado_id', empId)
        .eq('fecha', fechaSeleccionada)
        .maybeSingle();

      if (existe) {
        if (nuevoEstado === 'presente') {
          await db
            .from('asistencia_diaria')
            .update({ estado: 'presente', hora_entrada: hora })
            .eq('id', existe.id);
        } else {
          await db.from('asistencia_diaria').delete().eq('id', existe.id);
        }
      } else if (nuevoEstado === 'presente') {
        await db.from('asistencia_diaria').insert({
          empleado_id: empId,
          fecha: fechaSeleccionada,
          estado: 'presente',
          hora_entrada: hora,
        });
      }

      setAsistencia(prev => ({
        ...prev,
        [empId]: nuevoEstado === 'presente' ? { estado: 'presente', hora } : undefined,
      }));
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="date"
          value={fechaSeleccionada}
          onChange={(e) => setFechaSeleccionada(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bgCard,
            color: colors.text,
            fontSize: 13,
          }}
        />

        <select
          value={sucursalSel}
          onChange={(e) => setSucursalSel(e.target.value)}
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: colors.bgCard,
            color: colors.text,
            fontSize: 13,
          }}
        >
          {sucursales.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ color: colors.textDim }}>Cargando...</div>
      ) : (
        <div>
          {empleados.map((emp) => {
            const asist = asistencia[emp.id];
            const presente = asist?.estado === 'presente';

            return (
              <div
                key={emp.id}
                className="card"
                style={{
                  padding: '12px 14px',
                  marginBottom: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: colors.text, fontSize: 13 }}>
                    {emp.nombre_completo}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
                    {emp.cargo}
                  </div>
                  {asist?.hora && (
                    <div style={{ fontSize: 11, color: colors.green, marginTop: 4 }}>
                      Entrada: {asist.hora}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => marcarPresente(emp.id, presente ? 'ausente' : 'presente')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: presente ? colors.green : colors.bgCard,
                    color: presente ? '#000' : colors.text,
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 12,
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
        <div style={{ textAlign: 'center', color: colors.textDim, padding: 20 }}>
          No hay empleados activos en esta sucursal
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: DESCUENTOS
// ═══════════════════════════════════════════════════════════════
function TabDescuentos({ canEdit }) {
  const [descuentos, setDescuentos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [descRes, empRes] = await Promise.all([
        db
          .from('descuentos_empleado')
          .select('*, empleados(id, nombre_completo, codigo_empleado)')
          .eq('activo', true)
          .order('created_at', { ascending: false }),
        db
          .from('empleados')
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

  useEffect(() => {
    cargar();
  }, [cargar]);

  const openForm = (desc = null) => {
    if (desc) {
      setFormData({ ...desc });
    } else {
      setFormData({
        empleado_id: '',
        tipo: '',
        descripcion: '',
        monto_total: '',
        monto_cuota: '',
        cuotas_totales: '',
        cuotas_pagadas: 0,
      });
    }
    setShowForm(true);
  };

  const saveDescuento = async () => {
    if (!formData.empleado_id || !formData.tipo || !formData.monto_total || !formData.cuotas_totales) {
      alert('Empleado, tipo, monto total y cuotas son requeridos');
      return;
    }

    try {
      const data = {
        empleado_id: formData.empleado_id,
        tipo: formData.tipo,
        descripcion: formData.descripcion,
        monto_total: n(formData.monto_total),
        monto_cuota: n(formData.monto_total) / parseInt(formData.cuotas_totales),
        cuotas_totales: parseInt(formData.cuotas_totales),
        cuotas_pagadas: parseInt(formData.cuotas_pagadas) || 0,
        activo: true,
      };

      if (formData.id) {
        await db.from('descuentos_empleado').update(data).eq('id', formData.id);
      } else {
        await db.from('descuentos_empleado').insert(data);
      }

      setShowForm(false);
      setFormData(null);
      await cargar();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  };

  if (loading) {
    return <div style={{ color: colors.textDim }}>Cargando descuentos...</div>;
  }

  return (
    <div>
      {canEdit && (
        <button
          onClick={() => openForm()}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: colors.green,
            color: '#000',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          + Nuevo
        </button>
      )}

      {descuentos.map((desc) => {
        const pct = (desc.cuotas_pagadas / desc.cuotas_totales) * 100;

        return (
          <div
            key={desc.id}
            className="card"
            style={{
              padding: '12px 14px',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, color: colors.text, fontSize: 13 }}>
                  {desc.empleados?.nombre_completo}
                </div>
                <div style={{ fontSize: 12, color: colors.textDim, marginTop: 2 }}>
                  {desc.tipo} - {desc.descripcion || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.yellow }}>
                  ${n(desc.monto_total).toFixed(2)}
                </div>
                <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>
                  {desc.cuotas_pagadas}/{desc.cuotas_totales} cuotas
                </div>
              </div>
            </div>

            {/* Barra de progreso */}
            <div
              style={{
                width: '100%',
                height: 6,
                background: colors.border,
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: pct === 100 ? colors.green : colors.yellow,
                  transition: 'width 0.3s',
                }}
              />
            </div>

            {canEdit && (
              <button
                onClick={() => openForm(desc)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.yellow,
                  cursor: 'pointer',
                  fontSize: 12,
                  textDecoration: 'underline',
                }}
              >
                Editar
              </button>
            )}
          </div>
        );
      })}

      {descuentos.length === 0 && (
        <div style={{ textAlign: 'center', color: colors.textDim, padding: 20 }}>
          No hay descuentos activos
        </div>
      )}

      {showForm && formData && (
        <ModalDescuento
          formData={formData}
          setFormData={setFormData}
          empleados={empleados}
          onSave={saveDescuento}
          onCancel={() => {
            setShowForm(false);
            setFormData(null);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════════════
function ModalEmpleado({ formData, setFormData, onSave, onCancel, sucursales }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="modal"
        style={{
          maxWidth: 500,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: colors.text }}>
          {formData.id ? 'Editar Empleado' : 'Nuevo Empleado'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <InputField
            label="Nombre Completo *"
            value={formData.nombre_completo}
            onChange={(e) => setFormData({ ...formData, nombre_completo: e.target.value })}
          />
          <InputField
            label="Código"
            value={formData.codigo_empleado}
            onChange={(e) => setFormData({ ...formData, codigo_empleado: e.target.value })}
          />
          <InputField
            label="DUI"
            value={formData.dui}
            onChange={(e) => setFormData({ ...formData, dui: e.target.value })}
            placeholder="123456789"
          />
          <InputField
            label="NIT"
            value={formData.nit}
            onChange={(e) => setFormData({ ...formData, nit: e.target.value })}
          />
          <SelectField
            label="Cargo *"
            value={formData.cargo}
            onChange={(e) => setFormData({ ...formData, cargo: e.target.value })}
            options={CARGOS_REALES}
          />
          <InputField
            label="Tipo Empleado"
            value={formData.tipo_empleado}
            onChange={(e) => setFormData({ ...formData, tipo_empleado: e.target.value })}
          />
          <SelectField
            label="Sucursal *"
            value={formData.sucursal_id}
            onChange={(e) => setFormData({ ...formData, sucursal_id: e.target.value })}
            options={sucursales}
            optionKey="id"
            optionLabel="nombre"
          />
          <InputField
            label="Salario Mensual"
            type="number"
            value={formData.salario_mensual}
            onChange={(e) => setFormData({ ...formData, salario_mensual: e.target.value })}
          />
          <InputField
            label="Tipo Contrato"
            value={formData.tipo_contrato}
            onChange={(e) => setFormData({ ...formData, tipo_contrato: e.target.value })}
          />
          <InputField
            label="Banco"
            value={formData.banco}
            onChange={(e) => setFormData({ ...formData, banco: e.target.value })}
          />
          <InputField
            label="Cuenta Bancaria"
            value={formData.cuenta_bancaria}
            onChange={(e) => setFormData({ ...formData, cuenta_bancaria: e.target.value })}
          />
          <InputField
            label="Teléfono"
            type="tel"
            value={formData.telefono}
            onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
          />
          <InputField
            label="Contacto Emergencia"
            value={formData.contacto_emergencia}
            onChange={(e) => setFormData({ ...formData, contacto_emergencia: e.target.value })}
          />
          <InputField
            label="Fecha Ingreso"
            type="date"
            value={formData.fecha_ingreso}
            onChange={(e) => setFormData({ ...formData, fecha_ingreso: e.target.value })}
          />

          <div style={{ gridColumn: '1 / -1' }}>
            <CheckboxField
              label="Recibe Propina"
              checked={formData.recibe_propina}
              onChange={(e) => setFormData({ ...formData, recibe_propina: e.target.checked })}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <CheckboxField
              label="Es Delivery Driver"
              checked={formData.es_delivery_driver}
              onChange={(e) => setFormData({ ...formData, es_delivery_driver: e.target.checked })}
            />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <CheckboxField
              label="Activo"
              checked={formData.activo}
              onChange={(e) => setFormData({ ...formData, activo: e.target.checked })}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: colors.bgCard,
              color: colors.text,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 6,
              border: 'none',
              background: colors.green,
              color: '#000',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalDescuento({ formData, setFormData, empleados, onSave, onCancel }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
        padding: 16,
      }}
      onClick={onCancel}
    >
      <div
        className="modal"
        style={{
          maxWidth: 400,
          width: '100%',
          padding: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', color: colors.text }}>
          {formData.id ? 'Editar Descuento' : 'Nuevo Descuento'}
        </h2>

        <div style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
          <SelectField
            label="Empleado *"
            value={formData.empleado_id}
            onChange={(e) => setFormData({ ...formData, empleado_id: e.target.value })}
            options={empleados}
            optionKey="id"
            optionLabel="nombre_completo"
          />
          <SelectField
            label="Tipo *"
            value={formData.tipo}
            onChange={(e) => setFormData({ ...formData, tipo: e.target.value })}
            options={TIPOS_DESCUENTOS}
          />
          <InputField
            label="Descripción"
            value={formData.descripcion}
            onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
          />
          <InputField
            label="Monto Total *"
            type="number"
            value={formData.monto_total}
            onChange={(e) => setFormData({ ...formData, monto_total: e.target.value })}
          />
          <InputField
            label="Cuotas Totales *"
            type="number"
            value={formData.cuotas_totales}
            onChange={(e) => setFormData({ ...formData, cuotas_totales: e.target.value })}
            min="1"
          />
          <InputField
            label="Cuotas Pagadas"
            type="number"
            value={formData.cuotas_pagadas}
            onChange={(e) => setFormData({ ...formData, cuotas_pagadas: e.target.value })}
            min="0"
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: colors.bgCard,
              color: colors.text,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: 6,
              border: 'none',
              background: colors.green,
              color: '#000',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            Guardar
          </button>
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
      {label && (
        <label style={{ display: 'block', fontSize: 12, color: colors.textDim, marginBottom: 4 }}>
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        min={min}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          border: `1px solid ${colors.border}`,
          background: colors.bgCard,
          color: colors.text,
          fontSize: 13,
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options, optionKey = null, optionLabel = null }) {
  return (
    <div>
      {label && (
        <label style={{ display: 'block', fontSize: 12, color: colors.textDim, marginBottom: 4 }}>
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={onChange}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: 6,
          border: `1px solid ${colors.border}`,
          background: colors.bgCard,
          color: colors.text,
          fontSize: 13,
          boxSizing: 'border-box',
        }}
      >
        <option value="">— Seleccionar —</option>
        {options.map((opt) => {
          if (optionKey) {
            return (
              <option key={opt[optionKey]} value={opt[optionKey]}>
                {opt[optionLabel]}
              </option>
            );
          }
          return (
            <option key={opt} value={opt}>
              {opt}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function CheckboxField({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ width: 18, height: 18, cursor: 'pointer' }}
      />
      <span style={{ fontSize: 13, color: colors.text }}>{label}</span>
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 5: USUARIOS PIN (usuarios_erp)
// ═══════════════════════════════════════════════════════════════
function TabUsuariosPIN({ canEdit, sucursales }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [editando, setEditando] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (text, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 2500);
  };

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
      showToast('Sucursal y rol son requeridos', false); return;
    }
    setSaving(true);
    try {
      const { error } = await db.from('usuarios_erp').update({
        store_code: editando.store_code,
        rol: editando.rol,
        nombre: editando.nombre,
        apellido: editando.apellido,
      }).eq('id', editando.id);
      if (error) { showToast('Error: ' + error.message, false); setSaving(false); return; }
      showToast('✓ Usuario actualizado');
      setEditando(null);
      await cargar();
    } catch (e) { showToast(e.message, false); }
    setSaving(false);
  };

  const inputSm = {
    padding: '6px 8px', borderRadius: 6, border: `1px solid ${colors.border}`,
    background: colors.bg, color: colors.text, fontSize: 12,
    fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
  };

  if (loading) return <div style={{ color: colors.textDim }}>Cargando usuarios...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.bgCard, color: colors.text, fontSize: 13 }}>
          <option value="">Todas las sucursales</option>
          <option value="__sin_sucursal__">⚠️ Sin sucursal asignada</option>
          {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
        </select>
        <select value={filtroRol} onChange={e => setFiltroRol(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.bgCard, color: colors.text, fontSize: 13 }}>
          <option value="">Todos los roles</option>
          {rolesUnicos.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 11, color: colors.textDim, marginBottom: 12, padding: '6px 10px', background: 'rgba(230,57,70,0.08)', borderRadius: 6, border: '1px solid rgba(230,57,70,0.2)' }}>
        🔒 Los usuarios con rol <strong>ejecutivo</strong> y <strong>admin</strong> no se pueden editar desde aquí.
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 500 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${colors.border}` }}>
              <th style={thStyle}>Nombre</th>
              <th style={thStyle}>PIN</th>
              <th style={thStyle}>Rol</th>
              <th style={thStyle}>Sucursal</th>
              {canEdit && <th style={thStyle}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filtrados.map(u => {
              const esProtegido = ROLES_PROTEGIDOS.includes(u.rol);
              const isEditing = editando?.id === u.id;
              return (
                <tr key={u.id} style={{ borderBottom: `1px solid ${colors.border}`, opacity: u.activo ? 1 : 0.5 }}>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input value={editando.nombre} onChange={e => setEditando({ ...editando, nombre: e.target.value })} style={inputSm} placeholder="Nombre" />
                        <input value={editando.apellido} onChange={e => setEditando({ ...editando, apellido: e.target.value })} style={inputSm} placeholder="Apellido" />
                      </div>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{u.nombre} {u.apellido}</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', color: colors.yellow }}>{u.pin}</td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <select value={editando.rol} onChange={e => setEditando({ ...editando, rol: e.target.value })} style={inputSm}>
                        {ROLES_EDITABLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : (
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: esProtegido ? 'rgba(230,57,70,0.15)' : 'rgba(96,165,250,0.15)',
                        color: esProtegido ? colors.red : colors.blue }}>
                        {esProtegido ? '🔒 ' : ''}{u.rol}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {isEditing ? (
                      <select value={editando.store_code} onChange={e => setEditando({ ...editando, store_code: e.target.value })} style={inputSm}>
                        <option value="">— Seleccionar —</option>
                        {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
                      </select>
                    ) : (
                      <span style={{ color: colors.textDim, fontSize: 12 }}>
                        {sucursales.find(s => s.store_code === u.store_code)?.nombre || u.store_code || '—'}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={tdStyle}>
                      {esProtegido ? (
                        <span style={{ fontSize: 11, color: colors.textDim }}>—</span>
                      ) : isEditing ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={guardar} disabled={saving}
                            style={{ padding: '4px 10px', borderRadius: 6, background: colors.green, color: '#000', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                            {saving ? '...' : '✓ Guardar'}
                          </button>
                          <button onClick={() => setEditando(null)}
                            style={{ padding: '4px 8px', borderRadius: 6, background: colors.bgCard, color: colors.textDim, border: `1px solid ${colors.border}`, cursor: 'pointer', fontSize: 11 }}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setEditando({ ...u })}
                          style={{ background: 'none', border: 'none', color: colors.yellow, cursor: 'pointer', fontSize: 14 }}>
                          ✏️
                        </button>
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
        <div style={{ textAlign: 'center', color: colors.textDim, padding: 20 }}>Sin resultados</div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1000,
          background: toast.ok ? 'rgba(74,222,128,0.15)' : 'rgba(230,57,70,0.15)',
          color: toast.ok ? colors.green : colors.red,
          border: `1px solid ${toast.ok ? colors.green : colors.red}` }}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ESTILOS GLOBALES
// ─────────────────────────────────────────────────────────────
const thStyle = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 12,
  fontWeight: 700,
  color: colors.textDim,
  borderBottom: `2px solid ${colors.border}`,
};

const tdStyle = {
  padding: '10px 12px',
  fontSize: 13,
  color: colors.text,
  borderBottom: `1px solid ${colors.border}`,
};
