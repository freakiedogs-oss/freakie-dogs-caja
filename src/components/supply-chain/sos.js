// Pedidos SOS (v1, 23-sep-2026): piezas compartidas entre la sucursal
// (MisPedidosView), bodega (DespachoTab) y la alerta global de Casa Matriz.

export const MOTIVOS_SOS = [
  { key: 'se_acabo', label: 'Se acabó' },
  { key: 'se_dano',  label: 'Se dañó' },
  { key: 'no_llego', label: 'No llegó en el pedido' },
  { key: 'otro',     label: 'Otro' },
];

export const MOTIVO_SOS_LABEL = {
  se_acabo: 'Se acabó',
  se_dano: 'Se dañó',
  no_llego: 'No llegó en el pedido',
  otro: 'Otro',
  pendiente: 'Pendiente de un SOS anterior',
};

// Minutos desde que se pidió (para "hace 12 min")
export const minutosDesde = (iso, ahora = Date.now()) =>
  Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));

export const haceTexto = (iso, ahora) => {
  const m = minutosDesde(iso, ahora);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h ${m % 60} min`;
};

// Tres pitidos + vibración. Los navegadores solo dejan sonar después de que la
// persona tocó algo en la página; si no se puede, falla en silencio.
export function beepSOS() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      [0, 0.28, 0.56].forEach(t => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = 880;
        g.gain.value = 0.08;
        o.connect(g);
        g.connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.16);
      });
      setTimeout(() => { try { ctx.close(); } catch (e) { /* nada */ } }, 1500);
    }
  } catch (e) { /* sin audio */ }
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* sin vibración */ }
}
