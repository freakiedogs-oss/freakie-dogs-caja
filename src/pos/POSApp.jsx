import { useState } from 'react'
import POSLogin from './POSLogin'
import POSHome from './POSHome'
import POSMain from './cajero/POSMain'
import KDSScreen from './KDSScreen'

/**
 * POSApp — Router principal del POS
 *
 * Pantallas:
 *   'home'     → POSHome: plano de mesas + cuentas abiertas + botones rápidos
 *   'ordering' → POSMain: menú + orden activa (nueva o existente)
 *   'kds'      → KDSScreen: pantalla de cocina / kitchen display
 *
 * cuentaCtx: { tipo, mesa_ref, mesa_id, cuentaId }
 *   - cuentaId = null  → nueva orden
 *   - cuentaId = UUID  → cargar cuenta existente (seguir añadiendo)
 */
export default function POSApp() {
  const [user,       setUser]       = useState(null)
  const [screen,     setScreen]     = useState('home')
  const [cuentaCtx,  setCuentaCtx]  = useState(null)

  const handleLogout = () => {
    setUser(null)
    setScreen('home')
    setCuentaCtx(null)
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

  // ── Login ──
  if (!user) return <POSLogin onLogin={setUser} />

  // ── KDS ──
  if (screen === 'kds') {
    return <KDSScreen user={user} onBack={handleBack} />
  }

  // ── Home ──
  if (screen === 'home') {
    return (
      <POSHome
        user={user}
        onStartOrder={handleStartOrder}
        onLogout={handleLogout}
        onGoToKDS={handleGoToKDS}
      />
    )
  }

  // ── Ordering ──
  return (
    <POSMain
      user={user}
      cuentaCtx={cuentaCtx}
      onBack={handleBack}
      onLogout={handleLogout}
    />
  )
}
