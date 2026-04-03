import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n } from '../../config';

// ── Roles con acceso ──
const ROLES_ACCESO = ['ejecutivo', 'produccion', 'jefe_casa_matriz', 'admin'];

// ── Categorías de incidentes de producción/casa matriz ──
const CATEGORIAS = [
  {
    id: 'calidad', label: '🔬 Control de Calidad', tipos: [
      { id: 'producto_rechazado', label: 'Producto que no pasó control de calidad', sev: 'moderado' },
      { id: 'lote_descartado', label: 'Lote completo descartado', sev: 'grave' },
      { id: 'contaminacion', label: 'Contaminación detectada', sev: 'grave' },
      { id: 'sabor_textura', label: 'Problema de sabor/textura/color', sev: 'leve' },
      { id: 'temperatura_incorrecta', label: 'Temperatura fuera de rango', sev: 'moderado' },
    ]
  },
  {
    id: 'equipo', label: '⚙️ Equipo y Maquinaria', tipos: [
      { id: 'equipo_danado', label: 'Equipo dañado/fuera de servicio', sev: 'moderado' },
      { id: 'molino_falla', label: 'Falla en molino de carne', sev: 'grave' },
      { id: 'selladora_falla', label: 'Falla en selladora/empacadora', sev: 'moderado' },
      { id: 'refrigeracion_falla', label: 'Falla en refrigeración/congelador', sev: 'grave' },
      { id: 'limpieza_equipo', label: 'Equipo requiere mantenimiento/limpieza profunda', sev: 'leve' },
    ]
  },
  {
    id: 'seguridad', label: '🛡️ Seguridad e Higiene', tipos: [
      { id: 'accidente_empleado', label: 'Accidente de empleado', sev: 'grave' },
      { id: 'riesgo_seguridad', label: 'Riesgo de seguridad alimentaria detectado', sev: 'grave' },
      { id: 'higiene_area', label: 'Problema de higiene en área de producción', sev: 'moderado' },
      { id: 'plagas', label: 'Evidencia de plagas', sev: 'grave' },
      { id: 'corte_servicios', label: 'Corte de luz/agua/gas', sev: 'moderado' },
    ]
  },
  {
    id: 'faltante_mp', label: '📦 Faltante Materia Prima', tipos: [
      { id: 'mp_no_llego', label: 'Materia prima no llegó (proveedor)', sev: 'moderado' },
      { id: 'mp_mala_calidad', label: 'Materia prima llegó en mala calidad', sev: 'moderado' },
      { id: 'mp_cantidad_incorrecta', label: 'Cantidad recibida no coincide con pedido', sev: 'leve' },
      { id: 'stock_insuficiente', label: 'Stock insuficiente detectado al producir', sev: 'moderado' },
      { id: 'producto_vencido', label: 'Producto vencido encontrado en bodega', sev: 'grave' },
    ]
  },
  {
    id: 'desperdicio', label: '🗑️ Desperdicios y Merma', tipos: [
      { id: 'merma_excesiva', label: 'Merma superior al estándar', sev: 'leve' },
      { id: 'desperdicio_proceso', label: 'Desperdicio por error en proceso', sev: 'moderado' },
      { id: 'devolucion_sucursal', label: 'Producto devuelto por sucursal', sev: 'leve' },
      { id: 'sobreproduccion', label: 'Sobreproducción sin demanda', sev: 'leve' },
    ]
  },
  {
    id: 'otro', label: '📋 Otros', tipos: [
      { id: 'personal_conflicto', label: 'Conflicto entre personal de producción', sev: 'leve' },
      { id: 'ausentismo', label: 'Ausentismo que afecta producción', sev: 'moderado' },
      { id: 'otro_general', label: 'Otro incidente', sev: 'leve' },
    ]
  },
];

const SEV_COLORS = { leve: '#4ade80', moderado: '#f59e0b', grave: '#ef4444' };
const SEV_LABELS = { leve: 'Leve', moderado: 'Moderado', grave: '🔴 Grave' };

