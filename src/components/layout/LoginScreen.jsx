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
      if (error || !data) {
        setErr('PIN incorrecto');
        setPin('');
        return;
      }
      onLogin(data);
    }
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
      }}
    >
      <img
        src="data:image/webp;base64,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"
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
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`pin-dot${pin.length > i ? ' filled' : ''}`}
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
