import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import RecetasView from '../admin/RecetasView';
import MapeoMenu from './MapeoMenu';
import CosteoView from '../admin/CosteoView';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTES
   ═══════════════════════════════════════════════════════════════════════════ */
const TIPOS = {
  materia_prima:     { label: 'MP',  full: 'Materia Prima',       icon: '🧾', color: '#60a5fa', bg: '#1e3a5f', badge: 'info',    hint: 'Ingrediente que compras a proveedores' },
  sub_producto:      { label: 'SP',  full: 'Sub Producto',        icon: '🧪', color: '#fb923c', bg: '#7c2d12', badge: 'warning', hint: 'Se prepara en cocina con materias primas' },
  producto_terminado:{ label: 'PT',  full: 'Producto Terminado',  icon: '🍔', color: '#4ade80', bg: '#14532d', badge: 'success', hint: 'Lo que vendes al cliente' },
  insumo:            { label: 'IN',  full: 'Insumo',              icon: '📦', color: '#a1a1aa', bg: '#27272a', badge: 'muted',   hint: 'Material de operación (no alimento)' },
};

const MOV_TIPOS = {
  recepcion:      { label: 'Recepción',  icon: '📥', badge: 'success' },
  despacho:       { label: 'Despacho',   icon: '🚚', badge: 'info' },
  ajuste_manual:  { label: 'Ajuste',     icon: '✏️', badge: 'warning' },
  conteo_fisico:  { label: 'Conteo',     icon: '📋', badge: 'muted' },
  produccion:     { label: 'Producción', icon: '🏭', badge: 'info' },
  merma:          { label: 'Merma',      icon: '🗑️', badge: 'destructive' },
  devolucion:     { label: 'Devolución', icon: '🔄', badge: 'warning' },
};

const selectCls = 'w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

const UNIDADES = ['kg', 'lb', 'g', 'unidad', 'litro', 'ml', 'oz', 'porcion', 'caja', 'paquete'];

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENTES REUTILIZABLES
   ═══════════════════════════════════════════════════════════════════════════ */

