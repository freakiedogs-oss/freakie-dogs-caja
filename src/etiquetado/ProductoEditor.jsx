/* ═══════════════════════════════════════════════════════════════════════
   Crear o corregir un producto, desde la misma báscula

   Vive acá y no en el ERP a propósito: el problema aparece cuando alguien
   está parado frente a la balanza con algo que no está en la lista. Si para
   arreglarlo hay que ir a una computadora —o esperar a Cesar— la gente
   aprende que la aplicación no sirve y vuelve al papel.

   Pesar no pide PIN (la tablet está dedicada y bajo control de Casa Matriz).
   Esto sí: cambia la lista para todos, así que identifica a la persona y
   deja el cambio firmado. Quién puede lo decide el servidor.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react'
import { validarPin, guardarProducto } from './productos'

const C = {
  bg: '#0a0a0b', card: '#141416', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', bad: '#ef4444', acc: '#3b82f6', warn: '#f59e0b',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }
const input = {
  background: C.bg, border: `1px solid ${C.line}`, borderRadius: 10, padding: '11px 12px',
  color: C.txt, fontSize: 16, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
}
const label = { display: 'block', fontSize: 12, color: C.dim, margin: '10px 0 5px', fontWeight: 600 }

export default function ProductoEditor({ productoBase, onListo, onCerrar }) {
  // productoBase llega cuando se está corrigiendo uno que ya existe.
  const editando = !!productoBase
  const [actor, setActor] = useState(null)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [yendo, setYendo] = useState(false)
  const [f, setF] = useState(() => ({
    nombre: productoBase?.nombre || '',
    unidad: productoBase?.unidad || '',
    gramos: productoBase?.gramos != null ? String(productoBase.gramos) : '',
    banda:  productoBase?.banda  != null ? String(productoBase.banda)  : '',
    tara:   productoBase?.tara ? String(productoBase.tara) : '',
    dias:   productoBase?.dias != null ? String(productoBase.dias) : '',
    conserva: productoBase?.conserva || 'Mantener refrigerado',
  }))
  const up = (k, v) => setF(p => ({ ...p, [k]: v }))

  async function probarPin(valor) {
    setErr(''); setYendo(true)
    try {
      const a = await validarPin(valor)
      if (!a) { setErr('Ese PIN no puede cambiar la lista de productos'); setPin('') }
      else setActor(a)
    } catch (e) { setErr(e.message || 'No se pudo verificar el PIN'); setPin('') }
    setYendo(false)
  }

  const tecla = (k) => {
    if (yendo) return
    setErr('')
    if (k === '←') { setPin(p => p.slice(0, -1)); return }
    if (k === '✓') { if (pin.length >= 4) probarPin(pin); else setErr('Marcá los 4 dígitos'); return }
    setPin(p => (p.length >= 6 ? p : p + k))
  }

  async function guardar() {
    const nombre = f.nombre.trim()
    const gramos = Number(f.gramos)
    if (!nombre) { setErr('Ponele un nombre al producto'); return }
    if (!(gramos > 0)) { setErr('Falta el peso objetivo en gramos'); return }
    setErr(''); setYendo(true)
    try {
      const guardado = await guardarProducto(pin, {
        clave: productoBase?.id || null,
        nombre, unidad: f.unidad.trim(),
        gramos,
        banda: f.banda === '' ? null : Number(f.banda),
        tara: f.tara === '' ? 0 : Number(f.tara),
        dias: f.dias === '' ? null : Number(f.dias),
        conserva: f.conserva,
      })
      onListo(guardado)
    } catch (e) {
      setErr(e.message || 'No se pudo guardar')
      setYendo(false)
    }
  }

  const marco = (hijos) => (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.txt, padding: 14,
                  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>{hijos}</div>
    </div>
  )

  // ── Candado ──
  if (!actor) return marco(
    <div style={card}>
      <div style={{ fontSize: 17, fontWeight: 800 }}>
        {editando ? `Corregir «${productoBase.nombre}»` : 'Agregar un producto'}
      </div>
      <div style={{ color: C.dim, fontSize: 13.5, lineHeight: 1.55, margin: '6px 0 14px' }}>
        Esto cambia la lista para todos. Marcá tu PIN — queda registrado quién lo hizo.
      </div>
      <div style={{ textAlign: 'center', fontSize: 34, letterSpacing: 12, minHeight: 44,
                    fontFamily: 'ui-monospace, monospace', padding: '6px 0 12px' }}>
        {pin ? '•'.repeat(pin.length) : <span style={{ color: C.line }}>••••</span>}
      </div>
      {err && <div style={{ color: '#fca5a5', fontSize: 13.5, textAlign: 'center', marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
        {['1','2','3','4','5','6','7','8','9','←','0','✓'].map(k => (
          <button key={k} onClick={() => tecla(k)} disabled={yendo}
            style={{ background: k === '✓' ? C.ok : '#1c1c20', color: k === '✓' ? '#06180c' : C.txt,
                     border: 0, borderRadius: 12, padding: 17, fontSize: 21, cursor: 'pointer',
                     fontFamily: 'ui-monospace, monospace', opacity: yendo ? .5 : 1 }}>{k}</button>
        ))}
      </div>
      <button onClick={onCerrar}
        style={{ background: 'none', border: `1px solid ${C.line}`, borderRadius: 10, padding: 11,
                 width: '100%', marginTop: 10, color: C.dim, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
        Cancelar
      </button>
    </div>
  )

  // ── Formulario ──
  const listo = f.nombre.trim() && Number(f.gramos) > 0
  return marco(
    <div style={card}>
      <div style={{ fontSize: 17, fontWeight: 800 }}>{editando ? 'Corregir producto' : 'Producto nuevo'}</div>
      <div style={{ color: '#6ee7b7', fontSize: 12.5, marginTop: 3 }}>{actor.nombre}</div>

      <label style={label}>Nombre *</label>
      <input value={f.nombre} onChange={e => up('nombre', e.target.value)} style={input}
             placeholder="Ej: Salsa de ajo porcionada" autoFocus={!editando} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={label}>Presentación</label>
          <input value={f.unidad} onChange={e => up('unidad', e.target.value)} style={input} placeholder="bolsa 1 lb" />
        </div>
        <div>
          <label style={label}>Peso objetivo en gramos *</label>
          <input value={f.gramos} onChange={e => up('gramos', e.target.value.replace(/[^\d.]/g, ''))}
                 inputMode="decimal" style={input} placeholder="454" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <div>
          <label style={label}>Banda ± g</label>
          <input value={f.banda} onChange={e => up('banda', e.target.value.replace(/[^\d.]/g, ''))}
                 inputMode="decimal" style={input} placeholder="30" />
        </div>
        <div>
          <label style={label}>Tara del empaque</label>
          <input value={f.tara} onChange={e => up('tara', e.target.value.replace(/[^\d.]/g, ''))}
                 inputMode="decimal" style={input} placeholder="0" />
        </div>
        <div>
          <label style={label}>Vence en (días)</label>
          <input value={f.dias} onChange={e => up('dias', e.target.value.replace(/[^\d]/g, ''))}
                 inputMode="numeric" style={input} placeholder="30" />
        </div>
      </div>

      <label style={label}>Conservación</label>
      <select value={f.conserva} onChange={e => up('conserva', e.target.value)} style={input}>
        <option>Mantener refrigerado</option>
        <option>Mantener congelado</option>
        <option>Lugar seco</option>
      </select>

      <div style={{ background: '#2a1f06', border: '1px solid #78350f', borderRadius: 10, padding: 11,
                    marginTop: 14, color: '#fcd34d', fontSize: 12.5, lineHeight: 1.55 }}>
        El <b>peso objetivo es el neto</b>, sin el empaque: si la bolsa pesa algo, ponelo en
        «tara» y la báscula lo descuenta sola. Lo que dejes vacío se puede completar después.
      </div>

      {!editando && (
        <div style={{ color: C.dim, fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>
          Si nadie lo pesa en 15 días sale solo de la lista, para que no se llene de cosas que
          se usaron una vez. Si vuelve a hacer falta, escribí el mismo nombre acá y reaparece
          con el peso y la tara que ya tenía.
        </div>
      )}

      {err && <div style={{ ...card, background: '#3a1212', borderColor: C.bad, color: '#fecaca',
                            marginTop: 12, fontSize: 14 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
        <button onClick={guardar} disabled={!listo || yendo}
          style={{ flex: 1, background: listo && !yendo ? C.ok : '#1f2937', color: listo && !yendo ? '#06180c' : '#6b7280',
                   border: 0, borderRadius: 12, padding: 16, fontSize: 16, fontWeight: 800,
                   cursor: listo && !yendo ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          {yendo ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear y pesar ahora'}
        </button>
        <button onClick={onCerrar}
          style={{ background: '#1c1c20', border: 0, borderRadius: 12, padding: '16px 20px',
                   color: C.txt, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
