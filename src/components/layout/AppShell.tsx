import { useState, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

const bottomNavItems = [
  { to: '/dashboard',  kanji: '家', label: 'Dashboard' },
  { to: '/cierre',     kanji: '締', label: 'Cierre' },
  { to: '/inventario', kanji: '在', label: 'Inventario' },
  { to: '/planilla',   kanji: '給', label: 'Planilla' },
  { to: '/reportes',   kanji: '報', label: 'Reportes' }
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <TopBar onMenuClick={() => setSidebarOpen(true)} />
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
      <nav className="bottomnav">
        <ul>
          {bottomNavItems.map((it) => (
            <li key={it.to}>
              <NavLink to={it.to} className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="bottomnav-kanji">{it.kanji}</span>
                <span className="bottomnav-label">{it.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
