import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { APP_VERSION } from '../../config';

// Dominios oficiales de producción. Si el host NO está aquí y no es localhost,
// mostramos warning de "enlace antiguo".
const CANONICAL_HOSTS = [
  'freakie-dogs-caja.vercel.app',
  'erp.freakiedogs.com',
  'erp.freakiedogs.sv',
];

// PINs válidos: 4 dígitos (estándar) o 6 dígitos (super admin)
const MIN_PIN = 4;
const MAX_PIN = 6;
const DEBOUNCE_MS = 400; // espera sin input antes de queryear

export default function LoginScreen({ onLogin }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [errDetails, setErrDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [canInstall, setCanInstall] = useState(!!window.__pwaReady);
  const [online, setOnline] = useState(navigator.onLine);
  const [healthOk, setHealthOk] = useState(null); // null=checking, true=ok, false=fail
  const [healthErr, setHealthErr] = useState(''); // mensaje de error detallado
  const [rawFetchOk, setRawFetchOk] = useState(null); // fetch directo a supabase.co
  const [rawFetchDetails, setRawFetchDetails] = useState('');
  const [proxyFetchOk, setProxyFetchOk] = useState(null); // fetch via /api/sb proxy
  const [proxyFetchDetails, setProxyFetchDetails] = useState('');
  const [showDiag, setShowDiag] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // ─── Online / offline ───────────────────────────────────────
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ─── Health check a Supabase al cargar ──────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Health check vía SDK de Supabase
      try {
        const { error } = await db.from('usuarios_erp').select('id').limit(1);
        if (cancelled) return;
        if (error) {
          setHealthOk(false);
          setHealthErr(`${error.code || ''} ${error.message || String(error)}`.trim());
        } else {
          setHealthOk(true);
          setHealthErr('');
        }
      } catch (e) {
        if (cancelled) return;
        setHealthOk(false);
        setHealthErr(`EXC: ${e?.message || String(e)}`);
      }

      // 2. Fetch DIRECTO a supabase.co (sin proxy) — si esto falla confirma bloqueo DNS
      const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0Ym94bHdmcWNicmRmcmxud2xuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NjcyMzQsImV4cCI6MjA4OTU0MzIzNH0.NpBQZgxbajgOVvw3FOwIUiOkgmh7rEuPQMRi0ZcFKe4';
      try {
        const r = await fetch(
          'https://btboxlwfqcbrdfrlnwln.supabase.co/rest/v1/usuarios_erp?select=id&limit=1',
          { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
        );
        if (cancelled) return;
        if (r.ok) {
          setRawFetchOk(true);
          setRawFetchDetails(`${r.status} OK`);
        } else {
          setRawFetchOk(false);
          const txt = await r.text().catch(() => '');
          setRawFetchDetails(`${r.status} ${r.statusText} ${txt.slice(0, 80)}`);
        }
      } catch (e) {
        if (cancelled) return;
        setRawFetchOk(false);
        setRawFetchDetails(`FAIL: ${e?.message || String(e)}`);
      }

      // 3. Fetch vía PROXY /api/sb — debería funcionar aunque el directo falle
      try {
        const r = await fetch(
          `${window.location.origin}/api/sb/rest/v1/usuarios_erp?select=id&limit=1`,
          { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
        );
        if (cancelled) return;
        if (r.ok) {
          setProxyFetchOk(true);
          setProxyFetchDetails(`${r.status} OK`);
        } else {
          setProxyFetchOk(false);
          const txt = await r.text().catch(() => '');
          setProxyFetchDetails(`${r.status} ${r.statusText} ${txt.slice(0, 80)}`);
        }
      } catch (e) {
        if (cancelled) return;
        setProxyFetchOk(false);
        setProxyFetchDetails(`FAIL: ${e?.message || String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── PWA install prompt ─────────────────────────────────────
  useEffect(() => {
    const on = () => setCanInstall(true);
    const off = () => setCanInstall(false);
    window.addEventListener('pwaready', on);
    window.addEventListener('pwainstalled', off);
    return () => {
      window.removeEventListener('pwaready', on);
      window.removeEventListener('pwainstalled', off);
    };
  }, []);

  // ─── Debounced auto-login cuando el PIN tiene 4-6 dígitos ───
  useEffect(() => {
    // Limpiar timer previo al cambiar el pin
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // No hay PIN suficiente → no hacer nada
    if (pin.length < MIN_PIN) return;

    // Si ya alcanzó el máximo (6), queryear inmediatamente
    const delay = pin.length >= MAX_PIN ? 0 : DEBOUNCE_MS;
    const pinSnapshot = pin;

    debounceRef.current = setTimeout(() => {
      runLogin(pinSnapshot);
    }, delay);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  // ─── Ejecutar el login contra Supabase ──────────────────────
  const runLogin = async (np) => {
    if (!navigator.onLine) {
      setErr('Sin conexión a internet');
      setErrDetails('Revisa WiFi o datos móviles y reintenta.');
      setPin('');
      return;
    }
    // Abortar request anterior si sigue viva
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch {}
    }
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setErr('');
    setErrDetails('');
    try {
      const { data, error } = await db
        .from('usuarios_erp')
        .select('*')
        .eq('pin', np)
        .eq('activo', true)
        .abortSignal(ac.signal)
        .maybeSingle();

      // Si mientras queryeábamos el usuario cambió el PIN (otro dígito), ignorar
      if (pin !== np && pin.length >= MIN_PIN) return;

      setLoading(false);
      if (error) {
        // Ignorar errores de abort (no son fallas reales)
        if (error.message?.toLowerCase().includes('abort')) return;
        setErr('Error conectando al servidor');
        setErrDetails(error.message || 'Intenta de nuevo o limpia el caché.');
        setPin('');
        return;
      }
      if (data) {
        onLogin(data);
        return;
      }
      // No hubo match
      // Si el PIN ya alcanzó el máximo (6) → error definitivo
      // Si todavía es < 6 → el usuario probablemente NO va a teclear más (pasó el debounce)
      //   → también mostrar error
      setErr('PIN incorrecto');
      setErrDetails('Verifica con tu supervisor.');
      setPin('');
    } catch (e) {
      setLoading(false);
      if (e?.name === 'AbortError') return;
      setErr('Error inesperado');
      setErrDetails(String(e?.message || e));
      setPin('');
    }
  };

  const press = (k) => {
    // No bloqueamos con loading — el debounce + abort se encarga
    if (k === 'del') {
      setPin((p) => p.slice(0, -1));
      setErr('');
      setErrDetails('');
      return;
    }
    if (pin.length >= MAX_PIN) return; // tope
    setPin((p) => p + k);
    setErr('');
    setErrDetails('');
  };

  // ─── Limpieza de caché / SW para usuarios atascados ─────────
  const clearCacheAndReload = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* ignore */
    }
    window.location.href = window.location.pathname + '?_r=' + Date.now();
  };

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isCanonical =
    CANONICAL_HOSTS.includes(host) || host === 'localhost' || host === '127.0.0.1';
  const canonicalUrl = `https://${CANONICAL_HOSTS[0]}`;

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  const statusDot =
    !online ? '🔴' :
    healthOk === false ? '🔴' :
    healthOk === null ? '🟡' : '🟢';

  const statusText =
    !online ? 'Sin internet' :
    healthOk === false ? 'Servidor no responde' :
    healthOk === null ? 'Verificando...' : 'Conectado';

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 24px 56px',
      }}
    >
      {/* ⚠️ Warning URL no canónica (preview de Vercel / link viejo) */}
      {!isCanonical && (
        <div
          style={{
            background: '#78350f',
            color: '#fde68a',
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 12,
            lineHeight: 1.5,
            marginBottom: 16,
            textAlign: 'center',
            maxWidth: 320,
            border: '1px solid #f59e0b',
          }}
        >
          ⚠️ <b>Estás en un enlace antiguo</b>
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85, wordBreak: 'break-all' }}>
            {host}
          </div>
          <a
            href={canonicalUrl}
            style={{
              color: '#fff',
              display: 'inline-block',
              marginTop: 6,
              fontWeight: 700,
              textDecoration: 'underline',
            }}
          >
            Ir al enlace oficial →
          </a>
        </div>
      )}

      {/* 🔴 Warning offline o servidor caído */}
      {(!online || healthOk === false) && (
        <div
          style={{
            background: '#7f1d1d',
            color: '#fecaca',
            padding: '10px 14px',
            borderRadius: 10,
            fontSize: 12,
            marginBottom: 16,
            textAlign: 'center',
            border: '1px solid #dc2626',
          }}
        >
          {!online ? '📡 Sin conexión a internet' : '🔌 El servidor no responde'}
          <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>
            {!online ? 'Revisa tu WiFi o datos móviles.' : 'Intenta en unos segundos.'}
          </div>
        </div>
      )}

      <img
        src="/icon-192.png"
        alt="Freakie Dogs"
        style={{
          width: 160,
          height: 160,
          borderRadius: 20,
          marginBottom: 12,
          objectFit: 'contain',
        }}
      />
      <div style={{ fontWeight: 800, fontSize: 22 }}>Freakie Dogs</div>
      <div style={{ color: '#555', fontSize: 13, marginTop: 4, marginBottom: 32 }}>
        Ingresa tu PIN
      </div>

      <div className="pin-box">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`pin-dot${pin.length > i ? ' filled' : ''}`}
            style={{ width: 14, height: 14, margin: '0 5px' }}
          />
        ))}
      </div>

      {/* Área de mensaje con altura fija para que no salte el layout */}
      <div
        style={{
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
        }}
      >
        {err && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#f87171', fontSize: 14, fontWeight: 700 }}>
              ❌ {err}
            </div>
            {errDetails && (
              <div style={{ color: '#888', fontSize: 11, marginTop: 2, maxWidth: 280 }}>
                {errDetails}
              </div>
            )}
          </div>
        )}
        {loading && !err && <div className="spin" />}
      </div>

      <div className="keypad">
        {keys.map((k, i) =>
          k === '' ? (
            <div key={i} />
          ) : (
            <div key={i} className="key" onClick={() => press(k)}>
              {k === 'del' ? '⌫' : k}
            </div>
          )
        )}
      </div>

      {/* Botón limpiar caché — visible solo si hay error */}
      {err && (
        <button
          onClick={clearCacheAndReload}
          style={{
            marginTop: 16,
            background: 'transparent',
            color: '#888',
            border: '1px solid #333',
            borderRadius: 10,
            padding: '10px 18px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          🔄 Limpiar caché y reintentar
        </button>
      )}

      {canInstall && (
        <button
          onClick={() => window.__installPWA()}
          style={{
            marginTop: 24,
            background: '#e63946',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            padding: '12px 24px',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          📲 Instalar app en este dispositivo
        </button>
      )}
      {!canInstall && (
        <div
          style={{
            marginTop: 20,
            color: '#444',
            fontSize: 12,
            textAlign: 'center',
            maxWidth: 220,
          }}
        >
          En iOS: toca <b style={{ color: '#888' }}>Compartir →</b> "Añadir a pantalla de
          inicio"
        </div>
      )}

      {/* Footer con versión + estado (tocable para panel diagnóstico) */}
      <div
        onClick={() => setShowDiag((v) => !v)}
        style={{
          position: 'fixed',
          bottom: 6,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 10,
          color: '#555',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {statusDot} {APP_VERSION} · {host} · {statusText}
      </div>

      {/* Panel diagnóstico (expandido al tocar el footer) */}
      {showDiag && (
        <div
          style={{
            position: 'fixed',
            bottom: 28,
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#111',
            border: '1px solid #333',
            borderRadius: 10,
            padding: 12,
            fontSize: 11,
            color: '#aaa',
            fontFamily: 'monospace',
            maxWidth: 320,
            width: '90%',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
        >
          <div><b>Versión:</b> {APP_VERSION}</div>
          <div><b>Host:</b> {host}</div>
          <div><b>Canónico:</b> {isCanonical ? 'Sí ✅' : 'No ⚠️'}</div>
          <div><b>Online:</b> {online ? 'Sí ✅' : 'No ❌'}</div>
          <div><b>Supabase SDK:</b> {healthOk === null ? '⏳' : healthOk ? 'OK ✅' : 'FAIL ❌'}</div>
          {healthErr && (
            <div style={{ color: '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>
              → {healthErr}
            </div>
          )}
          <div><b>Fetch DIRECTO:</b> {rawFetchOk === null ? '⏳' : rawFetchOk ? 'OK ✅' : 'FAIL ❌'}</div>
          {rawFetchDetails && (
            <div style={{ color: '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>
              → {rawFetchDetails}
            </div>
          )}
          <div><b>Fetch PROXY:</b> {proxyFetchOk === null ? '⏳' : proxyFetchOk ? 'OK ✅' : 'FAIL ❌'}</div>
          {proxyFetchDetails && (
            <div style={{ color: proxyFetchOk ? '#86efac' : '#fca5a5', fontSize: 10, marginLeft: 8, wordBreak: 'break-all' }}>
              → {proxyFetchDetails}
            </div>
          )}
          <div style={{ marginTop: 4 }}><b>User Agent:</b></div>
          <div style={{ fontSize: 10, opacity: 0.7, wordBreak: 'break-all' }}>
            {navigator.userAgent}
          </div>
          <button
            onClick={clearCacheAndReload}
            style={{
              marginTop: 8,
              background: '#e63946',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 11,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            🔄 Limpiar caché y recargar
          </button>
        </div>
      )}
    </div>
  );
}
