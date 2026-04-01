import { useState, useCallback } from 'react'
import Sidebar from './components/layout/Sidebar'
import LoginScreen from './components/layout/LoginScreen'
import CierreForm from './components/caja/CierreForm'
import ReporteForm from './components/caja/ReporteForm'
import Deposito from './components/caja/Deposito'
import AdminView from './components/admin/AdminView'
import IncidentesDash from './components/admin/IncidentesDash'
import DashboardVentas from './components/dashboard/DashboardVentas'
import DashboardEjecutivo from './components/dashboard/DashboardEjecutivo'
import ConteoNocturno from './components/supply-chain/ConteoNocturno'
import ConfirmarEntrega from './components/supply-chain/ConfirmarEntrega'
import RecepcionTab from './components/almacen/RecepcionTab'
import DespachoTab from './components/almacen/DespachoTab'
import InventarioTab from './components/almacen/InventarioTab'
import HistorialTab from './components/almacen/HistorialTab'
import StockLevelsView from './components/almacen/StockLevelsView'
import ComprasTab from './components/almacen/ComprasTab'
import RecetasView from './components/admin/RecetasView'
import PlanillaView from './components/admin/PlanillaView'
import RRHHView from './components/admin/RRHHView'
import ProduccionDiaria from './components/admin/ProduccionDiaria'
import ConciliacionView from './components/admin/ConciliacionView'
import DeliveryView from './components/delivery/DeliveryView'
import MarketingView from './components/marketing/MarketingView'
import VentasDashboard from './components/dashboard/VentasDashboard'
import { useToast } from './hooks/useToast'
import { STORES } from './config'

function HomeScreen({ user }) {
  const storeName = STORES[user.store_code] || user.sucursal || ''
  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'

  return (
    <div style={{ padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🍔</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#e63946' }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 14, color: '#888', marginTop: 4 }}>{saludo}, {user.nombre?.split(' ')[0]}</div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{storeName} · {user.rol}</div>
      </div>

      <div className="card" style={{ borderColor: '#2d6a4f', padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#4ade80', marginBottom: 8 }}>
          💡 Navegación
        </div>
        <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6 }}>
          Usa el menú lateral (☰) para acceder a todos los módulos.
          Cada sección muestra solo los módulos disponibles para tu rol.
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: '#333', textAlign: 'center' }}>
        Freakie Dogs ERP v2.0 — Vite + React
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [screen, setScreen] = useState('home')
  const [editCierre, setEditCierre] = useState(null)
  const { show, Toast } = useToast()

  const handleLogout = useCallback(() => {
    setUser(null)
    setScreen('home')
    setEditCierre(null)
  }, [])

  const handleNavigate = useCallback((key) => {
    setScreen(key)
    setEditCierre(null)
  }, [])

  // Not logged in
  if (!user) return <LoginScreen onLogin={setUser} />

  // Render current screen content
  const renderScreen = () => {
    switch (screen) {
      case 'home':
        return <HomeScreen user={user} />

      // Caja
      case 'cierre':
        return (
          <CierreForm
            user={user}
            existingCierre={editCierre}
            onBack={() => setScreen('home')}
            onSuccess={() => { setEditCierre(null); setScreen('home'); }}
          />
        )
      case 'reporte':
        return <ReporteForm user={user} onBack={() => setScreen('home')} />
      case 'deposito':
        return <Deposito user={user} onBack={() => setScreen('home')} />

      // Dashboards
      case 'dashboard':
        return <DashboardVentas user={user} onBack={() => setScreen('home')} />
      case 'ejecutivo':
        return <DashboardEjecutivo user={user} onBack={() => setScreen('home')} />

      // Almacén
      case 'recepcion':
        return <RecepcionTab user={user} show={show} />
      case 'despacho':
        return <DespachoTab user={user} show={show} />
      case 'inventario':
        return <InventarioTab user={user} show={show} />
      case 'historial':
        return <HistorialTab user={user} show={show} />
      case 'compras':
        return <ComprasTab user={user} show={show} />
      case 'stock-levels':
        return <StockLevelsView user={user} onBack={() => setScreen('home')} />

      // Supply Chain
      case 'conteo':
        return <ConteoNocturno user={user} onBack={() => setScreen('home')} />
      case 'entregas':
        return <ConfirmarEntrega user={user} onBack={() => setScreen('home')} />

      // Admin
      case 'admin':
        return (
          <AdminView
            user={user}
            onBack={() => setScreen('home')}
            onEditCierre={(c) => { setEditCierre(c); setScreen('cierre'); }}
          />
        )
      case 'incidentes':
        return <IncidentesDash user={user} onBack={() => setScreen('home')} />
      case 'recetas':
        return <RecetasView user={user} />
      case 'planilla':
        return <PlanillaView user={user} />
      case 'rrhh':
        return <RRHHView user={user} />
      case 'produccion':
        return <ProduccionDiaria user={user} />
      case 'conciliacion':
        return <ConciliacionView user={user} />
      case 'delivery':
        return <DeliveryView user={user} />
      case 'ventas-dash':
        return <VentasDashboard user={user} onBack={() => setScreen('home')} />
      case 'marketing':
        return <MarketingView user={user} />

      default:
        return <HomeScreen user={user} />
    }
  }

  return (
    <div className="app-layout">
      <Sidebar
        user={user}
        currentScreen={screen}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />
      <div className="main-content with-sidebar">
        {renderScreen()}
      </div>
      <Toast />
    </div>
  )
}
