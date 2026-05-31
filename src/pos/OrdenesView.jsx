import { useState, useEffect, useCallback } from 'react'
import { db } from '../supabase'
import { STORES } from '../config'
import Icon from './Icon'
import HistorialCobros from './HistorialCobros'

const TIPO = {
  mesa:            { ic: 'armchair', l: 'Mesa',        c: '#2dd4a8' },
  para_llevar:     { ic: 'bag',      l: 'Para Llevar', c: '#f4a261' },
  delivery_propio: { ic: 'bike',     l: 'Delivery',    c: '#60a5fa' },
  delivery_app:    { ic: 'phone',    l: 'App Delivery', c: '#f472b6' },
  pedidos_ya:      { ic: 'bike',     l: 'PedidosYa',   c: '#a78bfa' },
  drive_through:   { ic: 'car',      l: 'Drive Thru',  c: '#fbbf24' },
}
const ESTADO_ACTIVO = ['abierta', 'enviada_cocina', 'en_preparacion', 'lista', 'entregada']

function elapsed(iso) {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (d < 1) return 'ahora'
  if (d < 60) return `${d}m`
  return `${Math.floor(d / 60)}h${d % 60}m`
}

export default function OrdenesView({ user, onBack, onOpenOrder }) {
  const storeCode = user.store_code || 'S001'
  const storeName = STORES[storeCode] || storeCode
  const [tab, setTab]         = useState('activas')
  const [activas, setActivas] = useState([])
  const [loading, setLoading] = useState(true)

  const loadActivas = useCallback(async () => {
    setLoading(true)
    const { data } = await db
      .from('pos_cuentas')
      .select('id, tipo, mesa_ref, estado, subtotal, total, created_at, cliente_nombre, delivery_referencia, pos_cuenta_items!pos_cuenta_items_cuenta_id_fkey(id)')
      .eq('store_code', storeCode)
      .in('estado', ESTADO_ACTIVO)
      .order('created_at')
    setActivas(data || [])
    setLoading(false)
  }, [storeCode])

  useEffect(() => { if (tab === 'activas') loadActivas() }, [tab, loadActivas])

  useEffect(() => {
    const sub = db.channel('ordenes_view_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pos_cuentas', filter: `store_code=eq.${storeCode}` },
        () => { if (tab === 'activas') loadActivas() })
      .subscribe()
    return () => db.removeChannel(sub)
  }, [storeCode, tab, loadActivas])

  const segBtn = (key, label, count) => (
    <button
      key={key}
      onClick={() => setTab(key)}
      style={{
        background: tab === key ? '#E62329' : 'none', border: 'none',
        color: tab === key ? '#fff' : '#9a9088', fontWeight: 700, fontSize: 14,
        padding: '9px 22px', borderRadius: 9, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 7,
      }}
    >
      {label}{count > 0 && <span style={{ background: tab === key ? '#ffffff33' : '#241d19', borderRadius: 999, padding: '1px 8px', fontSize: 12 }}>{count}</span>}
    </button>
  )

  return (
    <div className="poshome-root">
      <header className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Inicio</button>
        <img src="/icon-192.png" className="pos-header-logo" alt="Freakie Dogs" />
        <span className="pos-header-brand">Órdenes</span>
        <span className="pos-header-store">{storeName}</span>
        <span className="pos-header-sep" />
        <span className="pos-header-user">{user.nombre?.split(' ')[0]}</span>
        <button className="pos-header-btn danger" onClick={onBack}>Salir</button>
      </header>

      {/* Segmented Activas / Historial */}
      <div style={{ display: 'flex', gap: 6, margin: '12px 18px 0', background: '#241d19', border: '1px solid #332b27', borderRadius: 11, padding: 4, width: 'max-content' }}>
        {segBtn('activas', 'Activas', activas.length)}
        {segBtn('historial', 'Historial', 0)}
      </div>

      {tab === 'historial' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <HistorialCobros user={user} onBack={onBack} embedded />
        </div>
      ) : (
        <div className="poshome-body">
          {loading ? (
            <div className="poshome-empty"><div className="spin" /></div>
          ) : activas.length === 0 ? (
            <div className="poshome-empty">
              <div style={{ display: 'flex', justifyContent: 'center' }}><Icon name="utensils" size={46} color="#43382f" /></div>
              <div style={{ color: '#9a9088', fontSize: 14, marginTop: 8 }}>Sin órdenes activas</div>
            </div>
          ) : (
            <div className="poshome-cuentas-list">
              {activas.map(c => {
                const info  = TIPO[c.tipo] || { ic: 'bag', l: c.tipo, c: '#9a9088' }
                const items = c.pos_cuenta_items?.length || 0
                return (
                  <button
                    key={c.id}
                    className="poshome-cuenta-row"
                    style={{ borderLeftColor: info.c }}
                    onClick={() => onOpenOrder({ tipo: c.tipo, mesa_ref: c.mesa_ref || null, mesa_id: null, cuentaId: c.id })}
                  >
                    <span className="poshome-cuenta-icon"><Icon name={info.ic} size={20} color={info.c} /></span>
                    <div className="poshome-cuenta-info">
                      <span className="poshome-cuenta-label" style={{ color: info.c }}>
                        {c.mesa_ref ? `Mesa #${c.mesa_ref}` : info.l}{c.delivery_referencia ? ` #${c.delivery_referencia}` : ''}
                      </span>
                      <span className="poshome-cuenta-items">
                        {c.cliente_nombre ? `${c.cliente_nombre} · ` : ''}{items} ítem{items !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="poshome-cuenta-total">${parseFloat(c.subtotal || 0).toFixed(2)}</span>
                    <span className="poshome-cuenta-time">{elapsed(c.created_at)}</span>
                    <span className="poshome-cuenta-estado" data-estado={c.estado}>
                      {c.estado === 'enviada_cocina' ? 'Cocina'
                        : c.estado === 'lista'       ? 'Lista'
                        : c.estado === 'entregada'   ? 'Entregada'
                        : 'Abierta'}
                    </span>
                    <span className="poshome-cuenta-arrow">→</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
