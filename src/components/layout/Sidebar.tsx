import { NavLink } from 'react-router-dom';
import { useSession } from '@/lib/auth';
import { APP_VERSION } from '@/lib/version';

interface NavItem {
  to: string;
  kanji: string;
  label: string;
  badge?: string;
  /** Roles permitidos. Si omitido, visible para todos los authenticated. */
  roles?: string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
  /** Si todos los items son visibles solo para ciertos roles, esconde la sección entera. */
  roles?: string[];
}

const sections: NavSection[] = [
  {
    title: 'Operación',
    items: [
      { to: '/dashboard',  kanji: '家', label: 'Dashboard' },
      { to: '/pos',        kanji: '卓', label: 'POS Mesas' },
      { to: '/cocina',     kanji: '厨', label: 'Cocina (comandas)' },
      { to: '/cierre',     kanji: '締', label: 'Cierre de Caja' },
      { to: '/inventario', kanji: '在', label: 'Inventario' },
      { to: '/recetas',    kanji: '麺', label: 'Recetas (BOM)' },
      { to: '/horarios',   kanji: '時', label: 'Horarios' }
    ]
  },
  {
    title: 'Finanzas',
    items: [
      { to: '/ventas',     kanji: '売', label: 'Ventas' },
      { to: '/bancos',     kanji: '銀', label: 'Bancos' },
      { to: '/conciliacion', kanji: '対', label: 'Conciliación' },
      { to: '/proveedores', kanji: '商', label: 'Proveedores' },
      { to: '/clientes-corporativos', kanji: '客', label: 'Clientes (CCF)', badge: 'v0.15' },
      { to: '/dtes',                 kanji: '票', label: 'DTEs' },
      { to: '/gastos-consolidados',  kanji: '損', label: 'Gastos P&L',     badge: 'v0.13' },
      { to: '/activos',              kanji: '資', label: 'Activos Fijos' }
    ]
  },
  {
    title: 'RRHH',
    items: [
      { to: '/empleados',     kanji: '人', label: 'Empleados' },
      { to: '/asistencia',    kanji: '勤', label: 'Asistencia',     badge: 'v0.11' },
      { to: '/amonestaciones', kanji: '罰', label: 'Amonestaciones', badge: 'v0.12' },
      { to: '/planilla',      kanji: '給', label: 'Planilla' },
      { to: '/propinas',      kanji: '心', label: 'Propinas' },
      { to: '/recibos',       kanji: '領', label: 'Recibos' }
    ]
  },
  {
    title: 'Socios',
    items: [
      { to: '/socios',     kanji: '株', label: 'Socios' },
      { to: '/prestamos',  kanji: '借', label: 'Préstamos' },
      { to: '/rentabilidad', kanji: '利', label: 'Rentabilidad' }
    ]
  },
  {
    // Sección personal — todos los empleados ven SUS cosas (privacidad)
    title: 'Mi cuenta',
    items: [
      { to: '/pendientes',       kanji: '待', label: 'Mis Pendientes',    badge: 'v0.10' },
      { to: '/mi-asistencia',    kanji: '勤', label: 'Mi Asistencia',     badge: 'v0.11' },
      { to: '/mi-amonestaciones', kanji: '罰', label: 'Mis Amonestaciones', badge: 'v0.12' },
      { to: '/mi-boleta',        kanji: '個', label: 'Mi Boleta' }
    ]
  },
  {
    title: 'Sistema',
    items: [
      { to: '/reportes',      kanji: '報', label: 'Reportes' },
      { to: '/inbox',         kanji: '函', label: 'Inbox',         badge: 'v0.9' },
      { to: '/configuracion', kanji: '設', label: 'Configuración', badge: 'v0.10' }
    ]
  }
];

const adminSection: NavSection = {
  title: '⚡ Super Admin',
  roles: ['super_admin'],
  items: [
    { to: '/admin/usuarios', kanji: '管', label: 'Usuarios & Roles', badge: 'admin' },
    { to: '/devops',         kanji: '守', label: 'DevOps Health',    badge: 'v0.10' }
  ]
};

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

function isVisibleFor(rol: string | null | undefined, allowed?: string[]): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!rol) return false;
  return allowed.includes(rol);
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const { session } = useSession();
  const rol = session?.rol ?? null;

  const allSections = rol === 'super_admin'
    ? [...sections, adminSection]
    : sections;

  return (
    <>
      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        {allSections.map((section) => {
          if (!isVisibleFor(rol, section.roles)) return null;
          const visibleItems = section.items.filter((i) => isVisibleFor(rol, i.roles));
          if (visibleItems.length === 0) return null;
          return (
            <div className="sidebar-section" key={section.title}>
              <div className="sidebar-section-title">{section.title}</div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={onClose}
                >
                  <span className="sidebar-item-kanji">{item.kanji}</span>
                  <span className="sidebar-item-label">{item.label}</span>
                  {item.badge && <span className="sidebar-badge">{item.badge}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="sidebar-footer">
          Kaeru Chan ERP {APP_VERSION}<br />
          Schema <span className="text-purple">kaeru</span> · 51+ tablas
        </div>
      </aside>
    </>
  );
}
