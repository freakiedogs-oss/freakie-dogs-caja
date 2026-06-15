import { useState, useCallback, lazy, Suspense } from 'react'
import Sidebar from './components/layout/Sidebar'
import LoginScreen from './components/layout/LoginScreen'
import AsistenteFlotante from './components/dashboard/AsistenteFlotante'
import InboxFlotante from './components/dashboard/InboxFlotante'
import LoadingScreen from './components/layout/LoadingScreen'
import { useToast } from './hooks/useToast'
import { STORES, NAV_SECTIONS } from './config'

// ── Lazy imports — cada ruta carga su chunk sólo cuando se navega ──
const CierreForm         = lazy(() => import('./components/caja/CierreForm'))
const ReporteForm        = lazy(() => import('./components/caja/ReporteForm'))
const Deposito           = lazy(() => import('./components/caja/Deposito'))
const AdminView          = lazy(() => import('./components/admin/AdminView'))
const IncidentesDash     = lazy(() => import('./components/admin/IncidentesDash'))
const KpisVentaDashboard = lazy(() => import('./components/dashboard/KpisVentaDashboard'))
const ConteoNocturno     = lazy(() => import('./components/supply-chain/ConteoNocturno'))
const ConfirmarEntrega   = lazy(() => import('./components/supply-chain/ConfirmarEntrega'))
const MisPedidosView     = lazy(() => import('./components/supply-chain/MisPedidosView'))
const RecepcionTab       = lazy(() => import('./components/almacen/RecepcionTab'))
const DespachoTab        = lazy(() => import('./components/almacen/DespachoTab'))
const InventarioTab      = lazy(() => import('./components/almacen/InventarioTab'))
const HistorialTab       = lazy(() => import('./components/almacen/HistorialTab'))
const StockLevelsView    = lazy(() => import('./components/almacen/StockLevelsView'))
const InventarioFisico   = lazy(() => import('./components/almacen/InventarioFisico'))
const ComprasTab         = lazy(() => import('./components/almacen/ComprasTab'))
const KardexView         = lazy(() => import('./components/almacen/KardexView'))
const RecepcionBeesView  = lazy(() => import('./components/almacen/RecepcionBeesView'))
const RecetasView        = lazy(() => import('./components/admin/RecetasView'))
const PlanillaView       = lazy(() => import('./components/admin/PlanillaView'))
const RRHHView           = lazy(() => import('./components/admin/RRHHView'))
const RecibosDigitales   = lazy(() => import('./components/rrhh/RecibosDigitales'))
const ProduccionDiaria   = lazy(() => import('./components/admin/ProduccionDiaria'))
const ConciliacionView   = lazy(() => import('./components/admin/ConciliacionView'))
const DeliveryView       = lazy(() => import('./components/delivery/DeliveryView'))
const MarketingView      = lazy(() => import('./components/marketing/MarketingView'))
const IncidentesProduccion = lazy(() => import('./components/produccion/IncidentesProduccion'))
const DevolucionesView   = lazy(() => import('./components/produccion/DevolucionesView'))
const InventarioDashboard = lazy(() => import('./components/dashboard/InventarioDashboard'))
const MiAsistencia       = lazy(() => import('./components/empleado/MiAsistencia'))
const MiBoleta           = lazy(() => import('./components/empleado/MiBoleta'))
const HorariosView       = lazy(() => import('./components/rrhh/HorariosView'))
const Amonestaciones     = lazy(() => import('./components/rrhh/Amonestaciones'))
const PropinasView       = lazy(() => import('./components/rrhh/PropinasView'))
const PendientesView     = lazy(() => import('./components/admin/PendientesView'))
const DTEMapeoView       = lazy(() => import('./components/admin/DTEMapeoView'))
const RentabilidadView   = lazy(() => import('./components/admin/RentabilidadView'))
const FinanzasGastosView = lazy(() => import('./components/finanzas/FinanzasGastosView'))
const FinanzasDashboard  = lazy(() => import('./components/finanzas/FinanzasDashboard'))
const BancoView          = lazy(() => import('./components/finanzas/BancoView'))
const SuperAdminView     = lazy(() => import('./components/admin/SuperAdminView'))
const PlanMaestroView    = lazy(() => import('./components/dashboard/PlanMaestroView'))
const FinanzasAIView     = lazy(() => import('./components/dashboard/FinanzasAIView'))
const QuantoUploadView   = lazy(() => import('./components/admin/QuantoUploadView'))
const PagosProveedorView = lazy(() => import('./components/finanzas/PagosProveedorView'))
const DTEsView           = lazy(() => import('./components/finanzas/DTEsView'))
const EventosView        = lazy(() => import('./components/eventos/EventosView'))
const MiDespacho            = lazy(() => import('./components/empleado/MiDespacho'))
const DespachoOperativoView = lazy(() => import('./components/admin/DespachoOperativoView'))
const DespachoKpiDashboard  = lazy(() => import('./components/admin/DespachoKpiDashboard'))
const DeliveryKpiDashboard  = lazy(() => import('./components/admin/DeliveryKpiDashboard'))
const KpiVentasTotalesDashboard = lazy(() => import('./components/admin/KpiVentasTotalesDashboard'))
const SimuladorRentabilidad = lazy(() => import('./components/admin/SimuladorRentabilidad'))

