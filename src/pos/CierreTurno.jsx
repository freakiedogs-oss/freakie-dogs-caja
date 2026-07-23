import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../supabase'
import { STORES, BUCKET_CIERRES } from '../config'
import Icon from './Icon'
import { useToast } from '../hooks/useToast'
import { printCorte } from './print/printService'

const MOTIVOS_EMPLEADO = ['Adelanto de Salario', 'Pago de Salario', 'Pago Propina']
const _n = (v) => parseFloat(v) || 0

async function uploadFoto(file, folder) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await db.storage.from(BUCKET_CIERRES).upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw new Error(error.message)
  return db.storage.from(BUCKET_CIERRES).getPublicUrl(path).data.publicUrl
}

const _modalBg = { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const _modal = { background: '#1c1c22', border: '1px solid #43382f', borderRadius: 16, padding: 18, width: 420, maxWidth: '95%', maxHeight: '90vh', overflow: 'auto' }
const _inp = { width: '100%', background: '#241d19', border: '1px solid #332b27', color: '#f3efe9', borderRadius: 8, padding: '9px 11px', fontSize: 14, outline: 'none' }
const _lbl = { fontSize: 13, color: '#9a9088', marginBottom: 5 }

// ── Modal Egreso (clon del CierreForm: motivo + monto + persona/empleado + comentario + foto) ──
function ModalEgreso({ motivos, empleadosSuc, onSave, onClose }) {
  const [motivo, setMotivo] = useState(null)
  const [monto, setMonto] = useState('')
  const [persona, setPersona] = useState('')
  const [empleadoId, setEmpleadoId] = useState(null)
  const [showNuevo, setShowNuevo] = useState(false)
  const [nom, setNom] = useState(''); const [ape, setApe] = useState('')
  const [comentario, setComentario] = useState('')
  const [foto, setFoto] = useState(null)
  const fRef = useRef()
  const esEmp = motivo && MOTIVOS_EMPLEADO.includes(motivo.nombre)
  const personaOk = !motivo?.requiere_persona || (esEmp ? (empleadoId || (showNuevo && nom.trim() && ape.trim())) : persona.trim())
  const ok = motivo && _n(monto) > 0 && personaOk && (!motivo.requiere_comentario || comentario.trim()) && (!motivo.requiere_foto || foto)

  return (
    <div style={_modalBg} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={_modal}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Agregar Egreso</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {motivos.map(m => (
            <div key={m.id} onClick={() => { setMotivo(m); setPersona(''); setEmpleadoId(null); setShowNuevo(false) }}
              style={{ padding: '8px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', fontWeight: 600, background: motivo?.id === m.id ? '#E62329' : '#241d19', color: motivo?.id === m.id ? '#fff' : '#9a9088', border: `1.5px solid ${motivo?.id === m.id ? '#E62329' : '#332b27'}` }}>
              {m.nombre}
            </div>
          ))}
        </div>
        {motivo && (<>
          <div style={{ marginBottom: 10 }}><div style={_lbl}>Monto</div><input style={_inp} inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value)} /></div>
          {motivo.requiere_persona && esEmp && (
            <div style={{ marginBottom: 12 }}>
              <div style={_lbl}>Persona que recibe *</div>
              {persona && !showNuevo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#0d1a18', border: '1px solid #1f3a34', borderRadius: 10, marginBottom: 8 }}>
                  <span style={{ flex: 1, fontWeight: 600, color: '#2dd4a8' }}>{persona}</span>
                  <button onClick={() => { setPersona(''); setEmpleadoId(null) }} style={{ background: 'none', border: 'none', color: '#9a9088', cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              )}
              {!persona && !showNuevo && (
                <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 10, border: '1px solid #332b27' }}>
                  {(empleadosSuc || []).map(emp => (
                    <div key={emp.id} onClick={() => { setEmpleadoId(emp.id); setPersona(emp.nombre_completo); setShowNuevo(false) }}
                      style={{ padding: '10px 12px', borderBottom: '1px solid #241d19', cursor: 'pointer', fontSize: 14, color: '#c9c2b8' }}>
                      {emp.nombre_completo} <span style={{ fontSize: 11, color: '#6b6878' }}>· {emp.cargo || 'empleado'}</span>
                    </div>
                  ))}
                  <div onClick={() => setShowNuevo(true)} style={{ padding: '10px 12px', cursor: 'pointer', fontSize: 13, color: '#60a5fa', borderTop: '1px solid #332b27', background: '#0d1420' }}>+ Agregar otra persona (externa)</div>
                </div>
              )}
              {showNuevo && (
                <div style={{ background: '#15110f', padding: 12, borderRadius: 10, border: '1px solid #332b27' }}>
                  <div style={{ fontSize: 12, color: '#9a9088', marginBottom: 8 }}>Persona externa — nombre y apellido</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input style={{ ..._inp, fontSize: 13 }} value={nom} onChange={e => setNom(e.target.value)} placeholder="Nombre" />
                    <input style={{ ..._inp, fontSize: 13 }} value={ape} onChange={e => setApe(e.target.value)} placeholder="Apellido" />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...ghostBtn }} onClick={() => setShowNuevo(false)}>Volver a lista</button>
                    <button style={{ ...ghostBtn, color: '#E62329', borderColor: '#E62329' }} disabled={!nom.trim() || !ape.trim()} onClick={() => { setPersona(`${nom.trim()} ${ape.trim()}`); setEmpleadoId(null); setShowNuevo(false) }}>Confirmar</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {motivo.requiere_persona && !esEmp && (
            <div style={{ marginBottom: 12 }}><div style={_lbl}>Persona que recibe *</div><input style={_inp} value={persona} onChange={e => setPersona(e.target.value)} placeholder="Nombre completo" /></div>
          )}
          {motivo.requiere_comentario && (
            <div style={{ marginBottom: 12 }}><div style={_lbl}>Comentario *</div><textarea style={{ ..._inp, resize: 'none' }} rows={2} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Describe el gasto..." /></div>
          )}
          {motivo.requiere_foto && (
            <div style={{ marginBottom: 12 }}>
              <div style={_lbl}>Foto requerida *</div>
              <input ref={fRef} type="file" accept="image/*" capture="environment" onChange={e => setFoto(e.target.files[0])} style={{ display: 'none' }} />
              <button style={ghostBtn} onClick={() => fRef.current.click()}>{foto ? `✓ ${foto.name}` : '📷 Foto'}</button>
            </div>
          )}
        </>)}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button style={{ ...ghostBtn, flex: 1, padding: '10px' }} onClick={onClose}>Cancelar</button>
          <button disabled={!ok} onClick={() => ok && onSave({ motivo_id: motivo.id, motivo_nombre: motivo.nombre, monto: _n(monto), persona_recibe: persona.trim() || null, empleado_id: empleadoId, comentario: comentario.trim() || null, foto_file: foto || null, foto_url: null })}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: '#E62329', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: ok ? 1 : 0.4 }}>Agregar</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Ingreso (clon: motivo + monto + evento + comentario) ──
