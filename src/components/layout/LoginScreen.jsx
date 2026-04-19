import { useState, useEffect } from 'react';
import { db } from '../../supabase';

export default function LoginScreen({ onLogin }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [canInstall, setCanInstall] = useState(!!window.__pwaReady);

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

  const press = async (k) => {
    if (loading) return;
    if (k === 'del') {
      setPin((p) => p.slice(0, -1));
      setErr('');
      return;
    }
    const np = pin + k;
    setPin(np);
    if (np.length >= 4) {
      setLoading(true);
      const { data, error } = await db
        .from('usuarios_erp')
        .select('*')
        .eq('pin', np)
        .eq('activo', true)
        .maybeSingle();
      setLoading(false);
      if (data) {
        onLogin(data);
        return;
      }
      // PIN de 4-5 dígitos sin match: seguir esperando más dígitos
      if (np.length < 6) return;
      // 6 dígitos sin match: error y resetear
      setErr('PIN incorrecto');
      setPin('');
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
      }}
    >
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
      {err && (
        <div style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>
          {err}
        </div>
      )}
      {loading && <div className="spin" style={{ marginBottom: 12 }} />}
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
      {canInstall && (
        <button
          onClick={() => window.__installPWA()}
          style={{
            marginTop: 28,
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
            marginTop: 24,
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
    </div>
  );
}
