import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'
import Icon from './Icon'
import { useToast } from '../hooks/useToast'
import { printCorte } from './print/printService'

/**
 * CierreTurno — Corte de caja X/Z del POS, con el mismo flujo del CierreForm del ERP
 * pero alimentado desde el POS (RPC pos_corte sobre pos_cuenta_pagos).
 *
 * X = lectura/impresión del turno abierto (no cierra). Z = cierre con conteo físico.
 */
const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`
const num = (v) => parseFloat(v) || 0
const todayISO = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)

const METODOS = [
  { k: 'efectivo', l: 'Efectivo' },
  { k: 'tarjeta', l: 'Tarjeta' },
  { k: 'transferencia', l: 'Transferencia' },
  { k: 'link_pago', l: 'Link de pago' },
]

function Mi({ label, value, onChange, readOnly, hint }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontSize: 11, color: '#9a9088', marginBottom: 3 }}>
        {label}{hint && <span style={{ color: '#6b6878' }}> · {hint}</span>}
      </label>
      <input
        inputMode="decimal" placeholder="0.00" value={value}
        readOnly={readOnly}
        onChange={e => onChange && onChange(e.target.value)}
        style={{ width: '100%', background: readOnly ? '#1a1410' : '#241d19', border: '1px solid #332b27', color: readOnly ? '#9a9088' : '#f3efe9', borderRadius: 8, padding: '9px 11px', fontSize: 15, outline: 'none', fontWeight: readOnly ? 400 : 700 }}
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
  const [tab, setTab]         = useState('x')
  const [fondoInput, setFondoInput] = useState('')
  const [saving, setSaving]   = useState(false)
  // Conteo físico (Z)
  const [conteo, setConteo]   = useState({ efectivo: '', tarjeta: '', transferencia: '', link_pago: '' })
  const [depositar, setDepositar] = useState('')
  const [obs, setObs]         = useState('')

  // ── Cargar turno abierto del cajero ──
  const loadTurno = useCallback(async () => {
    setLoading(true)
    const { data } = await db.from('pos_turnos')
      .select('*')
      .eq('store_code', storeCode).eq('cajero_id', user.id)
      .eq('nivel', 'cajero').eq('estado', 'abierto')
      .order('abierto_at', { ascending: false }).limit(1).maybeSingle()
    setTurno(data || null)
    setLoading(false)
  }, [storeCode, user.id])

  useEffect(() => { loadTurno() }, [loadTurno])

  // ── Calcular corte (RPC) cuando hay turno ──
  const loadCorte = useCallback(async () => {
    if (!turno) return
    const { data, error } = await db.rpc('pos_corte', {
      p_store_code: storeCode,
      p_desde: turno.abierto_at,
      p_hasta: new Date().toISOString(),
      p_turno_id: null,
    })
    if (!error) setCorte(data)
  }, [turno, storeCode])

  useEffect(() => { loadCorte() }, [loadCorte])

  // ── Abrir turno ──
  const abrirTurno = async () => {
    setSaving(true)
    try {
      const { count } = await db.from('pos_turnos').select('*', { count: 'exact', head: true })
        .eq('store_code', storeCode).eq('fecha', todayISO())
      const { data, error } = await db.from('pos_turnos').insert({
        store_code: storeCode, cajero_id: user.id, nivel: 'cajero',
        fecha: todayISO(), numero_turno: (count || 0) + 1,
        fondo_apertura: num(fondoInput), abierto_at: new Date().toISOString(), estado: 'abierto',
      }).select().single()
      if (error) throw error
      setTurno(data)
      toast.success('Turno abierto')
    } catch (e) { toast.error('Error al abrir turno: ' + e.message) } finally { setSaving(false) }
  }

  // ── Cerrar turno (Z) ──
  const efectivoSistema = num(corte?.efectivo)
  const fondo = num(turno?.fondo_apertura)
  const efectivoEsperado = fondo + efectivoSistema       // lo que debería haber en caja (sin depositar)
  const efectivoContado = num(conteo.efectivo)
  const difEfectivo = efectivoContado - efectivoEsperado

  const cerrarZ = async () => {
    if (!confirm('¿Cerrar el turno? El corte Z es definitivo.')) return
    setSaving(true)
    try {
      const { error } = await db.from('pos_turnos').update({
        cerrado_at: new Date().toISOString(), estado: 'cerrado',
        sistema_efectivo: efectivoSistema, sistema_tarjeta: num(corte?.tarjeta),
        sistema_transferencia: num(corte?.transferencia), sistema_link_pago: num(corte?.link_pago),
        sistema_pedidos_ya: num(corte?.otros), sistema_total: num(corte?.total),
        sistema_propinas: num(corte?.propinas), sistema_num_cuentas: corte?.n_cuentas || 0,
        sistema_num_cancelaciones: corte?.n_cancelaciones || 0, sistema_ticket_promedio: num(corte?.ticket_promedio),
        conteo_efectivo: efectivoContado, conteo_tarjeta: num(conteo.tarjeta),
        conteo_transferencia: num(conteo.transferencia), conteo_link_pago: num(conteo.link_pago),
        diferencia_efectivo: difEfectivo,
        diferencia_total: (efectivoContado + num(conteo.tarjeta) + num(conteo.transferencia) + num(conteo.link_pago)) - (efectivoEsperado + num(corte?.tarjeta) + num(corte?.transferencia) + num(corte?.link_pago)),
        deposito_monto: num(depositar), notas: obs || null,
      }).eq('id', turno.id)
      if (error) throw error
      toast.success('Turno cerrado (corte Z)')
      try { await printCorte('z', buildCorteData('Z')) } catch {}
      onBack()
    } catch (e) { toast.error('Error al cerrar: ' + e.message) } finally { setSaving(false) }
  }

  const buildCorteData = (tipo) => ({
    tipo, storeCode, storeName, cajero: user.nombre || '', fecha: todayISO(),
    abierto_at: turno?.abierto_at, fondo,
    efectivo: efectivoSistema, tarjeta: num(corte?.tarjeta), transferencia: num(corte?.transferencia),
    link_pago: num(corte?.link_pago), otros: num(corte?.otros), total: num(corte?.total),
    propinas: num(corte?.propinas), n_cuentas: corte?.n_cuentas || 0,
    n_cancelaciones: corte?.n_cancelaciones || 0, ticket_promedio: num(corte?.ticket_promedio),
    efectivoEsperado,
    ...(tipo === 'Z' ? { conteo, efectivoContado, difEfectivo, depositar: num(depositar), obs } : {}),
  })

  const imprimirX = async () => { try { await printCorte('x', buildCorteData('X')) } catch (e) { toast.error('No se imprimió: ' + e.message) } }

  // ── Render ──
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

  // Sin turno abierto → abrir caja
  if (!turno) {
    return (
      <div className="poshome-root">
        {Header}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
          <Icon name="cash" size={48} color="#43382f" />
          <div style={{ fontSize: 18, fontWeight: 800 }}>Abrir caja</div>
          <div style={{ color: '#9a9088', fontSize: 13, textAlign: 'center', maxWidth: 280 }}>Ingresa el fondo de apertura para comenzar el turno.</div>
          <div style={{ width: 220 }}>
            <Mi label="Fondo de apertura" value={fondoInput} onChange={setFondoInput} hint="efectivo en caja" />
          </div>
          <button className="pos-cobrar-btn" style={{ width: 220 }} disabled={saving} onClick={abrirTurno}>
            {saving ? '...' : 'Abrir turno'}
          </button>
        </div>
      </div>
    )
  }

  const Resumen = (
    <div style={{ background: '#241d19', border: '1px solid #332b27', borderRadius: 12, padding: 14, marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: '#9a9088', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>Ventas del turno (sistema)</div>
      {[['Efectivo', corte?.efectivo], ['Tarjeta', corte?.tarjeta], ['Transferencia', corte?.transferencia], ['Link de pago', corte?.link_pago], ['Otros/Mixto', corte?.otros]].map(([l, v]) => (
        num(v) > 0 || l === 'Efectivo' || l === 'Tarjeta' ? (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', color: '#c9c2b8' }}>
            <span>{l}</span><span>{fmt(v)}</span>
          </div>
        ) : null
      ))}
      <div style={{ borderTop: '1px solid #332b27', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16 }}>
        <span>TOTAL VENTAS</span><span style={{ color: '#FFD900' }}>{fmt(corte?.total)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9a9088', marginTop: 4 }}>
        <span>Propinas: {fmt(corte?.propinas)}</span>
        <span>{corte?.n_cuentas || 0} cuentas · prom {fmt(corte?.ticket_promedio)}</span>
      </div>
    </div>
  )

  return (
    <div className="poshome-root">
      {Header}
      {/* Tabs X / Z */}
      <div style={{ display: 'flex', gap: 6, margin: '12px 18px 0', background: '#241d19', border: '1px solid #332b27', borderRadius: 11, padding: 4, width: 'max-content' }}>
        {[['x', 'Corte X (lectura)'], ['z', 'Corte Z (cierre)']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background: tab === k ? '#E62329' : 'none', border: 'none', color: tab === k ? '#fff' : '#9a9088', fontWeight: 700, fontSize: 13, padding: '8px 18px', borderRadius: 9, cursor: 'pointer' }}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18, maxWidth: 460, width: '100%', margin: '0 auto' }}>
        <div style={{ fontSize: 12, color: '#9a9088', marginBottom: 10 }}>
          Turno abierto {new Date(turno.abierto_at).toLocaleString('es-SV', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })} · Fondo {fmt(fondo)}
        </div>

        {Resumen}

        {tab === 'x' ? (
          <>
            <div style={{ background: '#2e1311', border: '1px solid #E62329', borderRadius: 12, padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div><div style={{ fontSize: 11, color: '#9a9088' }}>Efectivo esperado en caja</div><div style={{ fontSize: 11, color: '#9a9088' }}>(fondo {fmt(fondo)} + ventas efectivo)</div></div>
              <div style={{ fontSize: 22, fontWeight: 900, color: '#FFD900' }}>{fmt(efectivoEsperado)}</div>
            </div>
            <button className="pos-cobrar-btn" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={imprimirX}>
              <Icon name="receipt" size={17} color="#fff" /> Imprimir corte X
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#9a9088', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Conteo físico</div>
            <Mi label={`Efectivo contado`} value={conteo.efectivo} onChange={v => setConteo(c => ({ ...c, efectivo: v }))} hint={`esperado ${fmt(efectivoEsperado)}`} />
            {efectivoContado > 0 && (
              <div style={{ fontSize: 12, color: Math.abs(difEfectivo) < 0.01 ? '#2dd4a8' : '#f87171', marginTop: -2, marginBottom: 8 }}>
                Diferencia: {fmt(difEfectivo)} {Math.abs(difEfectivo) < 0.01 ? '✓' : difEfectivo > 0 ? '(sobra)' : '(falta)'}
              </div>
            )}
            <Mi label="Tarjeta (voucher)" value={conteo.tarjeta} onChange={v => setConteo(c => ({ ...c, tarjeta: v }))} hint={`sistema ${fmt(corte?.tarjeta)}`} />
            <Mi label="Transferencia" value={conteo.transferencia} onChange={v => setConteo(c => ({ ...c, transferencia: v }))} hint={`sistema ${fmt(corte?.transferencia)}`} />
            <Mi label="Efectivo a depositar" value={depositar} onChange={setDepositar} />
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#9a9088', marginBottom: 3 }}>Observaciones</label>
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
