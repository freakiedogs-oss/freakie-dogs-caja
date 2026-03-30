import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { STORES, today, n } from '../../config';
import { BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';

const fmt$ = (n) => `$${parseFloat(n || 0).toFixed(2)}`;

const METODOS = ['efectivo', 'tarjeta', 'transferencia', 'link_pago'];
const METODO_LABEL = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  link_pago: 'Link de Pago',
};

const MOTIVOS_EMPLEADO = ['Adelanto de Salario', 'Pago de Salario', 'Pago Propina'];

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

function ModalEgreso({ motivos, onSave, onClose, empleadosSuc }) {
  const [motivo, setMotivo] = useState(null);
  const [monto, setMonto] = useState('');
  const [persona, setPersona] = useState('');
  const [empleadoId, setEmpleadoId] = useState(null);
  const [showNuevoNombre, setShowNuevoNombre] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoApellido, setNuevoApellido] = useState('');
  const [comentario, setComentario] = useState('');
  const [foto, setFoto] = useState(null);
  const fRef = useRef();

  const esMotEmpleado = motivo && MOTIVOS_EMPLEADO.includes(motivo.nombre);
  const personaOk =
    !motivo?.requiere_persona ||
    (esMotEmpleado
      ? empleadoId || (showNuevoNombre && nuevoNombre.trim() && nuevoApellido.trim())
      : persona.trim());
  const ok =
    motivo &&
    n(monto) > 0 &&
    personaOk &&
    (!motivo.requiere_comentario || comentario.trim()) &&
    (!motivo.requiere_foto || foto);

  const selectEmpleado = (emp) => {
    setEmpleadoId(emp.id);
    setPersona(emp.nombre_completo);
    setShowNuevoNombre(false);
  };

  const confirmarNuevo = () => {
    if (!nuevoNombre.trim() || !nuevoApellido.trim()) return;
    setPersona(`${nuevoNombre.trim()} ${nuevoApellido.trim()}`);
    setEmpleadoId(null);
  };

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>Agregar Egreso</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {motivos.map((m) => (
            <div
              key={m.id}
              onClick={() => {
                setMotivo(m);
                setPersona('');
                setEmpleadoId(null);
                setShowNuevoNombre(false);
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 20,
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 600,
                background: motivo?.id === m.id ? '#e63946' : '#1e1e1e',
                color: motivo?.id === m.id ? '#fff' : '#aaa',
                border: `1.5px solid ${motivo?.id === m.id ? '#e63946' : '#333'}`,
              }}
            >
              {m.nombre}
            </div>
          ))}
        </div>
        {motivo && (
          <>
            <Mi label="Monto" value={monto} onChange={setMonto} />

            {motivo.requiere_persona && esMotEmpleado && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Persona que recibe *</div>
                {persona && !showNuevoNombre && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 12px',
                      background: '#14532d33',
                      border: '1px solid #14532d',
                      borderRadius: 10,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ flex: 1, fontWeight: 600, color: '#4ade80' }}>{persona}</span>
                    <button
                      onClick={() => {
                        setPersona('');
                        setEmpleadoId(null);
                      }}
                      style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}
                    >
                      ×
                    </button>
                  </div>
                )}
                {!persona && !showNuevoNombre && (
                  <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 10, border: '1px solid #333' }}>
                    {(empleadosSuc || []).map((emp) => (
                      <div
                        key={emp.id}
                        onClick={() => selectEmpleado(emp)}
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid #222',
                          cursor: 'pointer',
                          fontSize: 14,
                          color: '#ccc',
                        }}
                      >
                        {emp.nombre_completo} <span style={{ fontSize: 11, color: '#555' }}>· {emp.cargo || 'empleado'}</span>
                      </div>
                    ))}
                    <div
                      onClick={() => setShowNuevoNombre(true)}
                      style={{
                        padding: '10px 12px',
                        cursor: 'pointer',
                        fontSize: 13,
                        color: '#60a5fa',
                        borderTop: '1px solid #333',
                        background: '#0d1a2a',
                      }}
                    >
                      + Agregar otra persona (fuera de empleados)
                    </div>
                  </div>
                )}
                {showNuevoNombre && (
                  <div style={{ background: '#1a1a1a', padding: 12, borderRadius: 10, border: '1px solid #333' }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>Persona externa — ingresa nombre y apellido</div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <input
                        className="inp"
                        value={nuevoNombre}
                        onChange={(e) => setNuevoNombre(e.target.value)}
                        placeholder="Nombre"
                        style={{ flex: 1, fontSize: 13 }}
                      />
                      <input
                        className="inp"
                        value={nuevoApellido}
                        onChange={(e) => setNuevoApellido(e.target.value)}
                        placeholder="Apellido"
                        style={{ flex: 1, fontSize: 13 }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowNuevoNombre(false)}>
                        Volver a lista
                      </button>
                      <button
                        className="btn btn-red btn-sm"
                        onClick={confirmarNuevo}
                        disabled={!nuevoNombre.trim() || !nuevoApellido.trim()}
                      >
                        Confirmar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {motivo.requiere_persona && !esMotEmpleado && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Persona que recibe *</div>
                <input
                  className="inp"
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  placeholder="Nombre completo"
                />
              </div>
            )}

            {motivo.requiere_comentario && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Comentario *</div>
                <textarea
                  className="inp"
                  rows={2}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Describe el gasto..."
                  style={{ resize: 'none' }}
                />
              </div>
            )}
            {motivo.requiere_foto && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Foto requerida *</div>
                <input
                  ref={fRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => setFoto(e.target.files[0])}
                  style={{ display: 'none' }}
                />
                <button className="btn btn-ghost" onClick={() => fRef.current.click()} style={{ width: 'auto', padding: '10px 20px' }}>
                  {foto ? `✓ ${foto.name}` : '📷 Foto'}
                </button>
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
            Cancelar
          </button>
          <button
            className="btn btn-red"
            onClick={() =>
              ok &&
              onSave({
                motivo_id: motivo.id,
                motivo_nombre: motivo.nombre,
                monto: n(monto),
                persona_recibe: persona.trim() || null,
                empleado_id: empleadoId,
                comentario: comentario.trim() || null,
                foto_file: foto || null,
                foto_url: null,
              })
            }
            disabled={!ok}
            style={{ flex: 2, opacity: ok ? 1 : 0.4 }}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalIngreso({ motivos, onSave, onClose }) {
  const [motivo, setMotivo] = useState(null);
  const [monto, setMonto] = useState('');
  const [evento, setEvento] = useState('');
  const [comentario, setComentario] = useState('');
  const ok =
    motivo &&
    n(monto) > 0 &&
    (!motivo.requiere_evento || evento.trim()) &&
    (!motivo.requiere_comentario || comentario.trim());

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>Agregar Ingreso</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {motivos.map((m) => (
            <div
              key={m.id}
              onClick={() => setMotivo(m)}
              style={{
                padding: '8px 14px',
                borderRadius: 20,
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 600,
                background: motivo?.id === m.id ? '#2563eb' : '#1e1e1e',
                color: motivo?.id === m.id ? '#fff' : '#aaa',
                border: `1.5px solid ${motivo?.id === m.id ? '#2563eb' : '#333'}`,
              }}
            >
              {m.nombre}
            </div>
          ))}
        </div>
        {motivo && (
          <>
            <Mi label="Monto" value={monto} onChange={setMonto} />
            {motivo.requiere_evento && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Nombre del evento *</div>
                <input className="inp" value={evento} onChange={(e) => setEvento(e.target.value)} placeholder="Nombre del evento" />
              </div>
            )}
            {motivo.requiere_comentario && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Comentario *</div>
                <textarea
                  className="inp"
                  rows={2}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Explica el ingreso..."
                  style={{ resize: 'none' }}
                />
              </div>
            )}
          </>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
            Cancelar
          </button>
          <button
            className="btn btn-red"
            onClick={() =>
              ok &&
              onSave({
                motivo_id: motivo.id,
                motivo_nombre: motivo.nombre,
                monto: n(monto),
                nombre_evento: evento.trim() || null,
                comentario: comentario.trim() || null,
              })
            }
            disabled={!ok}
            style={{ flex: 2, opacity: ok ? 1 : 0.4 }}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalAjuste({ onSave, onClose }) {
  const [monto, setMonto] = useState('');
  const [de, setDe] = useState('efectivo');
  const [a, setA] = useState('tarjeta');
  const [nota, setNota] = useState('');
  const ok = n(monto) > 0 && de !== a;

  return (
    <div className="modal-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 16 }}>Ajuste Cruce de Método</div>
        <Mi label="Monto del ajuste" value={monto} onChange={setMonto} />
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>De método</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {METODOS.map((m) => (
              <button key={m} className={`method-btn${de === m ? ' active' : ''}`} onClick={() => setDe(m)}>
                {METODO_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>A método</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {METODOS.map((m) => (
              <button key={m} className={`method-btn${a === m ? ' active' : ''}`} onClick={() => setA(m)}>
                {METODO_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        {de === a && (
          <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>Los métodos deben ser diferentes</div>
        )}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Nota (opcional)</div>
          <input
            className="inp"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej: cliente pagó con tarjeta pero se registró como efectivo"
          />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>
            Cancelar
          </button>
          <button
            className="btn btn-red"
            onClick={() => ok && onSave({ monto: n(monto), de_metodo: de, a_metodo: a, nota: nota.trim() || null })}
            disabled={!ok}
            style={{ flex: 2, opacity: ok ? 1 : 0.4 }}
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CierreForm({ user, existingCierre, isAdminEdit, onBack, onSuccess }) {
  // Roles que pueden elegir sucursal (no tienen sucursal fija o son CM001)
  const esRolLibre = ['ejecutivo', 'admin'].includes(user.rol);
  const necesitaElegir = !isAdminEdit && !existingCierre && (!user.store_code || user.store_code === 'CM001');

  // Si no es ejecutivo/admin Y no tiene sucursal → bloquear
  if (necesitaElegir && !esRolLibre) {
    return (
      <div style={{ padding: 20, maxWidth: 480, margin: '0 auto' }}>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>← Volver</button>
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🚫</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Cierre no disponible</div>
          <div style={{ color: '#aaa', fontSize: 14 }}>No tienes una sucursal asignada. Contacta al administrador.</div>
        </div>
      </div>
    );
  }

  const isEdit = !!existingCierre;
  const { show, Toast } = useToast();
  const [fecha, setFecha] = useState(existingCierre?.fecha || today());
  const [turno, setTurno] = useState(existingCierre?.turno || 'completo');
  const [selectedStore, setSelectedStore] = useState(necesitaElegir ? '' : (user.store_code || ''));
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [cierresDelDia, setCierresDelDia] = useState([]); // turnos ya enviados para fecha+sucursal
  const [motEg, setMotEg] = useState([]);
  const [motIn, setMotIn] = useState([]);
  const [egresos, setEgresos] = useState([]);
  const [ingresos, setIngresos] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [depInfo, setDepInfo] = useState(null); // depósito vinculado (solo lectura en edit)
  const [showEg, setShowEg] = useState(false);
  const [showIn, setShowIn] = useState(false);
  const [showAj, setShowAj] = useState(false);
  const [loadingRelated, setLoadingRelated] = useState(isEdit);
  const [ventas, setVentas] = useState({
    efectivo_quanto: existingCierre ? String(existingCierre.efectivo_quanto || 0) : '',
    tarjeta_quanto: existingCierre ? String(existingCierre.tarjeta_quanto || 0) : '',
    ventas_transferencia: existingCierre ? String(existingCierre.ventas_transferencia || 0) : '',
    ventas_link_pago: existingCierre ? String(existingCierre.ventas_link_pago || 0) : '',
  });
  const [efectivoReal, setEfectivoReal] = useState(existingCierre ? String(existingCierre.efectivo_real_depositar || '') : '');
  const [obs, setObs] = useState(existingCierre?.observaciones || '');
  const [comentarioCorreccion, setComentarioCorreccion] = useState(existingCierre?.comentario_correccion || '');
  const [empleadosSuc, setEmpleadosSuc] = useState([]);

  const esCorreccion = isEdit && existingCierre?.estado === 'requiere_correccion';
  const sv = (k) => (v) => setVentas((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    db.from('motivos_egreso')
      .select('*')
      .eq('activo', true)
      .order('orden')
      .then(({ data }) => setMotEg(data || []));
    db.from('motivos_ingreso')
      .select('*')
      .eq('activo', true)
      .order('orden')
      .then(({ data }) => setMotIn(data || []));

    const storeCode = existingCierre?.store_code || selectedStore;
    if (storeCode) {
      db.from('sucursales')
        .select('id')
        .eq('store_code', storeCode)
        .maybeSingle()
        .then(({ data: suc }) => {
          if (suc)
            db.from('empleados')
              .select('id,nombre_completo,cargo')
              .eq('sucursal_id', suc.id)
              .eq('activo', true)
              .order('nombre_completo')
              .then(({ data }) => setEmpleadosSuc(data || []));
        });
    }

    if (isEdit) {
      setLoadingRelated(true);
      // Limpiar state antes de cargar para evitar duplicados
      setEgresos([]); setIngresos([]); setAjustes([]); setDepInfo(null);
      Promise.all([
        db.from('egresos_cierre').select('*').eq('cierre_id', existingCierre.id),
        db.from('ingresos_cierre').select('*').eq('cierre_id', existingCierre.id),
        db.from('ajustes_metodo').select('*').eq('cierre_id', existingCierre.id),
        db.from('depositos_bancarios').select('*').eq('store_code', existingCierre.store_code).contains('dias_cubiertos', [existingCierre.fecha]).limit(1),
      ]).then(([eg, ing, aj, dep]) => {
        // Deduplicar por id para prevenir duplicados
        const dedupe = (arr) => { const seen = new Set(); return (arr||[]).filter(r => r.id && !seen.has(r.id) && seen.add(r.id)); };
        setEgresos(dedupe(eg.data));
        setIngresos(dedupe(ing.data));
        setAjustes(aj.data || []);
        setDepInfo((dep.data || [])[0] || null);
        setLoadingRelated(false);
      });
    }
  }, []);

  // Consultar cierres ya existentes para esta fecha+sucursal
  useEffect(() => {
    if (isEdit || !fecha || !selectedStore) return;
    db.from('ventas_diarias')
      .select('turno,estado')
      .eq('store_code', selectedStore)
      .eq('fecha', fecha)
      .then(({ data }) => {
        const existentes = data || [];
        setCierresDelDia(existentes);
        // Si ya hay un cierre "completo", sugerir "tarde" para el segundo
        if (existentes.some(c => c.turno === 'completo')) {
          setTurno('tarde');
        }
      });
  }, [fecha, selectedStore]);

  useEffect(() => {
    if (isEdit || !fecha || !selectedStore) return;
    setFetching(true);
    db.rpc('exec_sql_batch', {
      sql_text: `
      SELECT
        COALESCE(SUM(CASE WHEN metodo_pago ILIKE '%efectivo%' THEN total ELSE 0 END),0)::numeric(10,2) as ef,
        COALESCE(SUM(CASE WHEN metodo_pago ILIKE '%tarjeta%' OR metodo_pago ILIKE '%card%' THEN total ELSE 0 END),0)::numeric(10,2) as tar,
        COALESCE(SUM(CASE WHEN metodo_pago ILIKE '%transfer%' THEN total ELSE 0 END),0)::numeric(10,2) as tra,
        COALESCE(SUM(CASE WHEN metodo_pago ILIKE '%link%' THEN total ELSE 0 END),0)::numeric(10,2) as lnk
      FROM quanto_transacciones
      WHERE store_code='${selectedStore}' AND fecha::date='${fecha}'
    `,
    }).then(({ data, error }) => {
      if (!error && data) {
        const r = Array.isArray(data) ? data[0] : data;
        if (r && r.ef !== undefined) {
          setVentas({
            efectivo_quanto: String(r.ef || 0),
            tarjeta_quanto: String(r.tar || 0),
            ventas_transferencia: String(r.tra || 0),
            ventas_link_pago: String(r.lnk || 0),
          });
          show('✓ Ventas QUANTO cargadas');
        }
      }
      setFetching(false);
    });
  }, [fecha, selectedStore]);

  const ef = n(ventas.efectivo_quanto);
  const totalEg = egresos.reduce((s, e) => s + n(e.monto), 0);
  const totalIn = ingresos.reduce((s, e) => s + n(e.monto), 0);
  const totalVentas = ef + n(ventas.tarjeta_quanto) + n(ventas.ventas_transferencia) + n(ventas.ventas_link_pago);
  const efCalculado = ef - totalEg + totalIn;
  const efReal = n(efectivoReal);
  const difDeposito = efReal - efCalculado;
  const difClass = () => {
    const a = Math.abs(difDeposito);
    if (efReal === 0) return 'diff-bar';
    if (a < 1) return 'diff-bar diff-ok';
    if (a <= 5) return 'diff-bar diff-warn';
    return 'diff-bar diff-err';
  };

  const handleSubmit = async () => {
    if (!ventas.efectivo_quanto && ventas.efectivo_quanto !== '0') {
      show('⚠️ Completa las ventas QUANTO');
      return;
    }
    if (!efectivoReal) {
      show('⚠️ Ingresa el efectivo real a depositar');
      return;
    }
    if (!selectedStore && !existingCierre?.store_code) {
      show('⚠️ Selecciona una sucursal');
      return;
    }
    if (!isEdit && cierresDelDia.length >= 2) {
      show('⚠️ Ya hay 2 cierres para esta fecha. Máximo permitido.');
      return;
    }
    if (!isEdit && cierresDelDia.some(c => c.turno === turno)) {
      show(`⚠️ Ya existe un cierre "${turno}" para esta fecha`);
      return;
    }
    setLoading(true);
    const storeCode = existingCierre?.store_code || selectedStore;
    const payload = {
      fecha,
      store_code: storeCode,
      turno,
      efectivo_quanto: ef,
      tarjeta_quanto: n(ventas.tarjeta_quanto),
      ventas_transferencia: n(ventas.ventas_transferencia),
      ventas_link_pago: n(ventas.ventas_link_pago),
      total_ventas_quanto: parseFloat(totalVentas.toFixed(2)),
      total_egresos: parseFloat(totalEg.toFixed(2)),
      total_ingresos: parseFloat(totalIn.toFixed(2)),
      efectivo_calculado: parseFloat(efCalculado.toFixed(2)),
      efectivo_real_depositar: efReal,
      diferencia_deposito: parseFloat(difDeposito.toFixed(2)),
      estado: 'enviado',
      observaciones: obs.trim() || null,
      creado_por: existingCierre?.creado_por || `${user.nombre} ${user.apellido}`,
      creado_por_id: existingCierre?.creado_por_id || user.id,
    };

    let cierreId;
    if (isEdit) {
      const updatePayload = {
        ...payload,
        aprobado_por: existingCierre.estado === 'aprobado' ? existingCierre.aprobado_por : null,
        aprobado_at: existingCierre.estado === 'aprobado' ? existingCierre.aprobado_at : null,
        comentario_correccion: esCorreccion ? (comentarioCorreccion.trim() || null) : existingCierre.comentario_correccion || null,
      };
      if (!esCorreccion) updatePayload.comentario_aprobacion = null;
      const { error } = await db.from('ventas_diarias').update(updatePayload).eq('id', existingCierre.id);
      if (error) {
        show('❌ ' + error.message);
        setLoading(false);
        return;
      }
      cierreId = existingCierre.id;
      await db.from('egresos_cierre').delete().eq('cierre_id', cierreId);
      await db.from('ingresos_cierre').delete().eq('cierre_id', cierreId);
      await db.from('ajustes_metodo').delete().eq('cierre_id', cierreId);
    } else {
      const { data: cierre, error } = await db
        .from('ventas_diarias')
        .upsert(payload, { onConflict: 'fecha,store_code,turno' })
        .select()
        .single();
      if (error) {
        show('❌ ' + error.message);
        setLoading(false);
        return;
      }
      cierreId = cierre.id;
    }

    if (egresos.length > 0) {
      const egresosConFoto = await Promise.all(
        egresos.map(async (e) => {
          let fotoUrl = e.foto_url || null;
          if (e.foto_file) {
            try {
              fotoUrl = await uploadFoto(e.foto_file, `egresos/${selectedStore}`);
            } catch (err) {
              console.warn('foto egreso no subida:', err.message);
            }
          }
          return {
            cierre_id: cierreId,
            motivo_id: e.motivo_id,
            motivo_nombre: e.motivo_nombre,
            monto: n(e.monto),
            persona_recibe: e.persona_recibe || null,
            empleado_id: e.empleado_id || null,
            comentario: e.comentario || null,
            foto_url: fotoUrl,
          };
        })
      );
      await db.from('egresos_cierre').insert(egresosConFoto);
    }

    if (ingresos.length > 0)
      await db
        .from('ingresos_cierre')
        .insert(
          ingresos.map((e) => ({
            cierre_id: cierreId,
            motivo_id: e.motivo_id,
            motivo_nombre: e.motivo_nombre,
            monto: n(e.monto),
            nombre_evento: e.nombre_evento || null,
            comentario: e.comentario || null,
          }))
        );

    if (ajustes.length > 0)
      await db
        .from('ajustes_metodo')
        .insert(
          ajustes.map((a) => ({
            cierre_id: cierreId,
            monto: n(a.monto),
            de_metodo: a.de_metodo,
            a_metodo: a.a_metodo,
            nota: a.nota || null,
          }))
        );

    setLoading(false);
    show(isEdit ? '✅ Cierre actualizado correctamente' : '✅ Cierre enviado correctamente');
    setTimeout(() => {
      if (onSuccess) onSuccess({ ...payload, diferencia: difDeposito, cierre_id: cierreId });
    }, 1500);
  };

  const storeLabel = existingCierre ? STORES[existingCierre.store_code] || existingCierre.store_code : STORES[selectedStore] || 'Seleccionar sucursal';

  if (loadingRelated)
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spin" style={{ width: 36, height: 36 }} />
      </div>
    );

  return (
    <div style={{ minHeight: '100vh', padding: '0 16px 50px' }}>
      <Toast />
      {showEg && (
        <ModalEgreso
          motivos={motEg}
          empleadosSuc={empleadosSuc}
          onClose={() => setShowEg(false)}
          onSave={(e) => {
            setEgresos((p) => [...p, e]);
            setShowEg(false);
          }}
        />
      )}
      {showIn && (
        <ModalIngreso
          motivos={motIn}
          onClose={() => setShowIn(false)}
          onSave={(e) => {
            setIngresos((p) => [...p, e]);
            setShowIn(false);
          }}
        />
      )}
      {showAj && (
        <ModalAjuste
          onClose={() => setShowAj(false)}
          onSave={(a) => {
            setAjustes((p) => [...p, a]);
            setShowAj(false);
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0 12px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 26, cursor: 'pointer', padding: '0 4px' }}>
          ‹
        </button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{storeLabel}</div>
          <div style={{ fontSize: 12, color: '#666' }}>
            {isAdminEdit ? '✏️ Edición Admin' : isEdit ? 'Editar Cierre' : 'Cierre de Caja'} · {isAdminEdit ? user.nombre + ' ' + user.apellido : user.nombre + ' ' + user.apellido}
          </div>
        </div>
        {fetching && <div className="spin" style={{ marginLeft: 'auto' }} />}
      </div>

      {/* Selector de sucursal para ejecutivos/admin sin sucursal fija */}
      {necesitaElegir && esRolLibre && !isEdit && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="sec-title">Sucursal</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(STORES).filter(([sc]) => sc !== 'CM001').map(([sc, name]) => (
              <div
                key={sc}
                onClick={() => setSelectedStore(sc)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: selectedStore === sc ? '2px solid #e63946' : '1.5px solid #333',
                  background: selectedStore === sc ? '#e6394622' : '#1a1a1a',
                  color: selectedStore === sc ? '#fff' : '#888',
                  fontWeight: selectedStore === sc ? 700 : 400,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      )}

      {isEdit && existingCierre.estado === 'requiere_correccion' && existingCierre.comentario_aprobacion && (
        <div style={{ background: '#2a1500', border: '1px solid #7c2d12', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#f97316' }}>
          💬 <strong>Corrección solicitada:</strong> {existingCierre.comentario_aprobacion}
        </div>
      )}

      <div className="card">
        <div className="sec-title">Fecha y Turno</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 5 }}>Fecha</div>
          <input
            type="date"
            className="inp"
            value={fecha}
            readOnly={isEdit}
            onChange={(e) => setFecha(e.target.value)}
            style={{ background: isEdit ? '#161616' : undefined, color: isEdit ? '#555' : '#fff' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['mañana', 'tarde', 'completo'].map((t) => {
            const yaExiste = !isEdit && cierresDelDia.some(c => c.turno === t);
            return (
              <button
                key={t}
                className={`method-btn${turno === t ? ' active' : ''}`}
                onClick={() => !isEdit && !yaExiste && setTurno(t)}
                style={{
                  padding: '12px 6px', fontSize: 14, flex: 1,
                  opacity: isEdit ? 0.5 : yaExiste ? 0.3 : 1,
                  cursor: isEdit || yaExiste ? 'default' : 'pointer',
                  textDecoration: yaExiste ? 'line-through' : 'none',
                }}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {yaExiste && ' ✓'}
              </button>
            );
          })}
        </div>
        {!isEdit && cierresDelDia.length > 0 && (
          <div style={{ fontSize: 12, color: '#facc15', marginTop: 8, background: 'rgba(250,204,21,0.08)', borderRadius: 8, padding: '6px 10px' }}>
            Ya {cierresDelDia.length === 1 ? 'hay 1 cierre' : `hay ${cierresDelDia.length} cierres`} para esta fecha.
            {cierresDelDia.length < 2 ? ' Puedes agregar un segundo turno.' : ' Máximo 2 cierres por día.'}
          </div>
        )}
        {isEdit && (
          <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>* Fecha y turno no se pueden cambiar al editar</div>
        )}
      </div>

      <div className="card">
        <div className="sec-title">Ventas QUANTO {fetching && '(cargando...)'}</div>
        <Mi label="Efectivo QUANTO" value={ventas.efectivo_quanto} onChange={sv('efectivo_quanto')} hint={!isEdit ? 'Auto' : undefined} />
        <Mi label="Tarjeta QUANTO" value={ventas.tarjeta_quanto} onChange={sv('tarjeta_quanto')} hint={!isEdit ? 'Auto' : undefined} />
        <Mi label="Ventas por Transferencia" value={ventas.ventas_transferencia} onChange={sv('ventas_transferencia')} />
        <Mi label="Ventas de Link de Pago" value={ventas.ventas_link_pago} onChange={sv('ventas_link_pago')} />
        <div className="row" style={{ marginTop: 4 }}>
          <span style={{ fontSize: 13, color: '#888' }}>Total ventas QUANTO</span>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{fmt$(totalVentas)}</span>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="sec-title" style={{ marginBottom: 0 }}>Egresos del día</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowEg(true)}>
            + Agregar
          </button>
        </div>
        {egresos.length === 0 && (
          <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>Sin egresos registrados</div>
        )}
        {egresos.map((e, i) => (
          <div key={i} className="line-item">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{e.motivo_nombre}</div>
              {e.persona_recibe && <div style={{ fontSize: 12, color: '#888' }}>→ {e.persona_recibe}</div>}
              {e.comentario && <div style={{ fontSize: 12, color: '#888' }}>{e.comentario}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, color: '#f87171' }}>{fmt$(e.monto)}</span>
              <button onClick={() => setEgresos((p) => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>
                ×
              </button>
            </div>
          </div>
        ))}
        {egresos.length > 0 && (
          <div className="row" style={{ marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#888' }}>Total egresos</span>
            <span style={{ fontWeight: 700, color: '#f87171' }}>{fmt$(totalEg)}</span>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="sec-title" style={{ marginBottom: 0 }}>Ingresos del día</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowIn(true)}>
            + Agregar
          </button>
        </div>
        {ingresos.length === 0 && (
          <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>Sin ingresos adicionales</div>
        )}
        {ingresos.map((e, i) => (
          <div key={i} className="line-item">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{e.motivo_nombre}</div>
              {e.nombre_evento && <div style={{ fontSize: 12, color: '#888' }}>Evento: {e.nombre_evento}</div>}
              {e.comentario && <div style={{ fontSize: 12, color: '#888' }}>{e.comentario}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontWeight: 700, color: '#4ade80' }}>{fmt$(e.monto)}</span>
              <button onClick={() => setIngresos((p) => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>
                ×
              </button>
            </div>
          </div>
        ))}
        {ingresos.length > 0 && (
          <div className="row" style={{ marginTop: 4 }}>
            <span style={{ fontSize: 13, color: '#888' }}>Total ingresos</span>
            <span style={{ fontWeight: 700, color: '#4ade80' }}>{fmt$(totalIn)}</span>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="sec-title" style={{ marginBottom: 0 }}>Ajuste Cruce de Método</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowAj(true)}>
            + Agregar
          </button>
        </div>
        {ajustes.length === 0 && <div style={{ color: '#444', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>Sin ajustes</div>}
        {ajustes.map((a, i) => (
          <div key={i} className="line-item">
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{fmt$(a.monto)}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {METODO_LABEL[a.de_metodo]} → {METODO_LABEL[a.a_metodo]}
              </div>
              {a.nota && <div style={{ fontSize: 12, color: '#555' }}>{a.nota}</div>}
            </div>
            <button onClick={() => setAjustes((p) => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="sec-title">Resumen de Efectivo</div>
        <div className="row">
          <span style={{ fontSize: 13, color: '#888' }}>Efectivo QUANTO</span>
          <span style={{ fontWeight: 600 }}>{fmt$(ef)}</span>
        </div>
        <div className="row">
          <span style={{ fontSize: 13, color: '#888' }}>(-) Total egresos</span>
          <span style={{ fontWeight: 600, color: '#f87171' }}>-{fmt$(totalEg)}</span>
        </div>
        <div className="row">
          <span style={{ fontSize: 13, color: '#888' }}>(+) Total ingresos</span>
          <span style={{ fontWeight: 600, color: '#4ade80' }}>+{fmt$(totalIn)}</span>
        </div>
        <div className="row" style={{ borderBottom: '2px solid #333', paddingBottom: 14, marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Efectivo calculado a depositar</span>
          <span style={{ fontWeight: 800, fontSize: 17 }}>{fmt$(efCalculado)}</span>
        </div>
        <Mi label="Efectivo REAL que vas a depositar ★" value={efectivoReal} onChange={setEfectivoReal} hint="Requerido" />
        {n(efectivoReal) > 0 && (
          <div className={difClass()}>
            <span style={{ fontSize: 14 }}>Diferencia</span>
            <div style={{ fontWeight: 800, fontSize: 18, color: Math.abs(difDeposito) < 1 ? '#4ade80' : Math.abs(difDeposito) <= 5 ? '#facc15' : '#f87171' }}>
              {Math.abs(difDeposito) < 0.01 ? '✓ Cuadra' : difDeposito > 0 ? `+${fmt$(difDeposito)} sobrante` : `${fmt$(Math.abs(difDeposito))} faltante`}
            </div>
          </div>
        )}
      </div>

      {/* Depósito bancario vinculado (solo lectura) */}
      {depInfo && (
        <div className="card" style={{ border: '1px solid #14532d' }}>
          <div className="sec-title">🏦 Depósito Bancario Vinculado</div>
          <div className="row">
            <span style={{ color: '#888', fontSize: 13 }}>Monto depositado</span>
            <span style={{ fontWeight: 800, fontSize: 17 }}>{fmt$(depInfo.monto)}</span>
          </div>
          {depInfo.monto_esperado != null && (
            <div className="row">
              <span style={{ color: '#888', fontSize: 13 }}>Monto esperado</span>
              <span style={{ fontWeight: 600 }}>{fmt$(depInfo.monto_esperado)}</span>
            </div>
          )}
          {depInfo.diferencia_deposito != null && (
            <div className="row">
              <span style={{ color: '#888', fontSize: 13 }}>Diferencia depósito</span>
              <span style={{ fontWeight: 700, color: Math.abs(depInfo.diferencia_deposito) < 1 ? '#4ade80' : '#f87171' }}>
                {Math.abs(depInfo.diferencia_deposito) < 0.01 ? '✓ OK' : fmt$(depInfo.diferencia_deposito)}
              </span>
            </div>
          )}
          <div className="row">
            <span style={{ color: '#888', fontSize: 13 }}>Estado</span>
            <span style={{ fontWeight: 700, color: depInfo.estado === 'confirmado' ? '#4ade80' : '#facc15' }}>
              {depInfo.estado === 'confirmado' ? '✓ Confirmado' : '⏳ Pendiente'}
            </span>
          </div>
          {(depInfo.fotos_urls || []).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener" style={{ display: 'block', marginTop: 8 }}>
              <img src={url} style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 8, border: '1px solid #333', background: '#111' }} alt={`Foto depósito ${i + 1}`} />
            </a>
          ))}
          {depInfo.notas && <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 6 }}>📝 {depInfo.notas}</div>}
        </div>
      )}

      <div className="card">
        <div className="sec-title">Observaciones</div>
        <textarea
          className="inp"
          rows={3}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Notas del día, incidencias..."
          style={{ resize: 'none' }}
        />
      </div>

      {esCorreccion && (
        <div className="card">
          <div className="sec-title">Tu Respuesta a la Corrección</div>
          <textarea
            className="inp"
            rows={3}
            value={comentarioCorreccion}
            onChange={(e) => setComentarioCorreccion(e.target.value)}
            placeholder="Explica los cambios realizados..."
            style={{ resize: 'none' }}
          />
        </div>
      )}

      <button className="btn btn-red" onClick={handleSubmit} disabled={loading} style={{ fontSize: 17, padding: 18 }}>
        {loading ? <span className="spin" /> : isEdit ? '💾  GUARDAR CAMBIOS' : '✓  ENVIAR CIERRE'}
      </button>
    </div>
  );
}
