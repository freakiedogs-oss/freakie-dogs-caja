import { useState, useEffect } from 'react'
import { NAV_SECTIONS, STORES } from '../../config'

export default function Sidebar({ user, currentScreen, onNavigate, onLogout }) {
  const [open, setOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  const hasAccess = (roles) => {
    if (roles.includes('*')) return true
    return roles.includes(user.rol)
  }

  const handleNav = (key) => {
    onNavigate(key)
    if (isMobile) setOpen(false)
  }

  const storeName = STORES[user.store_code] || user.sucursal || ''
  const initials = (user.nombre || '??').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  // Get current screen label for topbar
  const currentLabel = NAV_SECTIONS
    .flatMap(s => s.items)
    .find(i => i.key === currentScreen)?.label || 'Inicio'

  return (
    <>
      {/* Topbar (mobile) */}
      <div className="topbar">
        <button className="hamburger" onClick={() => setOpen(true)}>☰</button>
        <span className="topbar-title">{currentLabel}</span>
        <span className="topbar-store">{storeName}</span>
      </div>

      {/* Overlay (mobile) */}
      {isMobile && open && (
        <div className="sidebar-overlay" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar */}
      <nav className={`sidebar ${open || !isMobile ? 'open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-icon">🍔</span>
            <div>
              <div className="sidebar-brand-text">FREAKIE DOGS</div>
              <div className="sidebar-brand-sub">ERP v2.0</div>
            </div>
          </div>
          {isMobile && (
            <button className="sidebar-close" onClick={() => setOpen(false)}>✕</button>
          )}
        </div>

        {/* Navigation sections */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
          {NAV_SECTIONS.map((section) => {
            const visibleItems = section.items.filter(i => hasAccess(i.roles))
            if (visibleItems.length === 0) return null
            return (
              <div key={section.label} className="sidebar-section">
                <div className="sidebar-section-label">{section.label}</div>
                {visibleItems.map((item) => (
                  <button
                    key={item.key}
                    className={`sidebar-item ${currentScreen === item.key ? 'active' : ''}`}
                    onClick={() => handleNav(item.key)}
                  >
                    <span className="sidebar-item-icon">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            )
          })}
        </div>

        {/* User info */}
        <div className="sidebar-user">
          <div className="sidebar-user-info">
            <div className="sidebar-user-avatar">{initials}</div>
            <div>
              <div className="sidebar-user-name">{user.nombre}</div>
              <div className="sidebar-user-role">{user.rol} · {storeName}</div>
            </div>
          </div>
          <button className="sidebar-logout" onClick={onLogout} title="Cerrar sesión">⏻</button>
        </div>
      </nav>
    </>
  )
}
