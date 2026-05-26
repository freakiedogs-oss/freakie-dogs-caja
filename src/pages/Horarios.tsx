import { useEffect, useMemo, useState, useCallback } from 'react';
import PageShell, { LoadingCard } from '@/components/ui/PageShell';
import Drawer from '@/components/ui/Drawer';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';

interface Empleado { id: string; nombre: string; cargo: string | null; }

interface Etiqueta {
  id: string;
  nombre: string;
  hora_inicio_default: string | null;
  hora_fin_default: string | null;
  color: string;
  icono: string;
  cubre_diurno: boolean;
  cubre_nocturno: boolean;
  orden: number;
  activo: boolean;
}

interface Tramo {
  orden: number;
  hora_inicio: string;
  hora_fin: string;
  etiqueta: string;
}

interface HorarioRow {
  id?: string;
  empleado_id: string;
  dia_semana: number;
  semana_inicio: string | null;  // NULL = plantilla
  es_plantilla: boolean;
  tramos: Tramo[];
  etiqueta_id: string | null;
  notas: string | null;
  _fuente?: 'plantilla' | 'override';
}

const DIAS_SHORT = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const DIAS_FULL  = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

function lunesDe(d: Date): Date {
  const x = new Date(d);
  const dia = x.getDay();
  const offset = dia === 0 ? -6 : 1 - dia;
  x.setDate(x.getDate() + offset);
  x.setHours(12, 0, 0, 0);
  return x;
}
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtIsoDate = (d: Date) => d.toISOString().slice(0, 10);
const fmtSemana = (lunes: Date) => {
  const d = addDays(lunes, 6);
  const f = (x: Date) => `${x.getDate()}/${x.getMonth() + 1}`;
  return `${f(lunes)} – ${f(d)}`;
};
const fmtTramos = (t: Tramo[]) => t.length === 0 ? '—' : t.map((x) => `${x.etiqueta ? x.etiqueta + ' ' : ''}${x.hora_inicio}-${x.hora_fin}`).join(' + ');

