import { Routes, Route, Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import AppShell from '@/components/layout/AppShell';
import AuthGuard from '@/components/auth/AuthGuard';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import POS from '@/pages/POS';
import POSMesa from '@/pages/POSMesa';
import Cocina from '@/pages/Cocina';
import Planilla from '@/pages/Planilla';
import Propinas from '@/pages/Propinas';
import Rentabilidad from '@/pages/Rentabilidad';
import Horarios from '@/pages/Horarios';
import DTEs from '@/pages/DTEs';
import Ventas from '@/pages/Ventas';
import Empleados from '@/pages/Empleados';
import Proveedores from '@/pages/Proveedores';
import Socios from '@/pages/Socios';
import ActivosFijos from '@/pages/ActivosFijos';
import Bancos from '@/pages/Bancos';
import Inventario from '@/pages/Inventario';
import Recetas from '@/pages/Recetas';
import Prestamos from '@/pages/Prestamos';
import Conciliacion from '@/pages/Conciliacion';
import AdminUsuarios from '@/pages/AdminUsuarios';
import Cierre from '@/pages/Cierre';
import Reportes from '@/pages/Reportes';
import Inbox from '@/pages/Inbox';
import Configuracion from '@/pages/Configuracion';
import Recibos from '@/pages/Recibos';
import MiBoleta from '@/pages/MiBoleta';
import DevOps from '@/pages/DevOps';
import Pendientes from '@/pages/Pendientes';
import Asistencia from '@/pages/Asistencia';
import MiAsistencia from '@/pages/MiAsistencia';
import Amonestaciones from '@/pages/Amonestaciones';
import MiAmonestaciones from '@/pages/MiAmonestaciones';
import GastosConsolidados from '@/pages/GastosConsolidados';
import ClientesCorporativos from '@/pages/ClientesCorporativos';
import { procesarQueryKiosko } from '@/lib/kiosko';

// Procesar ?kiosko=on|off al cargar (efecto colateral una sola vez)
procesarQueryKiosko();

// Helper para envolver todas las rutas con AuthGuard + AppShell
const G = (children: ReactNode) => (
  <AuthGuard>
    <AppShell>{children}</AppShell>
  </AuthGuard>
);

export default function App() {
  return (
    <Routes>
      {/* Públicas */}
      <Route path="/login" element={<Login />} />

      {/* POS — con Auth, sin AppShell (UI dedicada full-screen) */}
      <Route path="/pos" element={<AuthGuard><POS /></AuthGuard>} />
      <Route path="/pos/mesa/:codigo" element={<AuthGuard><POSMesa /></AuthGuard>} />

      {/* Cocina — con Auth, sin AppShell (full-screen para tablet en cocina) */}
      <Route path="/cocina" element={<AuthGuard><Cocina /></AuthGuard>} />

      {/* Resto del ERP */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard"     element={G(<Dashboard />)} />

      <Route path="/cierre"        element={G(<Cierre />)} />

      <Route path="/inventario"    element={G(<Inventario />)} />
      <Route path="/recetas"       element={G(<Recetas />)} />

      <Route path="/horarios"      element={G(<Horarios />)} />

      <Route path="/ventas"        element={G(<Ventas />)} />
      <Route path="/bancos"        element={G(<Bancos />)} />
      <Route path="/conciliacion"  element={G(<Conciliacion />)} />
      <Route path="/proveedores"   element={G(<Proveedores />)} />
      <Route path="/clientes-corporativos" element={G(<ClientesCorporativos />)} />

      <Route path="/dtes"          element={G(<DTEs />)} />

      <Route path="/activos"       element={G(<ActivosFijos />)} />
      <Route path="/empleados"     element={G(<Empleados />)} />

      <Route path="/planilla"      element={G(<Planilla />)} />

      <Route path="/propinas"      element={G(<Propinas />)} />

      <Route path="/recibos"       element={G(<Recibos />)} />
      <Route path="/mi-boleta"     element={G(<MiBoleta />)} />

      <Route path="/socios"        element={G(<Socios />)} />
      <Route path="/prestamos"     element={G(<Prestamos />)} />

      <Route path="/rentabilidad"  element={G(<Rentabilidad />)} />

      <Route path="/reportes"      element={G(<Reportes />)} />
      <Route path="/inbox"         element={G(<Inbox />)} />
      <Route path="/pendientes"    element={G(<Pendientes />)} />
      <Route path="/asistencia"    element={G(<Asistencia />)} />
      <Route path="/mi-asistencia" element={G(<MiAsistencia />)} />
      <Route path="/amonestaciones"    element={G(<Amonestaciones />)} />
      <Route path="/mi-amonestaciones"   element={G(<MiAmonestaciones />)} />
      <Route path="/gastos-consolidados" element={G(<GastosConsolidados />)} />

      <Route path="/configuracion" element={G(<Configuracion />)} />
      <Route path="/devops"        element={G(<DevOps />)} />

      {/* Super Admin */}
      <Route path="/admin/usuarios" element={G(<AdminUsuarios />)} />

      {/* Fallback */}
      <Route path="*" element={G(<div className="card"><h2>404 · Página no encontrada</h2></div>)} />
    </Routes>
  );
}