// ── Helpers para accesos rápidos ──
const ROLE_DEFAULTS = {
  cajero: ['cierre', 'reporte', 'deposito', 'conteo'],
  cajera: ['cierre', 'reporte', 'deposito', 'conteo'],
  gerente: ['cierre', 'reporte', 'incidentes', 'conteo', 'horarios', 'kpis-venta'],
  admin: ['admin', 'kpis-venta', 'recepcion', 'despacho'],
  ejecutivo: ['kpis-venta', 'finanzas-dashboard', 'rentabilidad', 'superadmin-panel'],
  superadmin: ['superadmin-panel', 'kpi-delivery', 'kpi-despacho', 'kpis-venta', 'kpi-ventas-totales', 'finanzas-dashboard', 'admin'],
  bodeguero: ['recepcion', 'despacho', 'inventario', 'historial'],
  jefe_casa_matriz: ['despacho-operativo', 'recepcion', 'despacho', 'produccion', 'inventario', 'kardex'],
  cocina: ['conteo', 'reporte', 'devoluciones'],
  rrhh: ['rrhh', 'horarios', 'planilla', 'recibos-digitales'],
  contador: ['gastos', 'conciliacion', 'planilla'],
  despachador: ['mi-despacho', 'entregas', 'delivery'],
  motorista: ['mi-despacho', 'entregas', 'delivery'],
  domicilios: ['entregas', 'delivery'],
  marketing: ['marketing'],
  produccion: ['despacho-operativo', 'produccion', 'incidentes-cm', 'recetas'],
  eventos: ['eventos', 'mi-asistencia', 'mi-boleta'],
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

  // Módulos permitidos para este rol (según NAV_SECTIONS)
  const allowedKeys = new Set()
  for (const sec of NAV_SECTIONS) {
    for (const item of sec.items) {
      if (!item.roles || item.roles.includes(user.rol)) allowedKeys.add(item.key)
    }
  }

  // Obtener top accesos rápidos: frecuentes del usuario o defaults por rol
  const counts = getNavCounts()
  const sorted = Object.entries(counts)
    .filter(([k]) => k !== 'home' && allowedKeys.has(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .slice(0, 6)

  const defaults = (ROLE_DEFAULTS[user.rol] || ROLE_DEFAULTS['cajero'] || []).filter(k => allowedKeys.has(k))
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
        Freakie Dogs ERP v2.3 — Vite + React
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
      case 'kpis-venta':
        return <KpisVentaDashboard user={user} onBack={() => setScreen('home')} />

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
      case 'recepcion-bees':
        return <RecepcionBeesView user={user} show={show} />

      // Supply Chain
      case 'conteo':
        return <ConteoNocturno user={user} onBack={() => setScreen('home')} />
      case 'entregas':
        return <ConfirmarEntrega user={user} onBack={() => setScreen('home')} />
      case 'mis-pedidos':
        return <MisPedidosView user={user} onBack={() => setScreen('home')} />

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
      case 'propinas':
        return <PropinasView user={user} />
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
      case 'finanzas-ai':
        return <FinanzasAIView user={user} />
      case 'banco':
        return <BancoView user={user} />
      case 'pagos-proveedor':
        return <PagosProveedorView user={user} />
      case 'dtes':
        return <DTEsView user={user} />
      case 'eventos':
        return <EventosView user={user} />

      // KPI Despacho a Motoristas
      case 'mi-despacho':
        return <MiDespacho user={user} />
      case 'despacho-operativo':
        return <DespachoOperativoView user={user} />
      case 'kpi-despacho':
        return <DespachoKpiDashboard user={user} />
      case 'kpi-delivery':
        return <DeliveryKpiDashboard user={user} />
      case 'kpi-ventas-totales':
        return <KpiVentasTotalesDashboard user={user} />
      case 'simulador-rentabilidad':
        return <SimuladorRentabilidad user={user} />
      case 'delivery':
        return <DeliveryView user={user} />
      case 'inventario-dash':
        return <InventarioDashboard user={user} onBack={() => setScreen('home')} />
      case 'marketing':
        return <MarketingView user={user} />
      case 'superadmin-panel':
        return <SuperAdminView user={user} />
      case 'plan-maestro':
        return <PlanMaestroView user={user} />
      case 'quanto-upload':
        return <QuantoUploadView user={user} />

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
        <Suspense fallback={<LoadingScreen />}>
          {renderScreen()}
        </Suspense>
      </div>
      <Toast />
      <AsistenteFlotante user={user} />
      <InboxFlotante user={user} />
    </div>
  )
}
