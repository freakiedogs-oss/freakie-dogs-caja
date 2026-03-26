import { useState, useEffect, useRef } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { BUCKET_CIERRES as BUCKET } from '../../config';
import { useToast } from '../../hooks/useToast';

const INCIDENTES_CATS = [
  {
    cat: 'personal',
    icon: '👥',
    label: 'Personal',
    items: [{ id: 'conflicto_empleados', label: 'Conflicto entre empleados', hint: 'Discusión o problema de equipo' }],
  },
  {
    cat: 'operaciones',
    icon: '⚙️',
    label: 'Operaciones',
    items: [
      { id: 'falta_producto', label: 'Falta de producto/insumo', hint: 'Ingrediente o material agotado' },
      { id: 'equipo_danado', label: 'Equipo o maquinaria dañada', hint: 'Freidora, plancha, POS, refrigerador…' },
      { id: 'corte_servicios', label: 'Corte de luz / agua / internet', hint: 'Servicio interrumpido' },
      { id: 'problema_pos', label: 'Problema con sistema QUANTO/POS', hint: 'Lento, caído o con errores' },
    ],
  },
  {
    cat: 'cliente',
    icon: '🚨',
    label: 'Clientes',
    items: [
      { id: 'queja_cliente', label: 'Queja de cliente', hint: 'Reclamo por comida, servicio o tiempo' },
      { id: 'altercado_cliente', label: 'Altercado / cliente agresivo', hint: 'Discusión o situación tensa' },
      { id: 'pedido_incorrecto', label: 'Pedido incorrecto entregado', hint: 'Error de orden que llegó al cliente' },
    ],
  },
  {
    cat: 'higiene',
    icon: '🧽',
    label: 'Higiene & Seguridad',
    items: [
      { id: 'problema_higiene', label: 'Problema de higiene', hint: 'Plaga, baño fuera de servicio, limpieza' },
      { id: 'accidente_empleado', label: 'Accidente de empleado', hint: 'Quemadura, corte, caída…' },
      { id: 'robo_hurto', label: 'Robo / hurto', hint: 'Interno o externo' },
    ],
  },
];

