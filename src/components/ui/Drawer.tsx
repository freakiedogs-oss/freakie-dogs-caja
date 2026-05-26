import { ReactNode, useEffect } from 'react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function Drawer({ open, onClose, title, children }: DrawerProps) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.65)',
          zIndex: 100,
          backdropFilter: 'blur(2px)'
        }}
      />
      <aside
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 'min(480px, 100vw)',
          background: 'var(--bg-card)',
          borderLeft: '1px solid var(--border-default)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-elevated)'
        }}
      >
        <header style={{ padding: 16, borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Cerrar">✕</button>
        </header>
        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </aside>
    </>
  );
}
