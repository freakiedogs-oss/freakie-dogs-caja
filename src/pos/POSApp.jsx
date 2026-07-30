import { useState, useEffect } from 'react'
import { db } from '../supabase'
import POSLogin from './POSLogin'
import POSHome from './POSHome'
import POSMain from './cajero/POSMain'
import KDSScreen from './KDSScreen'
import OrdenesView from './OrdenesView'
import CierreTurno from './CierreTurno'
import MenuAdminView from './admin/MenuAdminView'
import { STORES } from '../config'

// Roles que pueden elegir sucursal al entrar al POS
const MULTI_STORE_ROLES = ['ejecutivo', 'admin', 'superadmin']

// Sucursales disponibles en POS (excluye Casa Matriz)
const POS_STORES = Object.entries(STORES)
  .filter(([code]) => code !== 'CM001')
  .map(([code, name]) => ({ code, name }))

// ── Selector de Sucursal ──
function StoreSelector({ user, onSelect, onLogout }) {
  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#141418', padding: '0 24px'
    }}>
      <img
        src="/icon-192.png"
        alt="Freakie Dogs"
        style={{ width: 80, height: 80, borderRadius: 16, marginBottom: 10, objectFit: 'contain' }}
      />
      <div style={{ fontWeight: 800, fontSize: 20, color: '#E62329', marginBottom: 4 }}>
        Freakie POS
      </div>
      <div style={{ color: '#8b8997', fontSize: 13, marginBottom: 6 }}>
        Hola, {user.nombre?.split(' ')[0]} 👋
      </div>
      <div style={{ color: '#8b8997', fontSize: 12, marginBottom: 28, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Selecciona sucursal
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
        {POS_STORES.map(({ code, name }) => (
          <button
            key={code}
            onClick={() => onSelect(code)}
            style={{
              padding: '16px 20px', border: '1px solid #2a2a32', borderRadius: 12,
              background: '#1c1c22', color: '#e8e6ef', fontSize: 16, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
              transition: 'all 0.15s',
            }}
            onMouseOver={e => { e.currentTarget.style.background = '#1e1e26'; e.currentTarget.style.borderColor = '#E62329' }}
            onMouseOut={e => { e.currentTarget.style.background = '#1c1c22'; e.currentTarget.style.borderColor = '#2a2a32' }}
          >
            <span style={{ fontSize: 22 }}>🏪</span>
            <span style={{ flex: 1, textAlign: 'left' }}>{name}</span>
            <span style={{ color: '#8b8997', fontSize: 12, fontWeight: 400 }}>{code}</span>
          </button>
        ))}
      </div>

      <button
        onClick={onLogout}
        style={{
          marginTop: 32, padding: '10px 24px', border: '1px solid #2a2a32', borderRadius: 8,
          background: 'transparent', color: '#8b8997', fontSize: 13, cursor: 'pointer',
        }}
      >
        ← Cambiar usuario
      </button>
    </div>
  )
}

// Etiqueta amigable por caja (sucursales con 2+ cajas, ej. Lourdes)
const CAJA_LABELS = {
  general: { icon: '🧾', label: 'Caja General' },
  drive:   { icon: '🚗', label: 'Drive Thru' },
}

