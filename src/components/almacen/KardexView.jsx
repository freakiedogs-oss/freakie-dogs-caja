import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/Badge';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTES
   ═══════════════════════════════════════════════════════════════════════════ */
const TIPOS = {
  materia_prima:     { label: 'MP',  full: 'Materia Prima',       icon: '🥩', color: '#60a5fa', bg: '#1e3a5f', badge: 'info',    hint: 'Ingrediente que compras a proveedores' },
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
  const [catFilter, setCatFilter] = useState('todos');
  const [catSearch, setCatSearch] = useState('');
  const [loadingCat, setLoadingCat] = useState(false);
  const [showCrear, setShowCrear] = useState(false);
  const [nuevoItem, setNuevoItem] = useState({ nombre: '', tipo: 'materia_prima', unidad: 'kg' });
  const [creando, setCreando] = useState(false);

  const fetchCatalogo = useCallback(async () => {
    setLoadingCat(true);
    try {
      let q = db.from('catalogo_productos')
        .select('id, nombre, sku, tipo, unidad_medida, categoria, activo, codigo')
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

  // Conteos por tipo
  const catCounts = { materia_prima: 0, sub_producto: 0, producto_terminado: 0, insumo: 0, total: catalogo.length };
  catalogo.forEach(c => { const t = c.tipo || 'materia_prima'; if (catCounts[t] !== undefined) catCounts[t]++; });

  /* ══════════════════════════════════════════════════════════════════════
     TAB 2: MAPEO DE COMPRAS (vincular items DTE → catálogo)
     ══════════════════════════════════════════════════════════════════════ */
  const [dteDescs, setDteDescs] = useState([]);
  const [loadingMapeo, setLoadingMapeo] = useState(false);
  const [soloSinMapear, setSoloSinMapear] = useState(true);
  const [mapeoSearch, setMapeoSearch] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [activeMapDesc, setActiveMapDesc] = useState(null);
  const [creandoDesdeMapeo, setCreandoDesdeMapeo] = useState(null);
  const [newNameMapeo, setNewNameMapeo] = useState('');
  const [savingMapeo, setSavingMapeo] = useState(false);
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
      let q = db.from('v_dte_descripciones').select('*');
      if (soloSinMapear) q = q.eq('mapeado', false);
      if (mapeoSearch) q = q.ilike('descripcion', `%${mapeoSearch}%`);
      q = q.limit(100);
      const { data, error } = await q;
      if (error) throw error;
      setDteDescs(data || []);
    } catch { show?.('Error al cargar mapeo', 'error'); }
    finally { setLoadingMapeo(false); }
  }, [soloSinMapear, mapeoSearch]);

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

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="p-3 min-h-screen bg-background text-foreground">
      <Tabs value={activeTab} onValueChange={v => {
        setActiveTab(v);
        if (v === 'mapeo') fetchMapeo();
        if (v === 'recetas') fetchRecetas();
      }}>
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="inventario">📦 Inventario</TabsTrigger>
          <TabsTrigger value="mapeo">🔗 Mapeo Compras</TabsTrigger>
          <TabsTrigger value="recetas">📋 Recetas</TabsTrigger>
          <TabsTrigger value="movimientos">📊 Historial</TabsTrigger>
          <TabsTrigger value="ajustes">⚙️ Ajustes</TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 1: INVENTARIO
        ═══════════════════════════════════════════════════════════════ */}
        <TabsContent value="inventario">
          {/* KPIs */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            <KpiCard icon="🥩" label="Materias Primas" value={catCounts.materia_prima} color="#60a5fa" />
            <KpiCard icon="🧪" label="Sub Productos" value={catCounts.sub_producto} color="#fb923c" />
            <KpiCard icon="🍔" label="Terminados" value={catCounts.producto_terminado} color="#4ade80" />
            <KpiCard icon="📦" label="Insumos" value={catCounts.insumo} color="#a1a1aa" />
          </div>

          {/* Filtros tipo chips */}
          <div className="chips">
            {[
              { key: 'todos', label: 'Todos' },
              { key: 'materia_prima', label: '🥩 MP' },
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
                <div key={item.id} className="item-row flex items-center gap-3">
                  <TipoPill tipo={item.tipo} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{item.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.sku || 'sin SKU'} · {item.unidad_medida || 'unidad'}
                      {item.categoria ? ` · ${item.categoria}` : ''}
                    </p>
                  </div>
                </div>
              ))}
              {catalogo.length >= 1000 && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  Mostrando primeros 1,000 resultados. Usa el buscador para filtrar.
                </p>
              )}
            </div>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 2: MAPEO DE COMPRAS
            Vincula los items de tus facturas a ingredientes del catálogo
        ═══════════════════════════════════════════════════════════════ */}
        <TabsContent value="mapeo">
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

                    {/* Acciones si no está mapeado */}
                    {!desc.mapeado && !isActive && (
                      <button className="btn btn-ghost btn-sm mt-2" style={{ fontSize: 12, width: '100%' }}
                        onClick={() => { setActiveMapDesc(desc.descripcion); setCreandoDesdeMapeo(null); }}>
                        Vincular a ingrediente →
                      </button>
                    )}

                    {/* Panel de vinculación expandido */}
                    {isActive && !desc.mapeado && (
                      <div className="mt-3 space-y-2 pt-3" style={{ borderTop: '1px solid #333' }}>
                        {/* Opción 1: buscar existente */}
                        <p className="text-xs font-bold" style={{ color: '#60a5fa' }}>
                          Buscar ingrediente existente:
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
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 3: RECETAS
        ═══════════════════════════════════════════════════════════════ */}
        <TabsContent value="recetas">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h3 className="sec-title mb-0">Recetas</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Define qué ingredientes componen cada producto
              </p>
            </div>
            <Button variant="success" size="sm" onClick={() => setShowNuevaReceta(v => !v)}
              className="shrink-0">
              + Nueva
            </Button>
          </div>

          {/* Crear receta */}
          {showNuevaReceta && (
            <div className="card" style={{ borderColor: '#2d6a4f' }}>
              <div className="sec-title" style={{ marginBottom: 10 }}>Nueva receta</div>
              <div className="space-y-3">
                <div className="field">
                  <label>¿Qué se prepara?</label>
                  <Input placeholder="Ej: Smash Burger Classic, Salsa Especial..."
                    value={nrData.nombre}
                    onChange={e => setNrData(p => ({ ...p, nombre: e.target.value }))} />
                </div>

                <div className="field">
                  <label>¿A qué producto del catálogo corresponde? (opcional)</label>
                  <CatalogoSearch
                    placeholder="Buscar PT o SP..."
                    tipo={['producto_terminado', 'sub_producto']}
                    onSelect={pt => setNrPT(pt)}
                  />
                  {nrPT && (
                    <div className="flex items-center gap-2 mt-2">
                      <TipoPill tipo={nrPT.tipo} />
                      <span className="text-sm">{nrPT.nombre}</span>
                      <button className="text-xs text-destructive ml-auto" onClick={() => setNrPT(null)}>✕</button>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="field" style={{ flex: 1 }}>
                    <label>Rinde</label>
                    <Input type="number" min="0.01" step="0.01"
                      value={nrData.rendimiento}
                      onChange={e => setNrData(p => ({ ...p, rendimiento: e.target.value }))} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Unidad</label>
                    <select value={nrData.unidad}
                      onChange={e => setNrData(p => ({ ...p, unidad: e.target.value }))}
                      className={selectCls}>
                      <option value="porcion">porción</option>
                      <option value="unidad">unidad</option>
                      <option value="kg">kg</option>
                      <option value="litro">litro</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button className="btn btn-green btn-sm" onClick={handleCrearReceta} disabled={savingReceta}>
                    {savingReceta ? '...' : 'Crear receta'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowNuevaReceta(false)}>Cancelar</button>
                </div>
              </div>
            </div>
          )}

          {/* Lista de recetas */}
          {loadingRecetas ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : recetas.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📋</div>
              <div className="empty-text">No hay recetas</div>
              <p className="text-xs text-muted-foreground mt-2">
                Crea tu primera receta para definir qué ingredientes lleva cada plato o preparación.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recetas.map(rec => {
                const isOpen = recetaOpen === rec.id;
                const lineas = recetaLineas[rec.id] || [];

                return (
                  <div key={rec.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {/* Header receta */}
                    <div className="flex items-center gap-3 p-3 cursor-pointer"
                      onClick={() => toggleReceta(rec.id)}
                      style={{ background: isOpen ? '#1e1e1e' : 'transparent' }}>
                      <div style={{ fontSize: 24 }}>
                        {rec.catalogo_productos?.tipo === 'sub_producto' ? '🧪' : '🍔'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{rec.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          Rinde {rec.rendimiento} {rec.unidad_rendimiento}
                          {rec.catalogo_productos && (
                            <span> · <span style={{ color: TIPOS[rec.catalogo_productos.tipo]?.color }}>
                              {rec.catalogo_productos.sku}
                            </span></span>
                          )}
                        </p>
                      </div>
                      <span className="text-muted-foreground text-lg">{isOpen ? '▲' : '▼'}</span>
                    </div>

                    {/* Detalle: ingredientes */}
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid #222' }}>
                        {lineas.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-3 text-center italic">
                            Sin ingredientes — agrega abajo
                          </p>
                        ) : (
                          <div className="space-y-1 pt-2">
                            {lineas.map(l => (
                              <div key={l.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg"
                                style={{ background: '#141414', border: '1px solid #1e1e1e' }}>
                                <TipoPill tipo={l.tipo_componente || l.catalogo_productos?.tipo} />
                                <span className="text-sm flex-1 truncate">
                                  {l.catalogo_productos?.nombre || '?'}
                                </span>
                                <span className="text-sm font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                  {n(l.cantidad)} {l.unidad}
                                </span>
                                <button onClick={() => handleDeleteLinea(l.id, rec.id)}
                                  className="text-destructive text-xs px-1 hover:opacity-70">✕</button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Agregar ingrediente */}
                        <div className="pt-2" style={{ borderTop: '1px dashed #333' }}>
                          <p className="text-xs font-bold text-muted-foreground mb-2">
                            + Agregar ingrediente (MP o SP)
                          </p>
                          <CatalogoSearch
                            placeholder="Buscar ingrediente..."
                            tipo={['materia_prima', 'sub_producto']}
                            onSelect={comp => setAddLinea(p => ({ ...p, comp }))}
                          />
                          {addLinea.comp && (
                            <div className="mt-2 flex gap-2 items-end flex-wrap">
                              <div className="flex items-center gap-1.5 flex-1">
                                <TipoPill tipo={addLinea.comp.tipo} />
                                <span className="text-sm truncate">{addLinea.comp.nombre}</span>
                              </div>
                              <Input type="number" min="0" step="0.001" placeholder="Cant."
                                value={addLinea.cantidad}
                                onChange={e => setAddLinea(p => ({ ...p, cantidad: e.target.value }))}
                                style={{ width: 80 }} />
                              <select value={addLinea.unidad}
                                onChange={e => setAddLinea(p => ({ ...p, unidad: e.target.value }))}
                                className={selectCls} style={{ width: 72 }}>
                                {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>
                              <button className="btn btn-green btn-sm"
                                onClick={() => handleAddIngrediente(rec.id)}>
                                Agregar
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 4: HISTORIAL DE MOVIMIENTOS
        ═══════════════════════════════════════════════════════════════ */}
        <TabsContent value="movimientos">
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
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 5: AJUSTES MANUALES
        ═══════════════════════════════════════════════════════════════ */}
        <TabsContent value="ajustes">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