// Chip badge visual por tipo
function TipoPill({ tipo, size = 'sm' }) {
  const t = TIPOS[tipo];
  if (!t) return <span className="tag tag-gray">{tipo || '?'}</span>;
  const cls = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-bold ${cls}`}
      style={{ background: t.bg, color: t.color }}>
      {t.icon} {t.label}
    </span>
  );
}

// Barra de progreso visual
function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-bold" style={{ color: pct === 100 ? '#4ade80' : '#fb923c' }}>{pct}%</span>
      </div>}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: pct === 100 ? '#4ade80' : pct > 50 ? '#fbbf24' : '#e63946' }} />
      </div>
    </div>
  );
}

// KPI card compacta
function KpiCard({ icon, label, value, sub, color }) {
  return (
    <div className="stat-card">
      <div style={{ fontSize: 22, marginBottom: 2 }}>{icon}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#f0f0f0' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Búsqueda en catálogo — acepta tipo string o array
function CatalogoSearch({ placeholder = 'Buscar...', tipo, onSelect, onCreate, className = '' }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) { setOpts([]); return; }
    const t = setTimeout(async () => {
      let query = db.from('catalogo_productos').select('id, nombre, sku, tipo').ilike('nombre', `%${q}%`).eq('activo', true).limit(10);
      if (tipo) {
        if (Array.isArray(tipo)) query = query.in('tipo', tipo);
        else query = query.eq('tipo', tipo);
      }
      const { data } = await query;
      setOpts(data || []);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q, tipo]);

  return (
    <div className={`relative ${className}`}>
      <Input
        placeholder={placeholder}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q.length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && (q.length >= 2) && (
        <div className="absolute top-full left-0 right-0 z-30 border border-border rounded-b-lg shadow-xl max-h-52 overflow-y-auto" style={{ background: '#1e1e1e' }}>
          {opts.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No se encontró "{q}"
              {onCreate && (
                <button
                  onMouseDown={() => { onCreate(q); setQ(''); setOpen(false); }}
                  className="block mx-auto mt-2 text-xs font-bold px-3 py-1.5 rounded-full"
                  style={{ background: '#14532d', color: '#4ade80' }}
                >
                  + Crear "{q}" como nuevo
                </button>
              )}
            </div>
          ) : (
            <>
              {opts.map(opt => (
                <div
                  key={opt.id}
                  onMouseDown={() => { onSelect(opt); setQ(''); setOpts([]); setOpen(false); }}
                  className="px-3 py-2.5 cursor-pointer border-b border-border/50 last:border-0 flex items-center gap-2 hover:bg-muted/80 active:bg-muted"
                >
                  <TipoPill tipo={opt.tipo} />
                  <span className="text-sm flex-1 truncate">{opt.nombre}</span>
                  {opt.sku && <span className="text-xs font-mono text-muted-foreground">{opt.sku}</span>}
                </div>
              ))}
              {onCreate && (
                <div
                  onMouseDown={() => { onCreate(q); setQ(''); setOpen(false); }}
                  className="px-3 py-2.5 cursor-pointer text-sm text-center font-semibold border-t border-border"
                  style={{ color: '#4ade80' }}
                >
                  + Crear "{q}" como nuevo
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
   ═══════════════════════════════════════════════════════════════════════════ */
export default function KardexView({ user, show }) {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [activeTab, setActiveTab] = useState('inventario');

  useEffect(() => {
    db.from('sucursales').select('id, store_code, nombre').eq('activa', true)
      .then(({ data }) => {
        const suc = (data || []).sort((a, b) => a.store_code.localeCompare(b.store_code));
        setSucursales(suc);
        const match = suc.find(s => s.store_code === user?.store_code);
        setSucursal(match ? match.id : suc[0]?.id || '');
      });
  }, []);

  /* ══════════════════════════════════════════════════════════════════════
     TAB 1: INVENTARIO (Catálogo de ingredientes y productos)
     ══════════════════════════════════════════════════════════════════════ */
  const [catalogo, setCatalogo] = useState([]);
  const [catTotals, setCatTotals] = useState({ materia_prima: 0, sub_producto: 0, producto_terminado: 0, insumo: 0, total: 0 });
  const [editUnid, setEditUnid] = useState(null); // producto cuyas unidades se editan
  const [editTipoId, setEditTipoId] = useState(null); // producto cuyo tipo (clasificación) se edita inline
  const [editItem, setEditItem] = useState(null); // producto abierto en el editor completo
  const [catFilter, setCatFilter] = useState('todos');
  const [catSearch, setCatSearch] = useState('');
  const [loadingCat, setLoadingCat] = useState(false);
  const [showCrear, setShowCrear] = useState(false);
  const [nuevoItem, setNuevoItem] = useState({ nombre: '', tipo: 'materia_prima', unidad: 'kg' });
  const [creando, setCreando] = useState(false);
  const [verDte, setVerDte] = useState(null);   // producto_id cuyo mapeo DTE se muestra
  const [dteMap, setDteMap] = useState(null);   // resultado de producto_mapeo_dte

  const toggleDte = async (id) => {
    if (verDte === id) { setVerDte(null); setDteMap(null); return; }
    setVerDte(id); setDteMap(null);
    const { data } = await db.rpc('producto_mapeo_dte', { p_producto_id: id });
    setDteMap(data || { n: 0, descripciones: [] });
  };

  const fetchCatalogo = useCallback(async () => {
    setLoadingCat(true);
    try {
      let q = db.from('catalogo_productos')
        .select('id, nombre, sku, tipo, unidad_medida, unidad_compra, factor_compra, categoria, activo, codigo')
        .eq('activo', true).order('nombre');
      if (catFilter !== 'todos') {
        if (catFilter === 'materia_prima') q = q.or('tipo.eq.materia_prima,tipo.is.null');
        else q = q.eq('tipo', catFilter);
      }
      if (catSearch) q = q.ilike('nombre', `%${catSearch}%`);
      const { data, error } = await q;
      if (error) throw error;
      setCatalogo(data || []);
    } catch { show?.('Error al cargar inventario', 'error'); }
    finally { setLoadingCat(false); }
  }, [catFilter, catSearch]);

  useEffect(() => { fetchCatalogo(); }, [fetchCatalogo]);

  // Totales por tipo (independiente del filtro activo, para las tarjetas KPI)
  const fetchTotals = useCallback(async () => {
    const { data } = await db.from('catalogo_productos').select('tipo').eq('activo', true);
    const t = { materia_prima: 0, sub_producto: 0, producto_terminado: 0, insumo: 0, total: (data || []).length };
    (data || []).forEach(c => { const k = c.tipo || 'materia_prima'; if (t[k] !== undefined) t[k]++; });
    setCatTotals(t);
  }, []);
  useEffect(() => { fetchTotals(); }, [fetchTotals, catalogo.length]);

  const handleCrearItem = async () => {
    if (!nuevoItem.nombre.trim()) { show?.('Escribe un nombre', 'warning'); return; }
    setCreando(true);
    try {
      const { error } = await db.rpc('crear_catalogo_item', {
        p_nombre: nuevoItem.nombre.trim(),
        p_tipo: nuevoItem.tipo,
        p_unidad_medida: nuevoItem.unidad,
      });
      if (error) throw error;
      show?.(`${TIPOS[nuevoItem.tipo]?.full} creado`, 'success');
      setNuevoItem({ nombre: '', tipo: 'materia_prima', unidad: 'kg' });
      setShowCrear(false);
      fetchCatalogo();
    } catch { show?.('Error al crear', 'error'); }
    finally { setCreando(false); }
  };

  // Reclasificar el tipo (MP/SP/PT/Insumo) de un item desde la lista
  const cambiarTipo = async (item, nuevoTipo) => {
    setEditTipoId(null);
    if (nuevoTipo === item.tipo) return;
    const { error } = await db.rpc('set_producto_tipo', { p_producto_id: item.id, p_tipo: nuevoTipo });
    if (error) { show?.('❌ ' + error.message, 'error'); return; }
    show?.(`"${item.nombre}" → ${TIPOS[nuevoTipo]?.full}`, 'success');
    fetchCatalogo();
    fetchTotals();
  };

  // Conteos por tipo
  const catCounts = { materia_prima: 0, sub_producto: 0, producto_terminado: 0, insumo: 0, total: catalogo.length };
  catalogo.forEach(c => { const t = c.tipo || 'materia_prima'; if (catCounts[t] !== undefined) catCounts[t]++; });

  /* ══════════════════════════════════════════════════════════════════════
     TAB 2: MAPEO DE COMPRAS (vincular items DTE → catálogo)
     ══════════════════════════════════════════════════════════════════════ */
  const [dteDescs, setDteDescs] = useState([]);
  const [loadingMapeo, setLoadingMapeo] = useState(false);
  const [soloSinMapear, setSoloSinMapear] = useState(true);
  const [soloInventariables, setSoloInventariables] = useState(true);
  const [solo3Meses, setSolo3Meses] = useState(true);
  const [mapeoSearch, setMapeoSearch] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [activeMapDesc, setActiveMapDesc] = useState(null);
  const [creandoDesdeMapeo, setCreandoDesdeMapeo] = useState(null);
  const [newNameMapeo, setNewNameMapeo] = useState('');
  const [savingMapeo, setSavingMapeo] = useState(false);
  const [editNombre, setEditNombre] = useState(null);     // descripcion cuyo ingrediente se está renombrando
  const [editNombreVal, setEditNombreVal] = useState('');
  const [totalDescs, setTotalDescs] = useState(0);
  const [totalMapped, setTotalMapped] = useState(0);

  const fetchMapeo = useCallback(async () => {
    setLoadingMapeo(true);
    try {
      // Primero: totales para la barra de progreso
      const { data: allData } = await db.from('v_dte_descripciones').select('mapeado');
      if (allData) {
        setTotalDescs(allData.length);
        setTotalMapped(allData.filter(d => d.mapeado).length);
      }
      // Luego: datos filtrados
      let q = db.from('v_dte_descripciones').select('descripcion,mapeado,monto_total,num_dtes,num_lineas,inventariable,ultima_compra,catalogo_id,catalogo_nombre,catalogo_tipo,catalogo_unidad,catalogo_en_conteo');
      if (soloSinMapear) q = q.eq('mapeado', false);
      if (soloInventariables) q = q.eq('inventariable', true);
      if (solo3Meses) {
        const d = new Date(); d.setDate(d.getDate() - 90);
        q = q.gte('ultima_compra', d.toISOString().slice(0, 10));
      }
      if (mapeoSearch) q = q.ilike('descripcion', `%${mapeoSearch}%`);
      q = q.limit(100);
      const { data, error } = await q;
      if (error) throw error;
      setDteDescs(data || []);
    } catch { show?.('Error al cargar mapeo', 'error'); }
    finally { setLoadingMapeo(false); }
  }, [soloSinMapear, soloInventariables, solo3Meses, mapeoSearch]);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      const { data, error } = await db.rpc('extraer_items_dte');
      if (error) throw error;
      show?.(`${data} items sincronizados desde tus compras`, 'success');
      fetchMapeo();
    } catch { show?.('Error al sincronizar', 'error'); }
    finally { setExtracting(false); }
  };

  const handleMapear = async (descripcion, catalogoId) => {
    setSavingMapeo(true);
    try {
      const { data, error } = await db.rpc('mapear_descripcion_dte', {
        p_descripcion: descripcion, p_catalogo_id: catalogoId,
      });
      if (error) throw error;
      show?.(`Vinculado — ${data} líneas de compra actualizadas`, 'success');
      setActiveMapDesc(null);
      fetchMapeo();
    } catch { show?.('Error al vincular', 'error'); }
    finally { setSavingMapeo(false); }
  };

  const handleCrearYMapear = async (descripcion) => {
    const nombre = newNameMapeo.trim() || descripcion;
    setSavingMapeo(true);
    try {
      const { data: nuevoId, error: errC } = await db.rpc('crear_materia_prima', {
        p_nombre: nombre, p_unidad_medida: 'kg',
        p_descripcion: `Desde compras: ${descripcion}`,
      });
      if (errC) throw errC;
      const { data: count, error: errM } = await db.rpc('mapear_descripcion_dte', {
        p_descripcion: descripcion, p_catalogo_id: nuevoId,
      });
      if (errM) throw errM;
      show?.(`"${nombre}" creado y ${count} líneas vinculadas`, 'success');
      setCreandoDesdeMapeo(null);
      setNewNameMapeo('');
      setActiveMapDesc(null);
      fetchMapeo();
      fetchCatalogo();
    } catch { show?.('Error al crear y vincular', 'error'); }
    finally { setSavingMapeo(false); }
  };

  const handleDesmapear = async (descripcion) => {
    if (!window.confirm(`¿Desvincular "${descripcion}" de su ingrediente?\n\nLas líneas de compra quedarán sin vincular (podrás volver a vincularlas a otro ingrediente).`)) return;
    setSavingMapeo(true);
    try {
      const { data, error } = await db.rpc('desmapear_descripcion_dte', { p_descripcion: descripcion });
      if (error) throw error;
      show?.(`Desvinculado — ${data} líneas liberadas`, 'success');
      setActiveMapDesc(null);
      fetchMapeo();
    } catch { show?.('Error al desvincular', 'error'); }
    finally { setSavingMapeo(false); }
  };

  // Renombra el ingrediente del catálogo (misma fuente que el conteo nocturno → se refleja allá)
  const handleRenombrarIngrediente = async (catalogoId, nombre) => {
    const v = (nombre || '').trim();
    if (!catalogoId || !v) return;
    setSavingMapeo(true);
    try {
      const { error } = await db.rpc('set_conteo_item_meta', { p_producto_id: catalogoId, p_nombre: v });
      if (error) throw error;
      show?.('Nombre actualizado (se refleja en el conteo nocturno)', 'success');
      setEditNombre(null);
      fetchMapeo();
      fetchCatalogo();
    } catch { show?.('Error al renombrar', 'error'); }
    finally { setSavingMapeo(false); }
  };

  const handleToggleConteo = async (catalogoId, incluir) => {
    if (!catalogoId) return;
    setSavingMapeo(true);
    try {
      const { error } = await db.rpc('set_conteo_item', { p_producto_id: catalogoId, p_incluir: incluir });
      if (error) throw error;
      show?.(incluir ? 'Agregado al conteo nocturno' : 'Quitado del conteo nocturno', 'success');
      fetchMapeo();
    } catch { show?.('Error al actualizar el conteo', 'error'); }
    finally { setSavingMapeo(false); }
  };

  /* ══════════════════════════════════════════════════════════════════════
     TAB 3: RECETAS
     ══════════════════════════════════════════════════════════════════════ */
  const [recetas, setRecetas] = useState([]);
  const [loadingRecetas, setLoadingRecetas] = useState(false);
  const [recetaOpen, setRecetaOpen] = useState(null);
  const [recetaLineas, setRecetaLineas] = useState({});
  const [showNuevaReceta, setShowNuevaReceta] = useState(false);
  const [nrData, setNrData] = useState({ nombre: '', rendimiento: 1, unidad: 'porcion' });
  const [nrPT, setNrPT] = useState(null);
  const [savingReceta, setSavingReceta] = useState(false);
  const [addLinea, setAddLinea] = useState({ comp: null, cantidad: '', unidad: 'kg' });

  const fetchRecetas = useCallback(async () => {
    setLoadingRecetas(true);
    try {
      const { data } = await db.from('recetas')
        .select('id, nombre, rendimiento, unidad_rendimiento, activo, catalogo_id, catalogo_productos(nombre, sku, tipo)')
        .eq('activo', true).order('nombre');
      setRecetas(data || []);
    } catch { show?.('Error al cargar recetas', 'error'); }
    finally { setLoadingRecetas(false); }
  }, []);

  const fetchLineas = async (rid) => {
    if (recetaLineas[rid]) return;
    const { data } = await db.from('recetas_lineas')
      .select('id, cantidad, unidad, tipo_componente, catalogo_productos(id, nombre, sku, tipo)')
      .eq('receta_id', rid).order('created_at');
    setRecetaLineas(prev => ({ ...prev, [rid]: data || [] }));
  };

  const toggleReceta = (rid) => {
    if (recetaOpen === rid) { setRecetaOpen(null); return; }
    setRecetaOpen(rid);
    fetchLineas(rid);
  };

  const handleCrearReceta = async () => {
    if (!nrData.nombre.trim()) { show?.('Escribe un nombre', 'warning'); return; }
    setSavingReceta(true);
    try {
      const { error } = await db.from('recetas').insert({
        nombre: nrData.nombre.trim(),
        rendimiento: parseFloat(nrData.rendimiento) || 1,
        unidad_rendimiento: nrData.unidad,
        catalogo_id: nrPT?.id || null,
        activo: true,
      });
      if (error) throw error;
      show?.('Receta creada — ahora agrega los ingredientes', 'success');
      setShowNuevaReceta(false);
      setNrData({ nombre: '', rendimiento: 1, unidad: 'porcion' });
      setNrPT(null);
      fetchRecetas();
    } catch { show?.('Error al crear receta', 'error'); }
    finally { setSavingReceta(false); }
  };

  const handleAddIngrediente = async (recetaId) => {
    if (!addLinea.comp) { show?.('Selecciona un ingrediente', 'warning'); return; }
    if (!addLinea.cantidad || isNaN(addLinea.cantidad)) { show?.('Escribe la cantidad', 'warning'); return; }
    try {
      const { error } = await db.from('recetas_lineas').insert({
        receta_id: recetaId,
        materia_prima_id: addLinea.comp.id,
        tipo_componente: addLinea.comp.tipo || 'materia_prima',
        cantidad: parseFloat(addLinea.cantidad),
        unidad: addLinea.unidad,
      });
      if (error) throw error;
      show?.('Ingrediente agregado', 'success');
      setAddLinea({ comp: null, cantidad: '', unidad: 'kg' });
      // Refresh lines
      const { data } = await db.from('recetas_lineas')
        .select('id, cantidad, unidad, tipo_componente, catalogo_productos(id, nombre, sku, tipo)')
        .eq('receta_id', recetaId).order('created_at');
      setRecetaLineas(prev => ({ ...prev, [recetaId]: data || [] }));
    } catch { show?.('Error al agregar', 'error'); }
  };

  const handleDeleteLinea = async (lineaId, recetaId) => {
    const { error } = await db.from('recetas_lineas').delete().eq('id', lineaId);
    if (error) { show?.('Error al eliminar', 'error'); return; }
    setRecetaLineas(prev => ({
      ...prev,
      [recetaId]: (prev[recetaId] || []).filter(l => l.id !== lineaId),
    }));
  };

  /* ══════════════════════════════════════════════════════════════════════
     TAB 4: MOVIMIENTOS
     ══════════════════════════════════════════════════════════════════════ */
  const [movimientos, setMovimientos] = useState([]);
  const [searchMov, setSearchMov] = useState('');
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateEnd, setDateEnd] = useState(() => today());
  const [loadingMov, setLoadingMov] = useState(false);

  const fetchMov = useCallback(async () => {
    if (!sucursal) return;
    setLoadingMov(true);
    try {
      const { data } = await db.from('kardex_movimientos')
        .select('id, tipo, cantidad, stock_anterior, stock_posterior, notas, created_at, catalogo_productos(nombre)')
        .eq('sucursal_id', sucursal)
        .gte('created_at', dateStart + 'T00:00:00Z')
        .lte('created_at', dateEnd + 'T23:59:59Z')
        .order('created_at', { ascending: false });
      let f = data || [];
      if (searchMov) f = f.filter(m => m.catalogo_productos?.nombre?.toLowerCase().includes(searchMov.toLowerCase()));
      setMovimientos(f);
    } catch { show?.('Error al cargar movimientos', 'error'); }
    finally { setLoadingMov(false); }
  }, [sucursal, dateStart, dateEnd, searchMov]);

  useEffect(() => { fetchMov(); }, [fetchMov]);

  /* ══════════════════════════════════════════════════════════════════════
     TAB 5: AJUSTES
     ══════════════════════════════════════════════════════════════════════ */
  const [adjProd, setAdjProd] = useState(null);
  const [adjQty, setAdjQty] = useState('');
  const [adjNotas, setAdjNotas] = useState('');
  const [adjStock, setAdjStock] = useState(null);
  const [savingAdj, setSavingAdj] = useState(false);

  const selectAdjProd = async (prod) => {
    setAdjProd(prod);
    if (!sucursal) { show?.('Selecciona una sucursal primero', 'warning'); return; }
    const { data } = await db.from('inventario').select('stock_actual')
      .eq('producto_id', prod.id).eq('sucursal_id', sucursal).single();
    setAdjStock(data?.stock_actual ?? 0);
  };

  const handleAjuste = async () => {
    if (!adjProd) { show?.('Selecciona un producto', 'warning'); return; }
    if (!adjQty || isNaN(adjQty)) { show?.('Escribe una cantidad válida', 'warning'); return; }
    if (!adjNotas || adjNotas.trim().length < 5) { show?.('Escribe el motivo (mín. 5 caracteres)', 'warning'); return; }
    setSavingAdj(true);
    try {
      const cantidad = parseFloat(adjQty);
      const stockPost = adjStock + cantidad;
      const { error } = await db.from('kardex_movimientos').insert({
        producto_id: adjProd.id, sucursal_id: sucursal,
        tipo: 'ajuste_manual', cantidad, stock_anterior: adjStock,
        stock_posterior: stockPost, notas: adjNotas.trim(),
        usuario_id: user.id, referencia_tipo: 'manual',
      });
      if (error) throw error;
      await db.from('inventario').update({ stock_actual: stockPost })
        .eq('producto_id', adjProd.id).eq('sucursal_id', sucursal);
      show?.('Ajuste registrado', 'success');
      setAdjProd(null); setAdjQty(''); setAdjNotas(''); setAdjStock(null);
    } catch { show?.('Error al registrar ajuste', 'error'); }
    finally { setSavingAdj(false); }
  };

  const handleTab = (v) => {
    setActiveTab(v);
    if (v === 'mapeo')   fetchMapeo();
    if (v === 'recetas') fetchRecetas();
  };

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */
  const TABS_K = [
    { id: 'inventario',  label: '📦 Inventario' },
    { id: 'conteo',      label: '🌙 Lista Conteo' },
    { id: 'mapeo',       label: '🔗 Mapeo Compras' },
    { id: 'menu',        label: '🍔 Menú (BOM)' },
    { id: 'recetas',     label: '📋 Recetas' },
    { id: 'costeo',      label: '💰 Costeo' },
    { id: 'movimientos', label: '📊 Historial' },
    { id: 'ajustes',     label: '⚙️ Ajustes' },
  ];

  return (
    <div className="p-3 min-h-screen bg-background text-foreground">
      {/* Tab nav — pills */}
      <div style={{ display: 'flex', overflowX: 'auto', gap: 6, marginBottom: 16, paddingBottom: 2 }}>
        {TABS_K.map(t => (
          <button
            key={t.id}
            onClick={() => handleTab(t.id)}
            style={{
              padding: '6px 12px', borderRadius: 20, border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600,
              background: activeTab === t.id ? '#e63946' : '#222',
              color:      activeTab === t.id ? '#fff'     : '#666',
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 1: INVENTARIO
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'inventario' && (<div>
          {/* KPIs */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            <KpiCard icon="🧾" label="Materias Primas" value={catTotals.materia_prima} color="#60a5fa" />
            <KpiCard icon="🧪" label="Sub Productos" value={catTotals.sub_producto} color="#fb923c" />
            <KpiCard icon="🍔" label="Terminados" value={catTotals.producto_terminado} color="#4ade80" />
            <KpiCard icon="📦" label="Insumos" value={catTotals.insumo} color="#a1a1aa" />
          </div>

          {/* Filtros tipo chips */}
          <div className="chips">
            {[
              { key: 'todos', label: 'Todos' },
              { key: 'materia_prima', label: '🧾 MP' },
              { key: 'sub_producto', label: '🧪 SP' },
              { key: 'producto_terminado', label: '🍔 PT' },
              { key: 'insumo', label: '📦 IN' },
            ].map(f => (
              <button key={f.key} className={`chip ${catFilter === f.key ? 'on' : ''}`}
                onClick={() => setCatFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Buscar + Crear */}
          <div className="flex gap-2 mb-4">
            <Input placeholder="Buscar por nombre..." value={catSearch}
              onChange={e => setCatSearch(e.target.value)} className="flex-1" />
            <Button variant="success" size="sm" onClick={() => setShowCrear(v => !v)}
              className="whitespace-nowrap shrink-0">
              + Crear
            </Button>
          </div>

          {/* Panel crear nuevo */}
          {showCrear && (
            <div className="card" style={{ borderColor: '#2d6a4f' }}>
              <div className="sec-title" style={{ marginBottom: 12 }}>Nuevo producto o ingrediente</div>

              {/* Selector de tipo: visual con iconos grandes */}
              <div className="flex gap-2 mb-3 flex-wrap">
                {Object.entries(TIPOS).map(([key, t]) => (
                  <button key={key}
                    className="flex-1 min-w-[70px] rounded-lg p-2 text-center border-2 transition-all"
                    style={{
                      background: nuevoItem.tipo === key ? t.bg : 'transparent',
                      borderColor: nuevoItem.tipo === key ? t.color : '#333',
                      color: nuevoItem.tipo === key ? t.color : '#888',
                    }}
                    onClick={() => setNuevoItem(p => ({ ...p, tipo: key }))}
                  >
                    <div style={{ fontSize: 20 }}>{t.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{t.label}</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mb-3" style={{ color: TIPOS[nuevoItem.tipo]?.color }}>
                {TIPOS[nuevoItem.tipo]?.hint}
              </p>

              <div className="flex gap-2 mb-3">
                <Input placeholder="Nombre del producto..."
                  value={nuevoItem.nombre}
                  onChange={e => setNuevoItem(p => ({ ...p, nombre: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleCrearItem()}
                  className="flex-1" autoFocus />
                <select value={nuevoItem.unidad}
                  onChange={e => setNuevoItem(p => ({ ...p, unidad: e.target.value }))}
                  className={selectCls} style={{ width: 'auto', minWidth: 80 }}>
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <button className="btn btn-green btn-sm" onClick={handleCrearItem} disabled={creando}>
                  {creando ? 'Creando...' : `Crear ${TIPOS[nuevoItem.tipo]?.label}`}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowCrear(false)}>Cancelar</button>
              </div>
            </div>
          )}

          {/* Lista de productos */}
          {loadingCat ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : catalogo.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">{catFilter === 'todos' ? '📦' : TIPOS[catFilter]?.icon || '📦'}</div>
              <div className="empty-text">
                {catFilter === 'todos' ? 'No hay productos aún.' : `No hay ${TIPOS[catFilter]?.full || 'productos'} aún.`}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Usa el botón "+ Crear" o ve a "Mapeo Compras" para importar ingredientes desde tus facturas.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {catalogo.map(item => (
                <div key={item.id}>
                  <div className="item-row flex items-center gap-2">
                    <button onClick={() => setEditTipoId(editTipoId === item.id ? null : item.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      title="Cambiar clasificación (MP/SP/PT/Insumo)">
                      <TipoPill tipo={item.tipo} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.sku || 'sin SKU'} · almacén: {item.unidad_medida || 'unidad'}
                        {item.unidad_compra && Number(item.factor_compra) !== 1
                          ? ` · compra: 1 ${item.unidad_compra} = ${item.factor_compra} ${item.unidad_medida || 'u'}`
                          : ''}
                        {item.categoria ? ` · ${item.categoria}` : ''}
                      </p>
                    </div>
                    <button onClick={() => setEditItem(item)}
                      style={{ background: '#222', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}
                      title="Editar ítem (nombre, tipo, unidades, todos los atributos)">✏️</button>
                    <button onClick={() => toggleDte(item.id)}
                      style={{ background: verDte === item.id ? '#333' : '#222', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}
                      title="Ver DTEs mapeados a este item">🔗 DTE</button>
                    <button onClick={() => setEditUnid(item)}
                      style={{ background: '#222', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                      title="Editar unidades y conversión">📐</button>
                    <button onClick={async () => {
                      if (!window.confirm(`¿Eliminar "${item.nombre}"? Sale del catálogo.`)) return;
                      const { error } = await db.rpc('eliminar_producto', { p_producto_id: item.id });
                      if (error) { window.alert('❌ ' + error.message); return; }
                      fetchCatalogo();
                    }} style={{ background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}
                      title="Eliminar producto">🗑️</button>
                  </div>
                  {editTipoId === item.id && (
                    <div style={{ background: '#101010', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', margin: '4px 0 8px 40px', fontSize: 12 }}>
                      <div style={{ color: '#8a8a8a', marginBottom: 6 }}>Clasificación de "{item.nombre}":</div>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(TIPOS).map(([key, t]) => (
                          <button key={key} onClick={() => cambiarTipo(item, key)}
                            className="rounded-lg p-2 text-center border-2 transition-all"
                            style={{
                              minWidth: 68,
                              background: item.tipo === key ? t.bg : 'transparent',
                              borderColor: item.tipo === key ? t.color : '#333',
                              color: item.tipo === key ? t.color : '#888',
                              cursor: 'pointer',
                            }}
                            title={t.hint}>
                            <div style={{ fontSize: 18 }}>{t.icon}</div>
                            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{t.label}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {verDte === item.id && (
                    <div style={{ background: '#101010', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px', margin: '4px 0 8px 40px', fontSize: 12 }}>
                      {!dteMap ? <span style={{ color: '#888' }}>Cargando…</span>
                        : (dteMap.descripciones || []).length === 0
                          ? <span style={{ color: '#f87171' }}>⚠️ Sin ningún DTE mapeado a este item.</span>
                          : (
                            <>
                              <div style={{ color: '#8a8a8a', marginBottom: 4 }}>{dteMap.descripciones.length} descripción(es) de DTE mapeada(s){dteMap.n_dte_items ? ` · ${dteMap.n_dte_items} líneas históricas` : ''}:</div>
                              {dteMap.descripciones.map((d, k) => (
                                <div key={k} style={{ padding: '2px 0', color: '#ddd' }}>
                                  • {d.descripcion} <span style={{ color: '#666' }}>{d.proveedor ? `· ${d.proveedor}` : d.nit ? `· NIT ${d.nit}` : ''}{d.veces ? ` · ×${d.veces}` : ''}</span>
                                </div>
                              ))}
                            </>
                          )}
                    </div>
                  )}
                </div>
              ))}
              {editUnid && <UnidadesModal item={editUnid} onClose={() => setEditUnid(null)} onSaved={() => { setEditUnid(null); fetchCatalogo(); }} />}
              {editItem && <ItemEditorModal item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); fetchCatalogo(); fetchTotals(); show?.('Ítem actualizado', 'success'); }} show={show} />}
              {catalogo.length >= 1000 && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  Mostrando primeros 1,000 resultados. Usa el buscador para filtrar.
                </p>
              )}
            </div>
          )}
        </div>)}

        {/* ═══════════════════════════════════════════════════════════════
            TAB 2: MAPEO DE COMPRAS
            Vincula los items de tus facturas a ingredientes del catálogo
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'mapeo' && (<div>
          {/* Barra de progreso global */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <p className="text-sm font-bold">Identificación de ingredientes</p>
                <p className="text-xs text-muted-foreground">
                  Vincula las descripciones de tus facturas a tu catálogo de ingredientes
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleExtract} disabled={extracting}
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {extracting ? '⏳ ...' : '🔄 Sincronizar'}
              </button>
            </div>
            <ProgressBar
              value={totalMapped}
              max={totalDescs}
              label={`${totalMapped} de ${totalDescs} descripciones vinculadas`}
            />
          </div>

          {/* Filtro */}
          <div className="flex gap-2 items-center mb-4 flex-wrap">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: '#888' }}>
              <input type="checkbox" checked={soloSinMapear}
                onChange={e => setSoloSinMapear(e.target.checked)}
                style={{ accentColor: '#e63946' }} />
              Solo pendientes
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: '#888' }}
              title="Oculta descripciones de proveedores que no se inventarían (gastos, servicios, etc.)">
              <input type="checkbox" checked={soloInventariables}
                onChange={e => setSoloInventariables(e.target.checked)}
                style={{ accentColor: '#e63946' }} />
              Solo inventariables
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: '#888' }}
              title="Solo descripciones compradas en los últimos 3 meses (evita mapear cosas muy viejas)">
              <input type="checkbox" checked={solo3Meses}
                onChange={e => setSolo3Meses(e.target.checked)}
                style={{ accentColor: '#e63946' }} />
              Últimos 3 meses
            </label>
            <Input placeholder="Buscar descripción..." value={mapeoSearch}
              onChange={e => setMapeoSearch(e.target.value)} className="flex-1 max-w-60" />
            <button className="btn btn-ghost btn-sm" onClick={fetchMapeo} style={{ fontSize: 12 }}>
              Actualizar
            </button>
          </div>

          {loadingMapeo ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : dteDescs.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">✅</div>
              <div className="empty-text">
                {soloSinMapear ? '¡Todo vinculado!' : 'No hay descripciones'}
              </div>
              {soloSinMapear && totalDescs > 0 && (
                <p className="text-xs mt-2" style={{ color: '#4ade80' }}>
                  Todas tus descripciones de compra están vinculadas a ingredientes del catálogo.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {dteDescs.map(desc => {
                const isActive = activeMapDesc === desc.descripcion;
                const isCreating = creandoDesdeMapeo === desc.descripcion;

                return (
                  <div key={desc.descripcion} className="card" style={{
                    borderColor: desc.mapeado ? '#14532d' : isActive ? '#e63946' : '#2a2a2a',
                    padding: 12,
                  }}>
                    {/* Encabezado: descripción + monto */}
                    <div className="flex items-start gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold leading-tight" style={{ wordBreak: 'break-word' }}>
                          {desc.descripcion}
                        </p>
                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                          <span>💰 ${n(desc.monto_total)}</span>
                          <span>📄 {desc.num_dtes} facturas</span>
                          <span>📦 {desc.num_lineas} líneas</span>
                        </div>
                      </div>
                      {desc.mapeado ? (
                        <span className="tag tag-green shrink-0" style={{ fontSize: 11 }}>✓ Vinculado</span>
                      ) : (
                        <span className="tag tag-orange shrink-0" style={{ fontSize: 11 }}>Pendiente</span>
                      )}
                    </div>

                    {/* Ingrediente vinculado: nombre editable + estado de conteo nocturno + acciones */}
                    {desc.mapeado && !isActive && (
                      <div className="mt-2 pt-2" style={{ borderTop: '1px solid #222' }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs shrink-0" style={{ color: '#8a8a8a' }}>🔗 Vinculado a:</span>
                          {editNombre === desc.descripcion ? (
                            <div className="flex gap-1 items-center flex-1" style={{ minWidth: 180 }}>
                              <Input value={editNombreVal} onChange={e => setEditNombreVal(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleRenombrarIngrediente(desc.catalogo_id, editNombreVal)}
                                autoFocus className="flex-1" />
                              <button className="btn btn-green btn-sm shrink-0" disabled={savingMapeo}
                                onClick={() => handleRenombrarIngrediente(desc.catalogo_id, editNombreVal)}>
                                {savingMapeo ? '...' : '✓'}
                              </button>
                              <button className="text-xs underline shrink-0" style={{ color: '#8a8a8a' }}
                                onClick={() => setEditNombre(null)}>✕</button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-semibold" style={{ color: '#4ade80', wordBreak: 'break-word' }}>
                                {desc.catalogo_nombre || '—'}
                              </span>
                              {desc.catalogo_unidad && (
                                <span className="text-xs shrink-0" style={{ color: '#8a8a8a' }}>· {desc.catalogo_unidad}</span>
                              )}
                              <button className="text-xs underline shrink-0" style={{ color: '#60a5fa' }}
                                title="Renombrar el ingrediente (se refleja en el conteo nocturno)"
                                onClick={() => { setEditNombre(desc.descripcion); setEditNombreVal(desc.catalogo_nombre || ''); }}>
                                ✎ nombre
                              </button>
                            </>
                          )}
                        </div>

                        {/* Estado en el conteo nocturno */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {desc.catalogo_en_conteo ? (
                            <span className="tag tag-green" style={{ fontSize: 11 }}>🌙 En conteo nocturno</span>
                          ) : (
                            <>
                              <span className="tag tag-orange" style={{ fontSize: 11 }}>🌙 No está en el conteo</span>
                              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} disabled={savingMapeo}
                                onClick={() => handleToggleConteo(desc.catalogo_id, true)}>
                                + Agregar al conteo
                              </button>
                            </>
                          )}
                        </div>

                        {/* Acciones: cambiar / desvincular */}
                        <div className="flex gap-2 mt-2">
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}
                            onClick={() => { setActiveMapDesc(desc.descripcion); setCreandoDesdeMapeo(null); setEditNombre(null); }}>
                            ↻ Cambiar ingrediente
                          </button>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: '#f87171' }} disabled={savingMapeo}
                            onClick={() => handleDesmapear(desc.descripcion)}>
                            ✕ Desvincular
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Acciones si no está mapeado */}
                    {!desc.mapeado && !isActive && (
                      <button className="btn btn-ghost btn-sm mt-2" style={{ fontSize: 12, width: '100%' }}
                        onClick={() => { setActiveMapDesc(desc.descripcion); setCreandoDesdeMapeo(null); }}>
                        Vincular a ingrediente →
                      </button>
                    )}

                    {/* Panel de vinculación / cambio expandido */}
                    {isActive && (
                      <div className="mt-3 space-y-2 pt-3" style={{ borderTop: '1px solid #333' }}>
                        {/* Opción 1: buscar existente */}
                        <p className="text-xs font-bold" style={{ color: '#60a5fa' }}>
                          {desc.mapeado ? 'Cambiar a otro ingrediente existente:' : 'Buscar ingrediente existente:'}
                        </p>
                        <CatalogoSearch
                          placeholder="Escribe el nombre del ingrediente..."
                          tipo={['materia_prima', 'sub_producto']}
                          onSelect={mp => handleMapear(desc.descripcion, mp.id)}
                        />

                        {/* Separador */}
                        <div className="flex items-center gap-3 my-1">
                          <div className="flex-1 h-px" style={{ background: '#333' }} />
                          <span className="text-xs text-muted-foreground">ó</span>
                          <div className="flex-1 h-px" style={{ background: '#333' }} />
                        </div>

                        {/* Opción 2: crear nuevo */}
                        {!isCreating ? (
                          <button className="btn btn-green btn-sm" style={{ width: '100%', fontSize: 12 }}
                            onClick={() => { setCreandoDesdeMapeo(desc.descripcion); setNewNameMapeo(''); }}>
                            + Crear ingrediente nuevo
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-bold" style={{ color: '#4ade80' }}>
                              Nombre para la nueva Materia Prima:
                            </p>
                            <div className="flex gap-2">
                              <Input
                                placeholder={desc.descripcion.substring(0, 40)}
                                value={newNameMapeo}
                                onChange={e => setNewNameMapeo(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleCrearYMapear(desc.descripcion)}
                                autoFocus className="flex-1" />
                              <button className="btn btn-green btn-sm shrink-0"
                                onClick={() => handleCrearYMapear(desc.descripcion)}
                                disabled={savingMapeo}>
                                {savingMapeo ? '...' : '✓'}
                              </button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Deja vacío para usar la descripción de la factura tal cual.
                            </p>
                          </div>
                        )}

                        {/* Cancelar */}
                        <button className="text-xs text-muted-foreground mt-1 underline"
                          onClick={() => { setActiveMapDesc(null); setCreandoDesdeMapeo(null); }}>
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>)}

        {/* ═══════════════════════════════════════════════════════════════
            TAB 3: RECETAS
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'conteo' && <ConteoLista user={user} />}

        {activeTab === 'menu' && <MapeoMenu user={user} />}

        {activeTab === 'recetas' && <RecetasView user={user} />}

        {activeTab === 'costeo' && <CosteoView />}

        {/* ═══════════════════════════════════════════════════════════════
            TAB 4: HISTORIAL DE MOVIMIENTOS
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'movimientos' && (<div>
          <div className="card" style={{ padding: 12 }}>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="field">
                <label>Sucursal</label>
                <select value={sucursal} onChange={e => setSucursal(e.target.value)} className={selectCls}>
                  <option value="">Selecciona...</option>
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.store_code} — {s.nombre || STORES[s.store_code] || s.store_code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Producto</label>
                <Input placeholder="Buscar..." value={searchMov}
                  onChange={e => setSearchMov(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="field"><label>Desde</label>
                <Input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} /></div>
              <div className="field"><label>Hasta</label>
                <Input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} /></div>
            </div>
          </div>

          {loadingMov ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : movimientos.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📊</div>
              <div className="empty-text">Sin movimientos en este período</div>
            </div>
          ) : (
            <div className="space-y-1">
              {movimientos.map(mov => {
                const mt = MOV_TIPOS[mov.tipo] || { label: mov.tipo, icon: '?', badge: 'muted' };
                const isPositive = mov.cantidad > 0;
                return (
                  <div key={mov.id} className="item-row">
                    <div className="flex items-center gap-3 w-full">
                      <div style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{mt.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{mov.catalogo_productos?.nombre || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {mt.label} · {fmtDate(mov.created_at)}
                          {mov.notas ? ` · ${mov.notas}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold" style={{ color: isPositive ? '#4ade80' : '#f87171' }}>
                          {isPositive ? '+' : ''}{n(mov.cantidad)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {n(mov.stock_anterior)} → {n(mov.stock_posterior)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>)}

        {/* ═══════════════════════════════════════════════════════════════
            TAB 5: AJUSTES MANUALES
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'ajustes' && (<div>
          <div className="card" style={{ maxWidth: 480 }}>
            <div className="sec-title" style={{ marginBottom: 4 }}>Ajuste manual de inventario</div>
            <p className="text-xs text-muted-foreground mb-4">
              Registra una corrección cuando el stock real no coincide con el sistema.
            </p>

            <div className="space-y-3">
              <div className="field">
                <label>Sucursal</label>
                <select value={sucursal} onChange={e => setSucursal(e.target.value)} className={selectCls}>
                  <option value="">Selecciona...</option>
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.store_code} — {s.nombre || STORES[s.store_code] || s.store_code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Producto</label>
                <CatalogoSearch
                  placeholder="Buscar producto..."
                  onSelect={selectAdjProd}
                />
                {adjProd && adjStock !== null && (
                  <div className="diff-bar diff-ok mt-2">
                    <div>
                      <p className="text-sm font-bold">{adjProd.nombre}</p>
                      <p className="text-xs" style={{ color: '#4ade80' }}>Stock actual: {n(adjStock)}</p>
                    </div>
                    <TipoPill tipo={adjProd.tipo} />
                  </div>
                )}
              </div>

              <div className="field">
                <label>Cantidad (+ entrada / − salida)</label>
                <Input type="number" step="0.01" placeholder="Ej: 5 o -3"
                  value={adjQty} onChange={e => setAdjQty(e.target.value)} />
                {adjQty && adjStock !== null && (
                  <p className="text-xs mt-1" style={{ color: parseFloat(adjQty) >= 0 ? '#4ade80' : '#f87171' }}>
                    Nuevo stock: {n(adjStock + (parseFloat(adjQty) || 0))}
                  </p>
                )}
              </div>

              <div className="field">
                <label>Motivo del ajuste</label>
                <textarea
                  placeholder="Ej: Conteo físico, Merma por rotura, Devolución..."
                  value={adjNotas} onChange={e => setAdjNotas(e.target.value)}
                  className="inp" style={{ minHeight: 72, resize: 'vertical' }} />
              </div>

              <button className="btn btn-green" onClick={handleAjuste}
                disabled={savingAdj || !adjProd}>
                {savingAdj ? 'Guardando...' : '✓ Registrar ajuste'}
              </button>
            </div>
          </div>
        </div>)}
    </div>
  );
}

// ── Editor de unidades y conversión compra→almacén ──
const UNID_ALMACEN = ['porcion', 'unidad', 'libra', 'onza', 'gramo', 'kilogramo', 'litro', 'mililitro', 'taza', 'cucharada', 'cucharadita', 'bolsa', 'bote', 'caja'];
const UNID_COMPRA = [...UNID_ALMACEN, 'fardo', 'paquete', 'saco', 'lata', 'galón', 'display', 'docena', 'media docena', 'cubeta'];
const OTRA = '__otra__';
function UnidadesModal({ item, onClose, onSaved }) {
  const [um, setUm] = useState(item.unidad_medida || 'unidad');
  const [uc, setUc] = useState(item.unidad_compra || '');
  const [factor, setFactor] = useState(item.factor_compra ?? 1);
  const [saving, setSaving] = useState(false);
  // Permite escribir una unidad de compra que no está en la lista (ej: docena, cubeta…)
  const [customC, setCustomC] = useState(false);
  const guardar = async () => {
    setSaving(true);
    const { error } = await db.rpc('set_unidades_producto', {
      p_producto_id: item.id, p_unidad_medida: um, p_unidad_compra: uc || null, p_factor_compra: Number(factor) || 1,
    });
    setSaving(false);
    if (!error) onSaved();
  };
  const inp = { background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#f0f0f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, width: '100%' };
  const lbl = { fontSize: 11, color: '#8a8a8a', display: 'block', marginBottom: 3 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16, width: '100%', maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Unidades y conversión</div>
        <div style={{ fontSize: 12, color: '#8a8a8a', marginBottom: 12 }}>{item.nombre}</div>
        <label style={lbl}>Unidad de almacén (cómo se guarda y se usa en recetas)</label>
        <select value={um} onChange={e => setUm(e.target.value)} style={{ ...inp, marginBottom: 10 }}>
          {(UNID_ALMACEN.includes(um) ? UNID_ALMACEN : [um, ...UNID_ALMACEN]).map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <label style={lbl}>Unidad de compra (cómo viene en el DTE)</label>
        <select
          value={customC ? OTRA : uc}
          onChange={e => {
            if (e.target.value === OTRA) { setCustomC(true); setUc(''); }
            else { setCustomC(false); setUc(e.target.value); }
          }}
          style={{ ...inp, marginBottom: customC ? 6 : 10 }}>
          <option value="">(igual que almacén)</option>
          {(uc && !UNID_COMPRA.includes(uc) ? [uc, ...UNID_COMPRA] : UNID_COMPRA).map(u => <option key={u} value={u}>{u}</option>)}
          <option value={OTRA}>➕ otra…</option>
        </select>
        {customC && (
          <input
            type="text" autoFocus placeholder="Escribí la unidad (ej: docena, cubeta, rollo…)"
            value={uc} onChange={e => setUc(e.target.value)}
            style={{ ...inp, marginBottom: 10 }} />
        )}
        <label style={lbl}>Factor: 1 {uc || 'compra'} = ? {um || 'almacén'}</label>
        <input type="number" step="any" value={factor} onChange={e => setFactor(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
        <div style={{ fontSize: 11, color: '#8a8a8a', marginBottom: 14 }}>Ej: comprás caja de 30 lb → compra "caja", almacén "lb", factor 30. Al recibir 5 cajas entran 150 lb.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: '#333', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{ background: '#4ade80', color: '#04220f', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Editor completo de un ítem del catálogo (todos los atributos de la tabla) ──
function ItemEditorModal({ item, onClose, onSaved, show }) {
  const [form, setForm] = useState(null); // se carga la fila completa al abrir
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    db.from('catalogo_productos').select('*').eq('id', item.id).single()
      .then(({ data }) => { if (alive) setForm(data || { ...item }); });
    return () => { alive = false; };
  }, [item]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const numOrNull = (v) => (v === '' || v == null ? null : Number(v));
  const guardar = async () => {
    setSaving(true); setErr('');
    const { error } = await db.rpc('actualizar_catalogo_producto', {
      p_id: item.id,
      p_nombre: form.nombre, p_sku: form.sku, p_codigo: form.codigo,
      p_tipo: form.tipo || null, p_categoria: form.categoria, p_subcategoria: form.subcategoria,
      p_unidad_medida: form.unidad_medida, p_unidad_compra: form.unidad_compra || null,
      p_factor_compra: numOrNull(form.factor_compra),
      p_contenido_neto: numOrNull(form.contenido_neto), p_unidad_contenido: form.unidad_contenido,
      p_precio_referencia: numOrNull(form.precio_referencia),
      p_descripcion: form.descripcion, p_activo: !!form.activo,
      p_incluir_conteo: form.incluir_conteo == null ? null : !!form.incluir_conteo,
      p_incluir_inventario_fisico: form.incluir_inventario_fisico == null ? null : !!form.incluir_inventario_fisico,
    });
    setSaving(false);
    if (error) { setErr(error.message); show?.('❌ ' + error.message, 'error'); return; }
    onSaved();
  };
  const inp = { background: '#1e1e1e', border: '1px solid #2a2a2a', color: '#f0f0f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, width: '100%' };
  const lbl = { fontSize: 11, color: '#8a8a8a', display: 'block', marginBottom: 3 };
  const row = { display: 'flex', gap: 8 };
  const sel = (val, list) => (val && !list.includes(val) ? [val, ...list] : list);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16, width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Editar ítem</div>
        {!form ? (
          <div style={{ color: '#8a8a8a', padding: 20, textAlign: 'center' }}>Cargando…</div>
        ) : (
          <>
            <label style={lbl}>Nombre *</label>
            <input value={form.nombre || ''} onChange={e => set('nombre', e.target.value)} style={{ ...inp, marginBottom: 10 }} />

            <label style={lbl}>Clasificación</label>
            <div className="flex gap-2 mb-3 flex-wrap">
              {Object.entries(TIPOS).map(([key, t]) => (
                <button key={key} onClick={() => set('tipo', key)}
                  className="rounded-lg p-2 text-center border-2" style={{
                    minWidth: 64, background: form.tipo === key ? t.bg : 'transparent',
                    borderColor: form.tipo === key ? t.color : '#333', color: form.tipo === key ? t.color : '#888', cursor: 'pointer',
                  }} title={t.hint}>
                  <div style={{ fontSize: 18 }}>{t.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{t.label}</div>
                </button>
              ))}
            </div>

            <div style={{ ...row, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>SKU</label>
                <input value={form.sku || ''} onChange={e => set('sku', e.target.value)} style={inp} placeholder="sin SKU" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Código</label>
                <input value={form.codigo || ''} onChange={e => set('codigo', e.target.value)} style={inp} placeholder="—" />
              </div>
            </div>

            <div style={{ ...row, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Categoría *</label>
                <input value={form.categoria || ''} onChange={e => set('categoria', e.target.value)} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Subcategoría</label>
                <input value={form.subcategoria || ''} onChange={e => set('subcategoria', e.target.value)} style={inp} placeholder="—" />
              </div>
            </div>

            <label style={lbl}>Unidad de almacén * (cómo se usa en recetas/inventario)</label>
            <select value={form.unidad_medida || 'unidad'} onChange={e => set('unidad_medida', e.target.value)} style={{ ...inp, marginBottom: 10 }}>
              {sel(form.unidad_medida, UNID_ALMACEN).map(u => <option key={u} value={u}>{u}</option>)}
            </select>

            <div style={{ ...row, marginBottom: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={lbl}>Unidad de compra (DTE)</label>
                <select value={form.unidad_compra || ''} onChange={e => set('unidad_compra', e.target.value)} style={inp}>
                  <option value="">(igual que almacén)</option>
                  {sel(form.unidad_compra, UNID_COMPRA).filter(Boolean).map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Factor</label>
                <input type="number" step="any" value={form.factor_compra ?? 1} onChange={e => set('factor_compra', e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#8a8a8a', marginBottom: 12 }}>1 {form.unidad_compra || 'compra'} = {form.factor_compra ?? 1} {form.unidad_medida || 'almacén'} · afecta el costo por unidad.</div>

            <div style={{ ...row, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Contenido neto</label>
                <input type="number" step="any" value={form.contenido_neto ?? ''} onChange={e => set('contenido_neto', e.target.value)} style={inp} placeholder="—" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Unidad contenido</label>
                <input value={form.unidad_contenido || ''} onChange={e => set('unidad_contenido', e.target.value)} style={inp} placeholder="—" />
              </div>
            </div>

            <label style={lbl}>Precio referencia (solo fallback si no hay costo DTE)</label>
            <input type="number" step="any" value={form.precio_referencia ?? ''} onChange={e => set('precio_referencia', e.target.value)} style={{ ...inp, marginBottom: 10 }} placeholder="—" />

            <label style={lbl}>Descripción</label>
            <textarea value={form.descripcion || ''} onChange={e => set('descripcion', e.target.value)} style={{ ...inp, minHeight: 44, marginBottom: 12 }} placeholder="—" />

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f0f0f0', marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.activo} onChange={e => set('activo', e.target.checked)} /> Activo (visible en catálogo, recetas y selectores)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f0f0f0', marginBottom: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.incluir_conteo} onChange={e => set('incluir_conteo', e.target.checked)} /> Incluir en Conteo Nocturno
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f0f0f0', marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.incluir_inventario_fisico} onChange={e => set('incluir_inventario_fisico', e.target.checked)} /> Incluir en Inventario Físico
            </label>

            {err && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>❌ {err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: '#333', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={guardar} disabled={saving} style={{ background: '#4ade80', color: '#04220f', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Mantenimiento de la lista del Conteo Nocturno (dentro de Kardex) ──
function ConteoLista({ user }) {
  const puede = ['jefe_casa_matriz', 'ejecutivo', 'admin', 'superadmin'].includes(user?.rol);
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [openG, setOpenG] = useState({});
  const [openR, setOpenR] = useState({});
  const [adding, setAdding] = useState(false);
  const [nuevaCat, setNuevaCat] = useState('');
  const [subrecetas, setSubrecetas] = useState([]);
  const [edit, setEdit] = useState(null); // id del item en edición

  const cargar = async () => {
    const [d, c, s] = await Promise.all([
      db.rpc('conteo_lista'),
      db.rpc('conteo_categorias'),
      db.from('recetas').select('id,nombre,tipo').in('tipo', ['sub_receta', 'porcionado']).eq('activo', true).order('nombre'),
    ]);
    setData(d.data || null); setCats(c.data || []); setSubrecetas(s.data || []);
  };
  useEffect(() => { cargar(); }, []);

  const setItem = async (id, patch) => {
    await db.rpc('set_conteo_item', { p_producto_id: id, p_incluir: patch.incluir ?? null, p_categoria: patch.categoria ?? null, p_orden: patch.orden ?? null });
    cargar();
  };
  const renombrar = async (id, nombre) => { await db.rpc('set_conteo_item_meta', { p_producto_id: id, p_nombre: nombre }); cargar(); };
  const cambiarTipo = async (id, tipo) => { await db.rpc('set_conteo_item_meta', { p_producto_id: id, p_tipo: tipo }); cargar(); };
  const matchSub = async (id, receta_id) => { await db.rpc('match_conteo_subreceta', { p_producto_id: id, p_receta_id: receta_id || null }); cargar(); };
  const quitar = async (id, nombre) => {
    if (!window.confirm(`¿Quitar "${nombre}" de la lista de conteo?`)) return;
    await db.rpc('set_conteo_item', { p_producto_id: id, p_incluir: false }); cargar();
  };
  const agregar = async (prod) => {
    await db.rpc('set_conteo_item', { p_producto_id: prod.id, p_incluir: true, p_categoria: nuevaCat || 'Sin grupo' });
    setAdding(false); setNuevaCat(''); cargar();
  };

  const C = { card: '#1a1a1a', card2: '#151515', border: '#2a2a2a', dim: '#8a8a8a', green: '#4ade80', blue: '#60a5fa' };
  if (!data) return <div style={{ color: C.dim, padding: 12 }}>Cargando…</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: C.dim }}>{data.total} productos en el conteo</div>
        <div style={{ flex: 1 }} />
        {puede && !adding && <button onClick={() => setAdding(true)} style={{ background: C.green, color: '#04220f', border: 'none', borderRadius: 8, padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>+ Agregar producto</button>}
      </div>

      {puede && adding && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 6 }}>Buscá un producto del catálogo y elegí su grupo:</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={nuevaCat} onChange={e => setNuevaCat(e.target.value)} style={{ background: '#1e1e1e', border: `1px solid ${C.border}`, color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 13 }}>
              <option value="">Grupo…</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ flex: 1, minWidth: 200 }}>
              <CatalogoSearch placeholder="Buscar producto…" onSelect={agregar} />
            </div>
            <button onClick={() => setAdding(false)} style={{ background: '#333', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(data.grupos || []).map(g => (
          <div key={g.grupo} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12 }}>
            <div onClick={() => setOpenG(o => ({ ...o, [g.grupo]: !o[g.grupo] }))} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <div style={{ flex: 1, fontWeight: 700 }}>{g.grupo}</div>
              <span style={{ fontSize: 12, color: C.dim }}>{g.n}</span>
              <span style={{ color: C.dim }}>{openG[g.grupo] ? '▲' : '▼'}</span>
            </div>
            {openG[g.grupo] && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(g.items || []).map(it => (
                  <div key={it.id} style={{ background: C.card2, borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <TipoPill tipo={it.tipo} />
                      <div style={{ flex: 1, minWidth: 140, fontSize: 13 }}>
                        {it.nombre} <span style={{ color: C.dim, fontSize: 11 }}>· {it.unidad || 'u'}</span>
                        {it.match_receta_nombre && <span style={{ color: '#fb923c', fontSize: 11, marginLeft: 8 }}>= {it.match_receta_nombre}</span>}
                        {it.receta && <span onClick={() => setOpenR(o => ({ ...o, [it.id]: !o[it.id] }))} style={{ color: C.blue, fontSize: 11, marginLeft: 8, cursor: 'pointer' }}>{openR[it.id] ? '▾ receta' : '▸ receta'}</span>}
                      </div>
                      {puede && (
                        <>
                          <button onClick={() => setEdit(e => e === it.id ? null : it.id)} title="Editar / clasificar"
                            style={{ background: edit === it.id ? '#333' : '#222', color: '#ccc', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>✎</button>
                          <select value={it.grupo || g.grupo} onChange={e => setItem(it.id, { categoria: e.target.value })}
                            style={{ background: '#1e1e1e', border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '3px 6px', fontSize: 11 }} title="Mover de grupo">
                            {cats.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input type="number" defaultValue={it.orden ?? ''} onBlur={e => setItem(it.id, { orden: e.target.value === '' ? null : Number(e.target.value) })}
                            placeholder="orden" style={{ width: 56, background: '#1e1e1e', border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '3px 6px', fontSize: 11 }} title="Orden" />
                          <button onClick={() => quitar(it.id, it.nombre)} style={{ background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Quitar</button>
                        </>
                      )}
                    </div>

                    {/* Panel de edición: nombre, tipo, match a sub-receta */}
                    {puede && edit === it.id && (
                      <div style={{ marginTop: 8, padding: 10, background: '#101010', borderRadius: 8, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Nombre del ingrediente</div>
                          <input defaultValue={it.nombre} onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.nombre) renombrar(it.id, v); }}
                            style={{ width: '100%', boxSizing: 'border-box', background: '#1e1e1e', border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Tipo</div>
                            <select value={it.tipo || 'materia_prima'} onChange={e => cambiarTipo(it.id, e.target.value)}
                              style={{ background: '#1e1e1e', border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
                              <option value="materia_prima">🧾 Materia Prima</option>
                              <option value="sub_producto">🧪 Sub Producto</option>
                              <option value="producto_terminado">🍔 Terminado (reventa)</option>
                              <option value="insumo">📦 Insumo (no alimento)</option>
                            </select>
                          </div>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Es la sub-receta… (si es un preparado de CM)</div>
                            <select value={it.match_receta_id || ''} onChange={e => matchSub(it.id, e.target.value)}
                              style={{ width: '100%', background: '#1e1e1e', border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
                              <option value="">— ninguna (es materia prima) —</option>
                              {subrecetas.map(s => <option key={s.id} value={s.id}>{s.nombre}{s.tipo === 'porcionado' ? ' (porcionado)' : ''}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ fontSize: 10, color: C.dim }}>
                          Al matchear a una sub-receta, la venta descuenta <b>este</b> ítem (lo que la sucursal cuenta), no las materias primas de CM.
                        </div>
                      </div>
                    )}

                    {it.receta && openR[it.id] && (
                      <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: `2px solid ${C.blue}` }}>
                        <div style={{ fontSize: 11, color: C.dim, marginBottom: 2 }}>Receta: {it.receta.nombre}</div>
                        {(it.receta.ingredientes || []).map((ing, k) => (
                          <div key={k} style={{ fontSize: 12 }}>• {ing.nombre} <span style={{ color: C.dim }}>{ing.cantidad} {ing.unidad || ''}{ing.tipo === 'sub_receta' ? ' (sub)' : ''}</span></div>
                        ))}
                        {(!it.receta.ingredientes || it.receta.ingredientes.length === 0) && <div style={{ fontSize: 12, color: C.dim }}>Sin ingredientes cargados.</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {!puede && <div style={{ fontSize: 11, color: C.dim, marginTop: 10 }}>Solo jefe de almacén y ejecutivos pueden editar la lista.</div>}
    </div>
  );
}
