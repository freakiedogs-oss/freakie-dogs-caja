import { useState } from 'react'
import POSLogin from './POSLogin'
import POSHome from './POSHome'
import POSMain from './cajero/POSMain'
import KDSScreen from './KDSScreen'
import HistorialCobros from './HistorialCobros'
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
      <div style={{ fontWeight: 800, fontSize: 20, color: '#ff6b35', marginBottom: 4 }}>
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
            onMouseOver={e => { e.currentTarget.style.background = '#1e1e26'; e.currentTarget.style.borderColor = '#ff6b35' }}
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
      // Ir directo al POS con su sucursal asignada
      setUser(userData)
      setEffectiveUser(userData)
      setScreen('home')
    }
  }

  const handleStoreSelect = (storeCode) => {
    // Sobreescribir store_code del usuario para esta sesión POS
    const u = { ...user, store_code: storeCode }
    setEffectiveUser(u)
    setScreen('home')
  }

  const handleLogout = () => {
    setUser(null)
    setEffectiveUser(null)
    setScreen('home')
    setCuentaCtx(null)
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

  // ── Login ──
  if (!user) return <POSLogin onLogin={handleLogin} />

  // ── Store Selector (ejecutivo/admin/superadmin) ──
  if (screen === 'store-select') {
    return <StoreSelector user={user} onSelect={handleStoreSelect} onLogout={handleLogout} />
  }

  // Desde aquí usamos effectiveUser (con store_code correcto)
  const posUser = effectiveUser || user
  const canChangeStore = MULTI_STORE_ROLES.includes(user.rol)

  // ── KDS ──
  if (screen === 'kds') {
    return <KDSScreen user={posUser} onBack={handleBack} />
  }

  // ── Historial de Cobros ──
  if (screen === 'historial') {
    return <HistorialCobros user={posUser} onBack={handleBack} />
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
