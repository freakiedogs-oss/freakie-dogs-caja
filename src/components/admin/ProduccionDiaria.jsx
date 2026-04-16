import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { today, fmtDate, n, STORES } from '../../config';

// ── Roles con acceso de edición ──
const ROLES_EDIT = ['ejecutivo', 'produccion', 'jefe_casa_matriz', 'admin', 'superadmin'];
const ROLES_PRODUCCION = ['produccion', 'jefe_casa_matriz', 'despachador'];

// ── Generar número de lote ──
const generarLote = (fecha, seq) =>
  `LOT-${fecha.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;

// ── Colores del sistema ──
const C = {
  bg: '#0f1117',
  card: '#1a1d28',
  cardHover: '#222638',
  border: '#2a2d3a',
  accent: '#e63946',
  accentSoft: '#e6394622',
  green: '#22c55e',
  greenSoft: '#22c55e18',
  greenBorder: '#22c55e44',
  blue: '#3b82f6',
  blueSoft: '#3b82f618',
  blueBorder: '#3b82f644',
  yellow: '#f59e0b',
  yellowSoft: '#f59e0b18',
  yellowBorder: '#f59e0b44',
  red: '#ef4444',
  redSoft: '#ef444418',
  text: '#e8e8ed',
  textMuted: '#8b8d9a',
  textDim: '#5a5c6a',
};

// ── Iniciales de un nombre ──
const initials = (nombre, apellido) => {
  const n1 = (nombre || '?')[0]?.toUpperCase() || '?';
  const n2 = (apellido || '')[0]?.toUpperCase() || '';
  return n1 + n2;
};

// ── Color consistente por empleado ──
const empColors = ['#e63946', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#ef4444'];
const empColor = (id) => empColors[((id || '').charCodeAt(5) || 0) % empColors.length];

// ══════════════════════════════════════════════════════════════
// PRODUCCIÓN DIARIA — REDISEÑO v2
// ══════════════════════════════════════════════════════════════
export default function ProduccionDiaria({ user }) {
  const [tab, setTab] = useState('registrar');

  // Estado Registrar
  const [fecha, setFecha] = useState(today());
  const [recetas, setRecetas] = useState([]);
  const [recetaSelId, setRecetaSelId] = useState(null);
  const [cantidadProducir, setCantidadProducir] = useState('');
  const [turno, setTurno] = useState('mañana');
  const [ingredientes, setIngredientes] = useState({});
  const [catalogo, setCatalogo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [productorId, setProductorId] = useState('');
  const [empleadosCM, setEmpleadosCM] = useState([]);
  const [searchEmp, setSearchEmp] = useState('');
  const [showEmpPicker, setShowEmpPicker] = useState(false);

  // Estado Historial
  const [producciones, setProducciones] = useState([]);
  const [filtroFecha, setFiltroFecha] = useState('');
  const [filtroReceta, setFiltroReceta] = useState('');
  const [filtroEmpleado, setFiltroEmpleado] = useState('');
  const [prodSelId, setProdSelId] = useState(null);
  const [prodItems, setProdItems] = useState([]);
  const [prodSelData, setProdSelData] = useState(null);
  const [loadingDetalle, setLoadingDetalle] = useState(false);

  // Inventario CM001
  const [inventarioCM, setInventarioCM] = useState({});

  // Validation state
  const [touched, setTouched] = useState({});

  const canEdit = ROLES_EDIT.includes(user?.rol);
  const CM_SUCURSAL_ID = '584aee3c-a842-496f-9f2b-1e3bac6e6b23';

  // ── Cargar datos iniciales ──
  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRes, iRes, cRes, invRes, empRes] = await Promise.all([
        db.from('recetas').select('*').eq('activo', true).order('nombre'),
        db.from('receta_ingredientes').select('*, catalogo_productos(id,nombre,unidad_medida,precio_referencia), sub:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,tipo,costo_calculado)'),
        db.from('catalogo_productos').select('id,nombre,categoria,unidad_medida,precio_referencia').eq('activo', true).order('nombre'),
        db.from('inventario').select('producto_id,stock_actual').eq('sucursal_id', CM_SUCURSAL_ID),
        db.from('usuarios_erp').select('id,nombre,apellido,rol').eq('store_code', 'CM001').eq('activo', true).order('nombre'),
      ]);

      setRecetas(rRes.data || []);
      const grouped = {};
      (iRes.data || []).forEach(i => {
        if (!grouped[i.receta_id]) grouped[i.receta_id] = [];
        grouped[i.receta_id].push(i);
      });
      setIngredientes(grouped);
      setCatalogo(cRes.data || []);

      const invMap = {};
      (invRes.data || []).forEach(r => { invMap[r.producto_id] = n(r.stock_actual); });
      setInventarioCM(invMap);
      setEmpleadosCM(empRes.data || []);
    } catch (err) {
      console.error('Error cargando datos:', err);
      setError('Error cargando recetas y productos');
    }
    setLoading(false);
  }, []);

  // ── Cargar historial ──
  const cargarHistorial = useCallback(async () => {
    try {
      let query = db.from('produccion_diaria')
        .select('*, recetas(id,nombre,tipo,rendimiento,unidad_rendimiento,costo_calculado), responsable:usuarios_erp!produccion_diaria_responsable_id_fkey(id,nombre,apellido)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filtroFecha) query = query.eq('fecha', filtroFecha);
      const res = await query;
      let datos = res.data || [];
      if (filtroReceta) {
        datos = datos.filter(p => p.recetas?.nombre?.toLowerCase().includes(filtroReceta.toLowerCase()));
      }
      if (filtroEmpleado) {
        datos = datos.filter(p => {
          const respNombre = p.responsable ? `${p.responsable.nombre} ${p.responsable.apellido}`.toLowerCase() : '';
          const createdBy = (p.created_by || '').toLowerCase();
          const notas = (p.notas || '').toLowerCase();
          const q = filtroEmpleado.toLowerCase();
          return respNombre.includes(q) || createdBy.includes(q) || notas.includes(q);
        });
      }
      setProducciones(datos);
    } catch (err) {
      console.error('Error cargando historial:', err);
    }
  }, [filtroFecha, filtroReceta, filtroEmpleado]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { if (tab === 'historial') cargarHistorial(); }, [tab, cargarHistorial]);

  // ── Receta seleccionada ──
  const recetaSel = recetas.find(r => r.id === recetaSelId);
  const ingsPorReceta = ingredientes[recetaSelId] || [];
  const productorSel = empleadosCM.find(e => e.id === productorId);

  // Empleados filtrados para el picker
  const empleadosFiltrados = empleadosCM
    .filter(e => ROLES_PRODUCCION.includes(e.rol))
    .filter(e => {
      if (!searchEmp) return true;
      const full = `${e.nombre} ${e.apellido}`.toLowerCase();
      return full.includes(searchEmp.toLowerCase());
    });

  // ── Calcular ingredientes necesarios ──
  const calcIngredientesNecesarios = () => {
    if (!cantidadProducir || !recetaSel) return [];
    const cant = n(cantidadProducir);
    return ingsPorReceta.map(i => {
      const cantBase = n(i.cantidad) * cant;
      const mermaPct = n(i.merma_pct) || 0;
      const cantConMerma = cantBase * (1 + mermaPct / 100);
      const prodId = i.tipo_ingrediente === 'materia_prima' ? i.producto_id : null;
      const stockDisp = prodId ? (inventarioCM[prodId] || 0) : null;
      return {
        ...i,
        cantidadNecesaria: cantConMerma,
        mermaCalculada: cantConMerma - cantBase,
        stockDisponible: stockDisp,
        faltante: prodId && stockDisp !== null ? Math.max(0, cantConMerma - stockDisp) : 0,
      };
    });
  };
  const ingNecesarios = calcIngredientesNecesarios();
  const hayFaltantes = ingNecesarios.some(i => i.faltante > 0);

  // ── Validaciones ──
  const validaciones = {
    productor: !productorId,
    receta: !recetaSelId,
    cantidad: !cantidadProducir || n(cantidadProducir) <= 0,
  };
  const formValido = !validaciones.productor && !validaciones.receta && !validaciones.cantidad;

  // ── Siguiente número de lote del día ──
  const getNextLote = async (fechaStr) => {
    const { data } = await db.from('produccion_diaria')
      .select('lote')
      .eq('fecha', fechaStr)
      .order('created_at', { ascending: false })
      .limit(1);
    if (data && data.length > 0 && data[0].lote) {
      const parts = data[0].lote.split('-');
      const seq = parseInt(parts[2] || '0', 10) + 1;
      return generarLote(fechaStr, seq);
    }
    return generarLote(fechaStr, 1);
  };

  // ── Registrar producción + descontar inventario CM ──
  const registrarProduccion = async () => {
    // Mark all as touched
    setTouched({ productor: true, receta: true, cantidad: true });

    if (!formValido) {
      const msgs = [];
      if (validaciones.productor) msgs.push('Seleccioná quién produjo');
      if (validaciones.receta) msgs.push('Seleccioná una receta');
      if (validaciones.cantidad) msgs.push('Ingresá la cantidad');
      setError(msgs.join(' · '));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const lote = await getNextLote(fecha);

      const prodRes = await db.from('produccion_diaria').insert({
        fecha,
        receta_id: recetaSel.id,
        cantidad_producida: n(cantidadProducir),
        cantidad_enviada: 0,
        merma: 0,
        turno,
        lote,
        responsable_id: productorId,
        created_by: `${user?.nombre || ''} ${user?.apellido || ''}`.trim(),
        created_by_id: user?.id || null,
        notas: notas || null,
      }).select();

      const produccionId = prodRes.data?.[0]?.id;
      if (!produccionId) throw new Error('No se creó el registro de producción');

      // Insertar items consumidos
      const items = ingNecesarios.map(i => ({
        produccion_id: produccionId,
        producto_id: i.tipo_ingrediente === 'materia_prima' ? i.producto_id : i.sub_receta_id,
        cantidad_consumida: i.cantidadNecesaria,
        unidad_medida: i.unidad_medida || 'unidad',
        costo_unitario: i.tipo_ingrediente === 'materia_prima' ? n(i.catalogo_productos?.precio_referencia) : 0,
        costo_linea: i.tipo_ingrediente === 'materia_prima' ? n(i.cantidadNecesaria) * n(i.catalogo_productos?.precio_referencia) : 0,
        es_subproducto: i.tipo_ingrediente === 'sub_receta',
      }));
      if (items.length > 0) {
        await db.from('produccion_diaria_items').insert(items);
      }

      // Descontar inventario
      const updatePromises = ingNecesarios
        .filter(i => i.tipo_ingrediente === 'materia_prima' && i.producto_id)
        .map(async (i) => {
          const currentStock = inventarioCM[i.producto_id] || 0;
          const newStock = Math.max(0, currentStock - i.cantidadNecesaria);
          await db.from('inventario')
            .update({ stock_actual: newStock, ultima_actualizacion: new Date().toISOString() })
            .eq('producto_id', i.producto_id)
            .eq('sucursal_id', CM_SUCURSAL_ID);
        });
      await Promise.all(updatePromises);

      const empNombre = productorSel ? `${productorSel.nombre} ${productorSel.apellido}` : '';
      setSuccess(`Lote ${lote} registrado — ${n(cantidadProducir)} tandas de ${recetaSel.nombre} por ${empNombre}. Inventario descontado.`);
      setCantidadProducir('');
      setRecetaSelId(null);
      setTurno('mañana');
      setNotas('');
      setProductorId('');
      setSearchEmp('');
      setFecha(today());
      setTouched({});
      cargar();
    } catch (err) {
      console.error('Error registrando producción:', err);
      setError(err.message || 'Error al registrar producción');
    }
    setSaving(false);
  };

  // ── Cargar detalle producción (BOM on-the-fly) ──
  const cargarDetalle = async (prod) => {
    setProdSelId(prod.id);
    setProdSelData(prod);
    setProdItems([]);
    setLoadingDetalle(true);
    try {
      const { data: bom, error: bomErr } = await db
        .from('receta_ingredientes')
        .select('*, catalogo_productos(id,nombre,unidad_medida,precio_referencia), sub_receta:recetas!receta_ingredientes_sub_receta_id_fkey(id,nombre,costo_calculado,rendimiento)')
        .eq('receta_id', prod.receta_id);

      if (bomErr) throw bomErr;

      const tandas = n(prod.cantidad_producida);
      const items = (bom || []).map(ri => {
        const cantConsum = n(ri.cantidad) * tandas;
        const esMP = ri.tipo_ingrediente === 'materia_prima';
        const nombre = esMP ? ri.catalogo_productos?.nombre : ri.sub_receta?.nombre;
        const unidad = ri.unidad_medida || (esMP ? ri.catalogo_productos?.unidad_medida : '');
        const precioU = esMP ? n(ri.catalogo_productos?.precio_referencia) : n(ri.sub_receta?.costo_calculado);
        return { nombre, unidad, tipo: ri.tipo_ingrediente, cantidad_receta: n(ri.cantidad), cantidad_consumida: cantConsum, precio_unitario: precioU, costo_linea: cantConsum * precioU };
      });
      setProdItems(items);
    } catch (err) {
      console.error('Error cargando detalle BOM:', err);
    } finally {
      setLoadingDetalle(false);
    }
  };

  // ══════════════════════════════════════════════════════════════
  // COMPONENTES INTERNOS
  // ══════════════════════════════════════════════════════════════

  const TabBar = () => (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 22 }}>🏭</div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>Producción Diaria</div>
          <div style={{ fontSize: 12, color: C.textMuted }}>Casa Matriz</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, background: C.card, borderRadius: 10, padding: 4 }}>
        {[
          { key: 'registrar', label: 'Registrar', icon: '📝' },
          { key: 'historial', label: 'Historial', icon: '📋' },
        ].map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setError(null); setSuccess(null); }}
            style={{
              flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
              background: tab === t.key ? C.accent : 'transparent',
              color: tab === t.key ? '#fff' : C.textMuted,
              cursor: 'pointer', fontWeight: 600, fontSize: 13,
              transition: 'all 0.2s',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  const Alert = ({ type, msg, onDismiss }) => {
    if (!msg) return null;
    const isErr = type === 'error';
    return (
      <div style={{
        background: isErr ? C.redSoft : C.greenSoft,
        border: `1px solid ${isErr ? '#ef444444' : C.greenBorder}`,
        color: isErr ? '#fca5a5' : '#86efac',
        padding: '12px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>{isErr ? '⚠️' : '✅'}</span>
        <span style={{ flex: 1 }}>{msg}</span>
        {onDismiss && (
          <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, padding: 0 }}>×</button>
        )}
      </div>
    );
  };

  const SectionLabel = ({ num, label, required, error: hasError }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 18,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: hasError ? C.redSoft : C.blueSoft,
        color: hasError ? C.red : C.blue,
        border: `1px solid ${hasError ? '#ef444444' : C.blueBorder}`,
      }}>{num}</div>
      <span style={{ fontSize: 13, fontWeight: 600, color: hasError ? C.red : C.text }}>{label}</span>
      {required && <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>OBLIGATORIO</span>}
    </div>
  );

  // ── Loading ──
  if (loading && tab === 'registrar') {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: C.textMuted }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🏭</div>
        Cargando recetas y empleados...
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: REGISTRAR
  // ══════════════════════════════════════════════════════════════
  if (tab === 'registrar') {
    return (
      <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>
        <TabBar />
        <Alert type="error" msg={error} onDismiss={() => setError(null)} />
        <Alert type="success" msg={success} onDismiss={() => setSuccess(null)} />

        {!canEdit && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textMuted, padding: 16, borderRadius: 12, fontSize: 13, textAlign: 'center' }}>
            🔒 Solo producción, jefe casa matriz, ejecutivo o admin pueden registrar.
          </div>
        )}

        {canEdit && (
          <>
            {/* ── Quién registra ── */}
            <div style={{
              background: C.card, borderRadius: 10, padding: '10px 14px', marginBottom: 6,
              display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${C.border}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', background: C.blueSoft, border: `1px solid ${C.blueBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.blue,
              }}>
                {initials(user?.nombre, user?.apellido)}
              </div>
              <div>
                <div style={{ fontSize: 12, color: C.textMuted }}>Registra</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{user?.nombre} {user?.apellido}</div>
              </div>
            </div>

            {/* ══════ PASO 1: ¿QUIÉN PRODUJO? ══════ */}
            <SectionLabel num={1} label="¿Quién produjo?" required error={touched.productor && validaciones.productor} />

            {productorSel ? (
              /* Empleado seleccionado - chip grande */
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                background: C.greenSoft, border: `1px solid ${C.greenBorder}`, borderRadius: 12,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: empColor(productorSel.id) + '33',
                  border: `2px solid ${empColor(productorSel.id)}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, color: empColor(productorSel.id),
                }}>
                  {initials(productorSel.nombre, productorSel.apellido)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                    {productorSel.nombre} {productorSel.apellido}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted }}>
                    {productorSel.rol === 'jefe_casa_matriz' ? 'Jefe Casa Matriz' : productorSel.rol === 'despachador' ? 'Despachador' : 'Producción'}
                  </div>
                </div>
                <button onClick={() => { setProductorId(''); setSearchEmp(''); setShowEmpPicker(true); }}
                  style={{
                    background: 'none', border: `1px solid ${C.border}`, borderRadius: 8,
                    color: C.textMuted, cursor: 'pointer', padding: '6px 12px', fontSize: 12,
                  }}>
                  Cambiar
                </button>
              </div>
            ) : (
              /* Selector de empleado */
              <div style={{
                border: `2px dashed ${touched.productor && validaciones.productor ? C.red : C.border}`,
                borderRadius: 12, padding: 12,
                background: touched.productor && validaciones.productor ? C.redSoft : C.card,
              }}>
                {/* Buscador */}
                <input
                  type="text"
                  value={searchEmp}
                  onChange={e => setSearchEmp(e.target.value)}
                  onFocus={() => setShowEmpPicker(true)}
                  placeholder="🔍 Buscar empleado por nombre..."
                  style={{
                    ...inp, marginBottom: 10, fontSize: 14, padding: '10px 12px',
                    border: `1px solid ${touched.productor && validaciones.productor ? C.red + '66' : C.border}`,
                  }}
                />
                {touched.productor && validaciones.productor && (
                  <div style={{ fontSize: 12, color: C.red, marginBottom: 8, paddingLeft: 4 }}>
                    Seleccioná al empleado que hizo la producción
                  </div>
                )}

                {/* Grid de empleados */}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6,
                  maxHeight: 240, overflowY: 'auto',
                }}>
                  {empleadosFiltrados.map(e => {
                    const color = empColor(e.id);
                    return (
                      <button key={e.id}
                        onClick={() => {
                          setProductorId(e.id);
                          setSearchEmp('');
                          setShowEmpPicker(false);
                          setTouched(t => ({ ...t, productor: true }));
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '10px 10px', borderRadius: 10,
                          background: C.bg, border: `1px solid ${C.border}`,
                          cursor: 'pointer', textAlign: 'left',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={ev => { ev.currentTarget.style.background = color + '22'; ev.currentTarget.style.borderColor = color + '66'; }}
                        onMouseLeave={ev => { ev.currentTarget.style.background = C.bg; ev.currentTarget.style.borderColor = C.border; }}
                      >
                        <div style={{
                          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                          background: color + '22', border: `1.5px solid ${color}66`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 700, color: color,
                        }}>
                          {initials(e.nombre, e.apellido)}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {e.nombre}
                          </div>
                          <div style={{ fontSize: 10, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {e.apellido}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {empleadosFiltrados.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 16, color: C.textDim, fontSize: 13 }}>
                    No se encontró "{searchEmp}"
                  </div>
                )}
              </div>
            )}

            {/* ══════ PASO 2: ¿QUÉ SE PRODUJO? ══════ */}
            <SectionLabel num={2} label="¿Qué se produjo?" required error={touched.receta && validaciones.receta} />

            <select
              value={recetaSelId || ''}
              onChange={e => { setRecetaSelId(e.target.value); setTouched(t => ({ ...t, receta: true })); }}
              style={{
                ...inp, fontSize: 14, padding: '12px',
                border: `1px solid ${touched.receta && validaciones.receta ? C.red + '66' : C.border}`,
                background: touched.receta && validaciones.receta ? C.redSoft : inp.background,
              }}
            >
              <option value="">Seleccionar receta...</option>
              {recetas.filter(r => r.tipo === 'sub_receta' || r.tipo === 'porcionado').map(r => (
                <option key={r.id} value={r.id}>
                  {r.nombre} ({r.tipo === 'sub_receta' ? 'Sub-receta' : 'Porcionado'})
                  {r.rendimiento ? ` · Rinde ${r.rendimiento}` : ''}
                </option>
              ))}
            </select>
            {touched.receta && validaciones.receta && (
              <div style={{ fontSize: 12, color: C.red, marginTop: 4, paddingLeft: 4 }}>Seleccioná qué se produjo</div>
            )}

            {/* BOM de receta seleccionada */}
            {recetaSel && (
              <div style={{ background: C.card, borderRadius: 10, padding: 12, marginTop: 10, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 14 }}>📦</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>Ingredientes — {recetaSel.nombre}</span>
                  {recetaSel.rendimiento && <span style={{ fontSize: 11, color: C.textDim, marginLeft: 'auto' }}>Rinde {recetaSel.rendimiento}</span>}
                </div>
                {ingsPorReceta.length === 0 ? (
                  <div style={{ fontSize: 12, color: C.textDim }}>Sin ingredientes definidos</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        <th style={th}>Ingrediente</th>
                        <th style={{ ...th, textAlign: 'right' }}>Cant/tanda</th>
                        <th style={{ ...th, textAlign: 'right' }}>Merma%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingsPorReceta.map(i => {
                        const nombre = i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre;
                        return (
                          <tr key={i.id} style={{ borderBottom: `1px solid ${C.bg}` }}>
                            <td style={{ padding: '6px 4px', fontSize: 12, color: C.text }}>{nombre || '?'}</td>
                            <td style={{ padding: '6px 4px', fontSize: 12, color: C.textMuted, textAlign: 'right' }}>
                              {n(i.cantidad)} {i.unidad_medida}
                            </td>
                            <td style={{ padding: '6px 4px', fontSize: 12, color: C.yellow, textAlign: 'right' }}>
                              {n(i.merma_pct)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ══════ PASO 3: ¿CUÁNTO? ══════ */}
            <SectionLabel num={3} label="¿Cuántas tandas?" required error={touched.cantidad && validaciones.cantidad} />

            <input type="number" step="0.5" min="0.5" value={cantidadProducir}
              onChange={e => { setCantidadProducir(e.target.value); setTouched(t => ({ ...t, cantidad: true })); }}
              placeholder="Ej: 2"
              style={{
                ...inp, fontSize: 18, padding: '14px 12px', textAlign: 'center', fontWeight: 700,
                border: `1px solid ${touched.cantidad && validaciones.cantidad ? C.red + '66' : C.border}`,
                background: touched.cantidad && validaciones.cantidad ? C.redSoft : inp.background,
              }} />
            {touched.cantidad && validaciones.cantidad && (
              <div style={{ fontSize: 12, color: C.red, marginTop: 4, paddingLeft: 4 }}>Ingresá cuántas tandas se produjeron</div>
            )}

            {/* Cálculo de necesidad vs stock */}
            {cantidadProducir && recetaSel && ingNecesarios.length > 0 && (
              <div style={{ background: C.card, borderRadius: 10, padding: 12, marginTop: 10, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <span style={{ fontSize: 14 }}>📊</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.yellow }}>
                    Necesidad × {cantidadProducir} tanda(s) vs Stock
                  </span>
                </div>
                {hayFaltantes && (
                  <div style={{
                    background: C.redSoft, border: `1px solid #ef444444`,
                    padding: '8px 10px', borderRadius: 8, marginBottom: 8, fontSize: 12, color: '#fca5a5',
                  }}>
                    ⚠️ Algunos ingredientes con stock insuficiente
                  </div>
                )}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <th style={th}>Ingrediente</th>
                      <th style={{ ...th, textAlign: 'right' }}>Necesita</th>
                      <th style={{ ...th, textAlign: 'right' }}>Stock</th>
                      <th style={{ ...th, textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingNecesarios.map(i => {
                      const nombre = i.tipo_ingrediente === 'materia_prima' ? i.catalogo_productos?.nombre : i.sub?.nombre;
                      const ok = i.stockDisponible === null || i.faltante === 0;
                      return (
                        <tr key={i.id} style={{ borderBottom: `1px solid ${C.bg}` }}>
                          <td style={{ padding: '6px 4px', fontSize: 12, color: C.text }}>{nombre || '?'}</td>
                          <td style={{ padding: '6px 4px', fontSize: 12, color: C.textMuted, textAlign: 'right' }}>
                            {i.cantidadNecesaria.toFixed(2)}
                          </td>
                          <td style={{
                            padding: '6px 4px', fontSize: 12, textAlign: 'right',
                            color: i.stockDisponible === null ? C.textDim : ok ? C.green : C.red,
                          }}>
                            {i.stockDisponible !== null ? i.stockDisponible.toFixed(2) : '—'}
                          </td>
                          <td style={{ padding: '6px 4px', fontSize: 12, textAlign: 'right' }}>
                            {i.stockDisponible === null ? (
                              <span style={{ color: C.textDim, fontSize: 10 }}>sub</span>
                            ) : ok ? (
                              <span style={{ color: C.green }}>✓</span>
                            ) : (
                              <span style={{ color: C.red, fontSize: 11 }}>-{i.faltante.toFixed(1)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ══════ PASO 4: DETALLES ══════ */}
            <SectionLabel num={4} label="Detalles" />

            {/* Turno como botones toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {[
                { key: 'mañana', icon: '🌅', label: 'Mañana' },
                { key: 'tarde', icon: '☀️', label: 'Tarde' },
              ].map(t => (
                <button key={t.key} onClick={() => setTurno(t.key)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, cursor: 'pointer',
                    border: turno === t.key ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                    background: turno === t.key ? C.accentSoft : C.card,
                    color: turno === t.key ? C.text : C.textMuted,
                    fontWeight: 600, fontSize: 14,
                    transition: 'all 0.15s',
                  }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {/* Fecha */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: C.textDim, marginBottom: 2, display: 'block' }}>Fecha</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...inp, fontSize: 13 }} />
              </div>
            </div>

            {/* Notas */}
            <label style={{ fontSize: 11, color: C.textDim, marginBottom: 2, display: 'block' }}>Observaciones (opcional)</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Algo especial sobre esta producción..."
              rows={2} style={{ ...inp, resize: 'vertical', fontSize: 13 }} />

            {/* ══════ RESUMEN Y BOTÓN ══════ */}
            {formValido && (
              <div style={{
                background: C.greenSoft, border: `1px solid ${C.greenBorder}`,
                borderRadius: 12, padding: 14, marginTop: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.green, marginBottom: 6 }}>Resumen</div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>
                  <strong>{productorSel?.nombre} {productorSel?.apellido}</strong> produjo{' '}
                  <strong>{cantidadProducir} tanda(s)</strong> de{' '}
                  <strong>{recetaSel?.nombre}</strong>{' '}
                  en turno <strong>{turno}</strong> el {fmtDate(fecha)}
                </div>
              </div>
            )}

            <button onClick={registrarProduccion} disabled={saving}
              style={{
                width: '100%', marginTop: 16,
                background: saving ? C.textDim : formValido ? C.accent : C.card,
                color: saving ? C.textMuted : formValido ? '#fff' : C.textDim,
                border: formValido ? 'none' : `1px solid ${C.border}`,
                borderRadius: 12, padding: '16px', fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer', fontSize: 15,
                transition: 'all 0.2s',
              }}>
              {saving ? '⏳ Registrando...' : formValido ? '📤 Registrar Producción' : 'Completá los campos obligatorios'}
            </button>
          </>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // TAB: HISTORIAL
  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>
      <TabBar />
      <Alert type="error" msg={error} onDismiss={() => setError(null)} />

      {/* Filtros */}
      <div style={{ background: C.card, borderRadius: 12, padding: 12, marginBottom: 14, border: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 2 }}>Fecha</label>
            <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)} style={{ ...inp, fontSize: 12 }} />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 2 }}>Receta</label>
            <input type="text" value={filtroReceta} onChange={e => setFiltroReceta(e.target.value)}
              placeholder="Buscar..." style={{ ...inp, fontSize: 12 }} />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 2 }}>Empleado</label>
            <input type="text" value={filtroEmpleado} onChange={e => setFiltroEmpleado(e.target.value)}
              placeholder="Buscar..." style={{ ...inp, fontSize: 12 }} />
          </div>
        </div>
        <button onClick={() => { setFiltroFecha(''); setFiltroReceta(''); setFiltroEmpleado(''); }}
          style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: 'pointer', fontSize: 11 }}>
          Limpiar filtros
        </button>
      </div>

      {/* Detalle */}
      {prodSelId ? (
        <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
          <button onClick={() => setProdSelId(null)}
            style={{ background: 'none', border: 'none', color: C.accent, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14, fontWeight: 600 }}>
            ← Volver al listado
          </button>
          {prodSelData && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{prodSelData.recetas?.nombre}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
                {fmtDate(prodSelData.fecha)} · {prodSelData.turno} · {prodSelData.lote || ''}
              </div>

              {/* Empleados */}
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                {prodSelData.responsable && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: C.greenSoft, border: `1px solid ${C.greenBorder}`,
                    borderRadius: 8, padding: '6px 10px',
                  }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', fontSize: 10, fontWeight: 700,
                      background: empColor(prodSelData.responsable.id) + '33',
                      color: empColor(prodSelData.responsable.id),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {initials(prodSelData.responsable.nombre, prodSelData.responsable.apellido)}
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: C.textDim }}>Produjo</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.green }}>
                        {prodSelData.responsable.nombre} {prodSelData.responsable.apellido}
                      </div>
                    </div>
                  </div>
                )}
                {prodSelData.created_by && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: C.blueSoft, border: `1px solid ${C.blueBorder}`,
                    borderRadius: 8, padding: '6px 10px',
                  }}>
                    <div style={{ fontSize: 10, color: C.textDim }}>Registró</div>
                    <div style={{ fontSize: 12, color: C.blue }}>{prodSelData.created_by}</div>
                  </div>
                )}
              </div>

              {/* Métricas */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{
                  background: C.blueSoft, border: `1px solid ${C.blueBorder}`,
                  color: C.blue, padding: '4px 10px', borderRadius: 8, fontSize: 12,
                }}>
                  🏭 {n(prodSelData.cantidad_producida)} tandas
                </span>
                <span style={{
                  background: C.greenSoft, border: `1px solid ${C.greenBorder}`,
                  color: C.green, padding: '4px 10px', borderRadius: 8, fontSize: 12,
                }}>
                  📦 {(n(prodSelData.cantidad_producida) * n(prodSelData.recetas?.rendimiento)).toFixed(1)} {prodSelData.recetas?.unidad_rendimiento || 'unidades'}
                </span>
              </div>

              {prodSelData.notas && (
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 8, fontStyle: 'italic' }}>
                  📝 {prodSelData.notas}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 14, fontWeight: 600, color: C.textMuted, marginBottom: 10 }}>💰 Costo de Ingredientes</div>
          {loadingDetalle ? (
            <div style={{ color: C.textDim, fontSize: 13, padding: '10px 0' }}>Calculando costos...</div>
          ) : prodItems.length === 0 ? (
            <div style={{ color: C.textDim, fontSize: 13 }}>Sin ingredientes cargados.</div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={th}>Ingrediente</th>
                    <th style={{ ...th, textAlign: 'right' }}>Usado</th>
                    <th style={{ ...th, textAlign: 'right' }}>Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {prodItems.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: `1px solid ${C.bg}` }}>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: item.tipo === 'sub_receta' ? C.blue : C.text }}>
                        {item.tipo === 'sub_receta' ? '🔗 ' : ''}{item.nombre || '—'}
                      </td>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: C.textMuted, textAlign: 'right' }}>
                        {n(item.cantidad_consumida).toFixed(2)} {item.unidad}
                      </td>
                      <td style={{ padding: '7px 4px', fontSize: 12, color: n(item.costo_linea) > 0 ? C.green : C.textDim, textAlign: 'right', fontWeight: 600 }}>
                        ${n(item.costo_linea).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(() => {
                const totalCosto = prodItems.reduce((s, i) => s + n(i.costo_linea), 0);
                const totalUnidades = n(prodSelData?.cantidad_producida) * n(prodSelData?.recetas?.rendimiento);
                const costoPorUnidad = totalUnidades > 0 ? totalCosto / totalUnidades : 0;
                return (
                  <div style={{ marginTop: 12, borderTop: `2px solid ${C.border}`, paddingTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: C.textMuted }}>Costo total:</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: C.green }}>${totalCosto.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: C.textDim }}>Costo/unidad:</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.yellow }}>${costoPorUnidad.toFixed(4)}</span>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '10px 14px', fontSize: 12, color: C.textMuted, flex: 1, minWidth: 100,
            }}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Registros</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{producciones.length}</div>
            </div>
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '10px 14px', fontSize: 12, color: C.textMuted, flex: 1, minWidth: 100,
            }}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Tandas totales</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.green }}>
                {producciones.reduce((s, p) => s + n(p.cantidad_producida), 0).toFixed(1)}
              </div>
            </div>
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: '10px 14px', fontSize: 12, color: C.textMuted, flex: 1, minWidth: 100,
            }}>
              <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Empleados</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.blue }}>
                {new Set(producciones.filter(p => p.responsable).map(p => p.responsable.id)).size}
              </div>
            </div>
          </div>

          {/* Lista */}
          {producciones.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.textDim, padding: 30, fontSize: 14 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              No hay registros{filtroFecha || filtroReceta || filtroEmpleado ? ' con esos filtros' : ''}
            </div>
          ) : (
            producciones.map(p => {
              const resp = p.responsable;
              const color = resp ? empColor(resp.id) : C.textDim;
              return (
                <div key={p.id} onClick={() => cargarDetalle(p)}
                  style={{
                    cursor: 'pointer', padding: '12px 14px', marginBottom: 8,
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={ev => { ev.currentTarget.style.background = C.cardHover; ev.currentTarget.style.borderColor = C.textDim; }}
                  onMouseLeave={ev => { ev.currentTarget.style.background = C.card; ev.currentTarget.style.borderColor = C.border; }}
                >
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {/* Avatar empleado */}
                    <div style={{
                      width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                      background: color + '22', border: `1.5px solid ${color}66`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 700, color: color,
                    }}>
                      {resp ? initials(resp.nombre, resp.apellido) : '?'}
                    </div>

                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
                          {p.recetas?.nombre || 'Receta desconocida'}
                        </div>
                        <div style={{ fontSize: 13, color: C.green, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>
                          {n(p.cantidad_producida).toFixed(1)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                        <div style={{ fontSize: 11, color: C.textMuted }}>
                          {resp ? (
                            <span style={{ color: color }}>{resp.nombre} {resp.apellido}</span>
                          ) : p.notas?.startsWith('Producción') ? (
                            <span style={{ color: C.yellow }}>{p.notas}</span>
                          ) : (
                            <span style={{ color: C.red }}>⚠ Sin empleado</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: C.textDim }}>
                          {fmtDate(p.fecha)} · {p.turno}
                        </div>
                      </div>
                      {p.lote && (
                        <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>🏷️ {p.lote}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

// ── Styles ──
const inp = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #2a2d3a', background: '#12141e', color: '#e8e8ed', fontSize: 13, boxSizing: 'border-box', outline: 'none' };
const th = { padding: '6px 4px', fontSize: 11, color: '#5a5c6a', textAlign: 'left', fontWeight: 600 };
