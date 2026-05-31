import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from '../../supabase'
import Icon from '../Icon'
import { useToast } from '../../hooks/useToast'

/**
 * PlanoEditor — Editor visual del plano de mesas (admin).
 * Arrastrar para mover, agregar/eliminar mesas, editar nº/capacidad/forma/zona.
 * Persiste en pos_mesas (pos_x/pos_y/ancho/alto en plano virtual 100×55).
 */
const PLANO_H = 55
const FORMAS = ['cuadrada', 'rectangular', 'redonda']

export default function PlanoEditor({ storeCode, storeName, onClose }) {
  const toast = useToast()
  const [mesas, setMesas]       = useState([])
  const [zonas, setZonas]       = useState(['principal'])
  const [zona, setZona]         = useState('principal')
  const [selId, setSelId]       = useState(null)
  const [deleted, setDeleted]   = useState([])   // ids reales a borrar
  const [saving, setSaving]     = useState(false)
  const [loading, setLoading]   = useState(true)
  const canvasRef = useRef(null)
  const dragRef   = useRef(null)  // { id, offX, offY }

  useEffect(() => {
    (async () => {
      const { data } = await db.from('pos_mesas').select('*').eq('store_code', storeCode).order('numero')
      const list = (data || []).map(m => ({
        id: m.id, numero: m.numero, zona: m.zona || 'principal',
        pos_x: parseFloat(m.pos_x) || 5, pos_y: parseFloat(m.pos_y) || 5,
        ancho: parseFloat(m.ancho) || 13, alto: parseFloat(m.alto) || 10,
        forma: m.forma || 'cuadrada', capacidad: m.capacidad || 4, activa: m.activa !== false,
        _new: false,
      }))
      setMesas(list)
      const zs = [...new Set(list.map(m => m.zona))]
      if (zs.length) { setZonas(zs); setZona(zs[0]) }
      setLoading(false)
    })()
  }, [storeCode])

  const mesasZona = mesas.filter(m => m.zona === zona)
  const sel = mesas.find(m => m.id === selId)

  // ── Drag ──
  const onPointerDown = (e, m) => {
    e.preventDefault()
    setSelId(m.id)
    const rect = canvasRef.current.getBoundingClientRect()
    const xPct = (e.clientX - rect.left) / rect.width * 100
    const yPlano = (e.clientY - rect.top) / rect.height * PLANO_H
    dragRef.current = { id: m.id, offX: xPct - m.pos_x, offY: yPlano - m.pos_y }
  }
  const onPointerMove = useCallback((e) => {
    const d = dragRef.current
    if (!d) return
    const rect = canvasRef.current.getBoundingClientRect()
    const xPct = (e.clientX - rect.left) / rect.width * 100
    const yPlano = (e.clientY - rect.top) / rect.height * PLANO_H
    setMesas(prev => prev.map(m => {
      if (m.id !== d.id) return m
      const nx = Math.max(0, Math.min(100 - m.ancho, xPct - d.offX))
      const ny = Math.max(0, Math.min(PLANO_H - m.alto, yPlano - d.offY))
      return { ...m, pos_x: Math.round(nx), pos_y: Math.round(ny) }
    }))
  }, [])
  const onPointerUp = useCallback(() => { dragRef.current = null }, [])
  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => { window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp) }
  }, [onPointerMove, onPointerUp])

  // ── Acciones ──
  const addMesa = () => {
    const nums = mesas.map(m => Number(m.numero)).filter(n => !isNaN(n))
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    const tmpId = 'new-' + Date.now()
    setMesas(prev => [...prev, { id: tmpId, numero: next, zona, pos_x: 40, pos_y: 22, ancho: 13, alto: 10, forma: 'cuadrada', capacidad: 4, activa: true, _new: true }])
    setSelId(tmpId)
  }
  const updateSel = (patch) => setMesas(prev => prev.map(m => m.id === selId ? { ...m, ...patch } : m))
  const removeSel = () => {
    if (!sel) return
    if (!sel._new) setDeleted(d => [...d, sel.id])
    setMesas(prev => prev.filter(m => m.id !== selId))
    setSelId(null)
  }
  const addZona = () => {
    const nombre = prompt('Nombre de la nueva zona (ej: Terraza, VIP, Barra):')
    if (!nombre) return
    const key = nombre.trim().toLowerCase()
    if (!zonas.includes(key)) setZonas(z => [...z, key])
    setZona(key)
  }

  const save = async () => {
    setSaving(true)
    try {
      // Eliminar
      if (deleted.length) await db.from('pos_mesas').delete().in('id', deleted)
      // Upsert
      for (const m of mesas) {
        const row = {
          store_code: storeCode, numero: Number(m.numero), zona: m.zona,
          pos_x: m.pos_x, pos_y: m.pos_y, ancho: m.ancho, alto: m.alto,
          forma: m.forma, capacidad: Number(m.capacidad), activa: true,
        }
        if (m._new) await db.from('pos_mesas').insert(row)
        else await db.from('pos_mesas').update(row).eq('id', m.id)
      }
      toast.success('Plano guardado')
      onClose(true)
    } catch (err) {
      toast.error('Error al guardar: ' + err.message)
    } finally { setSaving(false) }
  }

  const C = { bg: '#15110f', surface: '#1e1815', card: '#241d19', line: '#332b27', line2: '#43382f', text: '#f3efe9', muted: '#9a9088', red: '#E62329', yellow: '#FFD900', teal: '#2dd4a8' }
  const inp = { width: '100%', background: C.card, border: `1px solid ${C.line2}`, color: C.text, borderRadius: 8, padding: '8px 10px', fontSize: 14, outline: 'none' }
  const lbl = { fontSize: 11, color: C.muted, fontWeight: 600, margin: '10px 0 4px', display: 'block' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: C.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${C.line}`, background: C.surface }}>
        <button onClick={() => onClose(false)} style={{ background: 'none', border: `1px solid ${C.line2}`, color: C.text, borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>← Volver</button>
        <div style={{ fontWeight: 800, fontSize: 16, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="pencil" size={16} color={C.yellow} /> Editor de plano · {storeName}</div>
        <div style={{ flex: 1 }} />
        <button onClick={save} disabled={saving} style={{ background: C.red, border: 'none', color: '#fff', borderRadius: 9, padding: '9px 18px', fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Guardando…' : 'Guardar plano'}</button>
      </div>

      {/* Zonas */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 18px', borderBottom: `1px solid ${C.line}`, alignItems: 'center', flexWrap: 'wrap' }}>
        {zonas.map(z => (
          <button key={z} onClick={() => setZona(z)} style={{ background: z === zona ? C.red : C.card, border: `1px solid ${z === zona ? C.red : C.line}`, color: z === zona ? '#fff' : C.muted, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>{z}</button>
        ))}
        <button onClick={addZona} style={{ background: 'none', border: `1px dashed ${C.line2}`, color: C.muted, borderRadius: 8, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>+ Zona</button>
        <div style={{ flex: 1 }} />
        <button onClick={addMesa} style={{ background: C.yellow, border: 'none', color: '#231a00', borderRadius: 8, padding: '7px 16px', fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={15} color="#231a00" /> Agregar mesa</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Canvas */}
        <div style={{ flex: 1, padding: 18, minWidth: 0 }}>
          {loading ? <div style={{ color: C.muted, padding: 40 }}>Cargando…</div> : (
            <div ref={canvasRef} style={{ position: 'relative', width: '100%', aspectRatio: '100 / 55', background: '#100c0a', border: `1px dashed ${C.line2}`, borderRadius: 12, overflow: 'hidden', touchAction: 'none', backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 9.5%,#1c1612 9.5%,#1c1612 10%),repeating-linear-gradient(90deg,transparent,transparent 9.5%,#1c1612 9.5%,#1c1612 10%)' }}>
              {mesasZona.map(m => (
                <div
                  key={m.id}
                  onPointerDown={e => onPointerDown(e, m)}
                  style={{
                    position: 'absolute', left: `${m.pos_x}%`, top: `${m.pos_y / PLANO_H * 100}%`,
                    width: `${m.ancho}%`, height: `${m.alto / PLANO_H * 100}%`,
                    background: m.id === selId ? '#2e1311' : C.card,
                    border: `2px solid ${m.id === selId ? C.yellow : C.teal}`,
                    borderRadius: m.forma === 'redonda' ? '50%' : 10,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    cursor: 'grab', userSelect: 'none', color: C.teal,
                  }}
                >
                  <div style={{ fontSize: 20, fontWeight: 800, color: m.id === selId ? C.yellow : C.teal }}>{m.numero}</div>
                  <div style={{ fontSize: 10, color: C.muted, display: 'inline-flex', alignItems: 'center', gap: 3 }}>{m.capacidad} <Icon name="users" size={10} /></div>
                </div>
              ))}
              {mesasZona.length === 0 && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.muted, fontSize: 14 }}>Zona vacía — toca "Agregar mesa"</div>}
            </div>
          )}
          <div style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>Arrastra las mesas para ubicarlas. Toca una para editar sus datos.</div>
        </div>

        {/* Panel propiedades */}
        <div style={{ width: 280, borderLeft: `1px solid ${C.line}`, background: C.surface, padding: 16, overflow: 'auto' }}>
          {!sel ? (
            <div style={{ color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 30 }}>Selecciona o agrega una mesa para editarla.</div>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>Mesa #{sel.numero}{sel._new && <span style={{ color: C.yellow, fontSize: 11, marginLeft: 6 }}>nueva</span>}</div>
              <label style={lbl}>Número</label>
              <input style={inp} value={sel.numero} onChange={e => updateSel({ numero: e.target.value })} />
              <label style={lbl}>Capacidad (personas)</label>
              <input style={inp} type="number" min="1" value={sel.capacidad} onChange={e => updateSel({ capacidad: e.target.value })} />
              <label style={lbl}>Forma</label>
              <select style={inp} value={sel.forma} onChange={e => updateSel({ forma: e.target.value })}>
                {FORMAS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
              <label style={lbl}>Zona</label>
              <select style={inp} value={sel.zona} onChange={e => updateSel({ zona: e.target.value })}>
                {zonas.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label style={lbl}>Ancho</label><input style={inp} type="number" min="6" max="30" value={sel.ancho} onChange={e => updateSel({ ancho: Number(e.target.value) })} /></div>
                <div style={{ flex: 1 }}><label style={lbl}>Alto</label><input style={inp} type="number" min="6" max="30" value={sel.alto} onChange={e => updateSel({ alto: Number(e.target.value) })} /></div>
              </div>
              <button onClick={removeSel} style={{ width: '100%', marginTop: 16, background: 'none', border: '1px solid #f8717155', color: '#f87171', borderRadius: 9, padding: '10px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}><Icon name="trash" size={15} /> Eliminar mesa</button>
            </>
          )}
        </div>
      </div>
      <toast.Toast />
    </div>
  )
}
