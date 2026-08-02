// Corte X/Z desde el ERP (computadora). Reutiliza el MISMO CierreTurno del POS
// (ventas automáticas + egresos/ingresos con fotos + por caja), con un selector de
// sucursal y caja. Unifica el cierre: mismo componente en tablet y en compu.
import { useState, useEffect } from 'react'
import { db } from '../../supabase'
import { STORES } from '../../config'
import '../../pos/pos.css'
import CierreTurno from '../../pos/CierreTurno'

const MULTI_STORE = ['ejecutivo', 'admin', 'superadmin']
const POS_STORES = Object.entries(STORES)
  .filter(([c]) => c !== 'CM001' && c !== 'EVT01')
  .map(([code, name]) => ({ code, name }))
const CAJA_LABEL = { general: '🧾 Caja General', drive: '🚗 Drive Thru' }

export default function CorteXZView({ user, onBack }) {
  const multi = MULTI_STORE.includes(user.rol)
  const [store, setStore] = useState(multi ? '' : (user.store_code || ''))
  const [cajas, setCajas] = useState(null)  // null = cargando/no elegido; [] = 1 sola
  const [caja, setCaja] = useState(null)
  const [go, setGo] = useState(false)

  useEffect(() => {
    if (!store) { setCajas(null); setCaja(null); return }
    let alive = true
    db.from('pos_impresoras').select('caja,nombre,rol').eq('store_code', store).eq('activa', true)
      .then(({ data }) => {
        if (!alive) return
        const map = new Map()
        ;(data || []).forEach(r => { if (r.caja && (!map.has(r.caja) || r.rol !== 'precuenta')) map.set(r.caja, r.nombre) })
        const list = Array.from(map, ([c, nombre]) => ({ caja: c, nombre }))
        setCajas(list)
        setCaja(list.length >= 2 ? null : (list.length === 1 ? list[0].caja : null))
      })
      .catch(() => { if (alive) { setCajas([]); setCaja(null) } })
    return () => { alive = false }
  }, [store])

  const cajaReady = cajas !== null && (cajas.length < 2 || !!caja)

  // Corte en marcha → el mismo CierreTurno del POS
  if (go && store && cajaReady) {
    return <CierreTurno user={{ ...user, store_code: store, caja: caja || null }} onBack={() => setGo(false)} ownTurnoOnly={false} />
  }

  // ── Selector ──
  const card = { background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 12, padding: 20, maxWidth: 460, width: '100%' }
  const sel = { width: '100%', padding: '12px 14px', borderRadius: 10, background: '#141418', color: '#e8e6ef', border: '1px solid #2a2a32', fontSize: 15 }
  const cajaBtn = (active) => ({ padding: '14px 16px', borderRadius: 10, border: `1.5px solid ${active ? '#E62329' : '#2a2a32'}`, background: active ? 'rgba(230,35,41,0.12)' : '#141418', color: '#e8e6ef', fontSize: 15, fontWeight: 700, cursor: 'pointer', textAlign: 'left' })

  return (
    <div style={{ minHeight: '70vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 18 }}>
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4, color: '#e8e6ef' }}>🧾 Corte de Caja (X / Z)</div>
        <div style={{ color: '#8b8997', fontSize: 13, marginBottom: 18 }}>Elegí la caja y hacé el corte desde acá — ventas automáticas del POS, egresos/ingresos con foto.</div>

        {multi && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#8b8997', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Sucursal</div>
            <select style={sel} value={store} onChange={e => { setStore(e.target.value); setCaja(null); setGo(false) }}>
              <option value="">Elegí una sucursal…</option>
              {POS_STORES.map(s => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
          </div>
        )}
        {!multi && (
          <div style={{ marginBottom: 14, color: '#e8e6ef', fontWeight: 600 }}>Sucursal: {STORES[store] || store}</div>
        )}

        {store && cajas && cajas.length >= 2 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#8b8997', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Caja</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {cajas.map(c => (
                <button key={c.caja} style={cajaBtn(caja === c.caja)} onClick={() => setCaja(c.caja)}>
                  {CAJA_LABEL[c.caja] || c.caja}<div style={{ fontSize: 11, color: '#8b8997', fontWeight: 400 }}>{c.nombre}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={onBack} style={{ flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #2a2a32', background: 'transparent', color: '#8b8997', fontSize: 14, cursor: 'pointer' }}>← Volver</button>
          <button disabled={!store || !cajaReady} onClick={() => setGo(true)}
            style={{ flex: 2, padding: '12px', borderRadius: 10, border: 'none', background: '#E62329', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: (!store || !cajaReady) ? 0.4 : 1 }}>
            Abrir corte →
          </button>
        </div>
      </div>
    </div>
  )
}