export default function IncidentesProduccion({ user }) {
  const [tab, setTab] = useState('reportar');
  const canEdit = ROLES_ACCESO.includes(user?.rol);

  // ── ESTADO: Reportar ──
  const [fecha, setFecha] = useState(today());
  const [incidentes, setIncidentes] = useState([]); // Array de incidentes del reporte
  const [catSel, setCatSel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // ── ESTADO: Historial ──
  const [historial, setHistorial] = useState([]);
  const [filtroFecha, setFiltroFecha] = useState('');
  const [filtroCat, setFiltroCat] = useState('');
  const [filtroSev, setFiltroSev] = useState('');
  const [loadingHist, setLoadingHist] = useState(false);

  // ── ESTADO: Seguimiento ──
  const [pendientes, setPendientes] = useState([]);

  // Productos y recetas para selector
  const [productos, setProductos] = useState([]);
  const [recetasList, setRecetasList] = useState([]);

  useEffect(() => {
    Promise.all([
      db.from('catalogo_productos').select('id,nombre').eq('activo', true).order('nombre'),
      db.from('recetas').select('id,nombre').eq('activo', true).order('nombre'),
    ]).then(([pRes, rRes]) => {
      setProductos(pRes.data || []);
      setRecetasList(rRes.data || []);
    });
  }, []);

  // ── Agregar incidente al array ──
  const agregarIncidente = (tipo) => {
    setIncidentes(prev => [...prev, {
      _key: Date.now(),
      categoria: catSel,
      tipo_id: tipo.id,
      tipo_label: tipo.label,
      severidad: tipo.sev,
      descripcion: '',
      producto_afectado_id: null,
      receta_afectada_id: null,
      cantidad_afectada: '',
      unidad_medida: '',
      accion_tomada: '',
      requiere_seguimiento: false,
    }]);
    setCatSel(null);
  };

  const updateIncidente = (key, field, value) => {
    setIncidentes(prev => prev.map(i => i._key === key ? { ...i, [field]: value } : i));
  };

  const removeIncidente = (key) => {
    setIncidentes(prev => prev.filter(i => i._key !== key));
  };

  // ── Guardar todos los incidentes ──
  const guardar = async () => {
    if (incidentes.length === 0) {
      setError('Agrega al menos un incidente');
      return;
    }
    const sinDescripcion = incidentes.find(i => !i.descripcion.trim());
    if (sinDescripcion) {
      setError('Todos los incidentes necesitan descripción');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const rows = incidentes.map(i => ({
        fecha,
        categoria: i.categoria,
        severidad: i.severidad,
        descripcion: `[${i.tipo_label}] ${i.descripcion}`,
        producto_afectado_id: i.producto_afectado_id || null,
        receta_afectada_id: i.receta_afectada_id || null,
        cantidad_afectada: i.cantidad_afectada ? n(i.cantidad_afectada) : null,
        unidad_medida: i.unidad_medida || null,
        accion_tomada: i.accion_tomada || null,
        requiere_seguimiento: i.requiere_seguimiento,
        reportado_por: `${user?.nombre || ''} ${user?.apellido || ''}`.trim(),
        reportado_por_id: user?.id || null,
      }));

      const { error: err } = await db.from('incidentes_produccion').insert(rows);
      if (err) throw err;

      setSuccess(`✅ ${incidentes.length} incidente(s) registrado(s) para ${fmtDate(fecha)}`);
      setIncidentes([]);
      setFecha(today());
    } catch (err) {
      setError(err.message || 'Error al guardar');
    }
    setSaving(false);
  };

  // ── Cargar historial ──
  const cargarHistorial = useCallback(async () => {
    setLoadingHist(true);
    let query = db.from('incidentes_produccion')
      .select('*, catalogo_productos(nombre), recetas(nombre)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (filtroFecha) query = query.eq('fecha', filtroFecha);
    if (filtroCat) query = query.eq('categoria', filtroCat);
    if (filtroSev) query = query.eq('severidad', filtroSev);

    const { data } = await query;
    setHistorial(data || []);

    // Pendientes de seguimiento
    const { data: pend } = await db.from('incidentes_produccion')
      .select('*, catalogo_productos(nombre), recetas(nombre)')
      .eq('requiere_seguimiento', true)
      .eq('seguimiento_resuelto', false)
      .order('created_at', { ascending: false });
    setPendientes(pend || []);

    setLoadingHist(false);
  }, [filtroFecha, filtroCat, filtroSev]);

  useEffect(() => {
    if (tab === 'historial' || tab === 'seguimiento') cargarHistorial();
  }, [tab, cargarHistorial]);

  // ── Resolver seguimiento ──
  const resolverSeguimiento = async (id, notas) => {
    await db.from('incidentes_produccion').update({
      seguimiento_resuelto: true,
      seguimiento_notas: notas,
    }).eq('id', id);
    cargarHistorial();
  };

  // ── TABS ──
  const TabBar = () => (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 18, color: '#fff' }}>🚨 Incidentes Casa Matriz</h2>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #333', overflowX: 'auto' }}>
        {[
          { k: 'reportar', l: '📝 Reportar' },
          { k: 'historial', l: '📋 Historial' },
          { k: 'seguimiento', l: `⚠️ Pendientes (${pendientes.length})` },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: '8px 14px', borderRadius: 0, border: 'none', background: 'none', whiteSpace: 'nowrap',
              color: tab === t.k ? '#e63946' : '#666', borderBottom: tab === t.k ? '2px solid #e63946' : 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            {t.l}
          </button>
        ))}
      </div>
    </div>
  );

  if (!canEdit) {
    return (
      <div style={{ padding: 16 }}>
        <TabBar />
        <div style={{ background: '#1a3a52', color: '#aaa', padding: 12, borderRadius: 8, fontSize: 13 }}>
          🔒 Solo producción, jefe casa matriz, ejecutivo o admin.
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: REPORTAR
  // ══════════════════════════════════════════════════════════════
  if (tab === 'reportar') {
    return (
      <div style={{ padding: 16 }}>
        <TabBar />
        {error && <div style={{ background: '#8b0000', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {error}</div>}
        {success && <div style={{ background: '#2d6a4f', color: '#fff', padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{success}</div>}

        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <label style={lbl}>Fecha del Incidente</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inp} />
        </div>

        {/* Incidentes ya agregados */}
        {incidentes.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
              📋 {incidentes.length} incidente(s) en este reporte:
            </div>
            {incidentes.map(inc => (
              <div key={inc._key} className="card" style={{ padding: 12, marginBottom: 8, borderLeft: `3px solid ${SEV_COLORS[inc.severidad]}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{inc.tipo_label}</span>
                    <span style={{ fontSize: 11, color: SEV_COLORS[inc.severidad], marginLeft: 8 }}>
                      {SEV_LABELS[inc.severidad]}
                    </span>
                  </div>
                  <button onClick={() => removeIncidente(inc._key)}
                    style={{ background: 'none', border: 'none', color: '#e63946', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>

                <textarea value={inc.descripcion}
                  onChange={e => updateIncidente(inc._key, 'descripcion', e.target.value)}
                  placeholder="Describe qué pasó y contexto..."
                  rows={2} style={{ ...inp, marginBottom: 6, resize: 'vertical' }} />

                {/* Producto/receta afectada */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                  <select value={inc.producto_afectado_id || ''}
                    onChange={e => updateIncidente(inc._key, 'producto_afectado_id', e.target.value || null)}
                    style={{ ...inp, flex: 1, minWidth: 140 }}>
                    <option value="">Producto afectado (opc.)</option>
                    {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                  <select value={inc.receta_afectada_id || ''}
                    onChange={e => updateIncidente(inc._key, 'receta_afectada_id', e.target.value || null)}
                    style={{ ...inp, flex: 1, minWidth: 140 }}>
                    <option value="">Receta afectada (opc.)</option>
                    {recetasList.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                </div>

                {/* Cantidad afectada */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input type="number" step="0.01" value={inc.cantidad_afectada}
                    onChange={e => updateIncidente(inc._key, 'cantidad_afectada', e.target.value)}
                    placeholder="Cant. afectada" style={{ ...inp, flex: 1 }} />
                  <input type="text" value={inc.unidad_medida}
                    onChange={e => updateIncidente(inc._key, 'unidad_medida', e.target.value)}
                    placeholder="Unidad (lb, kg, unid...)" style={{ ...inp, flex: 1 }} />
                </div>

                <textarea value={inc.accion_tomada}
                  onChange={e => updateIncidente(inc._key, 'accion_tomada', e.target.value)}
                  placeholder="Acción tomada..."
                  rows={1} style={{ ...inp, marginBottom: 6, resize: 'vertical' }} />

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#f59e0b', cursor: 'pointer' }}>
                  <input type="checkbox" checked={inc.requiere_seguimiento}
                    onChange={e => updateIncidente(inc._key, 'requiere_seguimiento', e.target.checked)} />
                  Requiere seguimiento
                </label>
              </div>
            ))}
          </div>
        )}

        {/* Selector de categorías */}
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#fff' }}>+ Agregar Incidente</h3>

          {!catSel ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {CATEGORIAS.map(cat => (
                <button key={cat.id} onClick={() => setCatSel(cat.id)}
                  style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#16213e',
                    color: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
                  {cat.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              <button onClick={() => setCatSel(null)}
                style={{ background: 'none', border: 'none', color: '#e63946', fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 8 }}>
                ← Cambiar categoría
              </button>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
                {CATEGORIAS.find(c => c.id === catSel)?.label}:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {CATEGORIAS.find(c => c.id === catSel)?.tipos.map(tipo => (
                  <button key={tipo.id} onClick={() => agregarIncidente(tipo)}
                    style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #333', background: '#0d1b2a',
                      color: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{tipo.label}</span>
                    <span style={{ fontSize: 11, color: SEV_COLORS[tipo.sev], fontWeight: 600 }}>{SEV_LABELS[tipo.sev]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Botón guardar */}
        {incidentes.length > 0 && (
          <button onClick={guardar} disabled={saving}
            style={{ width: '100%', marginTop: 16, background: saving ? '#555' : '#e63946', color: '#fff',
              border: 'none', borderRadius: 8, padding: '14px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14 }}>
            {saving ? '⏳ Guardando...' : `📤 Registrar ${incidentes.length} Incidente(s)`}
          </button>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: SEGUIMIENTO (pendientes)
  // ══════════════════════════════════════════════════════════════
  if (tab === 'seguimiento') {
    return (
      <div style={{ padding: 16 }}>
        <TabBar />
        {pendientes.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#4ade80', padding: 20 }}>✅ Sin incidentes pendientes de seguimiento</div>
        ) : (
          pendientes.map(inc => (
            <SeguimientoCard key={inc.id} inc={inc} onResolver={resolverSeguimiento} />
          ))
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: HISTORIAL
  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: 16 }}>
      <TabBar />

      {/* Filtros */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label style={lbl}>Fecha</label>
            <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} style={inp} />
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label style={lbl}>Categoría</label>
            <select value={filtroCat} onChange={e => setFiltroCat(e.target.value)} style={inp}>
              <option value="">Todas</option>
              {CATEGORIAS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 110 }}>
            <label style={lbl}>Severidad</label>
            <select value={filtroSev} onChange={e => setFiltroSev(e.target.value)} style={inp}>
              <option value="">Todas</option>
              <option value="leve">Leve</option>
              <option value="moderado">Moderado</option>
              <option value="grave">Grave</option>
            </select>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#aaa' }}>
          Total: <span style={{ color: '#fff', fontWeight: 600 }}>{historial.length}</span>
        </div>
        <div style={{ background: '#1a1a2e', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
          <span style={{ color: '#ef4444' }}>🔴 {historial.filter(h => h.severidad === 'grave').length}</span>
          <span style={{ color: '#f59e0b', marginLeft: 8 }}>🟡 {historial.filter(h => h.severidad === 'moderado').length}</span>
          <span style={{ color: '#4ade80', marginLeft: 8 }}>🟢 {historial.filter(h => h.severidad === 'leve').length}</span>
        </div>
      </div>

      {loadingHist ? (
        <div style={{ textAlign: 'center', color: '#888', padding: 20 }}>Cargando...</div>
      ) : historial.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#666', padding: 20 }}>No hay incidentes registrados</div>
      ) : (
        historial.map(inc => (
          <div key={inc.id} className="card" style={{ padding: 12, marginBottom: 8, borderLeft: `3px solid ${SEV_COLORS[inc.severidad]}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                {CATEGORIAS.find(c => c.id === inc.categoria)?.label || inc.categoria}
              </span>
              <span style={{ fontSize: 11, color: SEV_COLORS[inc.severidad] }}>{SEV_LABELS[inc.severidad]}</span>
            </div>
            <div style={{ fontSize: 12, color: '#ddd', marginBottom: 4 }}>{inc.descripcion}</div>
            {inc.catalogo_productos?.nombre && (
              <div style={{ fontSize: 11, color: '#888' }}>📦 {inc.catalogo_productos.nombre}
                {inc.cantidad_afectada ? ` — ${n(inc.cantidad_afectada)} ${inc.unidad_medida || ''}` : ''}
              </div>
            )}
            {inc.accion_tomada && (
              <div style={{ fontSize: 11, color: '#4ade80', marginTop: 2 }}>✅ {inc.accion_tomada}</div>
            )}
            <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
              {fmtDate(inc.fecha)} · {inc.reportado_por}
              {inc.requiere_seguimiento && !inc.seguimiento_resuelto && (
                <span style={{ color: '#f59e0b', marginLeft: 8 }}>⏳ Pendiente seguimiento</span>
              )}
              {inc.seguimiento_resuelto && (
                <span style={{ color: '#4ade80', marginLeft: 8 }}>✅ Resuelto</span>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Componente de seguimiento individual ──
function SeguimientoCard({ inc, onResolver }) {
  const [notas, setNotas] = useState('');
  const [resolviendo, setResolviendo] = useState(false);

  const resolver = async () => {
    setResolviendo(true);
    await onResolver(inc.id, notas);
    setResolviendo(false);
  };

  return (
    <div className="card" style={{ padding: 12, marginBottom: 8, borderLeft: `3px solid ${SEV_COLORS[inc.severidad]}` }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
        {CATEGORIAS.flatMap(c => c.tipos).find(t => inc.descripcion?.includes(t.label))?.label || inc.descripcion?.substring(0, 60)}
      </div>
      <div style={{ fontSize: 12, color: '#ddd', marginBottom: 4 }}>{inc.descripcion}</div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        {fmtDate(inc.fecha)} · {inc.reportado_por}
      </div>
      <textarea value={notas} onChange={e => setNotas(e.target.value)}
        placeholder="Notas de resolución..." rows={2}
        style={{ ...inp, marginBottom: 6, resize: 'vertical' }} />
      <button onClick={resolver} disabled={resolviendo}
        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2d6a4f', color: '#fff',
          cursor: resolviendo ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
        {resolviendo ? '⏳...' : '✅ Marcar Resuelto'}
      </button>
    </div>
  );
}

const CATEGORIAS_REF = CATEGORIAS; // keep reference for SeguimientoCard
const lbl = { display: 'block', fontSize: 12, color: '#888', marginBottom: 2, marginTop: 8 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#16213e', color: '#fff', fontSize: 13, boxSizing: 'border-box' };
