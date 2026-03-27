import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { n } from '../../config';

// ── Usuarios con acceso de edición ──
const EDIT_PINS = ['2000', '1000']; // Cesar Rodriguez, Jose Isart (ejecutivos)
const CARGOS = ['gerente', 'cajera', 'cocinero', 'repartidor', 'bodeguero', 'produccion', 'limpieza', 'auxiliar'];
const TIPOS_CONTRATO = ['permanente', 'temporal', 'medio_tiempo'];
const CONCEPTOS_DESCUENTOS = ['préstamo', 'uniforme', 'adelanto', 'daño'];

// ── Helper: formato moneda ──
const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

// ── Badge para estado activo ──
function EstadoBadge({ activo }) {
  return (
    <span className={`px-2 py-1 rounded text-xs font-600 ${
      activo ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'
    }`}>
      {activo ? '✓ Activo' : '✗ Inactivo'}
    </span>
  );
}

// ── Modal formulario empleado ──
function ModalEmpleado({ empleado, sucursales, onSave, onCancel, canEdit }) {
  const [form, setForm] = useState(empleado || {
    nombre: '', dui: '', cargo: '', sucursal_id: '', salario_base: '', tipo_contrato: '',
    banco: '', numero_cuenta: '', telefono: '', email: '', contacto_emergencia: '', fecha_ingreso: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSave = async () => {
    if (!form.nombre || !form.cargo || !form.sucursal_id) {
      setError('Nombre, cargo y sucursal son requeridos');
      return;
    }
    if (!form.dui.match(/^\d{9}$/)) {
      setError('DUI debe tener 9 dígitos');
      return;
    }
    setSaving(true);
    try {
      const data = {
        nombre: form.nombre, dui: form.dui, cargo: form.cargo, sucursal_id: form.sucursal_id,
        salario_base: n(form.salario_base) || 0, tipo_contrato: form.tipo_contrato,
        banco: form.banco, numero_cuenta: form.numero_cuenta, telefono: form.telefono,
        email: form.email, contacto_emergencia: form.contacto_emergencia, fecha_ingreso: form.fecha_ingreso || new Date().toISOString().split('T')[0]
      };
      if (form.id) {
        await db.from('empleados').update(data).eq('id', form.id);
      } else {
        // Generar código con RPC
        const { data: codeData } = await db.rpc('gen_codigo_empleado');
        data.codigo = codeData;
        await db.from('empleados').insert(data);
      }
      onSave();
    } catch (err) {
      setError('Error al guardar: ' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-96 overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-700 mb-4">{form.id ? 'Editar Empleado' : 'Nuevo Empleado'}</h2>
          {error && <div className="bg-red-100 text-red-800 p-2 rounded mb-4 text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-600 mb-1">Nombre *</label>
              <input type="text" name="nombre" value={form.nombre} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" placeholder="Nombre completo" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">DUI *</label>
              <input type="text" name="dui" value={form.dui} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" placeholder="123456789" maxLength="9" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Cargo *</label>
              <select name="cargo" value={form.cargo} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Seleccionar</option>
                {CARGOS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Sucursal *</label>
              <select name="sucursal_id" value={form.sucursal_id} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Seleccionar</option>
                {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Salario Base (USD)</label>
              <input type="number" name="salario_base" value={form.salario_base} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" step="0.01" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Tipo Contrato</label>
              <select name="tipo_contrato" value={form.tipo_contrato} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Seleccionar</option>
                {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Banco</label>
              <input type="text" name="banco" value={form.banco} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" placeholder="Ej: Banco Agrícola" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Número Cuenta</label>
              <input type="text" name="numero_cuenta" value={form.numero_cuenta} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Teléfono</label>
              <input type="tel" name="telefono" value={form.telefono} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Email</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-600 mb-1">Contacto Emergencia</label>
              <input type="text" name="contacto_emergencia" value={form.contacto_emergencia} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Fecha Ingreso</label>
              <input type="date" name="fecha_ingreso" value={form.fecha_ingreso} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-6">
            <button onClick={onCancel} className="px-4 py-2 border rounded text-sm font-600 hover:bg-gray-100">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-600 hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal descuento ──
function ModalDescuento({ empleados, onSave, onCancel }) {
  const [form, setForm] = useState({ empleado_id: '', concepto: '', monto_cuota: '', cuotas_totales: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSave = async () => {
    if (!form.empleado_id || !form.concepto || !form.monto_cuota || !form.cuotas_totales) {
      setError('Todos los campos son requeridos');
      return;
    }
    setSaving(true);
    try {
      await db.from('descuentos_empleado').insert({
        empleado_id: form.empleado_id, concepto: form.concepto,
        monto_cuota: n(form.monto_cuota), cuotas_totales: parseInt(form.cuotas_totales),
        cuotas_pagadas: 0, activo: true
      });
      onSave();
    } catch (err) {
      setError('Error: ' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
        <div className="p-6">
          <h2 className="text-xl font-700 mb-4">Nuevo Descuento</h2>
          {error && <div className="bg-red-100 text-red-800 p-2 rounded mb-4 text-sm">{error}</div>}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-600 mb-1">Empleado *</label>
              <select name="empleado_id" value={form.empleado_id} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Seleccionar</option>
                {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} ({e.codigo})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Concepto *</label>
              <select name="concepto" value={form.concepto} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">Seleccionar o escribir</option>
                {CONCEPTOS_DESCUENTOS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="text" value={form.concepto} onChange={(e) => setForm(prev => ({ ...prev, concepto: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm mt-1" placeholder="Otro concepto" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Monto por Cuota (USD) *</label>
              <input type="number" name="monto_cuota" value={form.monto_cuota} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" step="0.01" />
            </div>
            <div>
              <label className="block text-sm font-600 mb-1">Total de Cuotas *</label>
              <input type="number" name="cuotas_totales" value={form.cuotas_totales} onChange={handleChange} className="w-full border rounded px-3 py-2 text-sm" min="1" />
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-6">
            <button onClick={onCancel} className="px-4 py-2 border rounded text-sm font-600 hover:bg-gray-100">Cancelar</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-600 hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Empleados ──
function TabEmpleados({ canEdit }) {
  const [empleados, setEmpleados] = useState([]);
  const [sucursales, setSucursales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroCargo, setFiltroCargo] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('todos');
  const [showModal, setShowModal] = useState(false);
  const [editEmpleado, setEditEmpleado] = useState(null);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, sRes] = await Promise.all([
        db.from('empleados').select('*').order('nombre'),
        db.from('sucursales').select('*').eq('activo', true).order('nombre')
      ]);
      setEmpleados(eRes.data || []);
      setSucursales(sRes.data || []);
    } catch (err) {
      setMensaje('Error cargando: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const filtrados = empleados.filter(e => {
    if (filtroSucursal && e.sucursal_id !== filtroSucursal) return false;
    if (filtroCargo && e.cargo !== filtroCargo) return false;
    if (filtroActivo === 'activos' && !e.activo) return false;
    if (filtroActivo === 'inactivos' && e.activo) return false;
    return true;
  });

  const handleToggleActivo = async (id, activo) => {
    try {
      await db.from('empleados').update({ activo: !activo }).eq('id', id);
      await cargar();
      setMensaje('✓ Actualizado');
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    }
  };

  const handleSaveEmpleado = async () => {
    setShowModal(false);
    setEditEmpleado(null);
    await cargar();
    setMensaje('✓ Empleado guardado');
  };

  return (
    <div>
      {mensaje && <div className="bg-green-100 text-green-800 p-2 rounded mb-4 text-sm">{mensaje}</div>}

      <div className="flex gap-4 mb-6 flex-wrap">
        <select value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="">Todas sucursales</option>
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <select value={filtroCargo} onChange={(e) => setFiltroCargo(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="">Todos cargos</option>
          {CARGOS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)} className="border rounded px-3 py-2 text-sm">
          <option value="todos">Todos</option>
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
        </select>
        {canEdit && (
          <button onClick={() => { setEditEmpleado(null); setShowModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-600 hover:bg-blue-700 ml-auto">
            + Nuevo Empleado
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-4 text-gray-600">Cargando...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b">
                <th className="px-4 py-2 text-left font-600">Código</th>
                <th className="px-4 py-2 text-left font-600">Nombre</th>
                <th className="px-4 py-2 text-left font-600">Cargo</th>
                <th className="px-4 py-2 text-left font-600">Sucursal</th>
                <th className="px-4 py-2 text-left font-600">Salario</th>
                <th className="px-4 py-2 text-left font-600">Estado</th>
                {canEdit && <th className="px-4 py-2 text-center font-600">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan="7" className="px-4 py-4 text-center text-gray-500">Sin empleados</td></tr>
              ) : (
                filtrados.map(e => (
                  <tr key={e.id} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => canEdit && (setEditEmpleado(e), setShowModal(true))}>
                    <td className="px-4 py-2 font-600">{e.codigo}</td>
                    <td className="px-4 py-2">{e.nombre}</td>
                    <td className="px-4 py-2">{e.cargo}</td>
                    <td className="px-4 py-2">{sucursales.find(s => s.id === e.sucursal_id)?.nombre || '-'}</td>
                    <td className="px-4 py-2 text-right">{fmt$(e.salario_base)}</td>
                    <td className="px-4 py-2"><EstadoBadge activo={e.activo} /></td>
                    {canEdit && (
                      <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleToggleActivo(e.id, e.activo)} className="text-xs text-blue-600 hover:underline">
                          {e.activo ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <ModalEmpleado empleado={editEmpleado} sucursales={sucursales} onSave={handleSaveEmpleado} onCancel={() => setShowModal(false)} canEdit={canEdit} />}
    </div>
  );
}

// ── Tab: Asistencia ──
function TabAsistencia() {
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [sucursales, setSucursales] = useState([]);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [asistencias, setAsistencias] = useState([]);
  const [empleadosSucursal, setEmpleadosSucursal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mensaje, setMensaje] = useState('');
  const [editAsistencia, setEditAsistencia] = useState(null);
  const [editForm, setEditForm] = useState({});

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await db.from('sucursales').select('*').eq('activo', true).order('nombre');
      setSucursales(sRes.data || []);
      if (!filtroSucursal && sRes.data?.length > 0) {
        setFiltroSucursal(sRes.data[0].id);
      }
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  const cargarAsistencia = useCallback(async () => {
    if (!filtroSucursal) return;
    try {
      const [aRes, eRes] = await Promise.all([
        db.from('asistencia_diaria').select('*').eq('fecha', fecha),
        db.from('empleados').select('*').eq('sucursal_id', filtroSucursal).eq('activo', true).order('nombre')
      ]);
      setAsistencias(aRes.data || []);
      setEmpleadosSucursal(eRes.data || []);
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    }
  }, [fecha, filtroSucursal]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarAsistencia(); }, [cargarAsistencia]);

  const marcarPresente = async (empleadoId) => {
    try {
      const existe = asistencias.find(a => a.empleado_id === empleadoId && a.fecha === fecha);
      const hora = new Date().toTimeString().split(' ')[0];
      if (existe) {
        await db.from('asistencia_diaria').update({ hora_entrada: hora }).eq('id', existe.id);
      } else {
        await db.from('asistencia_diaria').insert({
          empleado_id: empleadoId, fecha, hora_entrada: hora, estado: 'presente'
        });
      }
      await cargarAsistencia();
      setMensaje('✓ Asistencia registrada');
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    }
  };

  const guardarEdicion = async () => {
    try {
      await db.from('asistencia_diaria').update(editForm).eq('id', editAsistencia.id);
      setEditAsistencia(null);
      await cargarAsistencia();
      setMensaje('✓ Guardado');
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    }
  };

  const resumen = {
    presentes: asistencias.filter(a => a.estado === 'presente').length,
    ausentes: asistencias.filter(a => a.estado === 'ausente').length,
    tardanzas: asistencias.filter(a => a.estado === 'tardanza').length,
  };

  return (
    <div>
      {mensaje && <div className="bg-green-100 text-green-800 p-2 rounded mb-4 text-sm">{mensaje}</div>}

      <div className="flex gap-4 mb-6 flex-wrap items-center">
        <div>
          <label className="block text-sm font-600 mb-1">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="border rounded px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-600 mb-1">Sucursal</label>
          <select value={filtroSucursal} onChange={(e) => setFiltroSucursal(e.target.value)} className="border rounded px-3 py-2 text-sm">
            {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      </div>

      {!loading && (
        <div className="bg-gray-50 p-4 rounded mb-6 grid grid-cols-3 gap-4">
          <div>
            <div className="text-3xl font-700 text-green-600">{resumen.presentes}</div>
            <div className="text-sm text-gray-600">Presentes</div>
          </div>
          <div>
            <div className="text-3xl font-700 text-red-600">{resumen.ausentes}</div>
            <div className="text-sm text-gray-600">Ausentes</div>
          </div>
          <div>
            <div className="text-3xl font-700 text-yellow-600">{resumen.tardanzas}</div>
            <div className="text-sm text-gray-600">Tardanzas</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-4 text-gray-600">Cargando...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b">
                <th className="px-4 py-2 text-left font-600">Empleado</th>
                <th className="px-4 py-2 text-left font-600">Entrada</th>
                <th className="px-4 py-2 text-left font-600">Salida</th>
                <th className="px-4 py-2 text-left font-600">Estado</th>
                <th className="px-4 py-2 text-left font-600">H. Extra</th>
                <th className="px-4 py-2 text-left font-600">Acción</th>
              </tr>
            </thead>
            <tbody>
              {empleadosSucursal.length === 0 ? (
                <tr><td colSpan="6" className="px-4 py-4 text-center text-gray-500">Sin empleados</td></tr>
              ) : (
                empleadosSucursal.map(e => {
                  const asist = asistencias.find(a => a.empleado_id === e.id);
                  return (
                    <tr key={e.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-600">{e.nombre}</td>
                      <td className="px-4 py-2 cursor-pointer" onClick={() => asist && (setEditAsistencia(asist), setEditForm({ ...asist }))}>
                        {asist?.hora_entrada || '-'}
                      </td>
                      <td className="px-4 py-2 cursor-pointer" onClick={() => asist && (setEditAsistencia(asist), setEditForm({ ...asist }))}>
                        {asist?.hora_salida || '-'}
                      </td>
                      <td className="px-4 py-2">{asist?.estado || '-'}</td>
                      <td className="px-4 py-2 text-right">{asist?.horas_extra || '0'}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => marcarPresente(e.id)} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                          {asist ? 'Editar' : 'Marcar'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {editAsistencia && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-700 mb-4">Editar Asistencia</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-600 mb-1">Hora Entrada</label>
                <input type="time" value={editForm.hora_entrada || ''} onChange={(e) => setEditForm(prev => ({ ...prev, hora_entrada: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-600 mb-1">Hora Salida</label>
                <input type="time" value={editForm.hora_salida || ''} onChange={(e) => setEditForm(prev => ({ ...prev, hora_salida: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-600 mb-1">Estado</label>
                <select value={editForm.estado || ''} onChange={(e) => setEditForm(prev => ({ ...prev, estado: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm">
                  <option value="presente">Presente</option>
                  <option value="ausente">Ausente</option>
                  <option value="tardanza">Tardanza</option>
                  <option value="permiso">Permiso</option>
                  <option value="vacacion">Vacación</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button onClick={() => setEditAsistencia(null)} className="px-4 py-2 border rounded text-sm font-600 hover:bg-gray-100">Cancelar</button>
              <button onClick={guardarEdicion} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-600 hover:bg-blue-700">Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Descuentos ──
function TabDescuentos({ canEdit }) {
  const [descuentos, setDescuentos] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [mensaje, setMensaje] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [dRes, eRes] = await Promise.all([
        db.from('descuentos_empleado').select('*').eq('activo', true).order('fecha_inicio', { ascending: false }),
        db.from('empleados').select('*').eq('activo', true).order('nombre')
      ]);
      setDescuentos(dRes.data || []);
      setEmpleados(eRes.data || []);
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const marcarCuotaPagada = async (id, cuotasPagadas, cuotasTotales) => {
    try {
      const nuevas = cuotasPagadas + 1;
      await db.from('descuentos_empleado').update({
        cuotas_pagadas: nuevas,
        activo: nuevas < cuotasTotales
      }).eq('id', id);
      await cargar();
      setMensaje('✓ Cuota registrada');
    } catch (err) {
      setMensaje('Error: ' + (err.message || ''));
    }
  };

  return (
    <div>
      {mensaje && <div className="bg-green-100 text-green-800 p-2 rounded mb-4 text-sm">{mensaje}</div>}

      {canEdit && (
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-600 hover:bg-blue-700 mb-6">
          + Nuevo Descuento
        </button>
      )}

      {loading ? (
        <div className="text-center py-4 text-gray-600">Cargando...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 border-b">
                <th className="px-4 py-2 text-left font-600">Empleado</th>
                <th className="px-4 py-2 text-left font-600">Concepto</th>
                <th className="px-4 py-2 text-left font-600">Cuota</th>
                <th className="px-4 py-2 text-left font-600">Progreso</th>
                <th className="px-4 py-2 text-left font-600">Estado</th>
                {canEdit && <th className="px-4 py-2 text-center font-600">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {descuentos.length === 0 ? (
                <tr><td colSpan="6" className="px-4 py-4 text-center text-gray-500">Sin descuentos activos</td></tr>
              ) : (
                descuentos.map(d => {
                  const emp = empleados.find(e => e.id === d.empleado_id);
                  return (
                    <tr key={d.id} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2 font-600">{emp?.nombre || '-'}</td>
                      <td className="px-4 py-2">{d.concepto}</td>
                      <td className="px-4 py-2 text-right">{fmt$(d.monto_cuota)}</td>
                      <td className="px-4 py-2">{d.cuotas_pagadas}/{d.cuotas_totales}</td>
                      <td className="px-4 py-2"><EstadoBadge activo={d.activo} /></td>
                      {canEdit && (
                        <td className="px-4 py-2 text-center">
                          {d.cuotas_pagadas < d.cuotas_totales && (
                            <button onClick={() => marcarCuotaPagada(d.id, d.cuotas_pagadas, d.cuotas_totales)} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                              Pagar
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <ModalDescuento empleados={empleados} onSave={() => { setShowModal(false); cargar(); }} onCancel={() => setShowModal(false)} />}
    </div>
  );
}

// ── COMPONENTE PRINCIPAL ──
export default function RRHHView({ user, onBack }) {
  const [tab, setTab] = useState('empleados');
  const canEdit = EDIT_PINS.includes(user?.pin);

  if (!canEdit) {
    return (
      <div className="p-6 bg-red-100 text-red-800 rounded">
        <p className="font-600">Acceso denegado</p>
        <p className="text-sm">Solo roles ejecutivos/RRHH pueden ver este módulo.</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 bg-red-600 text-white rounded text-sm font-600 hover:bg-red-700">Volver</button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-700">Recursos Humanos</h1>
        <button onClick={onBack} className="px-4 py-2 border rounded text-sm font-600 hover:bg-gray-100">← Volver</button>
      </div>

      <div className="flex gap-2 mb-6 border-b">
        {['empleados', 'asistencia', 'descuentos'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-3 font-600 text-sm border-b-2 transition ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'empleados' ? 'Empleados' : t === 'asistencia' ? 'Asistencia' : 'Descuentos'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        {tab === 'empleados' && <TabEmpleados canEdit={canEdit} />}
        {tab === 'asistencia' && <TabAsistencia />}
        {tab === 'descuentos' && <TabDescuentos canEdit={canEdit} />}
      </div>
    </div>
  );
}
