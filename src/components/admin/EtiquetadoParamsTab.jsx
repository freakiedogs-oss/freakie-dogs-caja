// ══════════════════════════════════════════════════════════════
// Producción → 🏷️ Etiquetado: qué productos ofrece la estación de pesaje y
// con qué parámetros (receta, peso nominal, banda, días de vida útil,
// conservación). Antes esto vivía fijo en src/etiquetado/productos.js.
//
// peso_nominal_g vacío = la estación solo deja producirlo en MODO PRUEBA:
// con el peso real de una tanda completa se carga acá y queda habilitado.
// Los días son provisionales hasta que Calidad cierre el estudio de vida
// útil (RVP-13) y los marque "validado".
// ══════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react';
import { db } from '../../supabase';
import { n } from '../../config';

const C = {
  card: '#1a1d28', border: '#2a2d3a', accent: '#e63946', green: '#22c55e', greenSoft: '#22c55e18', greenBorder: '#22c55e44',
  yellow: '#f59e0b', red: '#ef4444', redSoft: '#ef444418', text: '#e8e8ed', textMuted: '#8b8d9a', textDim: '#5a5c6a', bg: '#0f1117',
};
const inp = { width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 10px', fontSize: 13 };
const lbl = { fontSize: 11, color: C.textDim, display: 'block', marginBottom: 3, marginTop: 10 };

const VACIO = { producto_id: '', receta_id: '', nombre_etiqueta: '', requiere_peso: true, peso_nominal_g: '', banda_g: '', tara_g: 0, vida_util_dias: '', vida_util_estado: 'provisional', conservacion: 'Mantener refrigerado', orden: 0, activo: true };

export default function EtiquetadoParamsTab({ user }) {
  const [filas, setFilas] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);

  const cargar = useCallback(async () => {
    const [pRes, rRes] = await Promise.all([
      db.from('produccion_etiquetado_productos').select('*, catalogo_productos(id,nombre,unidad_medida), recetas(id,nombre,rendimiento,unidad_rendimiento,activo)').order('orden'),
      // Solo recetas que producen stock: las que tienen producto de catálogo y no son platos del menú.
      db.from('recetas').select('id,nombre,rendimiento,unidad_rendimiento,catalogo_id,activo, catalogo_productos(id,nombre,unidad_medida)')
        .in('tipo', ['sub_receta', 'porcionado']).not('catalogo_id', 'is', null).order('nombre'),
    ]);
    if (pRes.error) setError(pRes.error.message);
    setFilas(pRes.data || []);
    setRecetas(rRes.data || []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const abrir = (f) => setEdit(f ? {
    producto_id: f.producto_id, receta_id: f.receta_id, nombre_etiqueta: f.nombre_etiqueta, requiere_peso: f.requiere_peso,
    peso_nominal_g: f.peso_nominal_g ?? '', banda_g: f.banda_g ?? '', tara_g: f.tara_g ?? 0, vida_util_dias: f.vida_util_dias,
    vida_util_estado: f.vida_util_estado, conservacion: f.conservacion || '', orden: f.orden, activo: f.activo,
  } : { ...VACIO });

  const elegirReceta = (id) => {
    const r = recetas.find(x => x.id === id);
    setEdit(e => ({ ...e, receta_id: id, producto_id: r?.catalogo_id || '', nombre_etiqueta: e.nombre_etiqueta || r?.catalogo_productos?.nombre || '' }));
  };

  const guardar = async () => {
    setSaving(true); setError(null); setOk(null);
    try {
      const p = {
        ...edit,
        peso_nominal_g: edit.peso_nominal_g === '' ? null : n(edit.peso_nominal_g),
        banda_g: edit.banda_g === '' ? null : n(edit.banda_g),
        tara_g: n(edit.tara_g), vida_util_dias: parseInt(edit.vida_util_dias, 10), orden: parseInt(edit.orden, 10) || 0,
      };
      if (!p.receta_id || !p.nombre_etiqueta || !(p.vida_util_dias > 0)) throw new Error('Receta, nombre de etiqueta y días de vida útil son obligatorios');
      const { error: e } = await db.rpc('produccion_etiquetado_guardar', { p, p_usuario_id: user?.id || null });
      if (e) throw new Error(e.message);
      setOk(`${p.nombre_etiqueta} guardado.`);
      setEdit(null);
      cargar();
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  const Msg = ({ err, msg }) => !msg ? null : (
    <div style={{ background: err ? C.redSoft : C.greenSoft, border: `1px solid ${err ? '#ef444444' : C.greenBorder}`, color: err ? '#fca5a5' : '#86efac', padding: '10px 12px', borderRadius: 10, marginBottom: 12, fontSize: 13 }}>{msg}</div>
  );

  if (edit) {
    const receta = recetas.find(r => r.id === edit.receta_id);
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
        <button onClick={() => setEdit(null)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10, fontWeight: 600 }}>← Volver</button>
        <Msg err msg={error} />
        <label style={lbl}>Receta de producción (define el producto y lo que se descuenta)</label>
        <select value={edit.receta_id} onChange={e => elegirReceta(e.target.value)} style={inp} disabled={!!filas.find(f => f.producto_id === edit.producto_id) && !!edit.producto_id && edit.producto_id !== ''}>
          <option value="">Elegir…</option>
          {recetas.map(r => <option key={r.id} value={r.id}>{r.nombre} → {r.catalogo_productos?.nombre} ({r.rendimiento} {r.unidad_rendimiento}/tanda){r.activo ? '' : ' · INACTIVA'}</option>)}
        </select>
        {receta && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>Producto: <b style={{ color: C.text }}>{receta.catalogo_productos?.nombre}</b> · unidad {receta.catalogo_productos?.unidad_medida}</div>}

        <label style={lbl}>Nombre en la etiqueta</label>
        <input value={edit.nombre_etiqueta} onChange={e => setEdit({ ...edit, nombre_etiqueta: e.target.value })} style={inp} maxLength={40} />

        <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={edit.requiere_peso} onChange={e => setEdit({ ...edit, requiere_peso: e.target.checked })} />
          <span style={{ color: C.text, fontSize: 13 }}>Se pesa en la báscula (si no, solo se cuenta)</span>
        </label>

        {edit.requiere_peso && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div><label style={lbl}>Peso nominal (g)</label><input type="number" value={edit.peso_nominal_g} onChange={e => setEdit({ ...edit, peso_nominal_g: e.target.value })} style={inp} placeholder="vacío = solo prueba" /></div>
            <div><label style={lbl}>Banda ± (g)</label><input type="number" value={edit.banda_g} onChange={e => setEdit({ ...edit, banda_g: e.target.value })} style={inp} /></div>
            <div><label style={lbl}>Tara (g)</label><input type="number" value={edit.tara_g} onChange={e => setEdit({ ...edit, tara_g: e.target.value })} style={inp} /></div>
          </div>
        )}
        {edit.requiere_peso && edit.peso_nominal_g === '' && (
          <div style={{ fontSize: 12, color: C.yellow, marginTop: 6 }}>Sin peso nominal la estación solo deja producirlo en modo prueba (no toca inventario). Pesá una tanda completa y cargalo.</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={lbl}>Vida útil (días)</label><input type="number" value={edit.vida_util_dias} onChange={e => setEdit({ ...edit, vida_util_dias: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>Estado de esos días</label>
            <select value={edit.vida_util_estado} onChange={e => setEdit({ ...edit, vida_util_estado: e.target.value })} style={inp}>
              <option value="provisional">Provisional</option>
              <option value="validado">Validado (RVP-13)</option>
            </select></div>
        </div>
        <label style={lbl}>Conservación (va en la etiqueta)</label>
        <input value={edit.conservacion} onChange={e => setEdit({ ...edit, conservacion: e.target.value })} style={inp} maxLength={40} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={lbl}>Orden en la tablet</label><input type="number" value={edit.orden} onChange={e => setEdit({ ...edit, orden: e.target.value })} style={inp} /></div>
          <div><label style={lbl}>Activo</label>
            <select value={edit.activo ? '1' : '0'} onChange={e => setEdit({ ...edit, activo: e.target.value === '1' })} style={inp}>
              <option value="1">Sí, aparece en la estación</option>
              <option value="0">No</option>
            </select></div>
        </div>
        <button onClick={guardar} disabled={saving} style={{ width: '100%', marginTop: 16, background: C.accent, color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <Msg err msg={error} />
      <Msg msg={ok} />
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        Lo que ofrece la tablet de pesaje y etiquetado de Casa Matriz. Al cerrar una tanda, el sistema descuenta la receta
        (materias primas por el peso real, empaques por unidades) y da de alta las bolsas.
      </div>
      {filas.map(f => (
        <div key={f.producto_id} onClick={() => abrir(f)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', opacity: f.activo ? 1 : .55 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{f.nombre_etiqueta}</div>
            <div style={{ fontSize: 11, color: f.activo ? C.green : C.textDim }}>{f.activo ? 'activo' : 'inactivo'}</div>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            {f.recetas?.nombre} · rinde {f.recetas?.rendimiento} {f.recetas?.unidad_rendimiento}{f.recetas?.activo ? '' : ' · RECETA INACTIVA'}
          </div>
          <div style={{ fontSize: 12, marginTop: 3, color: C.textMuted }}>
            {!f.requiere_peso ? 'no se pesa' : f.peso_nominal_g ? `${Math.round(f.peso_nominal_g)} g ±${f.banda_g ?? 0}` : <span style={{ color: C.yellow }}>sin peso nominal → solo modo prueba</span>}
            {' · '}{f.vida_util_dias} días {f.vida_util_estado === 'provisional' ? <span style={{ color: C.yellow }}>(provisional)</span> : <span style={{ color: C.green }}>(validado)</span>}
          </div>
        </div>
      ))}
      <button onClick={() => abrir(null)} style={{ width: '100%', marginTop: 8, background: 'transparent', color: C.text, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 12, cursor: 'pointer', fontSize: 13 }}>
        + Agregar producto a la estación
      </button>
    </div>
  );
}
