import { useState, useEffect, useCallback, useRef } from 'react'
import { db } from '../supabase'
import { STORES, BUCKET_CIERRES } from '../config'
import Icon from './Icon'
import { useToast } from '../hooks/useToast'
import { printCorte } from './print/printService'
import { confirmAsync } from './confirmDialog'

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
 * CierreTurno — Corte de caja del POS. DOS tipos de cierre:
 *
 *   • Corte X (cambio de turno): cierra la caja del cajero actual. Sus ventas quedan
 *     amarradas a él (arqueo por cajero), NO deposita, y libera la caja para que el
 *     siguiente cajero abra. La gaveta se ARRASTRA: el fondo del siguiente turno se
 *     precarga con el efectivo contado en este X. Puede haber varios X por día.
 *
 *   • Corte Z (cierre del día): UNO SOLO por día. Muestra el acumulado del día completo
 *     (todos los turnos), se cuenta la gaveta, se deposita el efectivo del día (el fondo
 *     base se queda), y se arma la fila 'completo' de ventas_diarias vía
 *     pos_rebuild_cierre_dia (que SUMA todos los turnos cerrados del día).
 *
 * Guardrails: 1 sola caja abierta por sucursal · no abrir si el día ya se cerró con Z.
 */
const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`
const n = (v) => parseFloat(v) || 0
const todayISO = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
// Hora actual de El Salvador (UTC-6, sin DST) — mismo criterio que todayISO()
const horaSV = () => new Date(Date.now() - 6 * 3600 * 1000).getUTCHours()
// A partir de esta hora el día YA NO se puede cerrar con X: se fuerza el corte Z.
// Motivo: Venecia terminó el día con X el 27-jul (22:10) y el 29-jul (21:55) -> el día
// quedó sin cerrar, sin depósito y sin fila en ventas_diarias (hubo que reconstruirlo a mano).
// Todos los cambios de turno legítimos registrados ocurren entre las 10:00 y las 16:14.
const HORA_FORZAR_Z = 19

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

  const [turno, setTurno]       = useState(null)
  const [corte, setCorte]       = useState(null)     // corte del TURNO actual (para X)
  const [corteDia, setCorteDia] = useState(null)     // corte del DÍA completo (para Z)
  const [diaInfo, setDiaInfo]   = useState({ fondoBase: 0, prevEgr: 0, prevIng: 0, zExiste: false, nTurnos: 0 })
  const [loading, setLoading]   = useState(true)
  // 'x' = cambio de turno · 'z' = cierre del día. Pasadas las HORA_FORZAR_Z arranca en Z
  // (antes arrancaba siempre en 'x' y el botón Z ni se renderizaba hasta tocar la pestaña).
  const [tab, setTab]           = useState(() => (horaSV() >= HORA_FORZAR_Z ? 'z' : 'x'))
  const [fondoInput, setFondoInput] = useState('200')
  const [saving, setSaving]     = useState(false)

  const [motEg, setMotEg]       = useState([])
  const [motIn, setMotIn]       = useState([])
  const [egresos, setEgresos]   = useState([])
  const [ingresos, setIngresos] = useState([])
  const [efectivoReal, setEfectivoReal] = useState('')
  const [obs, setObs]           = useState('')
  const [showEg, setShowEg]     = useState(false)
  const [showIn, setShowIn]     = useState(false)
  const [empleadosSuc, setEmpleadosSuc] = useState([])

  // ── Turno abierto de ESTA caja (guardrail: 1 caja abierta por sucursal) ──
  const loadTurno = useCallback(async () => {
    setLoading(true)
    const { data } = await db.from('pos_turnos').select('*')
      .eq('store_code', storeCode).eq('nivel', 'cajero').eq('estado', 'abierto')
      .order('abierto_at', { ascending: false }).limit(1).maybeSingle()
    setTurno(data || null)
    // Sin caja abierta: precargar el fondo con el efectivo contado del último CAMBIO DE
    // TURNO (X) del día — la gaveta que recibe el siguiente cajero (arrastre).
    if (!data) {
      // conteo_efectivo guarda el efectivo de VENTAS del turno (para la columna generada
      // diferencia_efectivo = conteo − sistema_efectivo). La gaveta completa que arrastra =
      // conteo_efectivo + fondo_apertura de ese turno.
      const { data: ult } = await db.from('pos_turnos').select('conteo_efectivo,fondo_apertura')
        .eq('store_code', storeCode).eq('fecha', todayISO()).eq('tipo_cierre', 'X')
        .not('conteo_efectivo', 'is', null)
        .order('cerrado_at', { ascending: false }).limit(1).maybeSingle()
      if (ult && ult.conteo_efectivo != null) setFondoInput(String(_n(ult.conteo_efectivo) + _n(ult.fondo_apertura)))
    }
    setLoading(false)
  }, [storeCode])
  useEffect(() => { loadTurno() }, [loadTurno])

  useEffect(() => {
    db.from('motivos_egreso').select('id,nombre,requiere_persona,requiere_comentario,requiere_foto,orden').eq('activo', true).order('orden').then(({ data }) => setMotEg(data || [])).catch(() => {})
    db.from('motivos_ingreso').select('id,nombre,requiere_evento,requiere_comentario,orden').order('orden').then(({ data }) => setMotIn(data || [])).catch(() => {})
    // empleados de la sucursal (para egresos a empleado)
    db.from('sucursales').select('id').eq('store_code', storeCode).maybeSingle().then(({ data: suc }) => {
      if (suc) db.from('empleados').select('id,nombre_completo,cargo').eq('sucursal_id', suc.id).eq('activo', true).order('nombre_completo').then(({ data }) => setEmpleadosSuc(data || []))
    }).catch(() => {})
  }, [storeCode])

  // ── Corte del TURNO actual (para X) ──
  const loadCorte = useCallback(async () => {
    if (!turno) return
    const { data, error } = await db.rpc('pos_corte', { p_store_code: storeCode, p_desde: turno.abierto_at, p_hasta: new Date().toISOString(), p_turno_id: turno.id })
    if (!error) setCorte(data)
  }, [turno, storeCode])
  useEffect(() => { loadCorte() }, [loadCorte])

  // ── Datos del DÍA (para Z): corte acumulado + fondo base + egresos/ingresos de otros turnos + ¿ya hubo Z? ──
  const loadDia = useCallback(async () => {
    if (!turno) return
    const desde = `${todayISO()}T00:00:00-06:00`
    const { data: cd } = await db.rpc('pos_corte', { p_store_code: storeCode, p_desde: desde, p_hasta: new Date().toISOString(), p_turno_id: null })
    setCorteDia(cd || null)
    const { data: turnos } = await db.from('pos_turnos')
      .select('id,fondo_apertura,egresos,ingresos_extra,tipo_cierre,abierto_at')
      .eq('store_code', storeCode).eq('fecha', todayISO()).eq('nivel', 'cajero')
      .order('abierto_at', { ascending: true })
    const arr = turnos || []
    const sumJson = (rows, key) => rows.reduce((s, t) => s + (Array.isArray(t[key]) ? t[key].reduce((a, e) => a + _n(e.monto), 0) : 0), 0)
    const otros = arr.filter(t => t.id !== turno.id)
    setDiaInfo({
      fondoBase: arr.length ? _n(arr[0].fondo_apertura) : _n(turno.fondo_apertura),
      prevEgr: sumJson(otros, 'egresos'),
      prevIng: sumJson(otros, 'ingresos_extra'),
      zExiste: arr.some(t => t.tipo_cierre === 'Z'),
      nTurnos: arr.length,
    })
  }, [turno, storeCode])
  useEffect(() => { loadDia() }, [loadDia])

  // ── Abrir caja ──
  const abrirTurno = async () => {
    setSaving(true)
    try {
      // Guardrail 1: no abrir si la caja ya tiene un turno abierto (1 caja por sucursal).
      const { data: yaAbierto } = await db.from('pos_turnos').select('id').eq('store_code', storeCode).eq('nivel', 'cajero').eq('estado', 'abierto').limit(1).maybeSingle()
      if (yaAbierto) { toast.error('Esta caja ya tiene un turno ABIERTO. Ciérralo (X o Z) antes de abrir otro.'); setSaving(false); return }
      // Guardrail 2: no abrir si el día ya se cerró con Z.
      const { data: yaZ } = await db.from('pos_turnos').select('id').eq('store_code', storeCode).eq('fecha', todayISO()).eq('tipo_cierre', 'Z').limit(1).maybeSingle()
      if (yaZ) { toast.error('El día ya fue cerrado con corte Z. No se pueden abrir más turnos hoy.'); setSaving(false); return }
      const { count } = await db.from('pos_turnos').select('*', { count: 'exact', head: true }).eq('store_code', storeCode).eq('fecha', todayISO())
      const { data, error } = await db.from('pos_turnos').insert({
        store_code: storeCode, cajero_id: user.id, nivel: 'cajero', fecha: todayISO(),
        numero_turno: (count || 0) + 1, fondo_apertura: n(fondoInput), abierto_at: new Date().toISOString(), estado: 'abierto',
      }).select().single()
      if (error) throw error
      setTurno(data); toast.success('Turno abierto')
    } catch (e) { toast.error('Error al abrir turno: ' + e.message) } finally { setSaving(false) }
  }

  // ── Totales / arqueo ──
  const totalEg = egresos.reduce((s, e) => s + n(e.monto), 0)
  const totalIn = ingresos.reduce((s, e) => s + n(e.monto), 0)
  const fondoRecibido = n(turno?.fondo_apertura)
  const efReal = n(efectivoReal)
  const r2 = (x) => Math.round(x * 100) / 100

  // X (cambio de turno): arqueo del cajero actual (fondo recibido + sus ventas efectivo)
  const efSisTurno = n(corte?.efectivo)
  const espTurno = r2(fondoRecibido + efSisTurno - totalEg + totalIn)
  const difTurno = r2(efReal - espTurno)

  // Z (cierre del día): arqueo del día completo
  const efSisDia = n(corteDia?.efectivo)
  const diaEgr = r2(diaInfo.prevEgr + totalEg)
  const diaIng = r2(diaInfo.prevIng + totalIn)
  const cashDia = r2(efSisDia - diaEgr + diaIng)            // efectivo generado en el día (a depositar)
  const espDia = r2(diaInfo.fondoBase + cashDia)            // efectivo que debe haber en gaveta
  const difDia = r2(efReal - espDia)
  const depositoDia = r2(efReal - diaInfo.fondoBase)        // se deposita; queda el fondo base

  const esZ = tab === 'z'
  const forzarZ = horaSV() >= HORA_FORZAR_Z   // pasada la hora de cierre, X queda bloqueado
  const A = esZ
    ? { corte: corteDia, esp: espDia, dif: difDia, ventasLabel: 'Ventas del día (acumulado)' }
    : { corte, esp: espTurno, dif: difTurno, ventasLabel: 'Ventas del turno (sistema)' }
  const totalVentas = n(A.corte?.efectivo) + n(A.corte?.tarjeta) + n(A.corte?.transferencia) + n(A.corte?.link_pago)
  const difColor = efReal === 0 ? '#9a9088' : Math.abs(A.dif) < 1 ? '#2dd4a8' : Math.abs(A.dif) <= 5 ? '#facc15' : '#f87171'

  const subirFotos = async (list) => Promise.all(list.map(async (e) => {
    let foto_url = e.foto_url || null
    if (e.foto_file) { try { foto_url = await uploadFoto(e.foto_file, `egresos/${storeCode}`) } catch (err) { console.warn('foto egreso no subida:', err.message) } }
    const { foto_file, ...rest } = e
    return { ...rest, foto_url }
  }))

  // snapshot del sistema para el turno actual (se guarda igual en X y en Z)
  const snapshotSistema = () => ({
    sistema_efectivo: efSisTurno, sistema_tarjeta: n(corte?.tarjeta), sistema_transferencia: n(corte?.transferencia),
    sistema_link_pago: n(corte?.link_pago), sistema_pedidos_ya: n(corte?.otros), sistema_total: n(corte?.total),
    sistema_propinas: n(corte?.propinas), sistema_num_cuentas: corte?.n_cuentas || 0,
    sistema_num_cancelaciones: corte?.n_cancelaciones || 0, sistema_ticket_promedio: n(corte?.ticket_promedio),
  })

  const buildCorteData = (tipo) => {
    const c = tipo === 'Z' ? corteDia : corte
    return {
      tipo, storeCode, storeName, cajero: user.nombre || '', fecha: todayISO(), abierto_at: turno?.abierto_at,
      fondo: tipo === 'Z' ? diaInfo.fondoBase : fondoRecibido,
      efectivo: n(c?.efectivo), tarjeta: n(c?.tarjeta), transferencia: n(c?.transferencia), link_pago: n(c?.link_pago),
      otros: n(c?.otros), total: n(c?.total), propinas: n(c?.propinas), n_cuentas: c?.n_cuentas || 0,
      n_cancelaciones: c?.n_cancelaciones || 0, ticket_promedio: n(c?.ticket_promedio),
      efectivoEsperado: tipo === 'Z' ? espDia : espTurno,
      conteo: {}, efectivoContado: efReal, difEfectivo: tipo === 'Z' ? difDia : difTurno,
      depositar: tipo === 'Z' ? depositoDia : 0, obs, totalEgresos: totalEg, totalIngresos: totalIn,
    }
  }

  // ── Corte X: cierra la caja del cajero (cambio de turno). No deposita, no arma el día. ──
  const cerrarX = async () => {
    // Guardrail: pasada la hora de cierre, el día debe cerrarse con Z (nunca con X).
    // Se evalúa acá (y no solo en el render) para que valga aunque la pantalla lleve rato abierta.
    if (horaSV() >= HORA_FORZAR_Z) {
      toast.error(`Después de las ${HORA_FORZAR_Z}:00 el día se cierra con corte Z, no con X. Te cambié a la pestaña "Cierre del día (Z)".`)
      setTab('z')
      return
    }
    if (!efectivoReal) { toast.warning('Cuenta e ingresa el efectivo de la gaveta'); return }
    if (!(await confirmAsync('¿Cerrar tu caja (cambio de turno)? Tus ventas quedan amarradas a vos y la caja queda libre para el siguiente cajero. NO se deposita todavía.', { title: 'Corte X · cambio de turno', confirmText: 'Cerrar mi caja', danger: true }))) return
    setSaving(true)
    try {
      const egresosFinal = await subirFotos(egresos)
      const { error } = await db.from('pos_turnos').update({
        cerrado_at: new Date().toISOString(), estado: 'cerrado', tipo_cierre: 'X',
        ...snapshotSistema(),
        // conteo_efectivo = efectivo de VENTAS contado (gaveta − fondo); la columna generada
        // diferencia_efectivo = conteo − sistema_efectivo da el sobrante/faltante. NO deposita.
        conteo_efectivo: r2(efReal - fondoRecibido), deposito_monto: 0,
        egresos: egresosFinal, ingresos_extra: ingresos, notas: obs || null,
      }).eq('id', turno.id)
      if (error) throw error
      toast.success('Caja cerrada (X). El siguiente cajero ya puede abrir.')
      try { const _r = await printCorte('x', buildCorteData('X')); if (_r && _r.ok === false) toast.error('⚠️ El corte X no se imprimió — revisá la impresora / puente') } catch {}
      onBack()
    } catch (e) { toast.error('Error al cerrar: ' + e.message) } finally { setSaving(false) }
  }

  // ── Corte Z: cierre del DÍA (1 por día). Deposita y arma ventas_diarias con TODOS los turnos. ──
  const cerrarZ = async () => {
    if (diaInfo.zExiste) { toast.error('El día ya fue cerrado con corte Z.'); return }
    if (!efectivoReal) { toast.warning('Cuenta e ingresa el efectivo de la gaveta'); return }
    if (!(await confirmAsync('¿Cerrar el DÍA con corte Z? Es definitivo y solo se hace una vez al día. Incluye todos los turnos.', { title: 'Corte Z · cierre del día', confirmText: 'Cerrar el día', danger: true }))) return
    setSaving(true)
    try {
      const egresosFinal = await subirFotos(egresos)
      // 1. Cierra ESTE turno con su propio snapshot (para que el rebuild sume bien por turno);
      //    el depósito y el conteo son del DÍA completo.
      const { error } = await db.from('pos_turnos').update({
        cerrado_at: new Date().toISOString(), estado: 'cerrado', tipo_cierre: 'Z',
        ...snapshotSistema(),
        // conteo_efectivo = efectivo del día a depositar (gaveta − fondo base). El depósito
        // del día es lo mismo. diferencia_efectivo (generada) = conteo − sistema_efectivo.
        conteo_efectivo: depositoDia, deposito_monto: depositoDia,
        egresos: egresosFinal, ingresos_extra: ingresos, notas: obs || null,
      }).eq('id', turno.id)
      if (error) throw error
      // 2. Arma el día completo en ventas_diarias (suma TODOS los turnos cerrados del día).
      try {
        const { data: cierreId, error: _rpcErr } = await db.rpc('pos_rebuild_cierre_dia', {
          p_store_code: storeCode, p_fecha: turno.fecha || todayISO(),
          p_creado_por: user.nombre || 'POS', p_creado_por_id: user.id || null,
        })
        if (!_rpcErr && cierreId) {
          // Detalle de egresos/ingresos del DÍA COMPLETO (todos los turnos) para Finanzas.
          const { data: turnosDia } = await db.from('pos_turnos')
            .select('id,egresos,ingresos_extra')
            .eq('store_code', storeCode).eq('fecha', todayISO()).eq('nivel', 'cajero').eq('estado', 'cerrado')
          await db.from('egresos_cierre').delete().eq('cierre_id', cierreId)
          await db.from('ingresos_cierre').delete().eq('cierre_id', cierreId)
          const egRows = [], inRows = []
          for (const t of (turnosDia || [])) {
            for (const e of (Array.isArray(t.egresos) ? t.egresos : [])) egRows.push({
              cierre_id: cierreId, turno_id: t.id, motivo_id: e.motivo_id, motivo_nombre: e.motivo_nombre, monto: n(e.monto),
              persona_recibe: e.persona_recibe || null, empleado_id: e.empleado_id || null, comentario: e.comentario || null, foto_url: e.foto_url || null,
            })
            for (const i of (Array.isArray(t.ingresos_extra) ? t.ingresos_extra : [])) inRows.push({
              cierre_id: cierreId, turno_id: t.id, motivo_id: i.motivo_id, motivo_nombre: i.motivo_nombre, monto: n(i.monto),
              nombre_evento: i.nombre_evento || null, comentario: i.comentario || null,
            })
          }
          if (egRows.length) await db.from('egresos_cierre').insert(egRows)
          if (inRows.length) await db.from('ingresos_cierre').insert(inRows)
        }
      } catch (_bridgeErr) { console.warn('bridge ventas_diarias:', _bridgeErr?.message) }
      toast.success('Día cerrado (corte Z)')
      try { const _r = await printCorte('z', buildCorteData('Z')); if (_r && _r.ok === false) toast.error('⚠️ El corte Z no se imprimió — revisá la impresora / puente') } catch {}
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
          <div style={{ color: '#9a9088', fontSize: 13, textAlign: 'center', maxWidth: 300 }}>Ingresa el efectivo con el que recibís la caja (la gaveta del turno anterior, o el fondo base si sos el primero del día).</div>
          <div style={{ width: 220 }}><Mi label="Fondo / gaveta recibida" value={fondoInput} onChange={setFondoInput} hint="efectivo en caja" /></div>
          <button className="pos-cobrar-btn" style={{ width: 220 }} disabled={saving} onClick={abrirTurno}>{saving ? '...' : 'Abrir turno'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="poshome-root">{Header}
      {/* Tabs X (cambio de turno) / Z (cierre del día) */}
      <div style={{ display: 'flex', gap: 6, margin: '12px 18px 0', background: '#241d19', border: '1px solid #332b27', borderRadius: 11, padding: 4, width: 'max-content' }}>
        {[['x', 'Cambio de turno (X)'], ['z', 'Cierre del día (Z)']].map(([k, l]) => {
          const bloqueada = k === 'x' && forzarZ
          return (
            <button key={k}
              onClick={() => {
                if (bloqueada) { toast.warning(`Después de las ${HORA_FORZAR_Z}:00 el día se cierra con corte Z.`); return }
                setTab(k)
              }}
              style={{ background: tab === k ? '#E62329' : 'none', border: 'none', color: bloqueada ? '#5a544e' : tab === k ? '#fff' : '#9a9088', fontWeight: 700, fontSize: 13, padding: '8px 16px', borderRadius: 9, cursor: bloqueada ? 'not-allowed' : 'pointer', textDecoration: bloqueada ? 'line-through' : 'none' }}>{l}</button>
          )
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18, maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <div style={{ fontSize: 12, color: '#9a9088', marginBottom: 10 }}>
          Turno #{turno.numero_turno} · {user.nombre?.split(' ')[0]} · abrió {new Date(turno.abierto_at).toLocaleString('es-SV', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} · recibió {fmt(fondoRecibido)}
        </div>

        {esZ && diaInfo.zExiste && (
          <div style={{ ...card, border: '1px solid #dc3545', color: '#f8d7da', background: '#2a1416' }}>⚠ El día ya fue cerrado con corte Z. No se puede volver a cerrar.</div>
        )}
        {forzarZ && !diaInfo.zExiste && (
          <div style={{ ...card, border: '1px solid #FFD900', color: '#FFD900', background: '#2a2410' }}>
            🌙 Ya pasaron las {HORA_FORZAR_Z}:00 — este es el <b>cierre del día (Z)</b>. El cambio de turno (X) quedó bloqueado
            para que el día no quede sin cerrar ni depositar.
          </div>
        )}
        <div style={{ ...card, background: '#15110f', borderColor: '#332b27', fontSize: 12, color: '#9a9088', lineHeight: 1.5 }}>
          {esZ
            ? 'Corte Z · cierre del DÍA (uno por día): incluye todos los turnos, se cuenta la gaveta y se deposita el efectivo del día. El fondo base se queda.'
            : 'Corte X · cambio de turno: cierra tu caja (tus ventas quedan amarradas a vos), no deposita y libera la caja. La gaveta la recibe el siguiente cajero.'}
        </div>

        {/* VENTAS (sistema, read-only) */}
        <div style={card}>
          <div style={secTitle}>{A.ventasLabel}</div>
          <Mi label="Efectivo" value={n(A.corte?.efectivo).toFixed(2)} readOnly hint="del sistema" />
          <Mi label="Tarjeta" value={n(A.corte?.tarjeta).toFixed(2)} readOnly hint="del sistema" />
          <Mi label="Transferencia" value={n(A.corte?.transferencia).toFixed(2)} readOnly hint="del sistema" />
          <Mi label="Link de pago" value={n(A.corte?.link_pago).toFixed(2)} readOnly hint="del sistema" />
          <div style={{ ...row, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#9a9088' }}>Total ventas {esZ ? 'del día' : 'del turno'}</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#FFD900' }}>{fmt(totalVentas)}</span>
          </div>
          <div style={{ ...row }}>
            <span style={{ fontSize: 12, color: '#9a9088' }}>Propinas {fmt(A.corte?.propinas)}</span>
            <span style={{ fontSize: 12, color: '#9a9088' }}>{A.corte?.n_cuentas || 0} cuentas · prom {fmt(A.corte?.ticket_promedio)}</span>
          </div>
          {esZ && diaInfo.nTurnos > 1 && <div style={{ fontSize: 11, color: '#6b6878', marginTop: 6 }}>Acumulado de {diaInfo.nTurnos} turnos del día.</div>}
        </div>

        {/* EGRESOS */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ ...secTitle, marginBottom: 0 }}>Egresos del turno</span>
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
            <span style={{ ...secTitle, marginBottom: 0 }}>Ingresos del turno</span>
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
          <div style={secTitle}>Resumen de efectivo {esZ ? '· día' : '· turno'}</div>
          <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>{esZ ? 'Fondo base del día' : 'Fondo / gaveta recibida'}</span><span style={{ fontWeight: 600 }}>{fmt(esZ ? diaInfo.fondoBase : fondoRecibido)}</span></div>
          <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>(+) Ventas efectivo {esZ ? 'del día' : 'del turno'}</span><span style={{ fontWeight: 600 }}>{fmt(esZ ? efSisDia : efSisTurno)}</span></div>
          <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>(−) Egresos {esZ ? 'del día' : ''}</span><span style={{ fontWeight: 600, color: '#f87171' }}>-{fmt(esZ ? diaEgr : totalEg)}</span></div>
          <div style={row}><span style={{ fontSize: 13, color: '#9a9088' }}>(+) Ingresos {esZ ? 'del día' : ''}</span><span style={{ fontWeight: 600, color: '#2dd4a8' }}>+{fmt(esZ ? diaIng : totalIn)}</span></div>
          <div style={{ ...row, borderBottom: '2px solid #332b27', paddingBottom: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Efectivo esperado en gaveta</span>
            <span style={{ fontWeight: 800, fontSize: 17 }}>{fmt(A.esp)}</span>
          </div>
          <Mi label="Efectivo contado en gaveta" star value={efectivoReal} onChange={setEfectivoReal} hint="requerido" />
          {efReal > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#15110f', borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
              <span style={{ fontSize: 14 }}>Diferencia</span>
              <span style={{ fontWeight: 800, fontSize: 18, color: difColor }}>
                {Math.abs(A.dif) < 0.01 ? '✓ Cuadra' : A.dif > 0 ? `+${fmt(A.dif)} sobrante` : `${fmt(Math.abs(A.dif))} faltante`}
              </span>
            </div>
          )}
          {esZ ? (
            <div style={{ ...row, marginTop: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#FFD900' }}>A depositar (queda el fondo {fmt(diaInfo.fondoBase)})</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: '#FFD900' }}>{fmt(depositoDia)}</span>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#6b6878', marginTop: 8, lineHeight: 1.5 }}>No se deposita en el cambio de turno: entregás la gaveta ({fmt(efReal || espTurno)}) al siguiente cajero. El depósito se hace en el cierre Z del día.</div>
          )}
        </div>

        {/* OBSERVACIONES */}
        <div style={card}>
          <div style={secTitle}>Observaciones</div>
          <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2} placeholder="Notas del cierre…" style={{ width: '100%', background: '#241d19', border: '1px solid #332b27', color: '#f3efe9', borderRadius: 8, padding: '9px 11px', fontSize: 13, outline: 'none', resize: 'vertical' }} />
        </div>

        {esZ ? (
          <button className="pos-cobrar-btn" disabled={saving || diaInfo.zExiste} onClick={cerrarZ} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="check" size={17} color="#fff" /> {saving ? 'Cerrando…' : 'Cerrar el día (Z) e imprimir'}
          </button>
        ) : (
          <button className="pos-cobrar-btn" disabled={saving} onClick={cerrarX} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="check" size={17} color="#fff" /> {saving ? 'Cerrando…' : 'Cerrar mi caja (X) e imprimir'}
          </button>
        )}
      </div>

      {showEg && <ModalEgreso motivos={motEg} empleadosSuc={empleadosSuc} onClose={() => setShowEg(false)} onSave={(e) => { setEgresos(p => [...p, e]); setShowEg(false) }} />}
      {showIn && <ModalIngreso motivos={motIn} onClose={() => setShowIn(false)} onSave={(e) => { setIngresos(p => [...p, e]); setShowIn(false) }} />}
    </div>
  )
}