function ModalIngreso({ motivos, onSave, onClose }) {
  const [motivo, setMotivo] = useState(null)
  const [monto, setMonto] = useState('')
  const [evento, setEvento] = useState('')
  const [comentario, setComentario] = useState('')
  const ok = motivo && _n(monto) > 0 && (!motivo.requiere_evento || evento.trim()) && (!motivo.requiere_comentario || comentario.trim())
  return (
    <div style={_modalBg} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={_modal}>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 14 }}>Agregar Ingreso</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {motivos.map(m => (
            <div key={m.id} onClick={() => setMotivo(m)} style={{ padding: '8px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', fontWeight: 600, background: motivo?.id === m.id ? '#2563eb' : '#241d19', color: motivo?.id === m.id ? '#fff' : '#9a9088', border: `1.5px solid ${motivo?.id === m.id ? '#2563eb' : '#332b27'}` }}>{m.nombre}</div>
          ))}
        </div>
        {motivo && (<>
          <div style={{ marginBottom: 10 }}><div style={_lbl}>Monto</div><input style={_inp} inputMode="decimal" placeholder="0.00" value={monto} onChange={e => setMonto(e.target.value)} /></div>
          {motivo.requiere_evento && <div style={{ marginBottom: 12 }}><div style={_lbl}>Nombre del evento *</div><input style={_inp} value={evento} onChange={e => setEvento(e.target.value)} placeholder="Nombre del evento" /></div>}
          {motivo.requiere_comentario && <div style={{ marginBottom: 12 }}><div style={_lbl}>Comentario *</div><textarea style={{ ..._inp, resize: 'none' }} rows={2} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Explica el ingreso..." /></div>}
        </>)}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button style={{ ...ghostBtn, flex: 1, padding: '10px' }} onClick={onClose}>Cancelar</button>
          <button disabled={!ok} onClick={() => ok && onSave({ motivo_id: motivo.id, motivo_nombre: motivo.nombre, monto: _n(monto), nombre_evento: evento.trim() || null, comentario: comentario.trim() || null })}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: ok ? 1 : 0.4 }}>Agregar</button>
        </div>
      </div>
    </div>
  )
}

