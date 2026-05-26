import { useState, useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession, signOut } from '@/lib/auth';
import { kaeru } from '@/lib/supabase';
import { APP_VERSION, CANONICAL_HOSTS } from '@/lib/version';
import {
  isKioskoMode,
  leerCredencialesKiosko,
  guardarCredencialesKiosko
} from '@/lib/kiosko';

// ============================================================
// Login resiliente — patrón portado de Freakies LoginScreen.jsx
// ------------------------------------------------------------
// Features de robustez:
//   1. Health check Supabase al cargar (3 capas: SDK + fetch directo + proxy)
//   2. Detección online/offline en vivo
//   3. Warning URL no canónica (preview Vercel o link viejo)
//   4. Botón "Limpiar caché y reintentar" (desregistra SW + borra cachés)
//   5. Panel diagnóstico expandible tocando el footer
//   6. APP_VERSION + host visibles siempre
//   7. PWA install prompt (también vía window.__installPWA si existe)
//   8. Instrucciones iOS
//   9. AbortController para cancelar requests viejos del login
//  +10. Auto-login persistente en modo kiosko (preexistente Kaeru)
// ============================================================

const PIN_LOGIN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/kaeru-pin-login`;
const SUPA_URL      = import.meta.env.VITE_SUPABASE_URL as string;
const SUPA_ANON     = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface DiagState {
  status: null | 'ok' | 'fail';
  detail: string;
}

export default function Login() {
  const { session, loading } = useSession();
  const location = useLocation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoAttempted, setAutoAttempted] = useState(false);

  // Health / diag state
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [healthSdk, setHealthSdk]       = useState<DiagState>({ status: null, detail: '' });
  const [healthFetch, setHealthFetch]   = useState<DiagState>({ status: null, detail: '' });
  const [showDiag, setShowDiag] = useState(false);

  // PWA install
  const [canInstall, setCanInstall] = useState<boolean>(
    typeof window !== 'undefined' && Boolean((window as any).__pwaReady)
  );

  const kiosko = isKioskoMode();
  const autoLoginRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ─── Online / offline live ──────────────────────────────
  useEffect(() => {
    const onOnline  = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ─── Health check Supabase ──────────────────────────────
  useEffect(() => {
    let cancel = false;
    (async () => {
      // 1. Vía SDK
      try {
        const { error: err } = await kaeru.from('user_roles').select('email').limit(1);
        if (cancel) return;
        if (err) {
          setHealthSdk({ status: 'fail', detail: `${err.code || ''} ${err.message || String(err)}`.trim() });
        } else {
          setHealthSdk({ status: 'ok', detail: 'SDK OK' });
        }
      } catch (e: any) {
        if (cancel) return;
        setHealthSdk({ status: 'fail', detail: `EXC: ${e?.message || String(e)}` });
      }

      // 2. Fetch directo (detecta bloqueos DNS / network)
      try {
        const r = await fetch(
          `${SUPA_URL}/rest/v1/user_roles?select=email&limit=1`,
          { headers: { apikey: SUPA_ANON, Authorization: `Bearer ${SUPA_ANON}`, 'Accept-Profile': 'kaeru' } }
        );
        if (cancel) return;
        if (r.ok) {
          setHealthFetch({ status: 'ok', detail: `${r.status} OK` });
        } else {
          const txt = await r.text().catch(() => '');
          setHealthFetch({ status: 'fail', detail: `${r.status} ${r.statusText} ${txt.slice(0, 80)}` });
        }
      } catch (e: any) {
        if (cancel) return;
        setHealthFetch({ status: 'fail', detail: `FAIL: ${e?.message || String(e)}` });
      }
    })();
    return () => { cancel = true; };
  }, []);

  // ─── PWA install prompt available ───────────────────────
  useEffect(() => {
    const on  = () => setCanInstall(true);
    const off = () => setCanInstall(false);
    window.addEventListener('pwaready',     on);
    window.addEventListener('pwainstalled', off);
    return () => {
      window.removeEventListener('pwaready',     on);
      window.removeEventListener('pwainstalled', off);
    };
  }, []);

  // ─── Auto-login en modo kiosko ──────────────────────────
  useEffect(() => {
    if (loading || session || autoLoginRef.current) return;
    if (!kiosko) return;
    const creds = leerCredencialesKiosko();
    if (!creds) return;
    autoLoginRef.current = true;
    setAutoAttempted(true);
    (async () => {
      try {
        const { error: signErr } = await kaeru.auth.signInWithPassword({
          email: creds.email,
          password: creds.pin
        });
        if (signErr) {
          console.warn('[login] auto-login falló:', signErr.message);
        }
      } catch (e: any) {
        console.warn('[login] auto-login error:', e?.message);
      }
    })();
  }, [loading, session, kiosko]);

  // ─── Auto-submit al completar 6 dígitos ─────────────────
  useEffect(() => {
    if (pin.length === 6 && !submitting) {
      handleSubmit(pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // ─── Teclado físico ──────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9' && pin.length < 6) {
        setPin((p) => p + e.key);
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
        setError(null);
      } else if (e.key === 'Escape') {
        setPin('');
        setError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pin]);

  // ─── Estados pre-render ─────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-base)' }}>
        <div className="text-muted">● Verificando sesión…</div>
      </div>
    );
  }

  if (session?.rol) {
    let defaultDest = '/dashboard';
    if (kiosko) {
      if (session.rol === 'mesero')        defaultDest = '/pos';
      else if (session.rol === 'cocinero') defaultDest = '/cocina';
    }
    const from = (location.state as any)?.from?.pathname || defaultDest;
    return <Navigate to={from} replace />;
  }

  if (session && !session.rol) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-base)', padding: 16 }}>
        <div className="card" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <span className="page-title-kanji" style={{ fontSize: 48, color: 'var(--state-danger)' }}>蛙</span>
          <h2 style={{ margin: '12px 0' }}>Acceso restringido</h2>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>
            La cuenta <strong>{session.email}</strong> no está en la whitelist.<br />
            Contactá a Jose para que te agregue.
          </p>
          <button className="btn btn-outline" onClick={() => signOut().then(() => window.location.reload())}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // ─── Login submit con AbortController ───────────────────
  async function handleSubmit(currentPin: string) {
    if (!online) {
      setError('Sin conexión a internet. Revisá WiFi/datos móviles.');
      setPin('');
      return;
    }
    setError(null);
    setSubmitting(true);

    // Abortar request anterior si quedó viva
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {/* noop */}
    }
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const resp = await fetch(PIN_LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: currentPin }),
        signal: ac.signal
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: 'PIN inválido' }));
        setError(body.error || 'PIN inválido');
        setPin('');
        setSubmitting(false);
        return;
      }

      const { email } = await resp.json();

      const { error: signErr } = await kaeru.auth.signInWithPassword({
        email,
        password: currentPin
      });

      if (signErr) {
        setError('PIN incorrecto');
        setPin('');
        setSubmitting(false);
        return;
      }

      guardarCredencialesKiosko(email, currentPin);
      // Éxito → useSession detecta el cambio y AuthGuard redirige
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(String(e?.message || 'Error de conexión'));
      setPin('');
      setSubmitting(false);
    }
  }

  const tap = (n: string) => {
    if (pin.length < 6 && !submitting) {
      setPin((p) => p + n);
      setError(null);
    }
  };
  const clearLast = () => { setPin((p) => p.slice(0, -1)); setError(null); };
  const clearAll  = () => { setPin(''); setError(null); };

  // ─── Limpieza de caché para usuarios atascados ──────────
  async function clearCacheAndReload() {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {/* ignore */}
    window.location.href = window.location.pathname + '?_r=' + Date.now();
  }

  function installPwa() {
    const fn = (window as any).__installPWA;
    if (typeof fn === 'function') fn();
  }

  // ─── Status calculados ──────────────────────────────────
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isCanonical =
    CANONICAL_HOSTS.includes(host) || host === 'localhost' || host === '127.0.0.1';
  const canonicalUrl = `https://${CANONICAL_HOSTS[0]}`;

  const overallOk = online && healthSdk.status === 'ok';
  const statusDot =
    !online ? '🔴' :
    healthSdk.status === 'fail' ? '🔴' :
    healthSdk.status === null ? '🟡' : '🟢';
  const statusText =
    !online ? 'Sin internet' :
    healthSdk.status === 'fail' ? 'Servidor no responde' :
    healthSdk.status === null ? 'Verificando…' : 'Conectado';

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-base)', padding: 20, paddingBottom: 56 }}>
      <div style={{ maxWidth: 380, width: '100%' }}>

        {/* ⚠ Warning URL no canónica */}
        {!isCanonical && (
          <div style={{
            background: 'rgba(245,180,0,0.10)',
            border: '1px solid #f5b400',
            color: '#fde68a',
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 12,
            lineHeight: 1.5,
            marginBottom: 16,
            textAlign: 'center'
          }}>
            ⚠ <b>Estás en un enlace antiguo</b>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85, wordBreak: 'break-all' }}>{host}</div>
            <a href={canonicalUrl} style={{
              color: 'var(--accent-kaeru)',
              display: 'inline-block',
              marginTop: 6,
              fontWeight: 700,
              textDecoration: 'underline'
            }}>
              Ir al enlace oficial →
            </a>
          </div>
        )}

        {/* 🔴 Warning offline / servidor caído */}
        {(!online || healthSdk.status === 'fail') && (
          <div style={{
            background: 'rgba(231,76,60,0.10)',
            border: '1px solid var(--state-danger,#e74c3c)',
            color: '#fecaca',
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            fontSize: 12,
            marginBottom: 16,
            textAlign: 'center'
          }}>
            {!online ? '📡 Sin conexión a internet' : '🔌 El servidor no responde'}
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
              {!online ? 'Revisá WiFi o datos móviles.' : 'Intentá en unos segundos o limpiá la caché.'}
            </div>
          </div>
        )}

        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <span className="page-title-kanji" style={{ fontSize: 56, color: 'var(--accent-kaeru)' }}>蛙</span>
          <h1 style={{ marginTop: 8, fontSize: 22 }}>Kaeru Chan ERP</h1>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Ingresá tu PIN de 6 dígitos</p>
        </div>

        {/* PIN dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 20 }}>
          {Array.from({ length: 6 }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <div key={i} style={{
                width: 16, height: 16, borderRadius: '50%',
                background: filled ? 'var(--accent-kaeru)' : 'transparent',
                border: `2px solid ${filled ? 'var(--accent-kaeru)' : 'var(--border-default)'}`,
                transition: 'all 0.15s',
                transform: filled ? 'scale(1.1)' : 'scale(1)'
              }} />
            );
          })}
        </div>

        {/* Status zone */}
        <div style={{ minHeight: 28, textAlign: 'center', marginBottom: 12 }}>
          {submitting && <span className="text-muted" style={{ fontSize: 12 }}>● Verificando…</span>}
          {error && <span className="text-danger" style={{ fontSize: 12 }}>{error}</span>}
        </div>

        {/* Keypad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {['1','2','3','4','5','6','7','8','9'].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => tap(n)}
              disabled={submitting}
              style={keyBtnStyle}
            >
              {n}
            </button>
          ))}
          <button type="button" onClick={clearAll} disabled={submitting || pin.length === 0} style={keySecondaryStyle}>
            CLEAR
          </button>
          <button type="button" onClick={() => tap('0')} disabled={submitting} style={keyBtnStyle}>
            0
          </button>
          <button type="button" onClick={clearLast} disabled={submitting || pin.length === 0} style={{ ...keySecondaryStyle, fontSize: 20 }}>
            ←
          </button>
        </div>

        {/* Limpiar caché — visible si hay error o servidor caído */}
        {(error || healthSdk.status === 'fail') && (
          <button
            onClick={clearCacheAndReload}
            style={{
              marginTop: 16,
              width: '100%',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--r-md)',
              padding: '10px 14px',
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            🔄 Limpiar caché y reintentar
          </button>
        )}

        {/* PWA install */}
        {canInstall && (
          <button
            onClick={installPwa}
            className="btn btn-kaeru"
            style={{ marginTop: 20, width: '100%', justifyContent: 'center' }}
          >
            📲 Instalar app en este dispositivo
          </button>
        )}
        {!canInstall && (
          <p style={{
            marginTop: 16,
            fontSize: 10.5,
            textAlign: 'center',
            color: 'var(--text-dim)',
            lineHeight: 1.6
          }}>
            En iOS: tocá <b style={{ color: 'var(--text-muted)' }}>Compartir →</b> "Añadir a pantalla de inicio"
          </p>
        )}

        {/* Notas finales */}
        <p className="text-dim" style={{ fontSize: 10, textAlign: 'center', marginTop: 20, lineHeight: 1.6 }}>
          ERP Kaeru Chan · Schema kaeru<br />
          Tu PIN te lo asigna Jose. Solo usuarios autorizados.
          {kiosko && (
            <>
              <br /><span className="badge badge-purple" style={{ fontSize: 9, marginTop: 8 }}>KIOSKO ACTIVO</span>
              {autoAttempted && <><br /><span style={{ color: 'var(--text-muted)' }}>Sesión expirada — reingresá PIN</span></>}
            </>
          )}
        </p>
      </div>

      {/* Footer tocable con panel diagnóstico */}
      <div
        onClick={() => setShowDiag((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 6,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 10,
          color: 'var(--text-dim)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {statusDot} {APP_VERSION} · {host} · {statusText} {overallOk ? '' : '· tocar para diagnóstico'}
      </div>

      {showDiag && (
        <div style={{
          position: 'fixed',
          bottom: 28,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-elevated, #111)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--r-md)',
          padding: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'monospace',
          maxWidth: 360,
          width: '92%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          zIndex: 100,
        }}>
          <div><b>Versión:</b> {APP_VERSION}</div>
          <div><b>Host:</b> {host}</div>
          <div><b>Canónico:</b> {isCanonical ? 'Sí ✓' : 'No ⚠'}</div>
          <div><b>Online:</b> {online ? 'Sí ✓' : 'No ✕'}</div>
          <div><b>Kiosko:</b> {kiosko ? 'Activo' : 'Off'}</div>
          <div><b>Supabase SDK:</b> {healthSdk.status === null ? '⏳' : healthSdk.status === 'ok' ? '✓' : '✕'}</div>
          {healthSdk.detail && (
            <div style={{ color: healthSdk.status === 'ok' ? 'var(--accent-kaeru)' : '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>
              → {healthSdk.detail}
            </div>
          )}
          <div><b>Fetch directo:</b> {healthFetch.status === null ? '⏳' : healthFetch.status === 'ok' ? '✓' : '✕'}</div>
          {healthFetch.detail && (
            <div style={{ color: healthFetch.status === 'ok' ? 'var(--accent-kaeru)' : '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>
              → {healthFetch.detail}
            </div>
          )}
          <div style={{ marginTop: 6 }}><b>User Agent:</b></div>
          <div style={{ fontSize: 10, opacity: 0.7, wordBreak: 'break-all' }}>
            {typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}
          </div>
          <button
            onClick={clearCacheAndReload}
            className="btn btn-kaeru btn-sm"
            style={{ marginTop: 10, width: '100%' }}
          >
            🔄 Limpiar caché y recargar
          </button>
        </div>
      )}
    </div>
  );
}

const keyBtnStyle: React.CSSProperties = {
  aspectRatio: '1 / 1',
  background: 'var(--bg-card)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--r-lg)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-metric)',
  fontSize: 28,
  cursor: 'pointer',
  transition: 'background 0.1s',
  touchAction: 'manipulation'
};

const keySecondaryStyle: React.CSSProperties = {
  aspectRatio: '1 / 1',
  background: 'transparent',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--r-lg)',
  color: 'var(--text-muted)',
  fontSize: 11,
  cursor: 'pointer',
  touchAction: 'manipulation'
};
