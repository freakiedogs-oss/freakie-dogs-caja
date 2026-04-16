import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Badge } from '../ui/Badge';

const TYPE_VARIANT = {
  recepcion: 'success',
  despacho: 'info',
  ajuste_manual: 'warning',
  conteo_fisico: 'muted',
  produccion: 'info',
  merma: 'destructive',
  devolucion: 'warning',
};

const TYPE_LABELS = {
  recepcion: '📥 Recepción',
  despacho: '🚚 Despacho',
  ajuste_manual: '✏️ Ajuste',
  conteo_fisico: '📋 Conteo',
  produccion: '🏭 Producción',
  merma: '🗑️ Merma',
  devolucion: '🔄 Devolución',
};

const selectCls = 'w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

// Etiquetas y colores por tipo
const TIPO_INFO = {
  materia_prima:    { label: 'MP', badge: 'info',        full: 'Materia Prima',    color: 'text-blue-400' },
  sub_producto:     { label: 'SP', badge: 'warning',     full: 'Sub Producto',     color: 'text-orange-400' },
  producto_terminado:{ label: 'PT', badge: 'success',    full: 'Producto Terminado',color: 'text-green-400' },
  insumo:           { label: 'IN', badge: 'muted',       full: 'Insumo',           color: 'text-muted-foreground' },
};

