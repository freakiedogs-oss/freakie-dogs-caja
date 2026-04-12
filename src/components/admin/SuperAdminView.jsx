import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { NAV_SECTIONS, STORES } from '../../config';
import DevOpsTab from './DevOpsTab';

// ── Todos los nav_keys disponibles (flat) ──
const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap(s =>
  s.items.map(i => ({ ...i, section: s.label }))
);

// ── Estilos ──
const c = {
  bg: '#0f0f23', card: '#16213e', border: '#333', red: '#e63946',
  green: '#4ade80', blue: '#3b82f6', yellow: '#f59e0b',
  text: '#eee', dim: '#888', input: '#1a1a2e',
};
const lbl = { display: 'block', fontSize: 12, color: c.dim, marginBottom: 2, marginTop: 10 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${c.border}`, background: c.input, color: c.text, fontSize: 13, boxSizing: 'border-box' };
const btn = (bg) => ({ padding: '10px 16px', borderRadius: 8, border: 'none', background: bg, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 });

export default function SuperAdminView({ user }) {
  // Ejecutivos entran directo al tab DevOps; superadmin a usuarios
  const [tab, setTab] = useState(user?.rol === 'ejecutivo' ? 'devops' : 'usuarios');

  // ═══ ESTADO USUARIOS ═══
  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [editUser, setEditUser] = useState(null);
  const [formUser, setFormUser] = useState({});
  const [savingUser, setSavingUser] = useState(false);
  const [msgUser, setMsgUser] = useState(null);
  const [creandoUser, setCreandoUser] = useState(false);

  // ═══ ESTADO PERMISOS ═══
  const [permisos, setPermisos] = useState([]); // [{rol, nav_key}]
  const [rolesExistentes, setRolesExistentes] = useState([]);
  const [rolSeleccionado, setRolSeleccionado] = useState('');
  const [loadingPermisos, setLoadingPermisos] = useState(true);
  const [savingPermisos, setSavingPermisos] = useState(false);
  const [msgPermisos, setMsgPermisos] = useState(null);

  // ═══ ESTADO NUEVO ROL ═══
  const [nuevoRolNombre, setNuevoRolNombre] = useState('');
  const [nuevoRolPermisos, setNuevoRolPermisos] = useState([]);
  const [savingRol, setSavingRol] = useState(false);
  const [msgRol, setMsgRol] = useState(null);

  // ── Cargar usuarios ──
  const cargarUsuarios = useCallback(async () => {
    setLoadingUsers(true);
    const { data } = await db.from('usuarios_erp')
      .select('*')
      .order('nombre');
    setUsuarios(data || []);
    setLoadingUsers(false);
  }, []);

  // ── Cargar permisos ──
  const cargarPermisos = useCallback(async () => {
    setLoadingPermisos(true);
    const { data } = await db.from('permisos_rol')
      .select('rol, nav_key');
    const perms = data || [];
    setPermisos(perms);
    const roles = [...new Set(perms.map(p => p.rol))].sort();
    setRolesExistentes(roles);
    if (!rolSeleccionado && roles.length > 0) setRolSeleccionado(roles[0]);
    setLoadingPermisos(false);
  }, []);

  useEffect(() => { cargarUsuarios(); cargarPermisos(); }, [cargarUsuarios, cargarPermisos]);

  // ══════════════════════════════════════════
  // TAB BAR
  // ══════════════════════════════════════════
  const TabBar = () => (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#fff' }}>🛡️ Super Admin</h2>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${c.border}`, overflowX: 'auto' }}>
        {[
          { k: 'devops', l: '🔧 DevOps' },
          { k: 'usuarios', l: '👥 Usuarios' },
          { k: 'permisos', l: '🔐 Permisos' },
          { k: 'nuevo-rol', l: '➕ Nuevo Rol' },
        ].filter(t => {
          // DevOps visible para ejecutivos y superadmin; el resto solo superadmin
          if (t.k === 'devops') return true;
          return user?.rol === 'superadmin';
        }).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: '8px 16px', borderRadius: 0, border: 'none', background: 'none',
              color: tab === t.k ? c.red : '#666', borderBottom: tab === t.k ? `2px solid ${c.red}` : 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
            {t.l}
          </button>
        ))}
      </div>
    </div>
  );

  const Alert = ({ type, msg, onClose }) => {
    if (!msg) return null;
    const bg = type === 'error' ? '#8b0000' : '#2d6a4f';
    return (
      <div style={{ background: bg, color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{type === 'error' ? '⚠️' : '✓'} {msg}</span>
        {onClose && <span onClick={onClose} style={{ cursor: 'pointer', opacity: 0.7 }}>✕</span>}
      </div>
    );
  };

  // ══════════════════════════════════════════
  // TAB: USUARIOS
  // ══════════════════════════════════════════
  const iniciarEdicion = (u) => {
    setEditUser(u.id);
    setFormUser({ nombre: u.nombre, apellido: u.apellido, pin: u.pin, rol: u.rol, store_code: u.store_code || '', activo: u.activo });
    setCreandoUser(false);
    setMsgUser(null);
  };

  const iniciarCreacion = () => {
    setEditUser('nuevo');
    setFormUser({ nombre: '', apellido: '', pin: '', rol: '', store_code: 'CM001', activo: true });
    setCreandoUser(true);
    setMsgUser(null);
  };

  const guardarUsuario = async () => {
    if (!formUser.nombre || !formUser.pin || !formUser.rol) {
      setMsgUser({ t: 'error', m: 'Nombre, PIN y Rol son obligatorios' }); return;
    }
    // Verificar PIN duplicado
    const existente = usuarios.find(u => u.pin === formUser.pin && u.id !== editUser);
    if (existente) {
      setMsgUser({ t: 'error', m: `PIN ${formUser.pin} ya está asignado a ${existente.nombre} ${existente.apellido}` }); return;
    }
    setSavingUser(true);
    try {
      if (creandoUser) {
        const { error } = await db.from('usuarios_erp').insert({
          nombre: formUser.nombre, apellido: formUser.apellido || '',
          pin: formUser.pin, rol: formUser.rol,
          store_code: formUser.store_code || null, activo: formUser.activo,
        });
        if (error) throw error;
        setMsgUser({ t: 'ok', m: `✅ Usuario ${formUser.nombre} creado` });
      } else {
        const { error } = await db.from('usuarios_erp').update({
          nombre: formUser.nombre, apellido: formUser.apellido || '',
          pin: formUser.pin, rol: formUser.rol,
          store_code: formUser.store_code || null, activo: formUser.activo,
        }).eq('id', editUser);
        if (error) throw error;
        setMsgUser({ t: 'ok', m: `✅ Usuario actualizado` });
      }
      setEditUser(null);
      setCreandoUser(false);
      cargarUsuarios();
    } catch (err) {
      setMsgUser({ t: 'error', m: err.message });
    }
    setSavingUser(false);
  };

  const renderUsuarios = () => (
    <div>
      <Alert type={msgUser?.t} msg={msgUser?.m} onClose={() => setMsgUser(null)} />

      <button onClick={iniciarCreacion} style={{ ...btn(c.blue), marginBottom: 12, width: '100%' }}>
        ➕ Crear Nuevo Usuario
      </button>

      {/* Formulario edición/creación */}
      {editUser && (
        <div className="card" style={{ padding: 16, marginBottom: 12, border: `1px solid ${c.blue}` }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: c.blue }}>
            {creandoUser ? '➕ Nuevo Usuario' : `✏️ Editando: ${formUser.nombre}`}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
            <div>
              <label style={lbl}>Nombre *</label>
              <input value={formUser.nombre} onChange={e => setFormUser(f => ({ ...f, nombre: e.target.value }))} style={inp} />
            </div>
            <div>
              <label style={lbl}>Apellido</label>
              <input value={formUser.apellido} onChange={e => setFormUser(f => ({ ...f, apellido: e.target.value }))} style={inp} />
            </div>
            <div>
              <label style={lbl}>PIN * (4-6 dígitos)</label>
              <input value={formUser.pin} onChange={e => setFormUser(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))} style={inp} maxLength={6} />
            </div>
            <div>
              <label style={lbl}>Rol *</label>
              <select value={formUser.rol} onChange={e => setFormUser(f => ({ ...f, rol: e.target.value }))} style={inp}>
                <option value="">— Seleccionar —</option>
                {rolesExistentes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Sucursal</label>
              <select value={formUser.store_code} onChange={e => setFormUser(f => ({ ...f, store_code: e.target.value }))} style={inp}>
                <option value="">— Sin asignar —</option>
                {Object.entries(STORES).map(([k, v]) => <option key={k} value={k}>{k} - {v}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Estado</label>
              <select value={formUser.activo ? 'true' : 'false'} onChange={e => setFormUser(f => ({ ...f, activo: e.target.value === 'true' }))} style={inp}>
                <option value="true">✅ Activo</option>
                <option value="false">❌ Inactivo</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={guardarUsuario} disabled={savingUser} style={btn(c.green)}>
              {savingUser ? '⏳...' : '💾 Guardar'}
            </button>
            <button onClick={() => { setEditUser(null); setCreandoUser(false); }} style={btn('#555')}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loadingUsers ? (
        <div style={{ textAlign: 'center', color: c.dim, padding: 20 }}>Cargando...</div>
      ) : (
        <div style={{ fontSize: 12, color: c.dim, marginBottom: 8 }}>
          {usuarios.length} usuarios · {usuarios.filter(u => u.activo).length} activos
        </div>
      )}
      {usuarios.map(u => (
        <div key={u.id} className="card" onClick={() => iniciarEdicion(u)}
          style={{ cursor: 'pointer', padding: '10px 14px', marginBottom: 6, opacity: u.activo ? 1 : 0.5,
            border: editUser === u.id ? `1px solid ${c.blue}` : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: c.text }}>
                {u.nombre} {u.apellido}
              </div>
              <div style={{ fontSize: 11, color: c.dim, marginTop: 2 }}>
                PIN: {u.pin} · <span style={{ color: c.yellow }}>{u.rol}</span> · {STORES[u.store_code] || u.store_code || '—'}
              </div>
            </div>
            <div style={{ fontSize: 11, color: u.activo ? c.green : '#f87171' }}>
              {u.activo ? '✅' : '❌'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // ══════════════════════════════════════════
  // TAB: PERMISOS
  // ══════════════════════════════════════════
  const permisosDelRol = permisos.filter(p => p.rol === rolSeleccionado).map(p => p.nav_key);

  const togglePermiso = (navKey) => {
    if (permisosDelRol.includes(navKey)) {
      setPermisos(prev => prev.filter(p => !(p.rol === rolSeleccionado && p.nav_key === navKey)));
    } else {
      setPermisos(prev => [...prev, { rol: rolSeleccionado, nav_key: navKey }]);
    }
  };

  const guardarPermisos = async () => {
    setSavingPermisos(true);
    setMsgPermisos(null);
    try {
      // Borrar permisos actuales del rol
      await db.from('permisos_rol').delete().eq('rol', rolSeleccionado);
      // Insertar los nuevos
      const nuevos = permisosDelRol.map(nk => ({ rol: rolSeleccionado, nav_key: nk }));
      if (nuevos.length > 0) {
        const { error } = await db.from('permisos_rol').insert(nuevos);
        if (error) throw error;
      }
      setMsgPermisos({ t: 'ok', m: `✅ Permisos de "${rolSeleccionado}" guardados (${nuevos.length} módulos)` });
      cargarPermisos();
    } catch (err) {
      setMsgPermisos({ t: 'error', m: err.message });
    }
    setSavingPermisos(false);
  };

  // Agrupar items por sección
  const secciones = NAV_SECTIONS.map(s => ({
    label: s.label,
    items: s.items.filter(i => i.key !== 'home' && i.key !== 'mi-asistencia' && i.key !== 'mi-boleta'),
  })).filter(s => s.items.length > 0);

  const renderPermisos = () => (
    <div>
      <Alert type={msgPermisos?.t} msg={msgPermisos?.m} onClose={() => setMsgPermisos(null)} />

      {loadingPermisos ? (
        <div style={{ textAlign: 'center', color: c.dim, padding: 20 }}>Cargando...</div>
      ) : (
        <>
          <label style={lbl}>Seleccionar Rol</label>
          <select value={rolSeleccionado} onChange={e => setRolSeleccionado(e.target.value)} style={{ ...inp, marginBottom: 16 }}>
            {rolesExistentes.map(r => (
              <option key={r} value={r}>{r} ({permisos.filter(p => p.rol === r).length} módulos)</option>
            ))}
          </select>

          {rolSeleccionado === 'superadmin' ? (
            <div className="card" style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
              <div style={{ color: c.green, fontWeight: 700, fontSize: 14 }}>Super Admin tiene acceso a TODO</div>
              <div style={{ color: c.dim, fontSize: 12, marginTop: 4 }}>No necesita permisos individuales</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: c.dim, marginBottom: 12 }}>
                ☝️ Los módulos <strong>Inicio</strong>, <strong>Mi Asistencia</strong> y <strong>Mi Boleta</strong> son accesibles para todos.
              </div>

              {secciones.map(sec => (
                <div key={sec.label} className="card" style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: c.yellow, marginBottom: 8 }}>{sec.label}</div>
                  {sec.items.map(item => {
                    const checked = permisosDelRol.includes(item.key);
                    return (
                      <label key={item.key} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                        cursor: 'pointer', borderBottom: `1px solid ${c.bg}`,
                      }}>
                        <input type="checkbox" checked={checked} onChange={() => togglePermiso(item.key)}
                          style={{ width: 18, height: 18, accentColor: c.green }} />
                        <span style={{ fontSize: 15, marginRight: 4 }}>{item.icon}</span>
                        <span style={{ fontSize: 13, color: checked ? c.text : c.dim }}>{item.label}</span>
                        <span style={{ fontSize: 10, color: c.dim, marginLeft: 'auto' }}>{item.key}</span>
                      </label>
                    );
                  })}
                </div>
              ))}

              <button onClick={guardarPermisos} disabled={savingPermisos}
                style={{ ...btn(c.green), width: '100%', marginTop: 8 }}>
                {savingPermisos ? '⏳ Guardando...' : `💾 Guardar Permisos de "${rolSeleccionado}"`}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );

  // ══════════════════════════════════════════
  // TAB: NUEVO ROL
  // ══════════════════════════════════════════
  const toggleNuevoRolPermiso = (navKey) => {
    setNuevoRolPermisos(prev =>
      prev.includes(navKey) ? prev.filter(k => k !== navKey) : [...prev, navKey]
    );
  };

  const crearRol = async () => {
    const nombre = nuevoRolNombre.trim().toLowerCase().replace(/\s+/g, '_');
    if (!nombre) { setMsgRol({ t: 'error', m: 'Ingresa un nombre de rol' }); return; }
    if (rolesExistentes.includes(nombre)) { setMsgRol({ t: 'error', m: `El rol "${nombre}" ya existe` }); return; }
    if (nuevoRolPermisos.length === 0) { setMsgRol({ t: 'error', m: 'Selecciona al menos un módulo' }); return; }

    setSavingRol(true);
    setMsgRol(null);
    try {
      const rows = nuevoRolPermisos.map(nk => ({ rol: nombre, nav_key: nk }));
      const { error } = await db.from('permisos_rol').insert(rows);
      if (error) throw error;
      setMsgRol({ t: 'ok', m: `✅ Rol "${nombre}" creado con ${nuevoRolPermisos.length} módulos. Ya puedes asignarlo a usuarios.` });
      setNuevoRolNombre('');
      setNuevoRolPermisos([]);
      cargarPermisos();
    } catch (err) {
      setMsgRol({ t: 'error', m: err.message });
    }
    setSavingRol(false);
  };

  const selectAllNuevoRol = () => {
    const allKeys = secciones.flatMap(s => s.items.map(i => i.key));
    setNuevoRolPermisos(nuevoRolPermisos.length === allKeys.length ? [] : allKeys);
  };

  const renderNuevoRol = () => (
    <div>
      <Alert type={msgRol?.t} msg={msgRol?.m} onClose={() => setMsgRol(null)} />

      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 14, color: c.blue }}>➕ Crear Nuevo Rol</h3>

        <label style={lbl}>Nombre del Rol</label>
        <input value={nuevoRolNombre} onChange={e => setNuevoRolNombre(e.target.value)}
          placeholder="ej: supervisor, auditor, asistente..." style={inp} />
        {nuevoRolNombre && (
          <div style={{ fontSize: 11, color: c.dim, marginTop: 4 }}>
            Se guardará como: <strong style={{ color: c.yellow }}>{nuevoRolNombre.trim().toLowerCase().replace(/\s+/g, '_')}</strong>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: c.text, fontWeight: 600 }}>Módulos con acceso:</div>
        <button onClick={selectAllNuevoRol} style={{ ...btn('#333'), padding: '4px 10px', fontSize: 11 }}>
          {nuevoRolPermisos.length === secciones.flatMap(s => s.items).length ? 'Deseleccionar todo' : 'Seleccionar todo'}
        </button>
      </div>

      {secciones.map(sec => (
        <div key={sec.label} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: c.yellow, marginBottom: 8 }}>{sec.label}</div>
          {sec.items.map(item => {
            const checked = nuevoRolPermisos.includes(item.key);
            return (
              <label key={item.key} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                cursor: 'pointer', borderBottom: `1px solid ${c.bg}`,
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggleNuevoRolPermiso(item.key)}
                  style={{ width: 18, height: 18, accentColor: c.green }} />
                <span style={{ fontSize: 15, marginRight: 4 }}>{item.icon}</span>
                <span style={{ fontSize: 13, color: checked ? c.text : c.dim }}>{item.label}</span>
              </label>
            );
          })}
        </div>
      ))}

      {nuevoRolPermisos.length > 0 && (
        <div style={{ fontSize: 12, color: c.green, marginBottom: 8, textAlign: 'center' }}>
          {nuevoRolPermisos.length} módulo(s) seleccionado(s)
        </div>
      )}

      <button onClick={crearRol} disabled={savingRol}
        style={{ ...btn(c.green), width: '100%' }}>
        {savingRol ? '⏳ Creando...' : '🚀 Crear Rol'}
      </button>
    </div>
  );

  // ══════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════
  const allowedRoles = ['superadmin', 'ejecutivo'];
  if (!allowedRoles.includes(user?.rol)) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
        <div style={{ color: '#f87171', fontSize: 15, fontWeight: 700 }}>Acceso restringido</div>
        <div style={{ color: c.dim, fontSize: 13, marginTop: 4 }}>Solo Super Admin y Ejecutivos pueden acceder a este panel</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px' }}>
      <TabBar />
      {tab === 'devops' && <DevOpsTab />}
      {tab === 'usuarios' && renderUsuarios()}
      {tab === 'permisos' && renderPermisos()}
      {tab === 'nuevo-rol' && renderNuevoRol()}
    </div>
  );
}
