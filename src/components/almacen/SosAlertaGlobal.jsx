import { useEffect, useRef, useState } from 'react';
import { db } from '../../supabase';
import { beepSOS, haceTexto } from '../supply-chain/sos';

// ── ALERTA SOS PARA CASA MATRIZ (v1, 23-sep-2026) ────────────────
// Antes bodega solo se enteraba de un pedido de emergencia si abría Despacho y
// recargaba. Esto revisa cada 45 s (y al volver a la app) si hay SOS sin
// preparar: suena y vibra cuando entra uno nuevo, y deja una píldora roja
// arriba, en cualquier pantalla, que lleva directo a Despacho.
const ROLES_ALERTA = ['bodeguero', 'jefe_casa_matriz', 'admin'];

export default function SosAlertaGlobal({ user, currentScreen, onNavigate }) {
  const [sos, setSos] = useState([]);
  const [ahora, setAhora] = useState(Date.now());
  const vistos = useRef(null);
  const activo = ROLES_ALERTA.includes(user?.rol);

  useEffect(() => {
    if (!activo) return undefined;
    let vivo = true;
    const revisar = async () => {
      if (document.hidden) return;
      const { data, error } = await db.from('pedidos_sucursal')
        .select('id,created_at,motivo,tipo,urgente_para,sucursales(nombre)')
        .in('tipo', ['sos', 'urgente']).eq('estado', 'enviado')
        .order('created_at', { ascending: true });
      if (!vivo || error || !data) return;
      if (vistos.current && data.some(d => !vistos.current.has(d.id))) beepSOS();
      vistos.current = new Set(data.map(d => d.id));
      setSos(data);
      setAhora(Date.now());
    };
    revisar();
    const t = setInterval(revisar, 45000);
    const alVolver = () => { if (!document.hidden) revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', alVolver); };
  }, [activo]);

  if (!activo || sos.length === 0 || currentScreen === 'despacho') return null;
  // SOS primero; después los 🌅 antes de abrir (17-nov-2026)
  const soloSos = sos.filter(x => x.tipo === 'sos');
  const primero = soloSos[0] || sos[0];
  const esAntes = primero.tipo === 'urgente';
  const hora = (t) => new Date(t).toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', timeZone: 'America/El_Salvador' });
  return (
    <button
      onClick={() => onNavigate('despacho')}
      style={{
        position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
        background: esAntes ? '#d97706' : '#dc2626', color: '#fff', border: 'none', borderRadius: 999,
        padding: '10px 16px', fontWeight: 800, fontSize: 13, cursor: 'pointer',
        boxShadow: '0 6px 20px rgba(0,0,0,.45)', maxWidth: 'calc(100vw - 32px)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {esAntes
        ? <>🌅 Antes de abrir · {primero.sucursales?.nombre || 'una sucursal'}{primero.urgente_para ? ` lo necesita a las ${hora(primero.urgente_para)}` : ''}{sos.length > 1 ? ` · +${sos.length - 1}` : ''} · Ver</>
        : <>🚨 {soloSos.length === 1 ? `SOS de ${primero.sucursales?.nombre || 'una sucursal'}` : `${soloSos.length} pedidos SOS`}{sos.length > soloSos.length ? ` · 🌅 ${sos.length - soloSos.length}` : ''} · {haceTexto(primero.created_at, ahora)} · Ver</>}
    </button>
  );
}