// ── Utilidad: búsqueda en catálogo ─────────────────────────────────────────
// tipo puede ser string ('materia_prima') o array (['materia_prima','sub_producto'])
function CatalogoSearch({ placeholder = 'Buscar en catálogo...', tipo, onSelect, className = '' }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q || q.length < 2) { setOpts([]); return; }
    const t = setTimeout(async () => {
      let query = db.from('catalogo_productos').select('id, nombre, sku, tipo').ilike('nombre', `%${q}%`).limit(12);
      if (tipo) {
        if (Array.isArray(tipo)) {
          query = query.in('tipo', tipo);
        } else {
          query = query.eq('tipo', tipo);
        }
      }
      const { data } = await query;
      setOpts(data || []);
      setOpen(true);
    }, 300);
    return () => clearTimeout(t);
  }, [q, tipo]);

  return (
    <div className={`relative ${className}`}>
      <Input
        placeholder={placeholder}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => q.length >= 2 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && opts.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-20 bg-card border border-border rounded-b-md shadow-lg max-h-48 overflow-y-auto">
          {opts.map(opt => (
            <div
              key={opt.id}
              onMouseDown={() => { onSelect(opt); setQ(''); setOpts([]); setOpen(false); }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-muted border-b border-border/50 last:border-0 flex items-center gap-2"
            >
              {opt.sku && <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded" style={{ color: TIPO_INFO[opt.tipo]?.color?.replace('text-','') || 'inherit' }}>{opt.sku}</span>}
              <span>{opt.nombre}</span>
              {opt.tipo && <span className={`text-xs ml-auto ${TIPO_INFO[opt.tipo]?.color || ''}`}>{TIPO_INFO[opt.tipo]?.label || ''}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KardexView({ user, show }) {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');

  useEffect(() => {
    db.from('sucursales').select('id, store_code, nombre').eq('activa', true)
      .then(({ data }) => {
        const suc = (data || []).sort((a, b) => a.store_code.localeCompare(b.store_code));
        setSucursales(suc);
        const match = suc.find(s => s.store_code === user?.store_code);
        if (match) setSucursal(match.id);
        else if (suc.length > 0) setSucursal(suc[0].id);
      });
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 1: MATERIAS PRIMAS
  // ══════════════════════════════════════════════════════════════════════════
  const [catalogoItems, setCatalogoItems] = useState([]);
  const [catalogoFilter, setCatalogoFilter] = useState('materia_prima');
  const [catalogoSearch, setCatalogoSearch] = useState('');
  const [loadingCatalogo, setLoadingCatalogo] = useState(false);
  const [newItemNombre, setNewItemNombre] = useState('');
  const [newItemUnidad, setNewItemUnidad] = useState('kg');
  const [newItemTipo, setNewItemTipo] = useState('materia_prima');
  const [creatingItem, setCreatingItem] = useState(false);
  const [showNewItem, setShowNewItem] = useState(false);

  const fetchCatalogo = useCallback(async () => {
    setLoadingCatalogo(true);
    try {
      let query = db.from('catalogo_productos')
        .select('id, nombre, sku, tipo, unidad_medida, categoria, activo, codigo')
        .order('nombre');

      if (catalogoFilter === 'todos') {
        // sin filtro de tipo
      } else if (catalogoFilter === 'materia_prima') {
        query = query.or('tipo.eq.materia_prima,tipo.is.null');
      } else {
        query = query.eq('tipo', catalogoFilter);
      }

      if (catalogoSearch) query = query.ilike('nombre', `%${catalogoSearch}%`);

      const { data, error } = await query;
      if (error) throw error;
      setCatalogoItems(data || []);
    } catch {
      show?.('Error al cargar catálogo', 'error');
    } finally {
      setLoadingCatalogo(false);
    }
  }, [catalogoFilter, catalogoSearch]);

  useEffect(() => { fetchCatalogo(); }, [fetchCatalogo]);

  const handleCreateItem = async () => {
    if (!newItemNombre.trim()) { show?.('Ingresa un nombre', 'warning'); return; }
    setCreatingItem(true);
    try {
      const { data, error } = await db.rpc('crear_catalogo_item', {
        p_nombre: newItemNombre.trim(),
        p_tipo: newItemTipo,
        p_unidad_medida: newItemUnidad,
      });
      if (error) throw error;
      const tipoLabel = TIPO_INFO[newItemTipo]?.full || newItemTipo;
      show?.(`${tipoLabel} creado con SKU auto-generado`, 'success');
      setNewItemNombre('');
      setShowNewItem(false);
      fetchCatalogo();
    } catch {
      show?.('Error al crear item', 'error');
    } finally {
      setCreatingItem(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 2: MAPEO DTE
  // ══════════════════════════════════════════════════════════════════════════
  const [dteDescripciones, setDteDescripciones] = useState([]);
  const [loadingMapeo, setLoadingMapeo] = useState(false);
  const [soloSinMapear, setSoloSinMapear] = useState(true);
  const [mapeoSearch, setMapeoSearch] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [mappingDesc, setMappingDesc] = useState(null); // descripción activa para mapear
  const [creatingFromDte, setCreatingFromDte] = useState(null); // descripción para crear MP nueva
  const [newMPFromDte, setNewMPFromDte] = useState('');
  const [savingMapeo, setSavingMapeo] = useState(null);

  const fetchDteDescripciones = useCallback(async () => {
    setLoadingMapeo(true);
    try {
      let query = db.from('v_dte_descripciones').select('*');
      if (soloSinMapear) query = query.eq('mapeado', false);
      if (mapeoSearch) query = query.ilike('descripcion', `%${mapeoSearch}%`);
      query = query.limit(200);
      const { data, error } = await query;
      if (error) throw error;
      setDteDescripciones(data || []);
    } catch {
      show?.('Error al cargar descripciones DTE', 'error');
    } finally {
      setLoadingMapeo(false);
    }
  }, [soloSinMapear, mapeoSearch]);

  const handleExtractItems = async () => {
    setExtracting(true);
    try {
      const { data, error } = await db.rpc('extraer_items_dte');
      if (error) throw error;
      show?.(`${data} items extraídos/actualizados`, 'success');
      fetchDteDescripciones();
    } catch {
      show?.('Error al extraer items DTE', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const handleMapearDescripcion = async (descripcion, catalogoId) => {
    setSavingMapeo(descripcion);
    try {
      const { data, error } = await db.rpc('mapear_descripcion_dte', {
        p_descripcion: descripcion,
        p_catalogo_id: catalogoId,
      });
      if (error) throw error;
      show?.(`${data} líneas mapeadas`, 'success');
      setMappingDesc(null);
      fetchDteDescripciones();
    } catch {
      show?.('Error al mapear descripción', 'error');
    } finally {
      setSavingMapeo(null);
    }
  };

  const handleCrearYMapear = async (descripcion) => {
    const nombre = newMPFromDte.trim() || descripcion;
    if (!nombre) return;
    setSavingMapeo(descripcion);
    try {
      // Crear MP nueva
      const { data: nuevoId, error: errCreate } = await db.rpc('crear_materia_prima', {
        p_nombre: nombre,
        p_unidad_medida: 'kg',
        p_descripcion: `Importado desde DTE: ${descripcion}`,
      });
      if (errCreate) throw errCreate;

      // Mapear todas las líneas a esta nueva MP
      const { data: count, error: errMap } = await db.rpc('mapear_descripcion_dte', {
        p_descripcion: descripcion,
        p_catalogo_id: nuevoId,
      });
      if (errMap) throw errMap;

      show?.(`MP "${nombre}" creada y ${count} líneas mapeadas`, 'success');
      setCreatingFromDte(null);
      setNewMPFromDte('');
      setMappingDesc(null);
      fetchDteDescripciones();
      fetchCatalogo();
    } catch {
      show?.('Error al crear y mapear', 'error');
    } finally {
      setSavingMapeo(null);
    }
  };

  const sinMapearCount = dteDescripciones.filter(d => !d.mapeado).length;

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 3: RECETAS
  // ══════════════════════════════════════════════════════════════════════════
  const [recetas, setRecetas] = useState([]);
  const [loadingRecetas, setLoadingRecetas] = useState(false);
  const [recetaExpandida, setRecetaExpandida] = useState(null);
  const [recetaLineas, setRecetaLineas] = useState({});
  const [showNuevaReceta, setShowNuevaReceta] = useState(false);
  const [nuevaReceta, setNuevaReceta] = useState({ nombre: '', rendimiento: 1, unidad_rendimiento: 'porcion' });
  const [nuevaLinea, setNuevaLinea] = useState({ receta_id: null, cantidad: '', unidad: 'kg' });
  const [savingReceta, setSavingReceta] = useState(false);

  const fetchRecetas = useCallback(async () => {
    setLoadingRecetas(true);
    try {
      const { data, error } = await db
        .from('recetas')
        .select('id, nombre, rendimiento, unidad_rendimiento, activo, catalogo_id, catalogo_productos(nombre, sku)')
        .order('nombre');
      if (error) throw error;
      setRecetas(data || []);
    } catch {
      show?.('Error al cargar recetas', 'error');
    } finally {
      setLoadingRecetas(false);
    }
  }, []);

  const fetchLineas = async (recetaId) => {
    if (recetaLineas[recetaId]) return; // ya cargado
    const { data } = await db
      .from('recetas_lineas')
      .select('id, cantidad, unidad, notas, catalogo_productos(id, nombre, sku)')
      .eq('receta_id', recetaId)
      .order('created_at');
    setRecetaLineas(prev => ({ ...prev, [recetaId]: data || [] }));
  };

  const handleExpandReceta = (recetaId) => {
    if (recetaExpandida === recetaId) { setRecetaExpandida(null); return; }
    setRecetaExpandida(recetaId);
    fetchLineas(recetaId);
  };

  const handleCrearReceta = async () => {
    if (!nuevaReceta.nombre.trim()) { show?.('Ingresa nombre de receta', 'warning'); return; }
    setSavingReceta(true);
    try {
      const { error } = await db.from('recetas').insert({
        nombre: nuevaReceta.nombre.trim(),
        rendimiento: parseFloat(nuevaReceta.rendimiento) || 1,
        unidad_rendimiento: nuevaReceta.unidad_rendimiento,
        catalogo_id: nuevaReceta.catalogo_id || null,
        activo: true,
      });
      if (error) throw error;
      show?.('Receta creada', 'success');
      setShowNuevaReceta(false);
      setNuevaReceta({ nombre: '', rendimiento: 1, unidad_rendimiento: 'porcion' });
      fetchRecetas();
    } catch {
      show?.('Error al crear receta', 'error');
    } finally {
      setSavingReceta(false);
    }
  };

  const handleAddLinea = async (recetaId, componente) => {
    if (!nuevaLinea.cantidad || isNaN(nuevaLinea.cantidad)) {
      show?.('Ingresa cantidad válida', 'warning'); return;
    }
    try {
      const { error } = await db.from('recetas_lineas').insert({
        receta_id: recetaId,
        materia_prima_id: componente.id,
        tipo_componente: componente.tipo || 'materia_prima',
        cantidad: parseFloat(nuevaLinea.cantidad),
        unidad: nuevaLinea.unidad,
      });
      if (error) throw error;
      show?.('Ingrediente agregado', 'success');
      setNuevaLinea({ receta_id: null, cantidad: '', unidad: 'kg' });
      // Refrescar líneas
      const { data } = await db.from('recetas_lineas')
        .select('id, cantidad, unidad, notas, catalogo_productos(id, nombre, sku)')
        .eq('receta_id', recetaId).order('created_at');
      setRecetaLineas(prev => ({ ...prev, [recetaId]: data || [] }));
    } catch {
      show?.('Error al agregar ingrediente', 'error');
    }
  };

  const handleDeleteLinea = async (lineaId, recetaId) => {
    const { error } = await db.from('recetas_lineas').delete().eq('id', lineaId);
    if (error) { show?.('Error al eliminar', 'error'); return; }
    setRecetaLineas(prev => ({
      ...prev,
      [recetaId]: (prev[recetaId] || []).filter(l => l.id !== lineaId),
    }));
  };

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 4: MOVIMIENTOS
  // ══════════════════════════════════════════════════════════════════════════
  const [movimientos, setMovimientos] = useState([]);
  const [searchProd, setSearchProd] = useState('');
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateEnd, setDateEnd] = useState(() => today());
  const [loadingMov, setLoadingMov] = useState(false);

  const fetchMovimientos = useCallback(async () => {
    if (!sucursal) return;
    setLoadingMov(true);
    try {
      const { data, error } = await db
        .from('kardex_movimientos')
        .select('id, tipo, cantidad, stock_anterior, stock_posterior, notas, created_at, catalogo_productos(nombre)')
        .eq('sucursal_id', sucursal)
        .gte('created_at', dateStart + 'T00:00:00Z')
        .lte('created_at', dateEnd + 'T23:59:59Z')
        .order('created_at', { ascending: false });
      if (error) throw error;
      let filtered = data || [];
      if (searchProd) {
        filtered = filtered.filter(m =>
          m.catalogo_productos?.nombre?.toLowerCase().includes(searchProd.toLowerCase())
        );
      }
      setMovimientos(filtered);
    } catch {
      show?.('Error al cargar movimientos', 'error');
    } finally {
      setLoadingMov(false);
    }
  }, [sucursal, dateStart, dateEnd, searchProd]);

  useEffect(() => { fetchMovimientos(); }, [fetchMovimientos]);

  // ══════════════════════════════════════════════════════════════════════════
  // TAB 5: AJUSTES
  // ══════════════════════════════════════════════════════════════════════════
  const [adjProduct, setAdjProduct] = useState(null);
  const [adjCantidad, setAdjCantidad] = useState('');
  const [adjNotas, setAdjNotas] = useState('');
  const [currentStock, setCurrentStock] = useState(null);
  const [savingAdj, setSavingAdj] = useState(false);

  const selectProduct = async (prod) => {
    setAdjProduct(prod);
    if (!sucursal) { show?.('Selecciona una sucursal primero', 'warning'); return; }
    const { data } = await db
      .from('inventario').select('stock_actual')
      .eq('producto_id', prod.id).eq('sucursal_id', sucursal).single();
    setCurrentStock(data?.stock_actual ?? 0);
  };

  const handleRegisterAdjuste = async () => {
    if (!adjProduct) { show?.('Selecciona un producto', 'warning'); return; }
    if (!adjCantidad || isNaN(adjCantidad)) { show?.('Ingresa cantidad válida', 'warning'); return; }
    if (!adjNotas || adjNotas.trim().length < 5) { show?.('Notas deben tener mínimo 5 caracteres', 'warning'); return; }
    setSavingAdj(true);
    try {
      const cantidad = parseFloat(adjCantidad);
      const stockPosterior = currentStock + cantidad;
      const { error: kardexErr } = await db.from('kardex_movimientos').insert({
        producto_id: adjProduct.id, sucursal_id: sucursal,
        tipo: 'ajuste_manual', cantidad, stock_anterior: currentStock,
        stock_posterior: stockPosterior, notas: adjNotas.trim(),
        usuario_id: user.id, referencia_tipo: 'manual',
      });
      if (kardexErr) throw kardexErr;
      await db.from('inventario')
        .update({ stock_actual: stockPosterior })
        .eq('producto_id', adjProduct.id).eq('sucursal_id', sucursal);
      show?.('Ajuste registrado correctamente', 'success');
      setAdjProduct(null); setAdjCantidad(''); setAdjNotas(''); setCurrentStock(null);
    } catch {
      show?.('Error al registrar ajuste', 'error');
    } finally {
      setSavingAdj(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="p-4 min-h-screen bg-background text-foreground">
      <Tabs defaultValue="materias">
        <TabsList className="mb-5 flex-wrap h-auto gap-1">
          <TabsTrigger value="materias">📦 Materias Primas</TabsTrigger>
          <TabsTrigger value="mapeo" onClick={fetchDteDescripciones}>🔗 Mapeo DTE</TabsTrigger>
          <TabsTrigger value="recetas" onClick={fetchRecetas}>📋 Recetas</TabsTrigger>
          <TabsTrigger value="movimientos">📊 Movimientos</TabsTrigger>
          <TabsTrigger value="ajustes">⚙️ Ajustes</TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1: MATERIAS PRIMAS
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="materias">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h3 className="sec-title mb-0">Catálogo de Productos</h3>
            <Button variant="success" size="sm" onClick={() => setShowNewItem(v => !v)}>
              + Nuevo ítem
            </Button>
          </div>

          {showNewItem && (
            <Card className="mb-4 border-primary/30">
              <CardHeader><CardTitle className="text-sm">Nuevo ítem de catálogo</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  {/* Tipo */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Tipo</label>
                    <select value={newItemTipo} onChange={e => setNewItemTipo(e.target.value)} className={selectCls}>
                      <option value="materia_prima">🥩 MP — Materia Prima</option>
                      <option value="sub_producto">🧪 SP — Sub Producto</option>
                      <option value="producto_terminado">🍔 PT — Producto Terminado</option>
                      <option value="insumo">📦 Insumo</option>
                    </select>
                  </div>
                  {/* Nombre */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Nombre</label>
                    <Input
                      placeholder={
                        newItemTipo === 'materia_prima' ? 'Ej: Carne de Res 80/20' :
                        newItemTipo === 'sub_producto'  ? 'Ej: Salsa Especial, Masa Pre-lista' :
                        'Ej: Smash Burger Classic'
                      }
                      value={newItemNombre}
                      onChange={e => setNewItemNombre(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleCreateItem()}
                      autoFocus
                    />
                  </div>
                  {/* Unidad */}
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Unidad</label>
                    <select value={newItemUnidad} onChange={e => setNewItemUnidad(e.target.value)} className={selectCls}>
                      <option value="kg">kg</option>
                      <option value="lb">lb</option>
                      <option value="unidad">unidad</option>
                      <option value="litro">litro</option>
                      <option value="gramo">gramo</option>
                      <option value="ml">ml</option>
                      <option value="porcion">porcion</option>
                      <option value="caja">caja</option>
                      <option value="paquete">paquete</option>
                    </select>
                  </div>
                </div>
                {newItemTipo === 'sub_producto' && (
                  <p className="text-xs text-orange-400/80">
                    💡 Un Sub Producto se fabrica en casa matriz con Materias Primas, y se usa como componente en platos/combos.
                    Se le generará un SKU <span className="font-mono">SP-XXX</span> automáticamente.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button variant="success" size="sm" onClick={handleCreateItem} disabled={creatingItem}>
                    {creatingItem ? 'Creando...' : `✓ Crear ${TIPO_INFO[newItemTipo]?.label || ''}`}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowNewItem(false); setNewItemNombre(''); }}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filtros */}
          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { key: 'todos',             label: '📋 Todos' },
              { key: 'materia_prima',     label: '🥩 MP — Materias Primas' },
              { key: 'sub_producto',      label: '🧪 SP — Sub Productos' },
              { key: 'producto_terminado',label: '🍔 PT — Terminados' },
              { key: 'insumo',            label: '📦 Insumos' },
            ].map(f => (
              <Button
                key={f.key}
                variant={catalogoFilter === f.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCatalogoFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
            <Input
              placeholder="Buscar..."
              value={catalogoSearch}
              onChange={e => setCatalogoSearch(e.target.value)}
              className="max-w-48"
            />
          </div>

          {loadingCatalogo ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : catalogoItems.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📦</div>
              <div className="empty-text">
                {catalogoFilter === 'materia_prima'
                  ? 'No hay Materias Primas. Usa "Mapeo DTE" para crear desde tus compras.'
                  : 'No hay productos de este tipo.'}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-muted-foreground font-medium">SKU</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Nombre</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Tipo</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Unidad</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Categoría</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogoItems.map(item => (
                      <tr key={item.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-3">
                          {item.sku
                            ? <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-primary">{item.sku}</span>
                            : <span className="text-xs text-muted-foreground italic">sin SKU</span>
                          }
                        </td>
                        <td className="p-3 font-medium">{item.nombre}</td>
                        <td className="p-3">
                          <Badge variant={TIPO_INFO[item.tipo]?.badge || 'muted'}>
                            {item.sku?.split('-')[0] || '?'} — {TIPO_INFO[item.tipo]?.full || 'Sin clasificar'}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">{item.unidad_medida || '—'}</td>
                        <td className="p-3 text-muted-foreground">{item.categoria || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2: MAPEO DTE
            Una descripción → una Materia Prima. Mapear una vez = aplica a todos los DTEs.
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="mapeo">
          <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
            <h3 className="sec-title mb-0">Mapeo DTE → Materia Prima</h3>
            <Button variant="outline" size="sm" onClick={handleExtractItems} disabled={extracting}>
              {extracting ? 'Extrayendo...' : '📥 Sincronizar DTEs'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Cada descripción única de tus compras. Mapearla una vez actualiza todos los DTEs que la contienen.
          </p>

          {/* Filtros mapeo */}
          <div className="flex flex-wrap gap-2 items-center mb-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={soloSinMapear}
                onChange={e => { setSoloSinMapear(e.target.checked); }}
                className="rounded"
              />
              Solo sin mapear
            </label>
            <Input
              placeholder="Buscar descripción..."
              value={mapeoSearch}
              onChange={e => setMapeoSearch(e.target.value)}
              className="max-w-60"
            />
            <Button variant="ghost" size="sm" onClick={fetchDteDescripciones}>Actualizar</Button>
          </div>

          {loadingMapeo ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : dteDescripciones.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">✅</div>
              <div className="empty-text">
                {soloSinMapear ? '¡Todas las descripciones están mapeadas!' : 'No hay descripciones DTE'}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-muted-foreground font-medium w-1/2">Descripción DTE</th>
                      <th className="text-right p-3 text-muted-foreground font-medium">$ Total</th>
                      <th className="text-right p-3 text-muted-foreground font-medium">DTEs</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Materia Prima</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dteDescripciones.map(desc => (
                      <tr key={desc.descripcion} className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${!desc.mapeado ? 'bg-destructive/5' : ''}`}>
                        <td className="p-3">
                          <p className="text-xs font-medium leading-snug line-clamp-2" title={desc.descripcion}>
                            {desc.descripcion}
                          </p>
                          <p className="text-xs text-muted-foreground">{desc.num_lineas} líneas</p>
                        </td>
                        <td className="p-3 text-right font-mono text-xs">
                          ${n(desc.monto_total)}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">
                          {desc.num_dtes}
                        </td>
                        <td className="p-3 min-w-48">
                          {desc.mapeado ? (
                            <Badge variant="success">✓ Mapeado</Badge>
                          ) : mappingDesc === desc.descripcion ? (
                            <div className="space-y-2">
                              {/* Opción A: mapear a MP existente */}
                              <CatalogoSearch
                                placeholder="Buscar MP existente..."
                                tipo="materia_prima"
                                onSelect={mp => handleMapearDescripcion(desc.descripcion, mp.id)}
                              />
                              {/* Opción B: crear MP nueva */}
                              {creatingFromDte === desc.descripcion ? (
                                <div className="flex gap-1">
                                  <Input
                                    placeholder="Nombre MP (o Enter para usar desc.)"
                                    value={newMPFromDte}
                                    onChange={e => setNewMPFromDte(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCrearYMapear(desc.descripcion)}
                                    className="text-xs"
                                    autoFocus
                                  />
                                  <Button
                                    variant="success"
                                    size="sm"
                                    onClick={() => handleCrearYMapear(desc.descripcion)}
                                    disabled={savingMapeo === desc.descripcion}
                                  >
                                    {savingMapeo === desc.descripcion ? '...' : '✓'}
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => { setCreatingFromDte(desc.descripcion); setNewMPFromDte(''); }}
                                  className="text-xs w-full"
                                >
                                  + Crear nueva MP
                                </Button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Sin mapear</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {!desc.mapeado && mappingDesc !== desc.descripcion && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => { setMappingDesc(desc.descripcion); setCreatingFromDte(null); }}
                            >
                              Mapear →
                            </Button>
                          )}
                          {mappingDesc === desc.descripcion && (
                            <Button variant="ghost" size="xs" onClick={() => { setMappingDesc(null); setCreatingFromDte(null); }}>
                              ✕
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 3: RECETAS
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="recetas">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h3 className="sec-title mb-0">Recetas de Producción</h3>
            <Button variant="success" size="sm" onClick={() => setShowNuevaReceta(v => !v)}>
              + Nueva Receta
            </Button>
          </div>

          {showNuevaReceta && (
            <Card className="mb-4 border-primary/30">
              <CardHeader><CardTitle className="text-sm">Nueva Receta</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1 space-y-1">
                    <label className="text-xs text-muted-foreground">Nombre de la receta</label>
                    <Input
                      placeholder="Ej: Smash Burger Classic"
                      value={nuevaReceta.nombre}
                      onChange={e => setNuevaReceta(p => ({ ...p, nombre: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Resultado: PT o SP (opcional)</label>
                    <CatalogoSearch
                      placeholder="Buscar PT o SP en catálogo..."
                      tipo={['producto_terminado', 'sub_producto']}
                      onSelect={pt => setNuevaReceta(p => ({ ...p, catalogo_id: pt.id, _ptNombre: pt.nombre, _ptTipo: pt.tipo }))}
                    />
                    {nuevaReceta._ptNombre && (
                      <p className={`text-xs mt-0.5 ${TIPO_INFO[nuevaReceta._ptTipo]?.color || 'text-success'}`}>
                        → [{TIPO_INFO[nuevaReceta._ptTipo]?.label}] {nuevaReceta._ptNombre}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Rendimiento</label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={nuevaReceta.rendimiento}
                        onChange={e => setNuevaReceta(p => ({ ...p, rendimiento: e.target.value }))}
                        className="w-24"
                      />
                      <Input
                        placeholder="porcion"
                        value={nuevaReceta.unidad_rendimiento}
                        onChange={e => setNuevaReceta(p => ({ ...p, unidad_rendimiento: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="success" size="sm" onClick={handleCrearReceta} disabled={savingReceta}>
                    {savingReceta ? 'Guardando...' : '✓ Crear Receta'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowNuevaReceta(false)}>Cancelar</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {loadingRecetas ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : recetas.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📋</div>
              <div className="empty-text">No hay recetas. Crea la primera receta para definir qué Materias Primas componen cada producto.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {recetas.map(receta => (
                <Card key={receta.id} className={receta.activo ? '' : 'opacity-60'}>
                  <CardContent className="pt-4">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => handleExpandReceta(receta.id)}
                    >
                      <div>
                        <p className="font-semibold">{receta.nombre}</p>
                        <p className="text-xs text-muted-foreground">
                          Rinde: {receta.rendimiento} {receta.unidad_rendimiento}
                          {receta.catalogo_productos && ` · PT: ${receta.catalogo_productos.nombre}`}
                        </p>
                      </div>
                      <span className="text-muted-foreground text-sm">
                        {recetaExpandida === receta.id ? '▲' : '▼'}
                      </span>
                    </div>

                    {recetaExpandida === receta.id && (
                      <div className="mt-4 border-t border-border pt-4 space-y-3">
                        {/* Ingredientes */}
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ingredientes</p>
                        {(recetaLineas[receta.id] || []).length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">Sin ingredientes aún</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted-foreground">
                                <th className="text-left pb-1">Materia Prima</th>
                                <th className="text-right pb-1">Cantidad</th>
                                <th className="text-left pb-1 pl-2">Unidad</th>
                                <th className="pb-1"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(recetaLineas[receta.id] || []).map(linea => {
                                const tipoComp = linea.tipo_componente || linea.catalogo_productos?.tipo || 'materia_prima';
                                const tipoColor = TIPO_INFO[tipoComp]?.color || 'text-muted-foreground';
                                return (
                                <tr key={linea.id} className="border-t border-border/30">
                                  <td className="py-1.5">
                                    {linea.catalogo_productos?.sku && (
                                      <span className={`text-xs font-mono mr-1.5 ${tipoColor}`}>{linea.catalogo_productos.sku}</span>
                                    )}
                                    {linea.catalogo_productos?.nombre || '?'}
                                    {tipoComp === 'sub_producto' && (
                                      <span className="ml-1.5 text-xs bg-orange-400/15 text-orange-400 px-1 rounded">SP</span>
                                    )}
                                  </td>
                                  <td className="py-1.5 text-right font-mono">{n(linea.cantidad)}</td>
                                  <td className="py-1.5 pl-2 text-muted-foreground">{linea.unidad}</td>
                                  <td className="py-1.5 text-right">
                                    <button
                                      onClick={() => handleDeleteLinea(linea.id, receta.id)}
                                      className="text-xs text-destructive hover:text-destructive/80"
                                    >
                                      ✕
                                    </button>
                                  </td>
                                </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}

                        {/* Agregar ingrediente — acepta MP y SP */}
                        <div className="pt-2 border-t border-border/30">
                          <p className="text-xs font-semibold text-muted-foreground mb-1">+ Agregar componente</p>
                          <p className="text-xs text-muted-foreground mb-2">Puede ser Materia Prima (MP) o Sub Producto (SP)</p>
                          <div className="flex gap-2 flex-wrap items-end">
                            <div className="flex-1 min-w-48">
                              <CatalogoSearch
                                placeholder="Buscar MP o SP..."
                                tipo={['materia_prima', 'sub_producto']}
                                onSelect={comp => setNuevaLinea(p => ({ ...p, receta_id: receta.id, _mp: comp }))}
                              />
                              {nuevaLinea._mp && nuevaLinea.receta_id === receta.id && (
                                <p className={`text-xs mt-0.5 ${TIPO_INFO[nuevaLinea._mp.tipo]?.color || 'text-success'}`}>
                                  → [{nuevaLinea._mp.sku}] {nuevaLinea._mp.nombre}
                                </p>
                              )}
                            </div>
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              placeholder="Cantidad"
                              value={nuevaLinea.receta_id === receta.id ? nuevaLinea.cantidad : ''}
                              onChange={e => setNuevaLinea(p => ({ ...p, cantidad: e.target.value, receta_id: receta.id }))}
                              className="w-28"
                            />
                            <select
                              value={nuevaLinea.receta_id === receta.id ? nuevaLinea.unidad : 'kg'}
                              onChange={e => setNuevaLinea(p => ({ ...p, unidad: e.target.value, receta_id: receta.id }))}
                              className="rounded-md border border-input bg-muted px-2 py-2 text-sm"
                            >
                              <option value="kg">kg</option>
                              <option value="lb">lb</option>
                              <option value="g">g</option>
                              <option value="unidad">unidad</option>
                              <option value="litro">litro</option>
                              <option value="ml">ml</option>
                              <option value="oz">oz</option>
                            </select>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (nuevaLinea._mp && nuevaLinea.receta_id === receta.id) {
                                  handleAddLinea(receta.id, nuevaLinea._mp);
                                } else {
                                  show?.('Selecciona un componente (MP o SP)', 'warning');
                                }
                              }}
                            >
                              Agregar
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 4: MOVIMIENTOS
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="movimientos">
          <h3 className="sec-title">Kardex de Movimientos</h3>

          <Card className="mb-4">
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Sucursal</label>
                  <select value={sucursal} onChange={e => setSucursal(e.target.value)} className={selectCls}>
                    <option value="">Selecciona sucursal...</option>
                    {sucursales.map(s => (
                      <option key={s.id} value={s.id}>{s.store_code} — {s.nombre || STORES[s.store_code] || s.store_code}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Producto</label>
                  <Input placeholder="Buscar producto..." value={searchProd} onChange={e => setSearchProd(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Desde</label>
                  <Input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Hasta</label>
                  <Input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {loadingMov ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : movimientos.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📦</div>
              <div className="empty-text">No hay movimientos en este período</div>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left p-3 text-muted-foreground font-medium">Fecha</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Producto</th>
                      <th className="text-center p-3 text-muted-foreground font-medium">Tipo</th>
                      <th className="text-right p-3 text-muted-foreground font-medium">Cantidad</th>
                      <th className="text-right p-3 text-muted-foreground font-medium">Ant.</th>
                      <th className="text-right p-3 text-muted-foreground font-medium">Post.</th>
                      <th className="text-left p-3 text-muted-foreground font-medium">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map(mov => (
                      <tr key={mov.id} className="border-b border-border/50 hover:bg-muted/40 transition-colors">
                        <td className="p-3 text-xs">{fmtDate(mov.created_at)}</td>
                        <td className="p-3">{mov.catalogo_productos?.nombre || '-'}</td>
                        <td className="p-3 text-center">
                          <Badge variant={TYPE_VARIANT[mov.tipo] || 'muted'}>
                            {TYPE_LABELS[mov.tipo] || mov.tipo}
                          </Badge>
                        </td>
                        <td className={`p-3 text-right font-semibold ${mov.cantidad > 0 ? 'text-success' : 'text-destructive'}`}>
                          {mov.cantidad > 0 ? '+' : ''}{n(mov.cantidad)}
                        </td>
                        <td className="p-3 text-right text-muted-foreground">{n(mov.stock_anterior)}</td>
                        <td className="p-3 text-right">{n(mov.stock_posterior)}</td>
                        <td className="p-3 text-xs text-muted-foreground">{mov.notas || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 5: AJUSTES
        ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="ajustes">
          <h3 className="sec-title">Ajustes Manuales de Stock</h3>

          <Card className="max-w-lg">
            <CardHeader><CardTitle>Registrar Ajuste</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Sucursal</label>
                <select value={sucursal} onChange={e => setSucursal(e.target.value)} className={selectCls}>
                  <option value="">Selecciona sucursal...</option>
                  {sucursales.map(s => (
                    <option key={s.id} value={s.id}>{s.store_code} — {s.nombre || STORES[s.store_code] || s.store_code}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Producto</label>
                <CatalogoSearch
                  placeholder="Buscar producto..."
                  onSelect={selectProduct}
                />
                {adjProduct && currentStock !== null && (
                  <div className="p-3 rounded-md bg-muted/50 border border-border text-sm mt-2">
                    <p className="font-semibold">{adjProduct.nombre}</p>
                    <p className="text-muted-foreground">
                      Stock actual: <span className="text-success font-bold">{n(currentStock)}</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Cantidad (+ entrada / − salida)</label>
                <Input
                  type="number" step="0.01" placeholder="Ej: 5 o -3"
                  value={adjCantidad} onChange={e => setAdjCantidad(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notas/Motivo (mín. 5 caracteres)</label>
                <textarea
                  placeholder="Ej: Conteo físico, Merma por rotura..."
                  value={adjNotas} onChange={e => setAdjNotas(e.target.value)}
                  className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[72px] resize-y font-inherit"
                />
              </div>

              <Button
                variant="success" className="w-full"
                onClick={handleRegisterAdjuste}
                disabled={savingAdj || !adjProduct}
              >
                {savingAdj ? 'Guardando...' : '✓ Registrar Ajuste'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
