import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession, signOut } from '@/lib/auth';
import { useUnreadInbox } from '@/hooks/useUnreadInbox';

interface TopBarProps {
  onMenuClick: () => void;
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const [hora, setHora] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const { session } = useSession();
  const unread = useUnreadInbox();

  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const initials = session?.nombre_display
    ? session.nombre_display.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()
    : 'KA';

  return (
    <header className="topbar">
      <div className="row">
        <button className="topbar-mobile-toggle" onClick={onMenuClick} aria-label="Menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="topbar-brand">
          <span className="topbar-brand-kanji">蛙</span>
          <div>
            <div className="topbar-brand-name">Kaeru Chan</div>
            <div className="topbar-brand-sub">EPIC Plaza · Nivel 2</div>
          </div>
        </div>
      </div>
      <div className="topbar-right">
        <Link
          to="/inbox"
          className="row"
          title={`${unread.total} sin leer (${unread.danger} críticas, ${unread.warning} atención)`}
          style={{
            position: 'relative',
            padding: '6px 10px',
            borderRadius: 'var(--r-md)',
            color: unread.total > 0 ? 'var(--accent-purple)' : 'var(--text-muted)',
            background: unread.danger > 0 ? 'rgba(231,76,60,0.10)' : unread.total > 0 ? 'rgba(154,111,209,0.10)' : 'transparent',
            textDecoration: 'none',
            gap: 4
          }}
        >
          <span style={{ fontFamily: 'var(--font-kanji)', fontSize: 14 }}>函</span>
          {unread.total > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-metric)',
                fontSize: 11,
                fontWeight: 800,
                background: unread.danger > 0 ? 'var(--state-danger, #e74c3c)' : 'var(--accent-purple)',
                color: 'var(--bg-base)',
                padding: '1px 6px',
                borderRadius: 999,
                minWidth: 18,
                textAlign: 'center',
                lineHeight: 1.4
              }}
            >
              {unread.total > 99 ? '99+' : unread.total}
            </span>
          )}
        </Link>
        <div className="topbar-clock">
          San Salvador {hora.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </div>
        <div style={{ position: 'relative' }}>
          <button
            className="topbar-user"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ border: 'none', cursor: 'pointer' }}
          >
            <span className="topbar-user-avatar">{initials}</span>
            <span style={{ fontSize: 12 }}>{session?.nombre_display ?? 'Sin sesión'}</span>
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--r-md)',
                padding: 12,
                minWidth: 220,
                zIndex: 51,
                boxShadow: 'var(--shadow-elevated)'
              }}>
                <div className="text-muted" style={{ fontSize: 11, padding: '4px 0' }}>{session?.email}</div>
                {session?.rol && (
                  <div style={{ padding: '4px 0' }}>
                    <span className="badge badge-purple">{session.rol}</span>
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '8px 0' }} />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    await signOut();
                    window.location.href = '/login';
                  }}
                  style={{ width: '100%', justifyContent: 'flex-start' }}
                >
                  ⎋ Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
