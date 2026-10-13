// ══════════════════════════════════════════════════════════════
// Producción → Etiquetado: los productos de la estación de pesaje
// (tabla `etiquetado_productos`, la misma que Kevin edita desde la tablet) y
// su VÍNCULO con la receta de producción, que es lo que hace que al cerrar
// una tanda el sistema descuente insumos y dé de alta las bolsas.
//
// · Peso, banda, tara, días y nombre se corrigen desde la tablet con PIN (es
//   donde se descubren los pesos malos). Acá solo se ve.
// · Sin receta vinculada el producto se pesa e imprime igual, pero el cierre
//   avisa que no descontó inventario. Vincularla acá lo activa.
// · "Días validados" = Calidad cerró el estudio de vida útil (RVP-13).
// ══════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react';
import { db } from '../../supabase';

const C = {
  card: '#1a1d28', border: '#2a2d3a', accent: '#e63946', green: '#22c55e', greenSoft: '#22c55e18', greenBorder: '#22c55e44',
  yellow: '#f59e0b', red: '#ef4444', redSoft: '#ef444418', text: '#e8e8ed', textMuted: '#8b8d9a', textDim: '#5a5c6a', bg: '#0f1117',
};
const inp = { width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '9px 10px', fontSize: 13 };
const lbl = { fontSize: 11, color: C.textDim, display: 'block', marginBottom: 3, marginTop: 10 };

export default function EtiquetadoParamsTab({ user }) {
  const [filas, setFilas] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(null);
  const [saving, setSaving] = useState(false);
  const [verRetirados, setVerRetirados] = useState(false);

  const cargar = useCallback(async () => {
    const [pRes, rRes] = await Promise.all([
      db.from('etiquetado_productos').select('*, recetas(id,nombre,rendimiento,unidad_rendimiento,activo,catalogo_id)').order('orden').order('nombre'),
      // Solo recetas que producen stock: con producto de catálogo y que no son platos del menú.
      db.from('recetas').select('id,nombre,rendimiento,unidad_rendimiento,catalogo_id,activo, catalogo_productos(id,nombre,unidad_medida)')
        .in('tipo', ['sub_receta', 'porcionado']).not('catalogo_id', 'is', null).order('nombre'),
    ]);
    if (pRes.error) setError(pRes.error.message);
    setFilas(pRes.data || []);
    setRecetas(rRes.data || []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async () => {
    setSaving(true); setError(null); setOk(null);
    try {
      const { error: e } = await db.rpc('fn_etiquetado_vincular_receta', {
        p_id: edit.id, p_receta_id: edit.receta_id || null, p_requiere_peso: !!edit.requiere_peso,
        p_vida_util_estado: edit.vida_util_estado, p_usuario_id: user?.id || null,
      });
      if (e) throw new Error(e.message);
      setOk(`${edit.nombre}: ${edit.receta_id ? 'receta vinculada' : 'sin receta'}.`);
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
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{edit.nombre}</div>
        <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
          {edit.unidad || '—'} · {edit.gramos ? `${Math.round(edit.gramos)} g netos ±${edit.banda ?? 0}` : 'sin peso objetivo'}{edit.tara ? ` · tara ${edit.tara} g` : ''} · {edit.dias ?? '?'} días
          <br /><span style={{ color: C.textDim }}>Peso, banda, tara y días se corrigen desde la tablet (✎, con PIN).</span>
        </div>

        <label style={lbl}>Receta de producción (lo que se descuenta al cerrar la tanda)</label>
        <select value={edit.receta_id || ''} onChange={e => setEdit({ ...edit, receta_id: e.target.value || null })} style={inp}>
          <option value="">Sin receta: se registra, no descuenta inventario</option>
          {recetas.map(r => <option key={r.id} value={r.id}>{r.nombre} → {r.catalogo_productos?.nombre} ({r.rendimiento} {r.unidad_rendimiento}/tanda){r.activo ? '' : ' · INACTIVA'}</option>)}
        </select>
        {receta && (
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}>
            Da de alta <b style={{ color: C.text }}>{receta.catalogo_productos?.nombre}</b> ({receta.catalogo_productos?.unidad_medida}).
            {edit.gramos ? <> Materias primas por peso real: {Math.round(edit.gramos)} g × {receta.rendimiento} = 1 tanda de receta.</> : <> <span style={{ color: C.yellow }}>Sin peso objetivo, el consumo se calcula por unidades (N ÷ {receta.rendimiento}).</span></>}
            {!receta.activo && <span style={{ color: C.red }}> Receta inactiva: no descontará hasta reactivarla.</span>}
          </div>
        )}

        <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!edit.requiere_peso} onChange={e => setEdit({ ...edit, requiere_peso: e.target.checked })} />
          <span style={{ color: C.text, fontSize: 13 }}>Se pesa en la báscula (si no, solo se cuenta: paquetes, botes)</span>
        </label>

        <label style={lbl}>Días de vida útil ({edit.dias ?? '?'})</label>
        <select value={edit.vida_util_estado || 'provisional'} onChange={e => setEdit({ ...edit, vida_util_estado: e.target.value })} style={inp}>
          <option value="provisional">Provisionales (la etiqueta lo marca)</option>
          <option value="validado">Validados por Calidad (RVP-13)</option>
        </select>

        <button onClick={guardar} disabled={saving} style={{ width: '100%', marginTop: 16, background: C.accent, color: '#fff', border: 'none', borderRadius: 12, padding: 14, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    );
  }

  const lista = filas.filter(f => verRetirados || f.activo);
  return (
    <div>
      <Msg err msg={error} />
      <Msg msg={ok} />
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10, lineHeight: 1.5 }}>
        Lo que ofrece la tablet de pesaje de Casa Matriz. Con receta vinculada, al cerrar una tanda el sistema descuenta la receta
        (materias primas por el peso real, empaques por unidades) y da de alta las bolsas. Sin receta, solo registra las unidades.
      </div>
      {lista.map(f => (
        <div key={f.id} onClick={() => setEdit(f)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', marginBottom: 8, cursor: 'pointer', opacity: f.activo ? 1 : .5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{f.nombre}</div>
            <div style={{ fontSize: 11, color: !f.activo ? C.textDim : f.recetas ? (f.recetas.activo ? C.green : C.red) : C.yellow }}>
              {!f.activo ? `retirado${f.retirado_motivo ? ' · ' + f.retirado_motivo : ''}` : f.recetas ? (f.recetas.activo ? 'descuenta inventario' : 'receta inactiva') : 'sin receta'}
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
            {f.unidad || '—'} · {f.gramos ? `${Math.round(f.gramos)} g ±${f.banda ?? 0}` : 'sin peso objetivo'}{f.tara ? ` · tara ${f.tara} g` : ''}
            {' · '}{f.dias ?? '?'} días {f.vida_util_estado === 'validado' ? <span style={{ color: C.green }}>(validados)</span> : <span style={{ color: C.yellow }}>(provisionales)</span>}
            {f.recetas ? ` · ${f.recetas.nombre} (${f.recetas.rendimiento} ${f.recetas.unidad_rendimiento}/tanda)` : ''}
            {f.origen === 'estacion' && f.creado_nombre ? ` · creado en la tablet por ${f.creado_nombre}` : ''}
          </div>
        </div>
      ))}
      <button onClick={() => setVerRetirados(v => !v)} style={{ width: '100%', marginTop: 4, background: 'transparent', color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 10, cursor: 'pointer', fontSize: 12 }}>
        {verRetirados ? 'Ocultar retirados' : `Ver retirados (${filas.filter(f => !f.activo).length})`}
      </button>
    </div>
  );
}