// =============================================================================
// Modal: "¿Permanente o solo esta semana?"
// =============================================================================
function ModalElegirTipo({ empleado, dia, horarioActual, semanaLunes, onElegir, onCerrar }: {
  empleado: Empleado; dia: number; horarioActual: HorarioRow | null; semanaLunes: Date;
  onElegir: (esPermanente: boolean) => void; onCerrar: () => void;
}) {
  return (
    <div onClick={(e) => e.target === e.currentTarget && onCerrar()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--r-lg)', padding: 20, maxWidth: 360, width: '100%' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 2 }}>{empleado.nombre}</div>
        <div className="text-muted" style={{ fontSize: 13, marginBottom: horarioActual ? 6 : 14 }}>{DIAS_FULL[dia]}</div>
        {horarioActual && (
          <div style={{ fontSize: 11, padding: '6px 10px', background: 'var(--bg-inset)', borderRadius: 6, marginBottom: 14, color: 'var(--text-muted)' }}>
            Actual: {fmtTramos(horarioActual.tramos)} · {horarioActual._fuente === 'override' ? '⚡ esta semana' : '🔒 permanente'}
          </div>
        )}
        <div className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>¿Este cambio es permanente o solo para esta semana?</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => onElegir(true)} style={{
            flex: 1, padding: '12px 8px', borderRadius: 10,
            background: 'rgba(95,224,169,0.12)', border: '1px solid var(--accent-kaeru)',
            color: 'var(--accent-kaeru)', cursor: 'pointer', textAlign: 'center'
          }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>🔒</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Permanente</div>
            <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>aplica siempre</div>
          </button>
          <button onClick={() => onElegir(false)} style={{
            flex: 1, padding: '12px 8px', borderRadius: 10,
            background: 'rgba(154,111,209,0.12)', border: '1px solid var(--accent-purple)',
            color: 'var(--accent-purple)', cursor: 'pointer', textAlign: 'center'
          }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>⚡</div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Solo esta semana</div>
            <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>{fmtSemana(semanaLunes)}</div>
          </button>
        </div>
        <button onClick={onCerrar} className="btn btn-ghost" style={{ width: '100%' }}>Cancelar</button>
      </div>
    </div>
  );
}

// =============================================================================
// Modal: editor de tramos
// =============================================================================
function ModalEditor({ empleado, dia, esPermanente, semanaLunes, horarioActual, etiquetas, onGuardar, onCerrar, onEliminar }: {
  empleado: Empleado; dia: number; esPermanente: boolean; semanaLunes: Date;
  horarioActual: HorarioRow | null; etiquetas: Etiqueta[];
  onGuardar: (tramos: Tramo[], etiquetaId: string | null, notas: string | null) => Promise<void>;
  onCerrar: () => void; onEliminar: () => Promise<void>;
}) {
  const [tramos, setTramos] = useState<Tramo[]>(horarioActual?.tramos || []);
  const [etiquetaId, setEtiquetaId] = useState<string | null>(horarioActual?.etiqueta_id ?? null);
  const [notas, setNotas] = useState<string>(horarioActual?.notas ?? '');
  const [saving, setSaving] = useState(false);

  // Aplicar preset de etiqueta
  function aplicarEtiqueta(et: Etiqueta) {
    setEtiquetaId(et.id);
    if (et.nombre === 'Descansa' || !et.hora_inicio_default) {
      setTramos(et.nombre === 'Partido' ? [
        { orden: 1, hora_inicio: '12:00', hora_fin: '15:00', etiqueta: 'Partido' },
        { orden: 2, hora_inicio: '18:00', hora_fin: '21:00', etiqueta: 'Partido' }
      ] : []);
    } else {
      setTramos([{ orden: 1, hora_inicio: et.hora_inicio_default, hora_fin: et.hora_fin_default || '', etiqueta: et.nombre }]);
    }
  }

  function setTramo(i: number, k: keyof Tramo, v: any) {
    setTramos((prev) => prev.map((t, idx) => idx === i ? { ...t, [k]: v } : t));
  }

  function addTramo() {
    setTramos((prev) => [...prev, { orden: prev.length + 1, hora_inicio: '12:00', hora_fin: '17:00', etiqueta: '' }]);
  }

  function removeTramo(i: number) {
    setTramos((prev) => prev.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, orden: idx + 1 })));
  }

  async function handleGuardar() {
    setSaving(true);
    await onGuardar(tramos, etiquetaId, notas || null);
    setSaving(false);
  }

  async function handleEliminar() {
    if (!confirm('¿Eliminar este horario?')) return;
    setSaving(true);
    await onEliminar();
    setSaving(false);
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onCerrar()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
    }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--r-lg)', padding: 20, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{empleado.nombre} · {DIAS_FULL[dia]}</div>
          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
            {esPermanente ? '🔒 Plantilla permanente' : `⚡ Solo semana ${fmtSemana(semanaLunes)}`}
          </div>
        </div>

        {/* Etiquetas (presets) */}
        <div style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Preset rápido</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {etiquetas.map((et) => (
              <button key={et.id} type="button" onClick={() => aplicarEtiqueta(et)} style={{
                padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: etiquetaId === et.id ? `${et.color}33` : 'var(--bg-inset)',
                border: `1px solid ${etiquetaId === et.id ? et.color : 'var(--border-default)'}`,
                color: etiquetaId === et.id ? et.color : 'var(--text-primary)'
              }}>
                {et.icono} {et.nombre}
              </button>
            ))}
          </div>
        </div>

        {/* Tramos custom */}
        <div style={{ marginBottom: 12 }}>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="card-title">Bloques de horario</span>
            <button type="button" onClick={addTramo} className="btn btn-outline btn-sm">+ Agregar bloque</button>
          </div>
          {tramos.length === 0 ? (
            <div className="text-dim" style={{ padding: 14, textAlign: 'center', background: 'var(--bg-inset)', borderRadius: 6, fontSize: 12 }}>
              Sin bloques (descansa). Selecciona un preset arriba o agrega bloque manual.
            </div>
          ) : tramos.map((t, i) => (
            <div key={i} className="row" style={{ gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input className="ki-input" type="time" value={t.hora_inicio} onChange={(e) => setTramo(i, 'hora_inicio', e.target.value)} style={{ width: 100 }} />
              <span className="text-muted">→</span>
              <input className="ki-input" type="time" value={t.hora_fin} onChange={(e) => setTramo(i, 'hora_fin', e.target.value)} style={{ width: 100 }} />
              <input className="ki-input" placeholder="Etiqueta" value={t.etiqueta} onChange={(e) => setTramo(i, 'etiqueta', e.target.value)} style={{ flex: 1 }} />
              <button type="button" onClick={() => removeTramo(i)} className="btn btn-ghost btn-sm" style={{ color: 'var(--state-danger)' }}>✕</button>
            </div>
          ))}
        </div>

        {/* Notas */}
        <div style={{ marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 4 }}>Notas (opcional)</div>
          <input className="ki-input" placeholder="Ej: Llega 30 min tarde por cita médica" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>

        <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
          {horarioActual?.id && (
            <button type="button" onClick={handleEliminar} className="btn btn-ghost" style={{ color: 'var(--state-danger)' }} disabled={saving}>🗑 Eliminar</button>
          )}
          <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
            <button type="button" onClick={onCerrar} className="btn btn-ghost" disabled={saving}>Cancelar</button>
            <button type="button" onClick={handleGuardar} className="btn btn-kaeru" disabled={saving}>{saving ? 'Guardando…' : '💾 Guardar'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CRUD Etiquetas (Drawer)
// =============================================================================
function EtiquetasManager({ etiquetas, onReload, onClose }: {
  etiquetas: Etiqueta[]; onReload: () => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState<Partial<Etiqueta> | null>(null);
  const [saving, setSaving] = useState(false);

  async function guardar() {
    if (!editing?.nombre) { alert('Nombre requerido'); return; }
    setSaving(true);
    const payload = {
      nombre: editing.nombre, icono: editing.icono || '',
      hora_inicio_default: editing.hora_inicio_default || null,
      hora_fin_default: editing.hora_fin_default || null,
      color: editing.color || '#5fe0a9',
      cubre_diurno: !!editing.cubre_diurno,
      cubre_nocturno: !!editing.cubre_nocturno,
      orden: editing.orden ?? 100,
      activo: editing.activo ?? true
    };
    if (editing.id) {
      const { error } = await kaeru.from('horario_etiquetas').update(payload).eq('id', editing.id);
      if (error) { alert(error.message); setSaving(false); return; }
    } else {
      const { error } = await kaeru.from('horario_etiquetas').insert(payload);
      if (error) { alert(error.message); setSaving(false); return; }
    }
    setEditing(null);
    setSaving(false);
    onReload();
  }

  async function toggleActivo(et: Etiqueta) {
    await kaeru.from('horario_etiquetas').update({ activo: !et.activo }).eq('id', et.id);
    onReload();
  }

  return (
    <div className="stack-sm">
      <button onClick={() => setEditing({ orden: 100, color: '#5fe0a9', cubre_diurno: true })} className="btn btn-kaeru" style={{ width: '100%' }}>+ Nueva etiqueta</button>

      {etiquetas.map((et) => (
        <div key={et.id} className="card" style={{ padding: 10, opacity: et.activo ? 1 : 0.5 }}>
          <div className="row-between">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                <span style={{ color: et.color }}>●</span> {et.icono} {et.nombre}
              </div>
              <div className="text-muted" style={{ fontSize: 10, marginTop: 2 }}>
                {et.hora_inicio_default && et.hora_fin_default ? `${et.hora_inicio_default}–${et.hora_fin_default}` : 'sin horario default'}
                {' · '}
                {et.cubre_diurno && '☀ Diurno'} {et.cubre_nocturno && '🌙 Nocturno'}
                {!et.cubre_diurno && !et.cubre_nocturno && '(no cubre turnos)'}
              </div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button onClick={() => setEditing(et)} className="btn btn-outline btn-sm">✎</button>
              <button onClick={() => toggleActivo(et)} className="btn btn-ghost btn-sm">{et.activo ? '👁' : '👁‍🗨'}</button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <div onClick={(e) => e.target === e.currentTarget && setEditing(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--r-lg)', padding: 20, maxWidth: 420, width: '100%' }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>
              {editing.id ? `Editar · ${editing.nombre}` : 'Nueva etiqueta'}
            </div>
            <div className="stack-sm">
              <div>
                <div className="card-title" style={{ marginBottom: 4 }}>Nombre *</div>
                <input className="ki-input" value={editing.nombre || ''} onChange={(e) => setEditing({ ...editing, nombre: e.target.value })} />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="card-title" style={{ marginBottom: 4 }}>Icono (emoji)</div>
                  <input className="ki-input" value={editing.icono || ''} onChange={(e) => setEditing({ ...editing, icono: e.target.value })} maxLength={4} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="card-title" style={{ marginBottom: 4 }}>Color</div>
                  <input className="ki-input" type="color" value={editing.color || '#5fe0a9'} onChange={(e) => setEditing({ ...editing, color: e.target.value })} style={{ padding: 4, height: 36 }} />
                </div>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="card-title" style={{ marginBottom: 4 }}>Hora inicio default</div>
                  <input className="ki-input" type="time" value={editing.hora_inicio_default || ''} onChange={(e) => setEditing({ ...editing, hora_inicio_default: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="card-title" style={{ marginBottom: 4 }}>Hora fin default</div>
                  <input className="ki-input" type="time" value={editing.hora_fin_default || ''} onChange={(e) => setEditing({ ...editing, hora_fin_default: e.target.value })} />
                </div>
              </div>
              <div className="row" style={{ gap: 16 }}>
                <label className="row" style={{ gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editing.cubre_diurno} onChange={(e) => setEditing({ ...editing, cubre_diurno: e.target.checked })} />
                  ☀ Cubre turno diurno (12-17h)
                </label>
                <label className="row" style={{ gap: 6, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editing.cubre_nocturno} onChange={(e) => setEditing({ ...editing, cubre_nocturno: e.target.checked })} />
                  🌙 Cubre nocturno (17-21h)
                </label>
              </div>
              <div>
                <div className="card-title" style={{ marginBottom: 4 }}>Orden (menor = primero)</div>
                <input className="ki-input" type="number" value={editing.orden ?? 100} onChange={(e) => setEditing({ ...editing, orden: Number(e.target.value) })} />
              </div>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} className="btn btn-ghost" disabled={saving}>Cancelar</button>
              <button onClick={guardar} className="btn btn-kaeru" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={onClose} className="btn btn-outline" style={{ width: '100%' }}>Cerrar</button>
      </div>
    </div>
  );
}

// =============================================================================
// Página principal
// =============================================================================
export default function Horarios() {
  const { session } = useSession();
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [semana, setSemana] = useState<Date>(lunesDe(new Date()));
  // horarios[empleado_id][dia_semana] = HorarioRow con _fuente
  const [horarios, setHorarios] = useState<Record<string, Record<number, HorarioRow>>>({});
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState<{ empleado: Empleado; dia: number } | null>(null);
  const [editMode, setEditMode] = useState<{ esPermanente: boolean } | null>(null);
  const [showEtiquetasMgr, setShowEtiquetasMgr] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(semana, i)), [semana]);
  const semanaIso = fmtIsoDate(semana);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const loadHorarios = useCallback(async () => {
    setLoading(true);
    const [pRes, oRes] = await Promise.all([
      kaeru.from('horario_planeado').select('*').is('semana_inicio', null).eq('es_plantilla', true),
      kaeru.from('horario_planeado').select('*').eq('semana_inicio', semanaIso)
    ]);
    const map: Record<string, Record<number, HorarioRow>> = {};
    for (const h of (pRes.data || []) as any[]) {
      if (!map[h.empleado_id]) map[h.empleado_id] = {};
      map[h.empleado_id][h.dia_semana] = { ...h, _fuente: 'plantilla' };
    }
    for (const h of (oRes.data || []) as any[]) {
      if (!map[h.empleado_id]) map[h.empleado_id] = {};
      map[h.empleado_id][h.dia_semana] = { ...h, _fuente: 'override' };
    }
    setHorarios(map);
    setLoading(false);
  }, [semanaIso]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [eRes, etRes] = await Promise.all([
        kaeru.from('empleados').select('id,nombre,cargo').eq('activo', true).eq('aparece_en_horario', true).order('nombre'),
        kaeru.from('horario_etiquetas').select('*').order('orden')
      ]);
      if (cancel) return;
      setEmpleados((eRes.data || []) as unknown as Empleado[]);
      setEtiquetas((etRes.data || []) as unknown as Etiqueta[]);
    })();
    return () => { cancel = true; };
  }, []);

  useEffect(() => { loadHorarios(); }, [loadHorarios]);

  function clickCelda(empleado: Empleado, dia: number) {
    setEditCell({ empleado, dia });
    setEditMode(null);
  }

  function elegirTipo(esPermanente: boolean) {
    setEditMode({ esPermanente });
  }

  async function guardar(tramos: Tramo[], etiquetaId: string | null, notas: string | null) {
    if (!editCell || !editMode) return;
    const { empleado, dia } = editCell;
    const { esPermanente } = editMode;
    const existing = horarios[empleado.id]?.[dia];
    const targetFuente = esPermanente ? 'plantilla' : 'override';
    // Si existe la versión que estamos guardando, update; si no, insert
    const matchExisting = existing?._fuente === targetFuente ? existing : null;

    const payload = {
      empleado_id: empleado.id,
      dia_semana: dia,
      semana_inicio: esPermanente ? null : semanaIso,
      es_plantilla: esPermanente,
      tramos: tramos as any,
      etiqueta_id: etiquetaId,
      notas,
      planeado_por: session?.empleado_id ?? null
    };

    if (matchExisting?.id) {
      const { error } = await kaeru.from('horario_planeado').update(payload).eq('id', matchExisting.id);
      if (error) { alert('Error: ' + error.message); return; }
    } else {
      const { error } = await kaeru.from('horario_planeado').insert(payload);
      if (error) { alert('Error: ' + error.message); return; }
    }

    showToast(esPermanente ? '🔒 Plantilla permanente guardada' : '⚡ Solo esta semana');
    setEditCell(null);
    setEditMode(null);
    loadHorarios();
  }

  async function eliminar() {
    if (!editCell || !editMode) return;
    const { empleado, dia } = editCell;
    const existing = horarios[empleado.id]?.[dia];
    if (!existing?.id || existing._fuente !== (editMode.esPermanente ? 'plantilla' : 'override')) {
      alert('No hay versión que eliminar en este nivel.');
      return;
    }
    const { error } = await kaeru.from('horario_planeado').delete().eq('id', existing.id);
    if (error) { alert('Error: ' + error.message); return; }
    showToast('Horario eliminado');
    setEditCell(null);
    setEditMode(null);
    loadHorarios();
  }

  const horarioActual = editCell ? horarios[editCell.empleado.id]?.[editCell.dia] || null : null;

  // Stats
  const asignaciones = empleados.flatMap((e) => dias.map((_, dia) => horarios[e.id]?.[dia])).filter((h) => h?.tramos?.length).length;
  const overrides = empleados.flatMap((e) => dias.map((_, dia) => horarios[e.id]?.[dia])).filter((h) => h?._fuente === 'override').length;
  const totalSlots = empleados.length * 7;

  if (loading) return <PageShell kanji="時" titulo="Horarios Semanales" subtitulo=""><LoadingCard /></PageShell>;

  return (
    <PageShell
      kanji="時"
      titulo="Horarios Semanales"
      subtitulo={`Semana ${fmtSemana(semana)} · ${empleados.length} empleados · ${overrides} cambios solo esta semana`}
      badge={{ label: `${asignaciones}/${totalSlots} slots`, variant: 'kaeru' }}
      actions={
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => setSemana(addDays(semana, -7))}>← Anterior</button>
          <button className="btn btn-outline btn-sm" onClick={() => setSemana(lunesDe(new Date()))}>Hoy</button>
          <button className="btn btn-outline btn-sm" onClick={() => setSemana(addDays(semana, 7))}>Siguiente →</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowEtiquetasMgr(true)}>🏷 Etiquetas</button>
        </div>
      }
    >
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, right: 16, zIndex: 250,
          background: 'var(--accent-kaeru)', color: 'var(--bg-base)',
          padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>{toast}</div>
      )}

      {/* Grid */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Grid semanal</div>
          <span className="badge badge-muted">🔒 plantilla · ⚡ override semana</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--bg-card)', zIndex: 2, minWidth: 140 }}>Empleado</th>
                {dias.map((d, i) => (
                  <th key={i} style={{ textAlign: 'center', minWidth: 100 }}>
                    <div style={{ fontWeight: 700 }}>{DIAS_SHORT[i]}</div>
                    <div className="text-muted" style={{ fontSize: 10, fontWeight: 400 }}>{d.getDate()}/{d.getMonth() + 1}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {empleados.map((emp) => (
                <tr key={emp.id}>
                  <td style={{ position: 'sticky', left: 0, background: 'var(--bg-card)', fontWeight: 600 }}>
                    <div>{emp.nombre}</div>
                    <div className="text-muted" style={{ fontSize: 10 }}>{emp.cargo || '—'}</div>
                  </td>
                  {dias.map((_, dia) => {
                    const h = horarios[emp.id]?.[dia];
                    const et = h?.etiqueta_id ? etiquetas.find((x) => x.id === h.etiqueta_id) : null;
                    const isOverride = h?._fuente === 'override';
                    const isPlantilla = h?._fuente === 'plantilla';
                    const color = et?.color || (h ? 'var(--accent-kaeru)' : 'var(--border-default)');
                    return (
                      <td key={dia} style={{ textAlign: 'center', padding: 4 }}>
                        <button onClick={() => clickCelda(emp, dia)} style={{
                          width: '100%', minHeight: 56,
                          background: h?.tramos?.length ? `${color}1a` : 'var(--bg-inset)',
                          border: `1px solid ${isOverride ? 'var(--accent-purple)' : isPlantilla ? color + '88' : 'var(--border-subtle)'}`,
                          borderRadius: 6,
                          color: h?.tramos?.length ? color : 'var(--text-muted)',
                          cursor: 'pointer', padding: '6px 4px', fontSize: 11
                        }}>
                          {h?.tramos?.length ? (
                            <>
                              <div style={{ fontWeight: 700, fontSize: 11 }}>
                                {et?.icono && `${et.icono} `}{et?.nombre || h.tramos[0].etiqueta || 'Custom'}
                              </div>
                              <div style={{ fontSize: 9, opacity: 0.8, marginTop: 1 }}>{fmtTramos(h.tramos)}</div>
                              <div style={{ fontSize: 9, marginTop: 2 }}>
                                {isOverride ? '⚡' : isPlantilla ? '🔒' : ''}
                              </div>
                            </>
                          ) : (
                            <span className="text-dim" style={{ fontSize: 10 }}>—</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Helper */}
      <div className="card" style={{ borderColor: 'rgba(154,111,209,0.3)' }}>
        <div className="card-title text-purple" style={{ marginBottom: 8 }}>Cómo funciona — patrón Freakies</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          • <strong>🔒 Plantilla permanente:</strong> aplica todas las semanas. Define el horario "normal" de cada empleado.<br />
          • <strong>⚡ Override semana:</strong> cambio puntual solo para esta semana. Tiene precedencia sobre la plantilla.<br />
          • Al editar una celda, el modal pregunta: ¿permanente o solo esta semana?<br />
          • <strong>Etiquetas custom:</strong> 🏷 Etiquetas → crear/editar presets (color, horario default, cubre diurno/nocturno). Usados como atajos rápidos.<br />
          • <strong>Tramos múltiples</strong> por día = soporte para turno partido (12-3 + 6-9).<br />
          • Las flags <code>cubre_diurno</code>/<code>cubre_nocturno</code> de cada etiqueta alimentan el reparto de propinas en <code>/propinas</code>.<br />
          • <strong>Próximo:</strong> notificación Telegram a empleados con su horario el lunes 9 AM (Fase final).
        </div>
      </div>

      {/* Modales */}
      {editCell && !editMode && (
        <ModalElegirTipo
          empleado={editCell.empleado} dia={editCell.dia}
          horarioActual={horarioActual} semanaLunes={semana}
          onElegir={elegirTipo} onCerrar={() => setEditCell(null)}
        />
      )}
      {editCell && editMode && (
        <ModalEditor
          empleado={editCell.empleado} dia={editCell.dia}
          esPermanente={editMode.esPermanente} semanaLunes={semana}
          horarioActual={horarioActual && horarioActual._fuente === (editMode.esPermanente ? 'plantilla' : 'override') ? horarioActual : null}
          etiquetas={etiquetas.filter((e) => e.activo)}
          onGuardar={guardar} onEliminar={eliminar}
          onCerrar={() => { setEditCell(null); setEditMode(null); }}
        />
      )}

      {/* Drawer etiquetas */}
      <Drawer open={showEtiquetasMgr} onClose={() => setShowEtiquetasMgr(false)} title="Etiquetas de turno">
        <EtiquetasManager etiquetas={etiquetas} onClose={() => setShowEtiquetasMgr(false)} onReload={async () => {
          const { data } = await kaeru.from('horario_etiquetas').select('*').order('orden');
          setEtiquetas((data || []) as unknown as Etiqueta[]);
        }} />
      </Drawer>
    </PageShell>
  );
}
