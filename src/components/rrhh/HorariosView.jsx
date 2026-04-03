import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

const c = {
  bg: '#111', card: '#1a1a1a', cardBorder: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', greenDark: '#2d6a4f',
  yellow: '#fbbf24', orange: '#f97316', blue: '#60a5fa', purple: '#a78bfa',
  border: '#333', text: '#f0f0f0', textDim: '#888', textOff: '#444',
};

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Etiquetas de bloque con colores y horas default
const ETIQUETAS = {
  'Mañana':  { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)',  icon: '🌅', inicio: '06:00', fin: '12:00' },
  'Tarde':   { color: '#60a5fa', bg: 'rgba(96,165,250,0.15)',  icon: '☀️',  inicio: '12:00', fin: '18:00' },
  'Noche':   { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', icon: '🌙', inicio: '18:00', fin: '22:00' },
  'Almuerzo':{ color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: '☕', inicio: '',      fin: ''      },
  'Extra':   { color: '#4ade80', bg: 'rgba(74,222,128,0.15)',  icon: '⭐', inicio: '',      fin: ''      },
  'Descanso':{ color: '#6b7280', bg: 'rgba(107,114,128,0.10)', icon: '😴', inicio: '',      fin: ''      },
};

const ROLES_ADMIN = ['rrhh', 'ejecutivo', 'admin'];
const canEdit = (user) => [...ROLES_ADMIN, 'gerente', 'cocina'].includes(user?.rol);

function getLunes(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split('T')[0];
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtSemana(lunes) {
  const dom = addDays(lunes, 6);
  const fmt = (s) => new Date(s + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
  return `${fmt(lunes)} – ${fmt(dom)}`;
}

const inputStyle = {
  background: c.input, border: `1px solid ${c.border}`, borderRadius: 6,
  color: c.text, padding: '7px 10px', fontSize: 13,
  fontFamily: 'inherit', boxSizing: 'border-box', width: '100%',
};

// Obtener tramos de un registro (compatible con legacy)
function getTramos(h) {
  if (!h) return [];
  if (h.tramos && Array.isArray(h.tramos) && h.tramos.length > 0) return h.tramos;
  // fallback legacy
  if (h.hora_inicio) return [{ orden: 1, hora_inicio: h.hora_inicio.slice(0,5), hora_fin: h.hora_fin?.slice(0,5) || '', etiqueta: h.turno || '' }];
  return [];
}

// Resumen de tramos para modal
function resumenTramos(h) {
  const tramos = getTramos(h);
  if (!tramos.length) return '—';
  return tramos.map(t => `${t.etiqueta ? t.etiqueta + ' ' : ''}${t.hora_inicio}–${t.hora_fin}`).join(', ');
}

// Modal: permanente o solo esta semana?
function ModalTipoCambio({ empleado, dia, horarioActual, semana, onElegir, onCerrar }) {
  const h = horarioActual;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 12, padding: 20, maxWidth: 320, width: '100%' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: c.text, marginBottom: 4 }}>
          {empleado.nombre} {empleado.apellido}
        </div>
        <div style={{ fontSize: 13, color: c.textDim, marginBottom: h ? 4 : 14 }}>{DIAS_FULL[dia]}</div>
        {h && (
          <div style={{ fontSize: 11, color: c.textOff, marginBottom: 14, padding: '4px 8px', background: '#222', borderRadius: 6 }}>
            Actual: {resumenTramos(h)} · {h._fuente === 'override' ? '⚡ esta semana' : '🔒 permanente'}
          </div>
        )}
        <div style={{ fontSize: 13, color: c.textDim, marginBottom: 12 }}>
          ¿Este cambio es permanente o solo para esta semana?
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => onElegir(true)} style={{ flex: 1, padding: '12px 8px', borderRadius: 10, background: 'rgba(96,165,250,0.12)', border: `1px solid ${c.blue}`, color: c.blue, cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>🔒</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Permanente</div>
            <div style={{ fontSize: 10, color: c.textDim, marginTop: 2 }}>aplica siempre</div>
          </button>
          <button onClick={() => onElegir(false)} style={{ flex: 1, padding: '12px 8px', borderRadius: 10, background: 'rgba(249,115,22,0.12)', border: `1px solid ${c.orange}`, color: c.orange, cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>⚡</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Solo esta semana</div>
            <div style={{ fontSize: 10, color: c.textDim, marginTop: 2 }}>{fmtSemana(semana)}</div>
          </button>
        </div>
        <button onClick={onCerrar} style={{ width: '100%', padding: '8px 0', borderRadius: 8, background: 'transparent', border: `1px solid ${c.border}`, color: c.textDim, cursor: 'pointer', fontSize: 12 }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function HorariosView({ user }) {
  const [semana, setSemana] = useState(getLunes(new Date()));
  const [sucursalSel, setSucursalSel] = useState(user.store_code || '');
  const [sucursales, setSucursales] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [horarios, setHorarios] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [editCell, setEditCell] = useState(null);
  const [editMode, setEditMode] = useState(null);
  const [toast, setToast] = useState(null);

  const esAdmin = ROLES_ADMIN.includes(user?.rol);

  useEffect(() => {
    db.from('sucursales').select('store_code, nombre').order('nombre')
      .then(({ data }) => {
        setSucursales(data || []);
        if (!sucursalSel && data?.[0]) setSucursalSel(data[0].store_code);
      });
  }, []);

  useEffect(() => {
    if (!sucursalSel) return;
    db.from('usuarios_erp')
      .select('id, nombre, apellido, rol, store_code')
      .eq('store_code', sucursalSel).eq('activo', true).order('nombre')
      .then(({ data }) => setEmpleados(data || []));
  }, [sucursalSel]);

  const loadHorarios = useCallback(async () => {
    if (!sucursalSel || !semana) return;
    setLoading(true);
    const [{ data: plantilla }, { data: overrides }] = await Promise.all([
      db.from('horarios_empleados').select('*').eq('sucursal', sucursalSel).is('semana_inicio', null),
      db.from('horarios_empleados').select('*').eq('sucursal', sucursalSel).eq('semana_inicio', semana),
    ]);
    const map = {};
    (plantilla || []).forEach(h => { map[`${h.usuario_id}-${h.dia_semana}`] = { ...h, _fuente: 'plantilla' }; });
    (overrides || []).forEach(h => { map[`${h.usuario_id}-${h.dia_semana}`] = { ...h, _fuente: 'override' }; });
    setHorarios(map);
    setLoading(false);
  }, [sucursalSel, semana]);

  useEffect(() => { loadHorarios(); }, [loadHorarios]);

  const showToast = (text, ok = true) => { setToast({ text, ok }); setTimeout(() => setToast(null), 2500); };

  const handleClickCelda = (usuario_id, dia) => {
    if (!canEdit(user)) return;
    setEditCell({ usuario_id, dia });
    setEditMode(null);
  };

  const handleElegirModo = (esPermanente) => {
    setEditMode({ ...editCell, esPermanente });
  };

  const guardarCelda = async (usuario_id, dia, data) => {
    const key = `${usuario_id}-${dia}`;
    const esPermanente = editMode?.esPermanente ?? false;
    setSaving(key);
    try {
      if (data === null) {
        // Eliminar
        const existing = horarios[key];
        if (existing?.id) await db.from('horarios_empleados').delete().eq('id', existing.id);
        setHorarios(prev => { const n = { ...prev }; delete n[key]; return n; });
        showToast('Horario eliminado');
      } else {
        // Construir payload con tramos + compat legacy
        const tramos = data.tramos || [];
        const primerTramo = tramos[0];
        const ultimoTramo = tramos[tramos.length - 1];
        const payload = {
          usuario_id, sucursal: sucursalSel,
          semana_inicio: esPermanente ? null : semana,
          dia_semana: dia, es_plantilla: esPermanente,
          creado_por: user.id,
          tramos,
          notas: data.notas || null,
          // compat legacy: primer entrada, última salida
          hora_inicio: primerTramo?.hora_inicio || null,
          hora_fin: ultimoTramo?.hora_fin || null,
          turno: primerTramo?.etiqueta || null,
        };
        const existente = Object.values(horarios).find(h =>
          h.usuario_id === usuario_id && h.dia_semana === dia &&
          h._fuente === (esPermanente ? 'plantilla' : 'override')
        );
        if (existente?.id) {
          await db.from('horarios_empleados').update(payload).eq('id', existente.id);
        } else {
          await db.from('horarios_empleados').insert(payload);
        }
        showToast(esPermanente ? '🔒 Horario permanente guardado' : '⚡ Cambio solo esta semana');
        await loadHorarios();
      }
    } catch (e) { showToast(e.message, false); }
    setSaving(null);
    setEditCell(null);
    setEditMode(null);
  };

  const copiarSemanaAnterior = async () => {
    const semanaAnterior = addDays(semana, -7);
    const { data } = await db.from('horarios_empleados').select('*').eq('sucursal', sucursalSel).eq('semana_inicio', semanaAnterior);
    if (!data?.length) { showToast('La semana anterior no tiene horarios', false); return; }
    const inserts = data.map(h => ({
      usuario_id: h.usuario_id, sucursal: h.sucursal,
      semana_inicio: semana, dia_semana: h.dia_semana,
      tramos: h.tramos, notas: h.notas,
      hora_inicio: h.hora_inicio, hora_fin: h.hora_fin, turno: h.turno,
      es_plantilla: false, creado_por: user.id,
    }));
    await db.from('horarios_empleados').upsert(inserts, { onConflict: 'usuario_id,sucursal,dia_semana,semana_inicio' });
    await loadHorarios();
    showToast(`${inserts.length} turnos copiados`);
  };

  const empDelModal = editCell ? empleados.find(e => e.id === editCell.usuario_id) : null;
  const horarioDelModal = editCell ? horarios[`${editCell.usuario_id}-${editCell.dia}`] : null;

  return (
    <div style={{ padding: '16px 12px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: c.text }}>📅 Horarios</div>
        <div style={{ fontSize: 12, color: c.textDim, marginTop: 2 }}>🔒 permanente · ⚡ override semanal · múltiples bloques por día</div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {esAdmin && (
          <select value={sucursalSel} onChange={e => setSucursalSel(e.target.value)} style={{ ...inputStyle, width: 'auto', flex: 1, minWidth: 140 }}>
            {sucursales.map(s => <option key={s.store_code} value={s.store_code}>{s.nombre}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button onClick={() => setSemana(addDays(semana, -7))} style={{ padding: '7px 12px', borderRadius: 8, background: c.input, color: c.text, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 16 }}>‹</button>
          <div style={{ fontSize: 13, color: c.text, fontWeight: 600, whiteSpace: 'nowrap', minWidth: 130, textAlign: 'center' }}>{fmtSemana(semana)}</div>
          <button onClick={() => setSemana(addDays(semana, 7))} style={{ padding: '7px 12px', borderRadius: 8, background: c.input, color: c.text, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 16 }}>›</button>
          <button onClick={() => setSemana(getLunes(new Date()))} style={{ padding: '7px 10px', borderRadius: 8, background: c.input, color: c.textDim, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 12 }}>Hoy</button>
        </div>
        {canEdit(user) && (
          <button onClick={copiarSemanaAnterior} style={{ padding: '7px 12px', borderRadius: 8, background: c.input, color: c.textDim, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            📋 Copiar semana ant.
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: c.textDim, padding: 40 }}>Cargando...</div>
      ) : empleados.length === 0 ? (
        <div style={{ textAlign: 'center', color: c.textOff, padding: 40 }}>Sin empleados en esta sucursal</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, color: c.textDim, fontWeight: 700, borderBottom: `2px solid ${c.border}`, minWidth: 140, background: c.bg, position: 'sticky', left: 0, zIndex: 2 }}>Empleado</th>
                {DIAS.map((d, i) => {
                  const fechaDia = addDays(semana, i);
                  const esHoy = fechaDia === new Date(Date.now() - 6 * 3600 * 1000).toISOString().split('T')[0];
                  return (
                    <th key={i} style={{ padding: '6px 8px', textAlign: 'center', fontSize: 12, color: esHoy ? c.red : c.textDim, fontWeight: 700, borderBottom: `2px solid ${c.border}`, minWidth: 100, background: c.bg }}>
                      <div>{d}</div>
                      <div style={{ fontSize: 10, fontWeight: 400, color: c.textOff }}>{new Date(fechaDia + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {empleados.map((emp, ei) => (
                <tr key={emp.id} style={{ background: ei % 2 === 0 ? c.bg : '#141414' }}>
                  <td style={{ padding: '8px 12px', borderBottom: `1px solid ${c.border}`, position: 'sticky', left: 0, zIndex: 1, background: ei % 2 === 0 ? c.bg : '#141414', verticalAlign: 'top' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{emp.nombre} {emp.apellido}</div>
                    <div style={{ fontSize: 11, color: c.textOff }}>{emp.rol}</div>
                  </td>
                  {DIAS.map((_, di) => {
                    const key = `${emp.id}-${di}`;
                    const h = horarios[key];
                    const isSaving = saving === key;
                    const isEditing = editMode?.usuario_id === emp.id && editMode?.dia === di;
                    const tramos = getTramos(h);
                    return (
                      <td key={di} style={{ padding: 4, borderBottom: `1px solid ${c.border}`, verticalAlign: 'top' }}>
                        {isEditing ? (
                          <CeldaEditor
                            initial={h}
                            onSave={(data) => guardarCelda(emp.id, di, data)}
                            onCancel={() => { setEditCell(null); setEditMode(null); }}
                          />
                        ) : (
                          <div
                            onClick={() => handleClickCelda(emp.id, di)}
                            style={{
                              minHeight: 52, borderRadius: 6, padding: '4px 5px',
                              cursor: canEdit(user) ? 'pointer' : 'default',
                              border: `1px solid ${h?._fuente === 'override' ? c.orange + '88' : h?._fuente === 'plantilla' ? c.blue + '55' : c.border}`,
                              opacity: isSaving ? 0.5 : 1,
                            }}>
                            {tramos.length > 0 ? (
                              <>
                                {tramos.map((t, ti) => {
                                  const info = ETIQUETAS[t.etiqueta];
                                  const esDescanso = t.etiqueta === 'Descanso';
                                  return (
                                    <div key={ti} style={{
                                      marginBottom: ti < tramos.length - 1 ? 3 : 0,
                                      background: info?.bg || 'rgba(255,255,255,0.04)',
                                      borderRadius: 4, padding: '2px 4px',
                                    }}>
                                      {t.etiqueta && (
                                        <div style={{ fontSize: 9, fontWeight: 700, color: info?.color || c.textDim, lineHeight: 1.3 }}>
                                          {info?.icon || ''} {t.etiqueta}
                                        </div>
                                      )}
                                      {!esDescanso && t.hora_inicio && (
                                        <div style={{ fontSize: 10, color: c.textDim, lineHeight: 1.3 }}>
                                          {t.hora_inicio} – {t.hora_fin}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {h?.notas && <div style={{ fontSize: 9, color: c.textOff, marginTop: 2, fontStyle: 'italic' }}>{h.notas}</div>}
                                <div style={{ fontSize: 8, color: h._fuente === 'override' ? c.orange : c.blue, marginTop: 2 }}>
                                  {h._fuente === 'override' ? '⚡' : '🔒'}
                                </div>
                              </>
                            ) : canEdit(user) ? (
                              <div style={{ fontSize: 18, color: c.textOff, textAlign: 'center', marginTop: 8 }}>+</div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editCell && !editMode && empDelModal && (
        <ModalTipoCambio
          empleado={empDelModal} dia={editCell.dia}
          horarioActual={horarioDelModal} semana={semana}
          onElegir={handleElegirModo}
          onCerrar={() => { setEditCell(null); setEditMode(null); }}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 1000, background: toast.ok ? 'rgba(74,222,128,0.15)' : 'rgba(230,57,70,0.15)', color: toast.ok ? c.green : c.red, border: `1px solid ${toast.ok ? c.greenDark : c.red}`, backdropFilter: 'blur(8px)' }}>
          {toast.ok ? '✓' : '✗'} {toast.text}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Editor de celda con múltiples bloques horarios
// ─────────────────────────────────────────────
function CeldaEditor({ initial, onSave, onCancel }) {
  const initTramos = () => {
    const t = getTramos(initial);
    if (t.length) return t.map(tr => ({ ...tr }));
    return [{ orden: 1, hora_inicio: '', hora_fin: '', etiqueta: '' }];
  };

  const [tramos, setTramos] = useState(initTramos);
  const [notas, setNotas] = useState(initial?.notas || '');

  const addTramo = () => {
    setTramos(prev => [...prev, { orden: prev.length + 1, hora_inicio: '', hora_fin: '', etiqueta: '' }]);
  };

  const removeTramo = (idx) => {
    if (tramos.length === 1) return; // mínimo 1
    setTramos(prev => prev.filter((_, i) => i !== idx).map((t, i) => ({ ...t, orden: i + 1 })));
  };

  const updateTramo = (idx, field, val) => {
    setTramos(prev => prev.map((t, i) => i === idx ? { ...t, [field]: val } : t));
  };

  const aplicarEtiqueta = (idx, etiqueta) => {
    const info = ETIQUETAS[etiqueta];
    setTramos(prev => prev.map((t, i) => {
      if (i !== idx) return t;
      return {
        ...t, etiqueta,
        hora_inicio: t.hora_inicio || info?.inicio || '',
        hora_fin: t.hora_fin || info?.fin || '',
      };
    }));
  };

  const handleSave = () => {
    const valid = tramos.filter(t => t.hora_inicio && t.hora_fin || t.etiqueta === 'Descanso');
    if (!valid.length) { onSave(null); return; }
    onSave({ tramos: valid.map((t, i) => ({ ...t, orden: i + 1 })), notas: notas || null });
  };

  const small = { ...inputStyle, padding: '5px 7px', fontSize: 12 };

  return (
    <div
      style={{ background: c.card, border: `1px solid ${c.red}`, borderRadius: 8, padding: 8, minWidth: 200, maxWidth: 280 }}
      onClick={e => e.stopPropagation()}
    >
      {/* Lista de tramos */}
      {tramos.map((t, idx) => {
        const info = ETIQUETAS[t.etiqueta];
        const esDescanso = t.etiqueta === 'Descanso';
        return (
          <div key={idx} style={{ marginBottom: 8, background: info?.bg || 'rgba(255,255,255,0.03)', borderRadius: 6, padding: '6px 8px', border: `1px solid ${info?.color ? info.color + '44' : c.border}` }}>
            {/* Header del tramo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
              <div style={{ fontSize: 10, color: info?.color || c.textDim, fontWeight: 700 }}>
                {info?.icon || '⏱'} Bloque {idx + 1}
              </div>
              {tramos.length > 1 && (
                <button onClick={() => removeTramo(idx)} style={{ background: 'none', border: 'none', color: c.red, cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
              )}
            </div>

            {/* Chips de etiqueta */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
              {Object.entries(ETIQUETAS).map(([k, v]) => (
                <button key={k} onClick={() => aplicarEtiqueta(idx, k)}
                  style={{ padding: '1px 6px', borderRadius: 12, fontSize: 9, fontWeight: 700, border: 'none', cursor: 'pointer', background: t.etiqueta === k ? v.bg : c.input, color: t.etiqueta === k ? v.color : c.textOff }}>
                  {v.icon} {k}
                </button>
              ))}
            </div>

            {/* Horas (solo si no es Descanso) */}
            {!esDescanso && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <div>
                  <div style={{ fontSize: 9, color: c.textDim, marginBottom: 2 }}>Entrada</div>
                  <input type="time" value={t.hora_inicio} onChange={e => updateTramo(idx, 'hora_inicio', e.target.value)} style={small} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: c.textDim, marginBottom: 2 }}>Salida</div>
                  <input type="time" value={t.hora_fin} onChange={e => updateTramo(idx, 'hora_fin', e.target.value)} style={small} />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Agregar bloque */}
      <button onClick={addTramo}
        style={{ width: '100%', padding: '4px 0', borderRadius: 6, background: 'rgba(96,165,250,0.08)', color: c.blue, border: `1px dashed ${c.blue + '66'}`, cursor: 'pointer', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
        + Agregar bloque
      </button>

      {/* Notas */}
      <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Nota (opcional)" style={{ ...small, marginBottom: 6 }} />

      {/* Acciones */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={handleSave}
          style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: c.greenDark, color: c.green, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
          ✓ Guardar
        </button>
        {initial?.id && (
          <button onClick={() => onSave(null)}
            style={{ padding: '5px 8px', borderRadius: 6, background: 'rgba(230,57,70,0.15)', color: c.red, border: 'none', cursor: 'pointer', fontSize: 11 }}>
            🗑
          </button>
        )}
        <button onClick={onCancel}
          style={{ padding: '5px 8px', borderRadius: 6, background: c.input, color: c.textDim, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 11 }}>
          ✕
        </button>
      </div>
    </div>
  );
}