/**
 * CierreTurno — Corte de caja X/Z del POS. Estructura CLONADA del CierreForm
 * del ERP (mismas secciones) pero alimentada desde el POS (RPC pos_corte) y
 * persistida en pos_turnos. Las ventas por método son de solo lectura
 * (vienen del sistema según lo cobrado en el turno).
 */
const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`
const n = (v) => parseFloat(v) || 0
const todayISO = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)

// estilos (equivalentes a .card/.sec-title/.row del ERP, en inline para el POS)
const card = { background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 12, padding: 14, marginBottom: 12 }
const secTitle = { fontSize: 12, fontWeight: 700, color: '#9a9088', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }
const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }
const lineItem = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #2a2a32' }
const ghostBtn = { background: 'none', border: '1px solid #43382f', color: '#9a9088', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }

function Mi({ label, value, onChange, readOnly, hint, star }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 11, color: '#9a9088', marginBottom: 3 }}>
        {label}{star && <span style={{ color: '#FFD900' }}> ★</span>}{hint && <span style={{ color: '#6b6878' }}> · {hint}</span>}
      </label>
      <input
        inputMode="decimal" placeholder="0.00" value={value} readOnly={readOnly}
        onChange={e => onChange && onChange(e.target.value)}
        style={{ width: '100%', background: readOnly ? '#15110f' : '#241d19', border: '1px solid #332b27', color: readOnly ? '#9a9088' : '#f3efe9', borderRadius: 8, padding: '9px 11px', fontSize: 15, outline: 'none', fontWeight: readOnly ? 400 : 700 }}
      />
    </div>
  )
}

export default function CierreTurno({ user, onBack }) {
  const toast = useToast()
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode

  const [turno, setTurno]     = useState(null)
  const [corte, setCorte]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('z')
  const [fondoInput, setFondoInput] = useState('200')
  const [saving, setSaving]   = useState(false)

  const [motEg, setMotEg]     = useState([])
  const [motIn, setMotIn]     = useState([])
  const [egresos, setEgresos] = useState([])
  const [ingresos, setIngresos] = useState([])
  const [efectivoReal, setEfectivoReal] = useState('')
  const [obs, setObs]         = useState('')
  // add forms
  const [showEg, setShowEg]   = useState(false)
  const [showIn, setShowIn]   = useState(false)
  const [empleadosSuc, setEmpleadosSuc] = useState([])

  const loadTurno = useCallback(async () => {
    setLoading(true)
    const { data } = await db.from('pos_turnos').select('*')
      .eq('store_code', storeCode).eq('cajero_id', user.id)
      .eq('nivel', 'cajero').eq('estado', 'abierto')
      .order('abierto_at', { ascending: false }).limit(1).maybeSingle()
    setTurno(data || null); setLoading(false)
  }, [storeCode, user.id])
  useEffect(() => { loadTurno() }, [loadTurno])

  useEffect(() => {
    db.from('motivos_egreso').select('id,nombre,requiere_persona,requiere_comentario,requiere_foto,orden').eq('activo', true).order('orden').then(({ data }) => setMotEg(data || [])).catch(() => {})
    db.from('motivos_ingreso').select('id,nombre,requiere_evento,requiere_comentario,orden').order('orden').then(({ data }) => setMotIn(data || [])).catch(() => {})
    // empleados de la sucursal (para egresos a empleado)
    db.from('sucursales').select('id').eq('store_code', storeCode).maybeSingle().then(({ data: suc }) => {
      if (suc) db.from('empleados').select('id,nombre_completo,cargo').eq('sucursal_id', suc.id).eq('activo', true).order('nombre_completo').then(({ data }) => setEmpleadosSuc(data || []))
    }).catch(() => {})
  }, [storeCode])

  const loadCorte = useCallback(async () => {
    if (!turno) return
    const { data, error } = await db.rpc('pos_corte', { p_store_code: storeCode, p_desde: turno.abierto_at, p_hasta: new Date().toISOString(), p_turno_id: null })
    if (!error) setCorte(data)
  }, [turno, storeCode])
  useEffect(() => { loadCorte() }, [loadCorte])

  const abrirTurno = async () => {
    setSaving(true)
    try {
      const { count } = await db.from('pos_turnos').select('*', { count: 'exact', head: true }).eq('store_code', storeCode).eq('fecha', todayISO())
      const { data, error } = await db.from('pos_turnos').insert({
        store_code: storeCode, cajero_id: user.id, nivel: 'cajero', fecha: todayISO(),
        numero_turno: (count || 0) + 1, fondo_apertura: n(fondoInput), abierto_at: new Date().toISOString(), estado: 'abierto',
      }).select().single()
      if (error) throw error
      setTurno(data); toast.success('Turno abierto')
    } catch (e) { toast.error('Error al abrir turno: ' + e.message) } finally { setSaving(false) }
  }

  // ── Totales (clonado del CierreForm) ──
  const efSistema = n(corte?.efectivo)
  const fondo = n(turno?.fondo_apertura)
  const totalEg = egresos.reduce((s, e) => s + n(e.monto), 0)
  const totalIn = ingresos.reduce((s, e) => s + n(e.monto), 0)
  const totalVentas = efSistema + n(corte?.tarjeta) + n(corte?.transferencia) + n(corte?.link_pago)
  const efCalculado = efSistema - totalEg + totalIn
  const efReal = n(efectivoReal)
  const difDeposito = efReal - efCalculado
  const difColor = efReal === 0 ? '#9a9088' : Math.abs(difDeposito) < 1 ? '#2dd4a8' : Math.abs(difDeposito) <= 5 ? '#facc15' : '#f87171'

  const buildCorteData = (tipo) => ({
    tipo, storeCode, storeName, cajero: user.nombre || '', fecha: todayISO(), abierto_at: turno?.abierto_at, fondo,
    efectivo: efSistema, tarjeta: n(corte?.tarjeta), transferencia: n(corte?.transferencia), link_pago: n(corte?.link_pago),
    otros: n(corte?.otros), total: n(corte?.total), propinas: n(corte?.propinas), n_cuentas: corte?.n_cuentas || 0,
    n_cancelaciones: corte?.n_cancelaciones || 0, ticket_promedio: n(corte?.ticket_promedio),
    efectivoEsperado: efCalculado,
    ...(tipo === 'Z' ? { conteo: {}, efectivoContado: efReal, difEfectivo: difDeposito, depositar: efReal, obs,
      totalEgresos: totalEg, totalIngresos: totalIn } : {}),
  })
  const imprimirX = async () => { try { await printCorte('x', buildCorteData('X')) } catch (e) { toast.error('No se imprimió: ' + e.message) } }

  const cerrarZ = async () => {
    if (!efectivoReal) { toast.warning('Ingresa el efectivo real a depositar'); return }
    if (!confirm('¿Cerrar el turno? El corte Z es definitivo.')) return
    setSaving(true)
    try {
      // Subir fotos de egresos (si las hay) y limpiar foto_file del jsonb
      const egresosFinal = await Promise.all(egresos.map(async (e) => {
        let foto_url = e.foto_url || null
        if (e.foto_file) { try { foto_url = await uploadFoto(e.foto_file, `egresos/${storeCode}`) } catch (err) { console.warn('foto egreso no subida:', err.message) } }
        const { foto_file, ...rest } = e
        return { ...rest, foto_url }
      }))
      const { error } = await db.from('pos_turnos').update({
        cerrado_at: new Date().toISOString(), estado: 'cerrado',
        sistema_efectivo: efSistema, sistema_tarjeta: n(corte?.tarjeta), sistema_transferencia: n(corte?.transferencia),
        sistema_link_pago: n(corte?.link_pago), sistema_pedidos_ya: n(corte?.otros), sistema_total: n(corte?.total),
        sistema_propinas: n(corte?.propinas), sistema_num_cuentas: corte?.n_cuentas || 0,
        sistema_num_cancelaciones: corte?.n_cancelaciones || 0, sistema_ticket_promedio: n(corte?.ticket_promedio),
        conteo_efectivo: efReal, deposito_monto: efReal,
        egresos: egresosFinal, ingresos_extra: ingresos, notas: obs || null,
      }).eq('id', turno.id)
      if (error) throw error
      // -- Puente -> ventas_diarias (Dashboard de Cierres + Finanzas), igual que las sucursales Quanto --
      try {
        const _tv = parseFloat((efSistema + n(corte?.tarjeta) + n(corte?.transferencia) + n(corte?.link_pago)).toFixed(2))
        const { data: _vd, error: _vdErr } = await db.from('ventas_diarias').upsert({
          fecha: todayISO(), store_code: storeCode, turno: 'completo',
          efectivo_quanto: efSistema, tarjeta_quanto: n(corte?.tarjeta),
          ventas_transferencia: n(corte?.transferencia), ventas_link_pago: n(corte?.link_pago),
          total_ventas_quanto: _tv, total_egresos: parseFloat(totalEg.toFixed(2)),
          total_ingresos: parseFloat(totalIn.toFixed(2)), efectivo_calculado: parseFloat(efCalculado.toFixed(2)),
          efectivo_real_depositar: efReal, diferencia_deposito: parseFloat(difDeposito.toFixed(2)),
          estado: 'enviado', source: 'cierre', observaciones: obs || null,
          creado_por: user.nombre || 'POS', creado_por_id: user.id || null,
        }, { onConflict: 'fecha,store_code,turno' }).select().single()
        if (!_vdErr && _vd) {
          await db.from('egresos_cierre').delete().eq('cierre_id', _vd.id)
          await db.from('ingresos_cierre').delete().eq('cierre_id', _vd.id)
          if (egresosFinal.length) await db.from('egresos_cierre').insert(egresosFinal.map(e => ({
            cierre_id: _vd.id, motivo_id: e.motivo_id, motivo_nombre: e.motivo_nombre, monto: n(e.monto),
            persona_recibe: e.persona_recibe || null, empleado_id: e.empleado_id || null,
            comentario: e.comentario || null, foto_url: e.foto_url || null,
          })))
          if (ingresos.length) await db.from('ingresos_cierre').insert(ingresos.map(e => ({
            cierre_id: _vd.id, motivo_id: e.motivo_id, motivo_nombre: e.motivo_nombre, monto: n(e.monto),
            nombre_evento: e.nombre_evento || null, comentario: e.comentario || null,
          })))
        }
      } catch (_bridgeErr) { console.warn('bridge ventas_diarias:', _bridgeErr?.message) }
      toast.success('Turno cerrado (corte Z)')
      try { await printCorte('z', buildCorteData('Z')) } catch {}
      onBack()
    } catch (e) { toast.error('Error al cerrar: ' + e.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="poshome-root"><div className="poshome-empty"><div className="spin" /></div></div>

  const Header = (
    <header className="pos-header">
      <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
      <img src="/icon-192.png" className="pos-header-logo" alt="Freakie Dogs" />
      <span className="pos-header-brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="cash" size={17} /> Cierre de Caja</span>
      <span className="pos-header-store">{storeName}</span>
      <span className="pos-header-sep" />
      <span className="pos-header-user">{user.nombre?.split(' ')[0]}</span>
      <button className="pos-header-btn danger" onClick={onBack}>Salir</button>
    </header>
  )

  if (!turno) {
    return (
      <div className="poshome-root">{Header}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
          <Icon name="cash" size={48} color="#43382f" />
          <div style={{ fontSize: 18, fontWeight: 800 }}>Abrir caja</div>
          <div style={{ color: '#9a9088', fontSize: 13, textAlign: 'center', maxWidth: 280 }}>Ingresa el fondo de apertura para comenzar el turno.</div>
          <div style={{ width: 220 }}><Mi label="Fondo de apertura" value={fondoInput} onChange={setFondoInput} hint="efectivo en caja" /></div>
          <button className="pos-cobrar-btn" style={{ width: 220 }} disabled={saving} onClick={abrirTurno}>{saving ? '...' : 'Abrir turno'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="poshome-root">{Header}
      {/* Tabs X / Z */}
      <div style={{ display: 'flex', gap: 6, margin: '12px 18px 0', background: '#241d19', border: '1px solid #332b27', borderRadius: 11, padding: 4, width: 'max-content' }}>
        {[['x', 'Corte X (lectura)'], ['z', 'Corte Z (cierre)']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: tab === k ? '#E62329' : 'none', border: 'none', color: tab === k ? '#fff' : '#9a9088', fontWeight: 700, fontSize: 13, padding: '8px 18px', borderRadius: 9, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18, maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <div style={{ fontSize: 12, color: '#9a9088', marginBottom: 10 }}>
          Turno {new Date(turno.abierto_at).toLocaleString('es-SV', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} · Fondo {fmt(fondo)}
        </div>

        {/* VENTAS (sistema, read-only) */}
        <div style={card}>
          <div style={secTitle}>Ventas del turno (sistema)</div>
          <Mi label="Efectivo" value={efSistema.toFixed(2)} readOnly hint="del sistema" />
          <Mi label="Tarjeta" value={n(corte?.tarjeta).toFixed(2)} readOnly hint="del sistema" />
          <Mi label="Transferencia" value={n(corte?.transferencia).toFixed(2)} readOnly hint="del sistema" />
          <Mi label="Link de pago" value={n(corte?.link_pago).toFixed(2)} readOnly hint="del sistema" />
          <div style={{ ...row, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#9a9088' }}>Total ventas</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#FFD900' }}>{fmt(totalVentas)}</span>
          </div>
          <div style={{ ...row }}>
            <span style={{ fontSize: 12, color: '#9a9088' }}>Propinas {fmt(corte?.propinas)}</span>
            <span style={{ fontSize: 12, color: '#9a9088' }}>{corte?.n_cuentas || 0} cuentas · prom {fmt(corte?.ticket_promedio)}</span>
          </div>
        </div>

        {tab === 'x' ? (
          <button className="pos-cobrar-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={imprimirX}>
            <Icon name="receipt" size={17} color="#fff" /> Imprimir corte X
          </button>
        ) : (
          <>
            {/* EGRESOS */}
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ ...secTitle, marginBottom: 0 }}>Egresos del día</span>
                <button style={ghostBtn} onClick={() => setShowEg(true)}>+ Agregar</button>
              </div>
              {egresos.length === 0 && <div style={{ color: '#6b6878', fontSize: 13, textAlign: 'center', padding: '6px 0' }}>Sin egresos</div>}
              {egresos.map((e, i) => (
                <div key={i} style={lineItem}>
                  <div><div style={{ fontWeight: 600, fontSize: 14 }}>{e.motivo_nombre}</div>{e.persona_recibe && <div style={{ fontSize: 12, color: '#9a9088' }}>→ {e.persona_recibe}</div>}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontWeight: 700, color: '#f87171' }}>{fmt(e.monto)}</span>
                    <button onClick={() => setEgresos(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#6b6878', cursor: 'pointer', fontSize: 18 }}>×</button></div>
                </div>
              ))}
              {totalEg > 0 && <div style={{ ...row, marginTop: 4 }}><span style={{ fontSize: 13, color: '#9a9088' }}>Total egresos</span><span style={{ fontWeight: 700, color: '#f87171' }}>{fmt(totalEg)}</span></div>}
            </div>

            {/* INGRESOS */}
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ ...secTitle, marginBottom: 0 }}>Ingresos del día</span>
                <button style={ghostBtn} onClick={() => setShowIn(true)}>+ Agregar</button>
              </div>
              {ingresos.length === 0 && <div style={{ color: '#6b6878', fontSize: 13, textAlign: 'center', padding: '6px 0' }}>Sin ingresos</div>}
              {ingresos.map((e, i) => (
                <div key={i} style={lineItem}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{e.motivo_nombre}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ fontWeight: 700, color: '#2dd4a8' }}>{fmt(e.monto)}</span>
                    <button onClick={() => setIngresos(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#6b6878', cursor: 'pointer', fontSize: 18 }}>×</button></div>
                </div>
              ))}
              {totalIn > 0 && <div style={{ ...row, marginTop: 4 }}><span style={{ fontSize: 13, color: '#9a9088' }}>Total ingresos</span><span style={{ fontWeight: 700, color: '#2dd4a8' }}>{fmt(totalIn)}</span></div>}
            </div>

            {/* RESUMEN DE EFECTIVO */}
            <div style={card}>
              <div style={secTitle}>Resumen de efectivo</div>
              <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>Efectivo (sistema)</span><span style={{ fontWeight: 600 }}>{fmt(efSistema)}</span></div>
              <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>(−) Total egresos</span><span style={{ fontWeight: 600, color: '#f87171' }}>-{fmt(totalEg)}</span></div>
              <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>(+) Total ingresos</span><span style={{ fontWeight: 600, color: '#2dd4a8' }}>+{fmt(totalIn)}</span></div>
              <div style={{ ...row, borderBottom: '2px solid #332b27', paddingBottom: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>Efectivo calculado a depositar</span>
                <span style={{ fontWeight: 800, fontSize: 17 }}>{fmt(efCalculado)}</span>
              </div>
              <Mi label="Efectivo REAL que vas a depositar" star value={efectivoReal} onChange={setEfectivoReal} hint="requerido" />
              {efReal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#15110f', borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
                  <span style={{ fontSize: 14 }}>Diferencia</span>
                  <span style={{ fontWeight: 800, fontSize: 18, color: difColor }}>
                    {Math.abs(difDeposito) < 0.01 ? '✓ Cuadra' : difDeposito > 0 ? `+${fmt(difDeposito)} sobrante` : `${fmt(Math.abs(difDeposito))} faltante`}
                  </span>
                </div>
              )}
            </div>

            {/* OBSERVACIONES */}
            <div style={card}>
              <div style={secTitle}>Observaciones</div>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Notas del cierre…" style={{ width: '100%', background: '#241d19', border: '1px solid #332b27', color: '#f3efe9', borderRadius: 8, padding: '9px 11px', fontSize: 13, outline: 'none', resize: 'vertical' }} />
            </div>

            <button className="pos-cobrar-btn" disabled={saving} onClick={cerrarZ} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="check" size={17} color="#fff" /> {saving ? 'Cerrando…' : 'Cerrar turno (Z) e imprimir'}
            </button>
          </>
        )}
      </div>

      {showEg && <ModalEgreso motivos={motEg} empleadosSuc={empleadosSuc} onClose={() => setShowEg(false)} onSave={(e) => { setEgresos(p => [...p, e]); setShowEg(false) }} />}
      {showIn && <ModalIngreso motivos={motIn} onClose={() => setShowIn(false)} onSave={(e) => { setIngresos(p => [...p, e]); setShowIn(false) }} />}
    </div>
  )
}