// ── Selector de Caja ──
// Sucursales con 2+ impresoras/cajas muestran el selector; las de 1 sola caja
// (todas las demás) auto-seleccionan y siguen directo (cero cambio para ellas).
function CajaSelector({ user, onSelect, onLogout }) {
  const [cajas, setCajas] = useState(null) // null = cargando

  useEffect(() => {
    let alive = true
    db.from('pos_impresoras').select('caja,nombre').eq('store_code', user.store_code).eq('activa', true)
      .then(({ data }) => {
        if (!alive) return
        const map = new Map()
        ;(data || []).forEach(r => { if (r.caja) map.set(r.caja, r.nombre) })
        const list = Array.from(map, ([caja, nombre]) => ({ caja, nombre }))
        if (list.length >= 2) setCajas(list)
        else onSelect(list.length === 1 ? list[0].caja : null) // 1 o 0 cajas → sin selección
      })
      .catch(() => onSelect(null))
    return () => { alive = false }
  }, [user.store_code])

  if (!cajas) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#141418', color: '#8b8997', fontSize: 14 }}>Cargando cajas…</div>
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#141418', padding: '0 24px' }}>
      <img src="/icon-192.png" alt="Freakie Dogs" style={{ width: 80, height: 80, borderRadius: 16, marginBottom: 10, objectFit: 'contain' }} />
      <div style={{ fontWeight: 800, fontSize: 20, color: '#E62329', marginBottom: 4 }}>Freakie POS</div>
      <div style={{ color: '#8b8997', fontSize: 13, marginBottom: 6 }}>Hola, {user.nombre?.split(' ')[0]} 👋</div>
      <div style={{ color: '#8b8997', fontSize: 12, marginBottom: 28, textTransform: 'uppercase', letterSpacing: '0.5px' }}>¿Qué caja vas a abrir?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
        {cajas.map(({ caja, nombre }) => {
          const meta = CAJA_LABELS[caja] || { icon: '🗄️', label: caja }
          return (
            <button key={caja} onClick={() => onSelect(caja)}
              style={{ padding: '16px 20px', border: '1px solid #2a2a32', borderRadius: 12, background: '#1c1c22', color: '#e8e6ef', fontSize: 16, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.15s' }}
              onMouseOver={e => { e.currentTarget.style.background = '#1e1e26'; e.currentTarget.style.borderColor = '#E62329' }}
              onMouseOut={e => { e.currentTarget.style.background = '#1c1c22'; e.currentTarget.style.borderColor = '#2a2a32' }}>
              <span style={{ fontSize: 22 }}>{meta.icon}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{meta.label}<div style={{ color: '#8b8997', fontSize: 11, fontWeight: 400 }}>{nombre}</div></span>
            </button>
          )
        })}
      </div>
      <button onClick={onLogout} style={{ marginTop: 32, padding: '10px 24px', border: '1px solid #2a2a32', borderRadius: 8, background: 'transparent', color: '#8b8997', fontSize: 13, cursor: 'pointer' }}>← Cambiar usuario</button>
    </div>
  )
}

/**
 * POSApp — Router principal del POS
 *
 * Pantallas:
 *   'store-select' → StoreSelector: elegir sucursal (solo ejecutivo/admin/superadmin)
 *   'home'     → POSHome: plano de mesas + cuentas abiertas + botones rápidos
 *   'ordering' → POSMain: menú + orden activa (nueva o existente)
 *   'kds'      → KDSScreen: pantalla de cocina / kitchen display
 *   'historial' → HistorialCobros: historial de tickets cobrados hoy
 *
 * cuentaCtx: { tipo, mesa_ref, mesa_id, cuentaId }
 *   - cuentaId = null  → nueva orden
 *   - cuentaId = UUID  → cargar cuenta existente (seguir añadiendo)
 */
export default function POSApp() {
  const [user,       setUser]       = useState(null)
  const [screen,     setScreen]     = useState('home')
  const [cuentaCtx,  setCuentaCtx]  = useState(null)

  // Para roles multi-sucursal: store_code elegido en el selector
  const [effectiveUser, setEffectiveUser] = useState(null)

  const handleLogin = (userData) => {
    if (MULTI_STORE_ROLES.includes(userData.rol)) {
      // Mostrar selector de sucursal
      setUser(userData)
      setScreen('store-select')
    } else {
      // Con su sucursal asignada → elegir caja (auto-salta si la sucursal tiene 1 sola)
      setUser(userData)
      setEffectiveUser(userData)
      setScreen('caja-select')
    }
  }

  const handleStoreSelect = (storeCode) => {
    // Sobreescribir store_code del usuario para esta sesión POS
    const u = { ...user, store_code: storeCode }
    setEffectiveUser(u)
    setScreen('caja-select')
    // Re-persist con el store seleccionado (para logs del proxy DTE)
    try {
      sessionStorage.setItem('pos_user', JSON.stringify({
        id: u.id, pin: u.pin, rol: u.rol, store_code: u.store_code,
        nombre: u.nombre, apellido: u.apellido,
      }))
    } catch {}
  }

  const handleCajaSelect = (caja) => {
    setEffectiveUser(prev => {
      const u = { ...(prev || user), caja: caja || null }
      try {
        sessionStorage.setItem('pos_user', JSON.stringify({
          id: u.id, pin: u.pin, rol: u.rol, store_code: u.store_code, caja: u.caja,
          nombre: u.nombre, apellido: u.apellido,
        }))
      } catch {}
      return u
    })
    setScreen('home')
  }

  const handleLogout = () => {
    setUser(null)
    setEffectiveUser(null)
    setScreen('home')
    setCuentaCtx(null)
    try { sessionStorage.removeItem('pos_user') } catch {}
  }

  const handleChangeStore = () => {
    // Volver al selector de sucursal (solo multi-store roles)
    setEffectiveUser(null)
    setCuentaCtx(null)
    setScreen('store-select')
  }

  const handleStartOrder = (ctx) => {
    setCuentaCtx(ctx)
    setScreen('ordering')
  }

  const handleBack = () => {
    setCuentaCtx(null)
    setScreen('home')
  }

  const handleGoToKDS = () => setScreen('kds')

  const handleGoToHistorial = () => setScreen('historial')

  const handleGoToMenuAdmin = () => setScreen('menu-admin')

  const handleGoToCierre = () => setScreen('cierre')

  // ── Login ──
  if (!user) return <POSLogin onLogin={handleLogin} />

  // ── Store Selector (ejecutivo/admin/superadmin) ──
  if (screen === 'store-select') {
    return <StoreSelector user={user} onSelect={handleStoreSelect} onLogout={handleLogout} />
  }

  // ── Caja Selector (sucursales con 2+ cajas, ej. Lourdes; auto-salta si 1 sola) ──
  if (screen === 'caja-select') {
    return <CajaSelector user={effectiveUser || user} onSelect={handleCajaSelect} onLogout={handleLogout} />
  }

  // Desde aquí usamos effectiveUser (con store_code correcto)
  const posUser = effectiveUser || user
  const canChangeStore = MULTI_STORE_ROLES.includes(user.rol)

  // ── KDS ──
  if (screen === 'kds') {
    return <KDSScreen user={posUser} onBack={handleBack} />
  }

  // ── Órdenes (Activas + Historial) ──
  if (screen === 'historial') {
    return <OrdenesView user={posUser} onBack={handleBack} onOpenOrder={handleStartOrder} />
  }

  // ── Admin Menú ──
  if (screen === 'menu-admin') {
    return <MenuAdminView user={posUser} storeCode={posUser.store_code} onBack={handleBack} />
  }

  // ── Cierre de caja (X/Z) ──
  if (screen === 'cierre') {
    return <CierreTurno user={posUser} onBack={handleBack} />
  }

  // ── Home ──
  if (screen === 'home') {
    return (
      <POSHome
        user={posUser}
        onStartOrder={handleStartOrder}
        onLogout={handleLogout}
        onGoToKDS={handleGoToKDS}
        onGoToHistorial={handleGoToHistorial}
        onGoToCierre={handleGoToCierre}
        onGoToMenuAdmin={canChangeStore ? handleGoToMenuAdmin : null}
        onChangeStore={canChangeStore ? handleChangeStore : null}
      />
    )
  }

  // ── Ordering ──
  return (
    <POSMain
      user={posUser}
      cuentaCtx={cuentaCtx}
      onBack={handleBack}
      onLogout={handleLogout}
    />
  )
}
