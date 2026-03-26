import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
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

export default function Deposito({ user, onBack }) {
  const { show, Toast } = useToast();
  const [monto, setMonto] = useState('');
  const [fechaDep, setFechaDep] = useState(today());
  const [dias, setDias] = useState([today()]);
  const [notas, setNotas] = useState('');
  const [fotos, setFotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cierresDias, setCierresDias] = useState([]);
  const fRef = useRef();
  const lastDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });

  useEffect(() => {
    if (dias.length === 0) {
      setCierresDias([]);
      return;
    }
    db.from('ventas_diarias')
      .select('fecha,efectivo_real_depositar,efectivo_calculado,diferencia_deposito,estado,turno')
      .eq('store_code', user.store_code)
      .in('fecha', dias)
      .then(({ data }) => setCierresDias(data || []));
  }, [dias]);

  const montoEsperado = cierresDias.reduce((s, c) => s + n(c.efectivo_real_depositar), 0);
  const difDep = n(monto) - montoEsperado;
  const difClass =
    n(monto) > 0 && montoEsperado > 0 ? (Math.abs(difDep) < 1 ? 'diff-ok' : Math.abs(difDep) <= 5 ? 'diff-warn' : 'diff-err') : '';

  const submit = async () => {
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
    setLoading(true);
    let fotosUrls = [];
    try {
      fotosUrls = await Promise.all(fotos.map((f) => uploadFoto(f, `depositos/${user.store_code}`)));
    } catch (e) {
      show('❌ Error subiendo foto: ' + e.message);
      setLoading(false);
      return;
    }
    const { error } = await db.from('depositos_bancarios').insert({
      store_code: user.store_code,
      monto: n(monto),
      fecha_deposito: fechaDep,
      dias_cubiertos: dias,
      fotos_urls: fotosUrls,
      notas: notas.trim() || null,
      monto_esperado: parseFloat(montoEsperado.toFixed(2)),
      diferencia_deposito: parseFloat(difDep.toFixed(2)),
      estado: 'pendiente',
      creado_por: `${user.nombre} ${user.apellido}`,
      creado_por_id: user.id,
    });
    setLoading(false);
    if (error) {
      show('❌ ' + error.message);
      return;
    }
    show('✓ Depósito registrado — pendiente de revisión por admin');
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
          <div style={{ fontWeight: 800, fontSize: 17 }}>Depósito Bancario</div>
          <div style={{ fontSize: 12, color: '#666' }}>{STORES[user.store_code]}</div>
        </div>
      </div>

      <div className="card">
        <div className="sec-title">Datos del depósito</div>
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

      <button className="btn btn-red" onClick={submit} disabled={loading} style={{ fontSize: 17, padding: 18 }}>
        {loading ? <span className="spin" /> : '🏦  REGISTRAR DEPÓSITO'}
      </button>
    </div>
  );
}
