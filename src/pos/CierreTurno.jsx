import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'
import Icon from './Icon'
import { useToast } from '../hooks/useToast'
import { printCorte } from './print/printService'

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
  const [egForm, setEgForm]   = useState(null) // {motivo_id, monto, persona, comentario}
  const [inForm, setInForm]   = useState(null)

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
    db.from('motivos_egreso').select('id,nombre').eq('activo', true).then(({ data }) => setMotEg(data || [])).catch(() => {})
    db.from('motivos_ingreso').select('id,nombre').then(({ data }) => setMotIn(data || [])).catch(() => {})
  }, [])

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
      const { error } = await db.from('pos_turnos').update({
        cerrado_at: new Date().toISOString(), estado: 'cerrado',
        sistema_efectivo: efSistema, sistema_tarjeta: n(corte?.tarjeta), sistema_transferencia: n(corte?.transferencia),
        sistema_link_pago: n(corte?.link_pago), sistema_pedidos_ya: n(corte?.otros), sistema_total: n(corte?.total),
        sistema_propinas: n(corte?.propinas), sistema_num_cuentas: corte?.n_cuentas || 0,
        sistema_num_cancelaciones: corte?.n_cancelaciones || 0, sistema_ticket_promedio: n(corte?.ticket_promedio),
        conteo_efectivo: efReal, diferencia_efectivo: difDeposito, deposito_monto: efReal,
        egresos: egresos, ingresos_extra: ingresos, notas: obs || null,
      }).eq('id', turno.id)
      if (error) throw error
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

  const addEgreso = () => {
    if (!egForm?.motivo_id || !n(egForm.monto)) { toast.warning('Elige motivo y monto'); return }
    const m = motEg.find(x => x.id === egForm.motivo_id)
    setEgresos(p => [...p, { motivo_id: egForm.motivo_id, motivo_nombre: m?.nombre || 'Egreso', monto: n(egForm.monto), persona_recibe: egForm.persona || null, comentario: egForm.comentario || null }])
    setEgForm(null)
  }
  const addIngreso = () => {
    if (!inForm?.motivo_id || !n(inForm.monto)) { toast.warning('Elige motivo y monto'); return }
    const m = motIn.find(x => x.id === inForm.motivo_id)
    setIngresos(p => [...p, { motivo_id: inForm.motivo_id, motivo_nombre: m?.nombre || 'Ingreso', monto: n(inForm.monto), nombre_evento: inForm.evento || null, comentario: inForm.comentario || null }])
    setInForm(null)
  }
  const inpStyle = { background: '#241d19', border: '1px solid #332b27', color: '#f3efe9', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none', width: '100%' }

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
                <button style={ghostBtn} onClick={() => setEgForm(egForm ? null : { motivo_id: '', monto: '', persona: '', comentario: '' })}>+ Agregar</button>
              </div>
              {egForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, background: '#15110f', borderRadius: 8, padding: 10 }}>
                  <select style={inpStyle} value={egForm.motivo_id} onChange={e => setEgForm(f => ({ ...f, motivo_id: e.target.value }))}>
                    <option value="">Motivo…</option>{motEg.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                  <input style={inpStyle} inputMode="decimal" placeholder="Monto" value={egForm.monto} onChange={e => setEgForm(f => ({ ...f, monto: e.target.value }))} />
                  <input style={inpStyle} placeholder="Persona que recibe (opcional)" value={egForm.persona} onChange={e => setEgForm(f => ({ ...f, persona: e.target.value }))} />
                  <button style={{ ...ghostBtn, color: '#2dd4a8', borderColor: '#1f3a34' }} onClick={addEgreso}>Agregar egreso</button>
                </div>
              )}
              {egresos.length === 0 && !egForm && <div style={{ color: '#6b6878', fontSize: 13, textAlign: 'center', padding: '6px 0' }}>Sin egresos</div>}
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
                <button style={ghostBtn} onClick={() => setInForm(inForm ? null : { motivo_id: '', monto: '', evento: '', comentario: '' })}>+ Agregar</button>
              </div>
              {inForm && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, background: '#15110f', borderRadius: 8, padding: 10 }}>
                  <select style={inpStyle} value={inForm.motivo_id} onChange={e => setInForm(f => ({ ...f, motivo_id: e.target.value }))}>
                    <option value="">Motivo…</option>{motIn.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                  <input style={inpStyle} inputMode="decimal" placeholder="Monto" value={inForm.monto} onChange={e => setInForm(f => ({ ...f, monto: e.target.value }))} />
                  <button style={{ ...ghostBtn, color: '#2dd4a8', borderColor: '#1f3a34' }} onClick={addIngreso}>Agregar ingreso</button>
                </div>
              )}
              {ingresos.length === 0 && !inForm && <div style={{ color: '#6b6878', fontSize: 13, textAlign: 'center', padding: '6px 0' }}>Sin ingresos</div>}
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
    </div>
  )
}
