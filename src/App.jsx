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
import InventarioFisico from './components/almacen/InventarioFisico'
import ComprasTab from './components/almacen/ComprasTab'
import KardexView from './components/almacen/KardexView'
import RecetasView from './components/admin/RecetasView'
import PlanillaView from './components/admin/PlanillaView'
import RRHHView from './components/admin/RRHHView'
import RecibosDigitales from './components/rrhh/RecibosDigitales'
import ProduccionDiaria from './components/admin/ProduccionDiaria'
import ConciliacionView from './components/admin/ConciliacionView'
import DeliveryView from './components/delivery/DeliveryView'
import MarketingView from './components/marketing/MarketingView'
import IncidentesProduccion from './components/produccion/IncidentesProduccion'
import DevolucionesView from './components/produccion/DevolucionesView'
import InventarioDashboard from './components/dashboard/InventarioDashboard'
import VentasDashboard from './components/dashboard/VentasDashboard'
import MiAsistencia from './components/empleado/MiAsistencia'
import MiBoleta from './components/empleado/MiBoleta'
import HorariosView from './components/rrhh/HorariosView'
import Amonestaciones from './components/rrhh/Amonestaciones'
import PendientesView from './components/admin/PendientesView'
import DTEMapeoView from './components/admin/DTEMapeoView'
import RentabilidadView from './components/admin/RentabilidadView'
import FinanzasGastosView from './components/finanzas/FinanzasGastosView'
import FinanzasDashboard from './components/finanzas/FinanzasDashboard'
import SuperAdminView from './components/admin/SuperAdminView'
import PagosProveedorView from './components/finanzas/PagosProveedorView'
import EventosView from './components/eventos/EventosView'
import { useToast } from './hooks/useToast'
import { STORES, NAV_SECTIONS } from './config'

// ── Helpers para accesos rápidos ──
const ROLE_DEFAULTS = {
  cajero: ['cierre', 'reporte', 'deposito', 'conteo'],
  cajera: ['cierre', 'reporte', 'deposito', 'conteo'],
  gerente: ['cierre', 'reporte', 'incidentes', 'conteo', 'horarios'],
  admin: ['admin', 'ejecutivo', 'recepcion', 'despacho'],
  ejecutivo: ['ejecutivo', 'finanzas-dashboard', 'ventas-dash', 'rentabilidad', 'superadmin-panel'],
  superadmin: ['superadmin-panel', 'ejecutivo', 'finanzas-dashboard', 'admin'],
  bodeguero: ['recepcion', 'despacho', 'inventario', 'historial'],
  jefe_casa_matriz: ['recepcion', 'despacho', 'produccion', 'inventario', 'kardex'],
  cocina: ['conteo', 'reporte', 'devoluciones'],
  rrhh: ['rrhh', 'horarios', 'planilla', 'recibos-digitales'],
  contador: ['gastos', 'conciliacion', 'planilla'],
  despachador: ['entregas', 'delivery'],
  motorista: ['entregas', 'delivery'],
  domicilios: ['entregas', 'delivery'],
  marketing: ['marketing'],
  produccion: ['produccion', 'incidentes-cm', 'recetas'],
}

function getNavCounts() {
  try { return JSON.parse(localStorage.getItem('fd_nav_counts') || '{}') } catch { return {} }
}

function incrementNavCount(key) {
  const c = getNavCounts()
  c[key] = (c[key] || 0) + 1
  localStorage.setItem('fd_nav_counts', JSON.stringify(c))
}

function getNavInfo(key) {
  for (const sec of NAV_SECTIONS) {
    const item = sec.items.find(i => i.key === key)
    if (item) return item
  }
  return null
}

function HomeScreen({ user, onNavigate }) {
  const storeName = STORES[user.store_code] || user.sucursal || ''
  const hora = new Date().getHours()
  const saludo = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'

  // Obtener top accesos rápidos: frecuentes del usuario o defaults por rol
  const counts = getNavCounts()
  const sorted = Object.entries(counts)
    .filter(([k]) => k !== 'home')
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, 6)

  const defaults = ROLE_DEFAULTS[user.rol] || ROLE_DEFAULTS['cajero'] || []
  const quickLinks = sorted.length >= 3 ? sorted : defaults

  return (
    <div style={{ padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🍔</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#e63946' }}>FREAKIE DOGS</div>
        <div style={{ fontSize: 14, color: '#888', marginTop: 4 }}>{saludo}, {user.nombre?.split(' ')[0]}</div>
        <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>{storeName} · {user.rol}</div>
      </div>

      {/* Accesos Rápidos */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          {sorted.length >= 3 ? '⚡ Más Usados' : '⚡ Accesos Rápidos'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {quickLinks.map(key => {
            const info = getNavInfo(key)
            if (!info) return null
            return (
              <button
                key={key}
                onClick={() => onNavigate(key)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 6, padding: '16px 8px',
                  background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12,
                  cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onMouseOver={e => e.currentTarget.style.borderColor = '#e63946'}
                onMouseOut={e => e.currentTarget.style.borderColor = '#2a2a2a'}
              >
                <span style={{ fontSize: 24 }}>{info.icon}</span>
                <span style={{ fontSize: 12, color: '#ccc', fontWeight: 500, textAlign: 'center', lineHeight: 1.3 }}>
                  {info.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ borderColor: '#2d6a4f', padding: 16 }}>
        <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.6 }}>
          💡 Usa el menú lateral (☰) para ver todos los módulos. Los accesos rápidos se personalizan según tu uso.
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
    if (key !== 'home') incrementNavCount(key)
  }, [])

  // Not logged in
  if (!user) return <LoginScreen onLogin={setUser} />

  // Render current screen content
  const renderScreen = () => {
    switch (screen) {
      case 'home':
        return <HomeScreen user={user} onNavigate={handleNavigate} />
      case 'pendientes':
        return <PendientesView user={user} onNavigate={handleNavigate} />
      case 'mi-asistencia':
        return <MiAsistencia user={user} />
      case 'mi-boleta':
        return <MiBoleta user={user} />

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
      case 'inventario-fisico':
        return <InventarioFisico user={user} onBack={() => setScreen('home')} />
      case 'kardex':
        return <KardexView user={user} show={show} />

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
      case 'recibos-digitales':
        return <RecibosDigitales user={user} onBack={() => setScreen('home')} />
      case 'rrhh':
        return <RRHHView user={user} />
      case 'horarios':
        return <HorariosView user={user} />
      case 'amonestaciones':
        return <Amonestaciones user={user} onBack={() => setScreen('home')} />
      case 'produccion':
        return <ProduccionDiaria user={user} />
      case 'incidentes-cm':
        return <IncidentesProduccion user={user} />
      case 'devoluciones':
        return <DevolucionesView user={user} />
      case 'conciliacion':
        return <ConciliacionView user={user} />
      case 'dte-mapeo':
        return <DTEMapeoView user={user} />
      case 'rentabilidad':
        return <RentabilidadView user={user} />
      case 'gastos':
        return <FinanzasGastosView user={user} />
      case 'finanzas-dashboard':
        return <FinanzasDashboard user={user} />
      case 'pagos-proveedor':
        return <PagosProveedorView user={user} />
      case 'eventos':
        return <EventosView user={user} />
      case 'delivery':
        return <DeliveryView user={user} />
      case 'ventas-dash':
        return <VentasDashboard user={user} onBack={() => setScreen('home')} />
      case 'inventario-dash':
        return <InventarioDashboard user={user} onBack={() => setScreen('home')} />
      case 'marketing':
        return <MarketingView user={user} />
      case 'superadmin-panel':
        return <SuperAdminView user={user} />

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
