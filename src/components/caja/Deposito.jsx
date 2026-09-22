import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import InfoTip from '../ui/InfoTip'
import { STORES, today, n } from '../../config';
import { BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

const uploadFoto = async (file, folder) => {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

function Mi({ label, value, onChange, readOnly, hint }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>
        {label} {hint && <span style={{ fontSize: 11, color: '#555' }}>· {hint}</span>}
      </div>
      <input
        className="inp"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder="0.00"
        style={{ background: readOnly ? '#161616' : undefined, color: readOnly ? '#555' : '#fff' }}
      />
    </div>
  );
}

function OpcionModo({ activo, onClick, color, titulo, texto }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', background: activo ? '#141414' : 'transparent',
      border: `1.5px solid ${activo ? color : '#333'}`, borderRadius: 10,
      padding: '11px 13px', cursor: 'pointer', color: '#fff', fontFamily: 'inherit', width: '100%',
    }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: activo ? color : '#ddd' }}>
        {activo ? '●' : '○'} {titulo}
      </div>
      <div style={{ fontSize: 11.5, color: '#888', marginTop: 3, lineHeight: 1.4 }}>{texto}</div>
    </button>
  );
}

export default function Deposito({ user, onBack }) {
  const { show, Toast } = useToast();
  const [storeCode, setStoreCode] = useState(user.store_code || '');
  const [monto, setMonto] = useState('');
  const [fechaDep, setFechaDep] = useState(today());
  const [dias, setDias] = useState([today()]);
  const [notas, setNotas] = useState('');
  const [fotos, setFotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cierresDias, setCierresDias] = useState([]);
  // Lo que YA está registrado y vigente para estos días. Es el corazón del
  // anti-duplicado: hasta septiembre nadie veía esto y el mismo depósito se
  // subió dos veces 23 veces, $12,080.61 de más.
  const [vigentes, setVigentes] = useState([]);
  const [modo, setModo] = useState(null); // 'reemplazar' | 'agregar'
  const fRef = useRef();
  const lastDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  // Cada vez que cambia la sucursal o los días, se relee qué hay vigente.
  // El chequeo de verdad lo hace `fn_deposito_registrar` en la base (acá no
  // se puede ver lo que otra persona sube en los segundos siguientes); esto
  // es para que el usuario lo sepa ANTES de llenar el formulario.
  useEffect(() => {
    setModo(null);
    if (!storeCode || dias.length === 0) { setVigentes([]); return; }
    let vivo = true;
    db.from('depositos_bancarios')
      .select('id,monto,fecha_deposito,dias_cubiertos,estado,creado_por,created_at,fotos_urls,notas')
      .eq('store_code', storeCode)
      .neq('estado', 'anulado')
      .overlaps('dias_cubiertos', dias)
      .then(({ data }) => { if (vivo) setVigentes(data || []); });
    return () => { vivo = false; };
  }, [storeCode, dias]);

  useEffect(() => {
    if (dias.length === 0 || !storeCode) {
      setCierresDias([]);
      return;
    }
    db.from('ventas_diarias')
      .select('fecha,efectivo_real_depositar,efectivo_calculado,diferencia_deposito,estado,turno')
      .eq('store_code', storeCode)
      .in('fecha', dias)
      .then(({ data }) => setCierresDias(data || []));
  }, [dias, storeCode]);

  const montoEsperado = cierresDias.reduce((s, c) => s + n(c.efectivo_real_depositar), 0);
  const difDep = n(monto) - montoEsperado;
  const difClass =
    n(monto) > 0 && montoEsperado > 0 ? (Math.abs(difDep) < 1 ? 'diff-ok' : Math.abs(difDep) <= 5 ? 'diff-warn' : 'diff-err') : '';

  const submit = async () => {
    if (!storeCode) {
      show('⚠️ Selecciona la sucursal');
      return;
    }
    if (!n(monto)) {
      show('⚠️ Ingresa el monto');
      return;
    }
    if (dias.length === 0) {
      show('⚠️ Selecciona al menos un día');
      return;
    }
    if (fotos.length === 0) {
      show('⚠️ Agrega al menos una foto del voucher');
      return;
    }
    if (vigentes.length > 0 && !modo) {
      show('⚠️ Ya hay un depósito para estos días — elegí qué hacer');
      return;
    }
    setLoading(true);
    let fotosUrls = [];
    try {
      fotosUrls = await Promise.all(fotos.map((f) => uploadFoto(f, `depositos/${storeCode}`)));
    } catch (e) {
      show('❌ Error subiendo foto: ' + e.message);
      setLoading(false);
      return;
    }
    // `fn_deposito_registrar` lee los vigentes, decide y escribe en la MISMA
    // transacción, con lock por sucursal. Un insert suelto no puede hacer eso:
    // entre leer y escribir, otra persona alcanza a registrar lo mismo.
    // `p_vistos` son los ids que el usuario tenía a la vista al decidir; si
    // cambiaron, la función NO ejecuta la decisión y devuelve lo nuevo.
    const { data: res, error } = await db.rpc('fn_deposito_registrar', {
      p_store_code: storeCode,
      p_monto: n(monto),
      p_fecha_deposito: fechaDep,
      p_dias: dias,
      p_fotos: fotosUrls,
      p_notas: notas,
      p_monto_esperado: parseFloat(montoEsperado.toFixed(2)),
      p_creado_por: `${user.nombre} ${user.apellido}`,
      p_creado_por_id: user.id,
      p_modo: vigentes.length > 0 ? modo : 'nuevo',
      p_vistos: vigentes.length > 0 ? vigentes.map((v) => v.id) : null,
    });
    setLoading(false);
    if (error) {
      show('❌ ' + error.message);
      return;
    }
    if (!res?.ok) {
      // La función devuelve los vigentes que encontró: se repintan, así el
      // usuario decide sobre lo que hay AHORA y no sobre lo que vio antes.
      if (res?.vigentes) { setVigentes(res.vigentes); setModo(null); }
      const msg = {
        ya_existe: '⚠️ Ya hay un depósito registrado para estos días. Mirá abajo y decidí qué hacer.',
        cambio: '⚠️ Alguien registró un depósito mientras llenabas esto. Revisá lo que hay ahora.',
        duplicado_exacto: '⚠️ Ya existe un depósito idéntico (mismo monto y mismos días). No se registró de nuevo.',
        datos_incompletos: '⚠️ Faltan datos del depósito.',
        modo_invalido: '❌ Opción inválida.',
      }[res?.motivo] || ('❌ No se pudo registrar: ' + (res?.motivo || 'error'));
      show(msg);
      return;
    }
    show(res.anulados > 0
      ? `✓ Depósito corregido — se anuló ${res.anulados === 1 ? 'el anterior' : `los ${res.anulados} anteriores`}`
      : '✓ Depósito registrado — pendiente de revisión por admin');
    setTimeout(onBack, 1500);
  };

  return (
    <div style={{ minHeight: '100vh', padding: '0 16px 50px' }}>
      <Toast />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0 12px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 26, cursor: 'pointer', padding: '0 4px' }}>
          ‹
        </button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>Depósito Bancario <InfoTip text="Registra los depósitos del efectivo de caja al banco: cuánto se depositó, de qué días de venta y a qué cuenta." /></div>
          <div style={{ fontSize: 12, color: '#666' }}>{STORES[storeCode] || 'Selecciona la sucursal abajo'}</div>
        </div>
      </div>

      <div className="card">
        <div className="sec-title">Datos del depósito</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Sucursal</div>
          <select className="inp" value={storeCode} onChange={(e) => setStoreCode(e.target.value)}>
            <option value="">— Selecciona sucursal —</option>
            {Object.entries(STORES).map(([code, nombre]) => (
              <option key={code} value={code}>{code} · {nombre}</option>
            ))}
          </select>
        </div>
        <Mi label="Monto depositado" value={monto} onChange={setMonto} />
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Fecha del depósito</div>
          <input type="date" className="inp" value={fechaDep} onChange={(e) => setFechaDep(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="sec-title">Días que cubre este depósito</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lastDays.map((d) => {
            const cierre = cierresDias.find((c) => c.fecha === d);
            return (
              <div
                key={d}
                onClick={() => setDias((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d].sort()))}
                style={{
                  padding: '12px 16px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: dias.includes(d) ? '#1a3a1a' : '#141414',
                  border: `1.5px solid ${dias.includes(d) ? '#4ade80' : '#222'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: 14, color: dias.includes(d) ? '#4ade80' : '#888' }}>
                    {new Date(d + 'T12:00:00').toLocaleDateString('es-SV', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  {dias.includes(d) && cierre && (
                    <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>Ef: {fmt$(cierre.efectivo_real_depositar)}</span>
                  )}
                  {dias.includes(d) && !cierre && <span style={{ fontSize: 11, color: '#f87171', marginLeft: 8 }}>Sin cierre</span>}
                </div>
                {dias.includes(d) && <span style={{ color: '#4ade80' }}>✓</span>}
              </div>
            );
          })}
        </div>
      </div>

      {vigentes.length > 0 && (
        <div className="card" style={{ borderColor: '#facc15', background: '#1c1a10' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#facc15', marginBottom: 4 }}>
            ⚠️ Estos días ya tienen depósito
          </div>
          <div style={{ fontSize: 12.5, color: '#bbb', marginBottom: 12, lineHeight: 1.45 }}>
            {vigentes.length === 1 ? 'Ya hay un depósito registrado' : `Ya hay ${vigentes.length} depósitos registrados`} que
            cubre{vigentes.length === 1 ? '' : 'n'} algún día de los que marcaste. Mirá si es el mismo antes de guardar.
          </div>

          {vigentes.map((v) => (
            <div key={v.id} style={{ border: '1px solid #333', borderRadius: 10, padding: 11, marginBottom: 9, background: '#141414' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 19, fontWeight: 800 }}>{fmt$(v.monto)}</span>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
                  background: v.estado === 'confirmado' ? '#14331f' : '#1a2a3d',
                  color: v.estado === 'confirmado' ? '#4ade80' : '#60a5fa' }}>
                  {v.estado === 'confirmado' ? '✓ Confirmado' : 'Sin confirmar'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>Depositado el {v.fecha_deposito}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Cubre: {(v.dias_cubiertos || []).join(' · ')}</div>
              <div style={{ fontSize: 12, color: '#888' }}>Lo subió {v.creado_por || '—'}</div>
              {v.notas && <div style={{ fontSize: 12, color: '#888' }}>Nota: {v.notas}</div>}
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
                {(v.fotos_urls || []).map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt={`Voucher ${i + 1}`} loading="lazy"
                      style={{ width: 62, height: 62, objectFit: 'cover', borderRadius: 8, border: '1px solid #333' }} />
                  </a>
                ))}
              </div>
            </div>
          ))}

          <div style={{ fontSize: 12.5, color: '#aaa', margin: '14px 0 8px', fontWeight: 700 }}>
            ¿Qué querés hacer?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <OpcionModo
              activo={modo === 'reemplazar'}
              onClick={() => setModo(modo === 'reemplazar' ? null : 'reemplazar')}
              color="#f87171"
              titulo="Estoy corrigiendo el anterior"
              texto={`El${vigentes.length === 1 ? '' : 'os'} depósito${vigentes.length === 1 ? '' : 's'} de arriba se anula${vigentes.length === 1 ? '' : 'n'} y sólo cuenta este. No se borra nada: queda guardado con la foto y el motivo.`}
            />
            <OpcionModo
              activo={modo === 'agregar'}
              onClick={() => setModo(modo === 'agregar' ? null : 'agregar')}
              color="#60a5fa"
              titulo="Es otra partida del mismo día"
              texto="Se depositó en dos partes. Los dos quedan vigentes y suman."
            />
          </div>
          <button className="btn btn-ghost" onClick={onBack} style={{ marginTop: 10 }}>
            Mejor salgo sin guardar
          </button>
        </div>
      )}

      {n(monto) > 0 && montoEsperado > 0 && (
        <div
          className="card"
          style={{
            borderColor:
              Math.abs(difDep) < 1 ? '#14532d' : Math.abs(difDep) <= 5 ? '#713f12' : '#7f1d1d',
          }}
        >
          <div className="sec-title">Cruce de Montos</div>
          <div className="row">
            <span style={{ fontSize: 13, color: '#888' }}>Monto depositado</span>
            <span style={{ fontWeight: 700 }}>{fmt$(n(monto))}</span>
          </div>
          <div className="row">
            <span style={{ fontSize: 13, color: '#888' }}>
              Esperado ({cierresDias.length} cierre{cierresDias.length !== 1 ? 's' : ''})
            </span>
            <span style={{ fontWeight: 700 }}>{fmt$(montoEsperado)}</span>
          </div>
          <div
            className={`diff-bar ${difClass}`}
            style={{ marginTop: 8 }}
          >
            <span style={{ fontSize: 14 }}>Diferencia</span>
            <div
              style={{
                fontWeight: 800,
                fontSize: 18,
                color:
                  Math.abs(difDep) < 1 ? '#4ade80' : Math.abs(difDep) <= 5 ? '#facc15' : '#f87171',
              }}
            >
              {Math.abs(difDep) < 0.01
                ? '✓ Cuadra'
                : difDep > 0
                  ? `+${fmt$(difDep)} sobrante`
                  : `${fmt$(Math.abs(difDep))} faltante`}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="sec-title">Fotos del voucher</div>
        <input
          ref={fRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFotos(Array.from(e.target.files))}
          style={{ display: 'none' }}
        />
        <button className="btn btn-ghost" onClick={() => fRef.current.click()} style={{ marginBottom: 8 }}>
          📷 {fotos.length > 0 ? `${fotos.length} foto(s)` : 'Agregar fotos del voucher'}
        </button>
        {fotos.map((f, i) => (
          <div key={i} style={{ fontSize: 12, color: '#4ade80', padding: '4px 0' }}>
            ✓ {f.name}
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Notas</div>
          <input
            className="inp"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Banco, referencia, etc."
          />
        </div>
      </div>

      <button
        className="btn btn-red"
        onClick={submit}
        disabled={loading || (vigentes.length > 0 && !modo)}
        style={{
          fontSize: 17, padding: 18,
          background: vigentes.length > 0 && !modo ? '#2a2a2a' : modo === 'reemplazar' ? '#b91c2c' : undefined,
          color: vigentes.length > 0 && !modo ? '#777' : undefined,
        }}>
        {loading ? <span className="spin" />
          : vigentes.length === 0 ? '🏦  REGISTRAR DEPÓSITO'
          : !modo ? 'Elegí qué hacer con el que ya existe'
          : modo === 'reemplazar' ? '⚠️  ANULAR EL ANTERIOR Y GUARDAR ESTE'
          : '➕  GUARDAR COMO OTRA PARTIDA'}
      </button>
    </div>
  );
}
