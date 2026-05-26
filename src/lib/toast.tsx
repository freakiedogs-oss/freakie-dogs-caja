import {
  createContext, useCallback, useContext, useState, ReactNode, useEffect
} from 'react';

// ============================================================
// useToast — sistema de feedback in-app (reemplazo de alert())
// ------------------------------------------------------------
// Uso:
//   const toast = useToast();
//   toast.success('Recibo enviado ✓');
//   toast.error('No se pudo cobrar');
//   toast.info('Procesando…');
//   toast.warning('Stock bajo en 3 ingredientes');
//
// Auto-dismiss después de 4s (configurable por tipo).
// Stack vertical en esquina inferior-derecha, soporta múltiples.
// Tap en el toast lo cierra anticipadamente.
// ============================================================

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  variant: ToastVariant;
  message: string;
  ttlMs: number;
}

interface ToastApi {
  success: (msg: string, ttlMs?: number) => void;
  error:   (msg: string, ttlMs?: number) => void;
  info:    (msg: string, ttlMs?: number) => void;
  warning: (msg: string, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

const DEFAULT_TTL: Record<ToastVariant, number> = {
  success: 3500,
  info:    3500,
  warning: 5000,
  error:   6000,
};

const ToastCtx = createContext<ToastApi | null>(null);

let _nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((variant: ToastVariant, message: string, ttlMs?: number) => {
    const id = _nextId++;
    setItems((xs) => [...xs, { id, variant, message, ttlMs: ttlMs ?? DEFAULT_TTL[variant] }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((t) => t.id !== id));
  }, []);

  const api: ToastApi = {
    success: (m, t) => push('success', m, t),
    error:   (m, t) => push('error',   m, t),
    info:    (m, t) => push('info',    m, t),
    warning: (m, t) => push('warning', m, t),
    dismiss,
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastStack items={items} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) {
    // Fallback silencioso si alguien lo usa fuera del Provider (no debería pasar)
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('useToast() usado fuera de <ToastProvider>. Mensajes irán a console.');
    }
    return {
      success: (m) => console.log('[toast.success]', m),
      error:   (m) => console.error('[toast.error]', m),
      info:    (m) => console.log('[toast.info]', m),
      warning: (m) => console.warn('[toast.warning]', m),
      dismiss: () => {},
    };
  }
  return ctx;
}

// ============================================================
// UI
// ============================================================
const VARIANT_STYLE: Record<ToastVariant, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(95,224,169,0.12)', border: 'var(--accent-kaeru)',         icon: '✓' },
  error:   { bg: 'rgba(231,76,60,0.12)',  border: 'var(--state-danger,#e74c3c)', icon: '✕' },
  info:    { bg: 'rgba(154,111,209,0.12)', border: 'var(--accent-purple)',       icon: 'ℹ' },
  warning: { bg: 'rgba(245,180,0,0.12)',   border: '#f5b400',                    icon: '⚠' },
};

function ToastStack({ items, onDismiss }: { items: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 32px)'
      }}
    >
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const style = VARIANT_STYLE[toast.variant];

  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), toast.ttlMs);
    return () => clearTimeout(t);
  }, [toast.id, toast.ttlMs, onDismiss]);

  return (
    <div
      onClick={() => onDismiss(toast.id)}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        background: 'var(--bg-elevated, var(--bg-card))',
        backgroundColor: style.bg,
        border: `1px solid ${style.border}`,
        borderLeft: `4px solid ${style.border}`,
        borderRadius: 'var(--r-md, 8px)',
        padding: '10px 14px',
        color: 'var(--text-primary)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        minWidth: 240,
        maxWidth: 380,
        fontSize: 13,
        lineHeight: 1.4,
        animation: 'kaeru-toast-in 0.18s ease-out',
      }}
    >
      <span style={{ color: style.border, fontWeight: 800, fontSize: 16, lineHeight: 1, marginTop: 2 }}>
        {style.icon}
      </span>
      <span style={{ flex: 1 }}>{toast.message}</span>
    </div>
  );
}
