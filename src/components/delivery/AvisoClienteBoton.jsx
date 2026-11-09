// ────────────────────────────────────────────────────────────────────
// Torre · «📣 Avisar al cliente» (9-nov-2026, pedido de Cesar)
//
// Karina pone el aviso amarillo que el cliente ve en su página de
// seguimiento (con botones Llamar / WhatsApp). Caso típico: el cliente no
// contesta y el motorista ya está afuera. El teléfono se llena con el del
// motorista; si no está cargado, Karina lo escribe y puede guardarlo para
// la próxima. El aviso se quita solo cuando el pedido se entrega.
// ────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { db } from '../../supabase';

const TOKEN_KEY = 'freakie_torre_token';

const PLANTILLAS = [
  { k: 'afuera', t: 'Ya está afuera', msg: (m) => `¡Tu pedido ya está afuera! ${m || 'Tu motorista'} te está esperando. Llamalo, por favor.` },
  { k: 'tarde', t: 'Va a llegar tarde', msg: (m) => `Tu pedido va un poco atrasado, ${m ? m + ' ya va' : 'ya vamos'} en camino. ¡Gracias por la paciencia!` },
  { k: 'direccion', t: 'No encontramos la dirección', msg: (m) => `${m || 'Tu motorista'} no encuentra tu dirección. Llamalo para indicarle, por favor.` },
  { k: 'otro', t: 'Otro…', msg: () => '' },
];

export default function AvisoClienteBoton({ p, show = () => {} }) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState(null);
  const [texto, setTexto] = useState('');
  const [tel, setTel] = useState('');
  const [guardarTel, setGuardarTel] = useState(true);
  const [plantilla, setPlantilla] = useState('afuera');
  const [ocupado, setOcupado] = useState(false);
  const token = () => localStorage.getItem(TOKEN_KEY);

  const abrir = async () => {
    setAbierto(true); setDatos(null);
    const { data, error } = await db.rpc('torre_aviso_cliente_datos', { p_token: token(), p_delivery_id: p.id });
    if (error) { show('❌ ' + error.message); setAbierto(false); return; }
    setDatos(data);
    const mot = (data.motorista || '').split(' ')[0];
    setTexto(data.aviso || PLANTILLAS[0].msg(mot));
    setPlantilla(data.aviso ? 'otro' : 'afuera');
    setTel(data.aviso_tel || data.motorista_tel || '');
    setGuardarTel(!data.motorista_tel);
  };

  const guardar = async (quitar = false) => {
    setOcupado(true);
    const { error } = await db.rpc('torre_aviso_cliente', {
      p_token: token(), p_delivery_id: p.id,
      p_texto: quitar ? null : texto, p_tel: quitar ? null : tel,
      p_guardar_tel_motorista: !quitar && guardarTel,
    });
    setOcupado(false);
    if (error) { show('❌ ' + error.message); return; }
    show(quitar ? '✅ Aviso quitado' : `📣 Aviso puesto: ${datos?.cliente || 'el cliente'} ya lo ve en su seguimiento`);
    setAbierto(false);
  };

  const mot = (datos?.motorista || '').split(' ')[0];
  const telOk = !tel || /^(503)?[267]\d{7}$/.test(tel.replace(/\D/g, ''));

  return (
    <>
      <button onClick={abrir} style={{ ...S.btn, background: '#3b2f0a', color: '#FFD900', border: '1px solid #6b5412', marginBottom: 6 }}>
        📣 Avisar al cliente
      </button>
      {abierto && (
        <div onClick={() => setAbierto(false)} style={S.fondo}>
          <div onClick={e => e.stopPropagation()} style={S.modal}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>📣 Avisar al cliente · {p.numero_orden}</div>
            {!datos ? <div style={{ color: '#9a9088', marginTop: 10 }}>Cargando…</div> : (
              <>
                <div style={{ fontSize: 12, color: '#9a9088', marginTop: 2 }}>
                  {datos.cliente || 'Cliente'} · motorista {datos.motorista || 'sin asignar'}
                  {datos.aviso && ' · ya tiene un aviso puesto'}
                </div>
                <div style={S.lbl}>Mensaje</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PLANTILLAS.map(x => (
                    <button key={x.k} onClick={() => { setPlantilla(x.k); if (x.k !== 'otro') setTexto(x.msg(mot)); }}
                            style={S.chip(plantilla === x.k)}>{x.t}</button>
                  ))}
                </div>
                <textarea value={texto} onChange={e => { setTexto(e.target.value); setPlantilla('otro'); }} rows={3} maxLength={300} style={S.input} />
                <div style={S.lbl}>Teléfono para los botones Llamar / WhatsApp</div>
                <input value={tel} onChange={e => setTel(e.target.value.replace(/[^\d]/g, '').slice(0, 11))}
                       placeholder="7777-7777" inputMode="numeric" style={{ ...S.input, fontSize: 16, letterSpacing: 1 }} />
                {!telOk && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 4 }}>8 dígitos que empiecen con 2, 6 o 7</div>}
                {datos.motorista_id && tel && tel !== datos.motorista_tel && (
                  <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5, marginTop: 8, color: '#cfc6bc' }}>
                    <input type="checkbox" checked={guardarTel} onChange={e => setGuardarTel(e.target.checked)} />
                    Guardarlo como teléfono de {mot || 'este motorista'}
                  </label>
                )}
                <div style={{ fontSize: 11.5, color: '#9a9088', marginTop: 10 }}>
                  Sale en grande, en amarillo, en la página de seguimiento del cliente. Se quita solo al entregar.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  {datos.aviso && (
                    <button disabled={ocupado} onClick={() => guardar(true)} style={{ ...S.btn, flex: 1, background: 'none', border: '1px solid #3a342e', color: '#9a9088' }}>
                      Quitar aviso
                    </button>
                  )}
                  <button disabled={ocupado || !texto.trim() || !telOk} onClick={() => guardar(false)}
                          style={{ ...S.btn, flex: 2, background: '#FFD900', color: '#1a1200', opacity: (!texto.trim() || !telOk) ? .5 : 1 }}>
                    {ocupado ? 'Guardando…' : 'Mostrar aviso al cliente'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const S = {
  btn: { width: '100%', padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: 'inherit' },
  fondo: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: '#17140f', border: '1px solid #3a342e', borderRadius: 14, padding: 16, width: 'min(420px, 100%)', color: '#f5efe6' },
  lbl: { fontSize: 11.5, color: '#9a9088', margin: '12px 0 6px' },
  chip: (on) => ({ background: on ? '#3b2f0a' : '#1f1c19', color: on ? '#FFD900' : '#cfc6bc', border: `1px solid ${on ? '#FFD900' : '#3a342e'}`,
                   borderRadius: 14, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }),
  input: { width: '100%', boxSizing: 'border-box', background: '#1f1c19', color: '#f5efe6', border: '1px solid #3a342e',
           borderRadius: 9, padding: 9, fontSize: 13.5, fontFamily: 'inherit', marginTop: 8, resize: 'vertical' },
};
