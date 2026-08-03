import { useState, lazy, Suspense } from 'react';

import TabPedidos from './TabPedidos';
import TabParametros from './TabParametros';
import TabSucursales from './TabSucursales';
import TabJuego from './TabJuego';
import TabBonos from './TabBonos';
// Cobertura usa Leaflet (mapa): lazy para no cargarlo hasta abrir ese tab
const TabCobertura = lazy(() => import('./TabCobertura'));

// ── Paleta ──────────────────────────────────────────────────────────────────
const c = {
  bg: '#111', card: '#1a1a1a', border: '#2a2a2a', input: '#1e1e1e',
  red: '#e63946', green: '#4ade80', yellow: '#fbbf24', orange: '#f97316',
  blue: '#60a5fa', purple: '#a78bfa', text: '#f0f0f0', dim: '#888', off: '#555',
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function DeliveryView({ user, show = () => {} }) {
  const [tab, setTab] = useState('pedidos');
  const rol = user?.rol || '';
  const puedeAprobar = ['ejecutivo', 'superadmin', 'admin'].includes(rol);

  return (
    <div style={{ padding: '16px 16px 100px', background: c.bg, minHeight: '100vh' }}>
      {/* TABS */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto' }}>
        {[['pedidos','📥 Pedidos'],['bonos','💰 Bonos'],['cobertura','🗺️ Cobertura'],['sucursales','🏪 Sucursales'],['juego','🏆 Juego'],['parametros','⚙️ Parámetros']].map(([k, etq]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            background: tab === k ? c.red : '#222',
            color: tab === k ? '#fff' : c.dim,
          }}>{etq}</button>
        ))}
      </div>

      {tab === 'pedidos'   && <TabPedidos  show={show} />}
      {tab === 'sucursales' && <TabSucursales show={show} />}
      {tab === 'juego' && <TabJuego show={show} />}
      {tab === 'parametros' && <TabParametros show={show} />}
      {tab === 'bonos'     && <TabBonos    user={user} show={show} puedeAprobar={puedeAprobar} />}
      {tab === 'cobertura' && (
        <Suspense fallback={<div style={{ color: c.dim, padding: 20 }}>Cargando mapa…</div>}>
          <TabCobertura show={show} />
        </Suspense>
      )}
    </div>
  );
}