const uploadFoto = async (file, folder) => {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw new Error(error.message);
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

export default function ReporteForm({ user, onBack }) {
  const { show, Toast } = useToast();
  const [estadoTurno, setEstadoTurno] = useState('sin_novedad');
  const [incSel, setIncSel] = useState({});
  const [empleados, setEmpleados] = useState([]);
  const [ausencias, setAusencias] = useState({});
  const [extraNombre, setExtraNombre] = useState('');
  const [extras, setExtras] = useState([]);
  const [notas, setNotas] = useState('');
  const [fotos, setFotos] = useState([]);
  const [mejoras, setMejoras] = useState([]);
  const [mejoraDesc, setMejoraDesc] = useState('');
  const [mejoraFotos, setMejoraFotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [yaEnviado, setYaEnviado] = useState(null);
  const fRef = useRef();
  const mfRef = useRef();

  useEffect(() => {
    db.from('sucursales')
      .select('id')
      .eq('store_code', user.store_code)
      .maybeSingle()
      .then(({ data: suc }) => {
        if (suc) {
          db.from('empleados')
            .select('id,nombre_completo,cargo')
            .eq('sucursal_id', suc.id)
            .eq('activo', true)
            .order('nombre_completo')
            .then(({ data }) => {
              const lista = (data || []).map((e) => ({ id: e.id, nombre: e.nombre_completo, rol: e.cargo || 'empleado' }));
              setEmpleados(lista);
            });
        }
      });
    db.from('reportes_turno')
      .select('*')
      .eq('fecha', today())
      .eq('store_code', user.store_code)
      .maybeSingle()
      .then(({ data }) => {
        setYaEnviado(data || null);
        if (data)
          db.from('mejoras_reporte')
            .select('*')
            .eq('reporte_id', data.id)
            .then(({ data: mej }) => {
              if (mej && mej.length > 0)
                setMejoras(mej.map((m) => ({ descripcion: m.descripcion, fotos: [], fotosUrls: m.fotos_urls || [] })));
            });
      });
  }, []);

  const toggleInc = (id, cat, label) => {
    setIncSel((prev) => {
      if (prev[id]) {
        const n = { ...prev };
        delete n[id];
        return n;
      }
      return { ...prev, [id]: { cat, label, severidad: 'leve', detalle: '', requiere_accion: false } };
    });
  };

  const setIncField = (id, field, val) => setIncSel((prev) => ({ ...prev, [id]: { ...prev[id], [field]: val } }));

  const AUSENCIA_CFG = [
    { tipo: 'tarde', label: 'Tarde', color: '#713f12', tc: '#facc15' },
    { tipo: 'con_permiso', label: 'Con permiso', color: '#1e3a5f', tc: '#60a5fa' },
    { tipo: 'sin_permiso', label: 'Sin permiso', color: '#7f1d1d', tc: '#f87171' },
  ];

  const addExtra = () => {
    if (!extraNombre.trim()) return;
    setExtras((p) => [...p, { nombre: extraNombre.trim(), tipo: null }]);
    setExtraNombre('');
  };

  const addMejora = () => {
    if (!mejoraDesc.trim()) return;
    setMejoras((p) => [...p, { descripcion: mejoraDesc.trim(), fotos: [...mejoraFotos] }]);
    setMejoraDesc('');
    setMejoraFotos([]);
  };

  const removeMejora = (i) => setMejoras((p) => p.filter((_, idx) => idx !== i));

  const submit = async () => {
    setLoading(true);
    let fotosUrls = [];
    try {
      if (fotos.length > 0)
        fotosUrls = await Promise.all(fotos.map((f) => uploadFoto(f, `incidentes/${user.store_code}`)));
    } catch (e) {
      show('❌ Error subiendo foto: ' + e.message);
      setLoading(false);
      return;
    }

    const { data: rep, error: repErr } = await db
      .from('reportes_turno')
      .insert({
        fecha: today(),
        store_code: user.store_code,
        estado_turno: estadoTurno,
        fotos_urls: fotosUrls,
        notas: notas.trim() || null,
        creado_por: `${user.nombre} ${user.apellido}`,
        creado_por_id: user.id,
      })
      .select()
      .single();
    if (repErr) {
      show('❌ ' + repErr.message);
      setLoading(false);
      return;
    }

    const incRows = Object.entries(incSel).map(([tipo_id, v]) => ({
      reporte_id: rep.id,
      categoria: INCIDENTES_CATS.find((c) => c.items.find((i) => i.id === tipo_id))?.cat || 'otro',
      tipo_id,
      tipo_label: v.label,
      severidad: v.severidad,
      detalle: v.detalle || null,
    }));
    if (incRows.length > 0) {
      const { data: incData } = await db.from('incidentes_reporte').insert(incRows).select();
      if (incData) {
        const accRows = incData
          .filter((_, i) => {
            const [, v] = Object.entries(incSel)[i] || [];
            return v && v.requiere_accion;
          })
          .map((inc) => ({
            incidente_id: inc.id,
            store_code: user.store_code,
            descripcion: inc.tipo_label + ' — ' + (inc.detalle || 'Sin detalle'),
            estado: 'pendiente',
            creado_por: `${user.nombre} ${user.apellido}`,
          }));
        if (accRows.length > 0) await db.from('acciones_pendientes').insert(accRows);
      }
    }

    const ausRows = [];
    empleados.forEach((e) => {
      const tipo = ausencias[e.id];
      if (tipo) ausRows.push({ reporte_id: rep.id, empleado_nombre: e.nombre, empleado_id: e.id, tipo, nota: null });
    });
    extras.forEach((e) => {
      if (e.tipo) ausRows.push({ reporte_id: rep.id, empleado_nombre: e.nombre, empleado_id: null, tipo: e.tipo, nota: null });
    });
    if (ausRows.length > 0) await db.from('ausencias_reporte').insert(ausRows);

    if (mejoras.length > 0) {
      for (const m of mejoras) {
        let mFotosUrls = [];
        if (m.fotos.length > 0) mFotosUrls = await Promise.all(m.fotos.map((f) => uploadFoto(f, `mejoras/${user.store_code}`)));
        await db.from('mejoras_reporte').insert({ reporte_id: rep.id, descripcion: m.descripcion, fotos_urls: mFotosUrls });
      }
    }

    setLoading(false);
    setYaEnviado(rep);
    show('✓ Reporte enviado correctamente');
  };

  const ESTADO_OPTS = [
    { v: 'sin_novedad', icon: '✅', label: 'Sin novedad', color: '#14532d', tc: '#4ade80' },
    { v: 'novedades_menores', icon: '🟡', label: 'Novedades menores', color: '#713f12', tc: '#facc15' },
    { v: 'moderado', icon: '🟠', label: 'Incidentes moderados', color: '#431c03', tc: '#f97316' },
    { v: 'grave', icon: '🔴', label: 'Incidentes graves', color: '#7f1d1d', tc: '#f87171' },
  ];

  return (
    <div style={{ minHeight: '100vh', padding: '0 16px 60px' }}>
      <Toast />
      <div style={{ padding: '20px 0 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#888', fontSize: 22, cursor: 'pointer', padding: 0 }}>
          ←
        </button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>📋 Reporte de Turno</div>
          <div style={{ color: '#555', fontSize: 12 }}>
            {STORES[user.store_code]} · {today()}
          </div>
        </div>
      </div>

      {yaEnviado && (
        <div style={{ background: '#14532d33', border: '1px solid #14532d', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#4ade80', marginBottom: 4 }}>✓ Reporte ya enviado hoy</div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Enviado por {yaEnviado.creado_por}. Solo puede haber un reporte por día.
          </div>
        </div>
      )}

      <div className="card">
        <div className="sec-title">Estado del turno</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {ESTADO_OPTS.map((o) => (
            <div
              key={o.v}
              onClick={() => !yaEnviado && setEstadoTurno(o.v)}
              style={{
                padding: '12px 10px',
                borderRadius: 10,
                cursor: yaEnviado ? 'default' : 'pointer',
                textAlign: 'center',
                background: estadoTurno === o.v ? o.color + '66' : '#1a1a1a',
                border: `1.5px solid ${estadoTurno === o.v ? o.tc : '#2a2a2a'}`,
                color: estadoTurno === o.v ? o.tc : '#555',
                fontWeight: 700,
                fontSize: 13,
                transition: 'all .15s',
              }}
            >
              {o.icon} {o.label}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="sec-title">Asistencia del turno</div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>Marca solo quien NO estuvo presente o llegó tarde</div>
        {empleados.map((e) => (
          <div key={e.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid #1e1e1e' }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {e.nombre} <span style={{ fontSize: 11, color: '#555' }}>· {e.rol}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {AUSENCIA_CFG.map((a) => (
                <div
                  key={a.tipo}
                  onClick={() => !yaEnviado && setAusencias((p) => ({ ...p, [e.id]: p[e.id] === a.tipo ? null : a.tipo }))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: yaEnviado ? 'default' : 'pointer',
                    background: ausencias[e.id] === a.tipo ? a.color : '#1a1a1a',
                    color: ausencias[e.id] === a.tipo ? a.tc : '#555',
                    border: `1.5px solid ${ausencias[e.id] === a.tipo ? a.tc : '#2a2a2a'}`,
                  }}
                >
                  {a.label}
                </div>
              ))}
            </div>
          </div>
        ))}
        {extras.map((e, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid #1e1e1e' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#aaa' }}>
              {e.nombre} <span style={{ fontSize: 11, color: '#555' }}>· externo</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {AUSENCIA_CFG.map((a) => (
                <div
                  key={a.tipo}
                  onClick={() => !yaEnviado && setExtras((p) => p.map((x, j) => (j === i ? { ...x, tipo: x.tipo === a.tipo ? null : a.tipo } : x)))}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: yaEnviado ? 'default' : 'pointer',
                    background: e.tipo === a.tipo ? a.color : '#1a1a1a',
                    color: e.tipo === a.tipo ? a.tc : '#555',
                    border: `1.5px solid ${e.tipo === a.tipo ? a.tc : '#2a2a2a'}`,
                  }}
                >
                  {a.label}
                </div>
              ))}
            </div>
          </div>
        ))}
        {!yaEnviado && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              className="inp"
              value={extraNombre}
              onChange={(e) => setExtraNombre(e.target.value)}
              placeholder="Nombre de otro empleado…"
              style={{ flex: 1, fontSize: 13 }}
              onKeyDown={(e) => e.key === 'Enter' && addExtra()}
            />
            <button className="btn btn-ghost btn-sm" onClick={addExtra}>
              + Agregar
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="sec-title">Incidentes del turno</div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Selecciona todos los que apliquen. Día sin novedades: déjalo vacío.
        </div>
        {INCIDENTES_CATS.map((cat) => (
          <div key={cat.cat} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                color: '#e63946',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              {cat.icon} {cat.label}
            </div>
            {cat.items.map((item) => {
              const sel = incSel[item.id];
              return (
                <div
                  key={item.id}
                  onClick={() => !yaEnviado && toggleInc(item.id, cat.cat, item.label)}
                  style={{
                    marginBottom: 8,
                    padding: '10px 12px',
                    borderRadius: 10,
                    cursor: yaEnviado ? 'default' : 'pointer',
                    border: `1.5px solid ${sel ? '#e63946' : '#2a2a2a'}`,
                    background: sel ? '#2d0a0d' : '#1a1a1a',
                    transition: 'all .15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        border: `2px solid ${sel ? '#e63946' : '#444'}`,
                        background: sel ? '#e63946' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {sel && <span style={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>✓</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: sel ? '#fff' : '#aaa' }}>{item.label}</div>
                      <div style={{ fontSize: 11, color: '#555' }}>{item.hint}</div>
                    </div>
                  </div>
                  {sel && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #333' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Severidad:</div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                        {[
                          { v: 'leve', c: '#14532d', tc: '#4ade80' },
                          { v: 'moderado', c: '#713f12', tc: '#facc15' },
                          { v: 'grave', c: '#7f1d1d', tc: '#f87171' },
                        ].map((s) => (
                          <div
                            key={s.v}
                            onClick={() => setIncField(item.id, 'severidad', s.v)}
                            style={{
                              padding: '4px 12px',
                              borderRadius: 20,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: sel.severidad === s.v ? s.c : '#1a1a1a',
                              color: sel.severidad === s.v ? s.tc : '#555',
                              border: `1.5px solid ${sel.severidad === s.v ? s.tc : '#2a2a2a'}`,
                            }}
                          >
                            {s.v.charAt(0).toUpperCase() + s.v.slice(1)}
                          </div>
                        ))}
                      </div>
                      <input
                        className="inp"
                        value={sel.detalle}
                        onChange={(e) => setIncField(item.id, 'detalle', e.target.value)}
                        placeholder="Detalle / acción tomada (opcional)"
                        style={{ fontSize: 12 }}
                      />
                      <div
                        onClick={() => setIncField(item.id, 'requiere_accion', !sel.requiere_accion)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', padding: '6px 0' }}
                      >
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 4,
                            border: `2px solid ${sel.requiere_accion ? '#f97316' : '#444'}`,
                            background: sel.requiere_accion ? '#f97316' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {sel.requiere_accion && <span style={{ color: '#fff', fontSize: 11, fontWeight: 800 }}>✓</span>}
                        </div>
                        <span
                          style={{
                            fontSize: 12,
                            color: sel.requiere_accion ? '#f97316' : '#888',
                            fontWeight: sel.requiere_accion ? 700 : 400,
                          }}
                        >
                          ⚡ Requiere acción de seguimiento
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="sec-title">🔧 Mejoras / Reparaciones</div>
        <div style={{ fontSize: 12, color: '#555', marginBottom: 12 }}>
          Registra reparaciones o mejoras realizadas durante el turno.
        </div>
        {mejoras.map((m, i) => (
          <div key={i} style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 10, padding: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: '#fff', fontWeight: 600 }}>{m.descripcion}</div>
                {m.fotos.length > 0 && <div style={{ fontSize: 11, color: '#4ade80', marginTop: 4 }}>📷 {m.fotos.length} foto(s)</div>}
                {(m.fotosUrls || []).map((u, fi) => (
                  <a key={fi} href={u} target="_blank" style={{ display: 'block', fontSize: 11, color: '#60a5fa', marginTop: 2 }}>
                    📷 Ver foto {fi + 1}
                  </a>
                ))}
              </div>
              {!yaEnviado && (
                <button onClick={() => removeMejora(i)} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 16, cursor: 'pointer', padding: '0 0 0 8px' }}>
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
        {!yaEnviado && (
          <div style={{ background: '#141414', border: '1px dashed #2a2a2a', borderRadius: 10, padding: 12 }}>
            <input
              className="inp"
              value={mejoraDesc}
              onChange={(e) => setMejoraDesc(e.target.value)}
              placeholder="Descripción de mejora o reparación…"
              style={{ fontSize: 13, marginBottom: 8 }}
            />
            <input
              ref={mfRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setMejoraFotos(Array.from(e.target.files).slice(0, 3))}
              style={{ display: 'none' }}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => mfRef.current.click()} style={{ marginBottom: 8, marginRight: 8 }}>
              📷 {mejoraFotos.length > 0 ? `${mejoraFotos.length} foto(s)` : 'Agregar fotos'}
            </button>
            {mejoraFotos.map((f, i) => (
              <div key={i} style={{ fontSize: 11, color: '#4ade80', padding: '2px 0' }}>
                ✓ {f.name}
              </div>
            ))}
            <button className="btn btn-primary btn-sm" onClick={addMejora} style={{ marginTop: 8 }}>
              + Agregar mejora
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="sec-title">Fotos (opcional)</div>
        <input
          ref={fRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFotos(Array.from(e.target.files).slice(0, 3))}
          style={{ display: 'none' }}
        />
        {!yaEnviado && (
          <button className="btn btn-ghost" onClick={() => fRef.current.click()} style={{ marginBottom: 8 }}>
            📷 {fotos.length > 0 ? `${fotos.length} foto(s) seleccionada(s)` : 'Agregar fotos del turno'}
          </button>
        )}
        {fotos.map((f, i) => (
          <div key={i} style={{ fontSize: 12, color: '#4ade80', padding: '3px 0' }}>
            ✓ {f.name}
          </div>
        ))}
        {yaEnviado &&
          (yaEnviado.fotos_urls || []).map((u, i) => (
            <a key={i} href={u} target="_blank" style={{ display: 'block', fontSize: 12, color: '#60a5fa', padding: '3px 0' }}>
              📷 Ver foto {i + 1}
            </a>
          ))}
      </div>

      <div className="card">
        <div className="sec-title">Notas generales (opcional)</div>
        <textarea
          className="inp"
          rows={3}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          readOnly={!!yaEnviado}
          placeholder="Observaciones del turno, información relevante…"
          style={{ resize: 'none' }}
        />
      </div>

      {!yaEnviado && (
        <button className="btn btn-red" onClick={submit} disabled={loading} style={{ fontSize: 17, padding: 18 }}>
          {loading ? <span className="spin" /> : '📋  ENVIAR REPORTE DE TURNO'}
        </button>
      )}
    </div>
  );
}
