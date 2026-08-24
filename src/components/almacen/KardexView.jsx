import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';
import { STORES, today, fmtDate, n } from '../../config';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import InfoTip from '../ui/InfoTip';
import RecetasView from '../admin/RecetasView';
import MapeoMenu from './MapeoMenu';
import DiferenciasTab from './DiferenciasTab';
import CosteoView from '../admin/CosteoView';
import { UnidadSelect } from '../UnidadSelect';
import { K, tint, pill } from './kardexUi';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTES — un solo ícono y un solo color por concepto, en todo el Kardex
   ═══════════════════════════════════════════════════════════════════════════ */
const TIPOS = {
  materia_prima:     { label: 'MP',  full: 'Materia Prima',       icon: '🥩', color: K.blue,   hint: 'Ingrediente que compras a proveedores' },
  sub_producto:      { label: 'SP',  full: 'Sub Producto',        icon: '🧪', color: K.orange, hint: 'Se prepara en cocina con materias primas' },
  producto_terminado:{ label: 'PT',  full: 'Producto Terminado',  icon: '🍔', color: K.green,  hint: 'Lo que vendes al cliente' },
  insumo:            { label: 'IN',  full: 'Insumo',              icon: '🧰', color: K.dim,    hint: 'Material de operación (no alimento)' },
};

// Colores de movimientos: entradas en verde, salidas operativas en gris,
// venta en morado, y conteo/merma/ajuste con los MISMOS colores que usa
// el tab Fugas (naranja/rojo/azul) para que se lean igual en todos lados.
const MOV_TIPOS = {
  recepcion:      { label: 'Recepción',  icon: '📥', color: K.green },
  produccion:     { label: 'Producción', icon: '🏭', color: K.green },
  venta:          { label: 'Venta',      icon: '💵', color: K.purple },
  traslado:       { label: 'Traslado',   icon: '🚚', color: K.dim },
  consumo:        { label: 'Consumo',    icon: '🍳', color: K.dim },
  conteo_fisico:  { label: 'Conteo',     icon: '📋', color: K.orange },
  merma:          { label: 'Merma',      icon: '🗑️', color: K.red },
  ajuste_manual:  { label: 'Ajuste',     icon: '✏️', color: K.blue },
};

const selectCls = 'w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

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
      style={{ background: tint(t.color), color: t.color, border: `1px solid ${tint(t.color, '44')}` }}>
      {t.icon} {t.label}
    </span>
  );
}

// Encabezado de cada tab: ícono + título + InfoTip que explica qué muestra,
// de dónde sale el dato y qué significa (para el dueño, no para el programador).
function TabHeader({ icon, titulo, sub, tip }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 12px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 17 }}>{icon}</span>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: K.text, margin: 0 }}>{titulo}</h2>
      {sub && <span style={{ fontSize: 12, color: K.faint }}>{sub}</span>}
      <InfoTip text={tip} width={300} />
    </div>
  );
}

// Barra de progreso visual
function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-bold" style={{ color: pct === 100 ? K.green : K.orange }}>{pct}%</span>
      </div>}
      <div className="h-2 rounded-full overflow-hidden" style={{ background: K.card2 }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: pct === 100 ? K.green : pct > 50 ? K.orange : K.red }} />
      </div>
    </div>
  );
}

// KPI card compacta — mismo lenguaje visual que las tarjetas de Fugas
function KpiCard({ icon, label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 92, background: K.card, border: `1px solid ${K.border}`,
                  borderLeft: '3px solid ' + color, borderRadius: 10, padding: '9px 11px' }}>
      <div style={{ fontSize: 10, color: K.faint, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color, marginTop: 3 }}>{value}</div>
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
        <div className="absolute top-full left-0 right-0 z-30 rounded-b-lg shadow-xl max-h-52 overflow-y-auto" style={{ background: K.card2, border: `1px solid ${K.border}` }}>
          {opts.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              No se encontró "{q}"
              {onCreate && (
                <button
                  onMouseDown={() => { onCreate(q); setQ(''); setOpen(false); }}
                  className="block mx-auto mt-2 text-xs font-bold px-3 py-1.5 rounded-full"
                  style={{ background: tint(K.green), color: K.green }}
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
                  style={{ color: K.green }}
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

  // Existencias por sucursal (solo lectura): se cargan al expandir el
  // producto para no pedir el inventario completo de un solo en el iPhone.
  const [verStock, setVerStock] = useState(null);   // producto_id expandido
  const [stockRows, setStockRows] = useState(null); // filas de `inventario` de ese producto
  const toggleStock = async (id) => {
    if (verStock === id) { setVerStock(null); setStockRows(null); return; }
    setVerStock(id); setStockRows(null);
    const { data } = await db.from('inventario')
      .select('stock_actual, ultima_actualizacion, sucursales(store_code, nombre)')
      .eq('producto_id', id);
    setStockRows((data || []).sort((a, b) =>
      (a.sucursales?.store_code || '').localeCompare(b.sucursales?.store_code || '')));
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
  const [factorInput, setFactorInput] = useState('');     // factor a aplicar al vincular
  const [editFactor, setEditFactor] = useState(null);     // descripcion cuyo factor se está editando
  const [editFactorVal, setEditFactorVal] = useState('');
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
      let q = db.from('v_dte_descripciones').select('descripcion,mapeado,monto_total,num_dtes,num_lineas,inventariable,ultima_compra,catalogo_id,catalogo_nombre,catalogo_tipo,catalogo_unidad,catalogo_en_conteo,factor_conversion,catalogo_factor_compra,precio_unitario_prom');
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

  // El factor dice cuántas unidades del catálogo trae cada unidad facturada:
  // "CAJA 6/4.5LB" vinculada a un producto en lb → factor 27. Sin él, la caja se costea
  // como si fuera una libra y el margen sale disparatado.
  const handleMapear = async (descripcion, catalogoId, factor) => {
    const f = factor === undefined ? factorInput : factor;
    const factorNum = String(f ?? '').trim() === '' ? null : Number(f);
    if (factorNum !== null && (!Number.isFinite(factorNum) || factorNum <= 0)) {
      show?.('El factor debe ser un número mayor que cero', 'error');
      return;
    }
    setSavingMapeo(true);
    try {
      const { data, error } = await db.rpc('mapear_descripcion_dte', {
        p_descripcion: descripcion, p_catalogo_id: catalogoId,
        p_factor_conversion: factorNum,
      });
      if (error) throw error;
      show?.(`Vinculado — ${data} líneas de compra actualizadas`, 'success');
      setActiveMapDesc(null);
      setFactorInput('');
      setEditFactor(null);
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
      const factorNum = String(factorInput ?? '').trim() === '' ? null : Number(factorInput);
      const { data: count, error: errM } = await db.rpc('mapear_descripcion_dte', {
        p_descripcion: descripcion, p_catalogo_id: nuevoId,
        p_factor_conversion: Number.isFinite(factorNum) && factorNum > 0 ? factorNum : null,
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

  /* El viejo editor de recetas que vivía acá (estados + escrituras a la
     tabla obsoleta `recetas_lineas`) se eliminó: nunca se renderizaba —
     el tab Recetas muestra RecetasView, que carga y edita lo suyo. */

  /* ══════════════════════════════════════════════════════════════════════
     TAB 4: MOVIMIENTOS
     ══════════════════════════════════════════════════════════════════════ */
  const [movimientos, setMovimientos] = useState([]);
  const [searchMov, setSearchMov] = useState('');
  const [movTipo, setMovTipo] = useState(null); // filtro por tipo de movimiento
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
      // usuarios_erp = quién firmó el movimiento (usuario del ERP, no empleado)
      let q = db.from('kardex_movimientos')
        .select('id, tipo, cantidad, stock_anterior, stock_posterior, notas, created_at, catalogo_productos(nombre), usuarios_erp(nombre)')
        .eq('sucursal_id', sucursal)
        .gte('created_at', dateStart + 'T00:00:00Z')
        .lte('created_at', dateEnd + 'T23:59:59Z')
        .order('created_at', { ascending: false });
      if (movTipo) q = q.eq('tipo', movTipo);
      const { data } = await q;
      let f = data || [];
      if (searchMov) f = f.filter(m => m.catalogo_productos?.nombre?.toLowerCase().includes(searchMov.toLowerCase()));
      setMovimientos(f);
    } catch { show?.('Error al cargar movimientos', 'error'); }
    finally { setLoadingMov(false); }
  }, [sucursal, dateStart, dateEnd, searchMov, movTipo]);

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
    // Firma obligatoria: el servidor rechaza ajustes manuales sin usuario (auditoría 22-ago)
    if (!user?.id) { show?.('Tu sesión no tiene usuario. Cierra y vuelve a iniciar sesión para firmar el ajuste.', 'warning'); return; }
    setSavingAdj(true);
    try {
      // Antes esto insertaba el movimiento a mano y DESPUÉS actualizaba
      // inventario: si lo segundo fallaba, el kardex decía una cosa y el stock
      // otra. Además `adjStock` se leyó al elegir el producto, así que el
      // stock_anterior podía llegar viejo. kardex_mover hace las dos escrituras
      // en una transacción y lee el stock con la fila lockeada.
      const cantidad = parseFloat(adjQty);
      const { error } = await db.rpc('kardex_mover_lote', {
        p_items: [{ producto_id: adjProd.id, cantidad }],
        p_tipo: 'ajuste_manual',
        p_referencia_tipo: 'manual',
        p_referencia_id: null,
        p_notas: adjNotas.trim(),
        p_usuario_id: user.id,
        p_sucursal_id: sucursal,
        p_permitir_negativo: true,
      });
      if (error) throw error;
      show?.('Ajuste registrado', 'success');
      setAdjProd(null); setAdjQty(''); setAdjNotas(''); setAdjStock(null);
    } catch (e) { show?.('Error al registrar ajuste: ' + (e?.message || e), 'error'); }
    finally { setSavingAdj(false); }
  };

  const handleTab = (v) => {
    setActiveTab(v);
    if (v === 'mapeo') fetchMapeo();
  };

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */
  const TABS_K = [
    { id: 'inventario',  icon: '📦', label: 'Inventario' },
    { id: 'diferencias', icon: '🔍', label: 'Fugas' },
    { id: 'conteo',      icon: '🌙', label: 'Lista Conteo' },
    { id: 'mapeo',       icon: '🔗', label: 'Mapeo Compras' },
    { id: 'menu',        icon: '🍽️', label: 'Menú (BOM)' },
    { id: 'recetas',     icon: '📖', label: 'Recetas' },
    { id: 'costeo',      icon: '💰', label: 'Costeo' },
    { id: 'movimientos', icon: '📜', label: 'Historial' },
    { id: 'ajustes',     icon: '✏️', label: 'Ajustes' },
  ];

  return (
    <div className="p-3 min-h-screen bg-background text-foreground">
      {/* Tab nav — pills */}
      <div style={{ display: 'flex', overflowX: 'auto', gap: 6, marginBottom: 14, paddingBottom: 2 }}>
        {TABS_K.map(t => (
          <button
            key={t.id}
            onClick={() => handleTab(t.id)}
            style={{
              padding: '6px 12px', borderRadius: 20,
              border: '1px solid ' + (activeTab === t.id ? K.red : K.border),
              cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600,
              background: activeTab === t.id ? K.red : K.card2,
              color:      activeTab === t.id ? '#fff' : K.dim,
              transition: 'all 0.15s', fontFamily: 'inherit',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

        {/* ═══════════════════════════════════════════════════════════════
            TAB 1: INVENTARIO
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'inventario' && (<div>
          <TabHeader icon="📦" titulo="Inventario" sub="catálogo y existencias"
            tip={'El catálogo maestro: todo lo que se compra (MP), se prepara (SP), se vende (PT) o se gasta operando (IN). ' +
              'Sale de la tabla catalogo_productos. Tocá un producto para ver sus existencias por sucursal: ' +
              'ese stock lo mueve el kardex solo, con cada venta, recepción, conteo y producción. ' +
              'Desde acá también se crea, se edita y se reclasifica cada ítem.'} />

          {/* KPIs */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            <KpiCard icon="🥩" label="Materias Primas" value={catTotals.materia_prima} color={K.blue} />
            <KpiCard icon="🧪" label="Sub Productos" value={catTotals.sub_producto} color={K.orange} />
            <KpiCard icon="🍔" label="Terminados" value={catTotals.producto_terminado} color={K.green} />
            <KpiCard icon="🧰" label="Insumos" value={catTotals.insumo} color={K.dim} />
          </div>

          {/* Filtros tipo chips */}
          <div className="chips">
            {[
              { key: 'todos', label: 'Todos' },
              { key: 'materia_prima', label: '🥩 MP' },
              { key: 'sub_producto', label: '🧪 SP' },
              { key: 'producto_terminado', label: '🍔 PT' },
              { key: 'insumo', label: '🧰 IN' },
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
            <div className="card" style={{ borderColor: tint(K.green, '55') }}>
              <div className="sec-title" style={{ marginBottom: 12 }}>Nuevo producto o ingrediente</div>

              {/* Selector de tipo: visual con iconos grandes */}
              <div className="flex gap-2 mb-3 flex-wrap">
                {Object.entries(TIPOS).map(([key, t]) => (
                  <button key={key}
                    className="flex-1 min-w-[70px] rounded-lg p-2 text-center border-2 transition-all"
                    style={{
                      background: nuevoItem.tipo === key ? tint(t.color) : 'transparent',
                      borderColor: nuevoItem.tipo === key ? t.color : K.border,
                      color: nuevoItem.tipo === key ? t.color : K.dim,
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
                <UnidadSelect value={nuevoItem.unidad}
                  onChange={v => setNuevoItem(p => ({ ...p, unidad: v }))}
                  className={selectCls} selectStyle={{ minWidth: 80 }} />
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
                    <div className="flex-1 min-w-0" onClick={() => toggleStock(item.id)}
                      style={{ cursor: 'pointer' }} title="Ver existencias por sucursal">
                      <p className="text-sm font-semibold truncate">
                        <span style={{ color: K.faint, fontSize: 10, marginRight: 4 }}>{verStock === item.id ? '▾' : '▸'}</span>
                        {item.nombre}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.sku || 'sin SKU'} · almacén: {item.unidad_medida || 'unidad'}
                        {item.unidad_compra && Number(item.factor_compra) !== 1
                          ? ` · compra: 1 ${item.unidad_compra} = ${item.factor_compra} ${item.unidad_medida || 'u'}`
                          : ''}
                        {item.categoria ? ` · ${item.categoria}` : ''}
                      </p>
                    </div>
                    <button onClick={() => setEditItem(item)}
                      style={{ background: K.card2, color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}
                      title="Editar ítem (nombre, tipo, unidades, todos los atributos)">✏️</button>
                    <button onClick={() => toggleDte(item.id)}
                      style={{ background: verDte === item.id ? K.border : K.card2, color: '#fff', border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}
                      title="Ver DTEs mapeados a este item">🔗 DTE</button>
                    <button onClick={() => setEditUnid(item)}
                      style={{ background: K.card2, color: '#fff', border: 'none', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
                      title="Editar unidades y conversión">📐</button>
                    <button onClick={async () => {
                      if (!window.confirm(`¿Eliminar "${item.nombre}"? Sale del catálogo.`)) return;
                      const { error } = await db.rpc('eliminar_producto', { p_producto_id: item.id });
                      if (error) { window.alert('❌ ' + error.message); return; }
                      fetchCatalogo();
                    }} style={{ background: tint(K.red, '26'), color: K.red, border: 'none', borderRadius: 8, padding: '5px 9px', fontSize: 12, cursor: 'pointer' }}
                      title="Eliminar producto">🗑️</button>
                  </div>
                  {/* Existencias por sucursal (solo lectura, del kardex) */}
                  {verStock === item.id && (
                    <div style={{ background: K.panel, border: `1px solid ${K.border}`, borderRadius: 8, padding: '8px 12px', margin: '4px 0 8px 16px', fontSize: 12 }}>
                      {!stockRows ? <span style={{ color: K.dim }}>Cargando existencias…</span>
                        : stockRows.length === 0
                          ? <span style={{ color: K.dim }}>Sin registro de inventario todavía — aparece con la primera recepción o conteo.</span>
                          : (
                            <>
                              {stockRows.map((r, i) => {
                                const s = n(r.stock_actual);
                                const color = s < 0 ? K.red : s === 0 ? K.dim : K.green;
                                return (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < stockRows.length - 1 ? `1px solid ${K.border}` : 'none' }}>
                                    <span style={{ color: '#bbb' }}>{r.sucursales?.nombre || r.sucursales?.store_code || '—'}</span>
                                    <span style={{ color, fontWeight: 700 }}>{n(r.stock_actual)} {item.unidad_medida || 'u'}</span>
                                  </div>
                                );
                              })}
                              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 5, marginTop: 2, borderTop: `1px solid ${K.border}` }}>
                                <span style={{ color: K.dim, fontWeight: 700 }}>Total</span>
                                <span style={{ color: K.text, fontWeight: 800 }}>
                                  {n(stockRows.reduce((a, r) => a + n(r.stock_actual), 0))} {item.unidad_medida || 'u'}
                                </span>
                              </div>
                              {stockRows.some(r => n(r.stock_actual) < 0) && (
                                <div style={{ color: K.orange, fontSize: 11, marginTop: 5 }}>
                                  ⚠️ Stock negativo = se descontó más de lo que el sistema tenía registrado. Se corrige con el conteo físico.
                                </div>
                              )}
                            </>
                          )}
                    </div>
                  )}
                  {editTipoId === item.id && (
                    <div style={{ background: K.panel, border: `1px solid ${K.border}`, borderRadius: 8, padding: '8px 12px', margin: '4px 0 8px 40px', fontSize: 12 }}>
                      <div style={{ color: K.dim, marginBottom: 6 }}>Clasificación de "{item.nombre}":</div>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(TIPOS).map(([key, t]) => (
                          <button key={key} onClick={() => cambiarTipo(item, key)}
                            className="rounded-lg p-2 text-center border-2 transition-all"
                            style={{
                              minWidth: 68,
                              background: item.tipo === key ? tint(t.color) : 'transparent',
                              borderColor: item.tipo === key ? t.color : K.border,
                              color: item.tipo === key ? t.color : K.dim,
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
                    <div style={{ background: K.panel, border: `1px solid ${K.border}`, borderRadius: 8, padding: '8px 12px', margin: '4px 0 8px 40px', fontSize: 12 }}>
                      {!dteMap ? <span style={{ color: K.dim }}>Cargando…</span>
                        : (dteMap.descripciones || []).length === 0
                          ? <span style={{ color: K.red }}>⚠️ Sin ningún DTE mapeado a este item.</span>
                          : (
                            <>
                              <div style={{ color: K.dim, marginBottom: 4 }}>{dteMap.descripciones.length} descripción(es) de DTE mapeada(s){dteMap.n_dte_items ? ` · ${dteMap.n_dte_items} líneas históricas` : ''}:</div>
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
          <TabHeader icon="🔗" titulo="Mapeo de compras" sub="factura → ingrediente"
            tip={'Cada línea de tus facturas electrónicas (DTE de Hacienda) trae una descripción escrita por el proveedor. ' +
              'Acá se vincula cada descripción a un ingrediente del catálogo, con su factor de conversión ' +
              '(cuántas unidades de almacén trae cada unidad facturada). ' +
              'Sin este vínculo la compra no entra al inventario ni al costeo: si una CAJA de 27 lb se costea como 1 lb, el margen sale disparatado.'} />

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
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: K.dim }}>
              <input type="checkbox" checked={soloSinMapear}
                onChange={e => setSoloSinMapear(e.target.checked)}
                style={{ accentColor: K.red }} />
              Solo pendientes
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: K.dim }}
              title="Oculta descripciones de proveedores que no se inventarían (gastos, servicios, etc.)">
              <input type="checkbox" checked={soloInventariables}
                onChange={e => setSoloInventariables(e.target.checked)}
                style={{ accentColor: K.red }} />
              Solo inventariables
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: K.dim }}
              title="Solo descripciones compradas en los últimos 3 meses (evita mapear cosas muy viejas)">
              <input type="checkbox" checked={solo3Meses}
                onChange={e => setSolo3Meses(e.target.checked)}
                style={{ accentColor: K.red }} />
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
                <p className="text-xs mt-2" style={{ color: K.green }}>
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
                    borderColor: desc.mapeado ? tint(K.green, '2e') : isActive ? K.red : K.border,
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
                      <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${K.border}` }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs shrink-0" style={{ color: K.dim }}>🔗 Vinculado a:</span>
                          {editNombre === desc.descripcion ? (
                            <div className="flex gap-1 items-center flex-1" style={{ minWidth: 180 }}>
                              <Input value={editNombreVal} onChange={e => setEditNombreVal(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleRenombrarIngrediente(desc.catalogo_id, editNombreVal)}
                                autoFocus className="flex-1" />
                              <button className="btn btn-green btn-sm shrink-0" disabled={savingMapeo}
                                onClick={() => handleRenombrarIngrediente(desc.catalogo_id, editNombreVal)}>
                                {savingMapeo ? '...' : '✓'}
                              </button>
                              <button className="text-xs underline shrink-0" style={{ color: K.dim }}
                                onClick={() => setEditNombre(null)}>✕</button>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-semibold" style={{ color: K.green, wordBreak: 'break-word' }}>
                                {desc.catalogo_nombre || '—'}
                              </span>
                              {desc.catalogo_unidad && (
                                <span className="text-xs shrink-0" style={{ color: K.dim }}>· {desc.catalogo_unidad}</span>
                              )}
                              <button className="text-xs underline shrink-0" style={{ color: K.blue }}
                                title="Renombrar el ingrediente (se refleja en el conteo nocturno)"
                                onClick={() => { setEditNombre(desc.descripcion); setEditNombreVal(desc.catalogo_nombre || ''); }}>
                                ✎ nombre
                              </button>
                            </>
                          )}
                        </div>

                        {/* Factor de conversión: cuántas unidades del catálogo trae cada unidad facturada */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className="text-xs shrink-0" style={{ color: K.dim }}>📐 1 facturada =</span>
                          {editFactor === desc.descripcion ? (
                            <div className="flex gap-1 items-center" style={{ minWidth: 160 }}>
                              <Input type="number" step="any" min="0" value={editFactorVal} autoFocus
                                style={{ width: 90 }}
                                onChange={e => setEditFactorVal(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleMapear(desc.descripcion, desc.catalogo_id, editFactorVal)} />
                              <span className="text-xs shrink-0" style={{ color: K.dim }}>{desc.catalogo_unidad}</span>
                              <button className="btn btn-green btn-sm shrink-0" disabled={savingMapeo}
                                onClick={() => handleMapear(desc.descripcion, desc.catalogo_id, editFactorVal)}>
                                {savingMapeo ? '...' : '✓'}
                              </button>
                              <button className="text-xs underline shrink-0" style={{ color: K.dim }}
                                onClick={() => setEditFactor(null)}>✕</button>
                            </div>
                          ) : desc.factor_conversion ? (
                            <>
                              <span className="text-sm font-semibold" style={{ color: K.green }}>
                                {n(desc.factor_conversion)} {desc.catalogo_unidad}
                              </span>
                              {n(desc.precio_unitario_prom) > 0 && (
                                <span className="text-xs shrink-0" style={{ color: K.dim }}>
                                  · ${(n(desc.precio_unitario_prom) / n(desc.factor_conversion)).toFixed(4)}/{desc.catalogo_unidad}
                                </span>
                              )}
                              <button className="text-xs underline shrink-0" style={{ color: K.blue }}
                                onClick={() => { setEditFactor(desc.descripcion); setEditFactorVal(String(desc.factor_conversion)); }}>
                                ✎ factor
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="tag tag-orange" style={{ fontSize: 11 }}>⚠ sin factor — se costea 1:1</span>
                              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                                onClick={() => { setEditFactor(desc.descripcion); setEditFactorVal(''); }}>
                                Definir
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
                            onClick={() => { setActiveMapDesc(desc.descripcion); setCreandoDesdeMapeo(null); setEditNombre(null); setFactorInput(desc.factor_conversion ? String(desc.factor_conversion) : ''); }}>
                            ↻ Cambiar ingrediente
                          </button>
                          <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, color: K.red }} disabled={savingMapeo}
                            onClick={() => handleDesmapear(desc.descripcion)}>
                            ✕ Desvincular
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Acciones si no está mapeado */}
                    {!desc.mapeado && !isActive && (
                      <button className="btn btn-ghost btn-sm mt-2" style={{ fontSize: 12, width: '100%' }}
                        onClick={() => { setActiveMapDesc(desc.descripcion); setCreandoDesdeMapeo(null); setFactorInput(''); }}>
                        Vincular a ingrediente →
                      </button>
                    )}

                    {/* Panel de vinculación / cambio expandido */}
                    {isActive && (
                      <div className="mt-3 space-y-2 pt-3" style={{ borderTop: `1px solid ${K.border}` }}>
                        {/* Opción 1: buscar existente */}
                        <p className="text-xs font-bold" style={{ color: K.blue }}>
                          {desc.mapeado ? 'Cambiar a otro ingrediente existente:' : 'Buscar ingrediente existente:'}
                        </p>
                        <CatalogoSearch
                          placeholder="Escribe el nombre del ingrediente..."
                          tipo={['materia_prima', 'sub_producto']}
                          onSelect={mp => handleMapear(desc.descripcion, mp.id)}
                        />

                        {/* Factor: lo que convierte la presentación de compra a la unidad del catálogo.
                            Sin esto una caja se costea como una libra — el error que rompió el costeo. */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs shrink-0" style={{ color: K.dim }}>
                            📐 Cada unidad facturada trae
                          </span>
                          <Input type="number" step="any" min="0" placeholder="opcional"
                            style={{ width: 110 }} value={factorInput}
                            onChange={e => setFactorInput(e.target.value)} />
                          <span className="text-xs shrink-0" style={{ color: K.dim }}>
                            del ingrediente que elijas
                          </span>
                        </div>
                        <p className="text-xs" style={{ color: K.dim, marginTop: -4 }}>
                          Ej.: <strong>CAJA 6/4.5LB</strong> vinculada a un producto en <strong>lb</strong> → escribí <strong>27</strong>.
                          Si lo dejás vacío se respeta el factor que ya tuviera.
                        </p>

                        {/* Separador */}
                        <div className="flex items-center gap-3 my-1">
                          <div className="flex-1 h-px" style={{ background: K.border }} />
                          <span className="text-xs text-muted-foreground">ó</span>
                          <div className="flex-1 h-px" style={{ background: K.border }} />
                        </div>

                        {/* Opción 2: crear nuevo */}
                        {!isCreating ? (
                          <button className="btn btn-green btn-sm" style={{ width: '100%', fontSize: 12 }}
                            onClick={() => { setCreandoDesdeMapeo(desc.descripcion); setNewNameMapeo(''); }}>
                            + Crear ingrediente nuevo
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-bold" style={{ color: K.green }}>
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
            TABS QUE VIVEN EN SUS PROPIOS COMPONENTES
            (el encabezado con su InfoTip se pone acá para que TODOS los
            tabs expliquen qué muestran, sin tocar cada componente hijo)
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'diferencias' && (<div>
          <TabHeader icon="🔍" titulo="Fugas" sub="diferencias del inventario"
            tip={'Lo que el kardex registró de más o de menos: conteos nocturnos, mermas declaradas y ajustes manuales, ' +
              'valorizados con el costo de compra. Separa las fugas reales (insumos de venta: un faltante ahí es merma, robo o error) ' +
              'del consumo interno (limpieza, empaques: gastarlo es normal, lo que se vigila es cuánto). ' +
              'El ⓘ de los filtros explica cada número en detalle.'} />
          <DiferenciasTab />
        </div>)}

        {activeTab === 'conteo' && (<div>
          <TabHeader icon="🌙" titulo="Lista del conteo nocturno" sub="qué se cuenta cada noche"
            tip={'Los productos que cada sucursal cuenta al cierre, agrupados y en el orden en que se cuentan físicamente. ' +
              'Sale del catálogo (los ítems marcados "incluir en conteo"). ' +
              'Lo que se cuenta acá alimenta el tab Fugas: si un producto no está en la lista, sus faltantes no se detectan nunca.'} />
          <ConteoLista user={user} />
        </div>)}

        {activeTab === 'menu' && (<div>
          <TabHeader icon="🍽️" titulo="Menú (BOM)" sub="platillo → receta → ingredientes"
            tip={'Cada platillo del POS enlazado a su receta y de ahí a sus ingredientes (la ficha técnica o BOM). ' +
              'Con este mapeo, cada venta descuenta inventario sola. ' +
              'La confiabilidad de cada fila avisa si la receta está vacía o sin costo: una receta mala descuenta mal el inventario de TODAS las sucursales.'} />
          <MapeoMenu user={user} />
        </div>)}

        {activeTab === 'recetas' && (<div>
          <TabHeader icon="📖" titulo="Recetas" sub="ingredientes y rendimiento"
            tip={'Las recetas de cocina: qué ingredientes lleva cada preparado, en qué cantidad y cuánto rinde cada tanda. ' +
              'De acá salen el costo de cada platillo y el descuento automático de inventario al vender o producir. ' +
              'Ojo con las unidades: si la receta dice "taza" y el almacén guarda "kg", hace falta el factor de conversión.'} />
          <RecetasView user={user} />
        </div>)}

        {activeTab === 'costeo' && (<div>
          <TabHeader icon="💰" titulo="Costeo" sub="cuánto cuesta cada platillo"
            tip={'El costo real de cada producto del menú, calculado con los precios de tus compras (DTE) y las recetas. ' +
              'Compara costo contra precio de venta para ver el margen. ' +
              'Si un ingrediente no tiene compras mapeadas, su costo sale en $0 y el margen se ve mejor de lo que es.'} />
          <CosteoView />
        </div>)}

        {/* ═══════════════════════════════════════════════════════════════
            TAB 4: HISTORIAL DE MOVIMIENTOS
        ═══════════════════════════════════════════════════════════════ */}
        {activeTab === 'movimientos' && (<div>
          <TabHeader icon="📜" titulo="Historial" sub="todo movimiento del kardex"
            tip={'Cada entrada y salida de inventario de la sucursal, en orden del más reciente al más viejo: ' +
              'recepciones, ventas, traslados, consumos, producciones, conteos, mermas y ajustes. ' +
              'Sale de la tabla kardex_movimientos, que es la bitácora que nadie edita a mano. ' +
              'Cada fila muestra el stock antes → después y QUIÉN firmó el movimiento (usuario del ERP); ' +
              'los automáticos, como la venta del POS, salen sin usuario.'} />

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

          {/* Filtro por tipo de movimiento — pills al estilo Fugas */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', margin: '2px 0 12px', paddingBottom: 2 }}>
            <button onClick={() => setMovTipo(null)} style={pill(!movTipo, K.dim)}>Todo</button>
            {Object.entries(MOV_TIPOS).map(([id, t]) => (
              <button key={id} onClick={() => setMovTipo(movTipo === id ? null : id)}
                style={pill(movTipo === id, t.color)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {loadingMov ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : movimientos.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📜</div>
              <div className="empty-text">Sin movimientos {movTipo ? `de tipo ${MOV_TIPOS[movTipo]?.label?.toLowerCase()} ` : ''}en este período</div>
            </div>
          ) : (
            <div className="space-y-1">
              {movimientos.map(mov => {
                const mt = MOV_TIPOS[mov.tipo] || { label: mov.tipo, icon: '❓', color: K.dim };
                const isPositive = mov.cantidad > 0;
                const quien = mov.usuarios_erp?.nombre;
                return (
                  <div key={mov.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: K.card,
                    border: `1px solid ${K.border}`, borderLeft: '3px solid ' + mt.color, borderRadius: 10, padding: '9px 12px' }}>
                    <div style={{ fontSize: 18, width: 26, textAlign: 'center', flexShrink: 0 }}>{mt.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: K.text }}>{mov.catalogo_productos?.nombre || '—'}</p>
                      <p className="text-xs" style={{ color: K.dim }}>
                        <span style={{ color: mt.color, fontWeight: 700 }}>{mt.label}</span>
                        {' · '}{fmtDate(mov.created_at)}
                        {' · '}
                        <span style={{ color: quien ? K.dim : K.orange }}>
                          👤 {quien || 'sin usuario'}
                        </span>
                        {mov.notas ? ` · ${mov.notas}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold" style={{ color: isPositive ? K.green : K.red }}>
                        {isPositive ? '+' : ''}{n(mov.cantidad)}
                      </p>
                      <p className="text-xs" style={{ color: K.faint }}>
                        {n(mov.stock_anterior)} → {n(mov.stock_posterior)}
                      </p>
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
          <TabHeader icon="✏️" titulo="Ajustes y merma" sub="correcciones firmadas"
            tip={'Dos cosas distintas: el AJUSTE corrige el stock cuando el sistema no coincide con la realidad ' +
              '(error de digitación, conteo mal hecho). La MERMA registra producto que se botó, se venció o se quemó. ' +
              'Las dos exigen motivo y usuario — quedan firmadas en el Historial y se ven en el tab Fugas. ' +
              'No uses el ajuste para esconder una merma: para eso está su propio botón.'} />

          <div className="card" style={{ maxWidth: 480 }}>
            <div className="sec-title" style={{ marginBottom: 4 }}>✏️ Ajuste manual de inventario</div>
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
                  <div className="mt-2" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: tint(K.green, '15'), border: `1px solid ${tint(K.green, '44')}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div>
                      <p className="text-sm font-bold">{adjProd.nombre}</p>
                      <p className="text-xs" style={{ color: K.green }}>Stock actual: {n(adjStock)}</p>
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
                  <p className="text-xs mt-1" style={{ color: parseFloat(adjQty) >= 0 ? K.green : K.red }}>
                    Nuevo stock: {n(adjStock + (parseFloat(adjQty) || 0))}
                  </p>
                )}
              </div>

              <div className="field">
                <label>Motivo del ajuste</label>
                <textarea
                  placeholder="Ej: Corrección de conteo, error de digitación... (para merma usá la sección de abajo)"
                  value={adjNotas} onChange={e => setAdjNotas(e.target.value)}
                  className="inp" style={{ minHeight: 72, resize: 'vertical' }} />
              </div>

              <button className="btn btn-green" onClick={handleAjuste}
                disabled={savingAdj || !adjProd}>
                {savingAdj ? 'Guardando...' : '✓ Registrar ajuste'}
              </button>
            </div>
          </div>

          <MermaForm user={user} show={show} sucursales={sucursales} defaultSucursal={sucursal} />
        </div>)}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   🗑️ REGISTRAR MERMA — producto que se botó, venció o se quemó.
   Usa la RPC registrar_merma (valida motivo y usuario en el servidor);
   NO es un ajuste manual: así la merma queda con su propio tipo en el
   kardex y el dashboard de Fugas puede mostrarla.
   ══════════════════════════════════════════════════════════════════════ */
function MermaForm({ user, show, sucursales, defaultSucursal }) {
  const [mSucursal, setMSucursal] = useState(defaultSucursal || '');
  const [items, setItems] = useState([]); // [{ producto, cantidad, stock }]
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState('');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  // Si el usuario elige sucursal en el ajuste de arriba, seguirla mientras acá no haya elegido nada
  useEffect(() => {
    if (defaultSucursal && !mSucursal) setMSucursal(defaultSucursal);
  }, [defaultSucursal]); // eslint-disable-line react-hooks/exhaustive-deps

  const addItem = async (prod) => {
    if (items.some(it => it.producto.id === prod.id)) {
      show?.('Ese producto ya está en la lista', 'warning');
      return;
    }
    let stock = null;
    if (mSucursal) {
      const { data } = await db.from('inventario').select('stock_actual')
        .eq('producto_id', prod.id).eq('sucursal_id', mSucursal).single();
      stock = data?.stock_actual ?? 0;
    }
    setItems(prev => [...prev, { producto: prod, cantidad: '', stock }]);
  };

  const setCantidad = (id, val) => {
    // iOS: el teclado numérico no trae punto → aceptamos coma también
    if (val && !/^\d*[.,]?\d*$/.test(val)) return;
    setItems(prev => prev.map(it => it.producto.id === id ? { ...it, cantidad: val } : it));
  };

  const removeItem = (id) => setItems(prev => prev.filter(it => it.producto.id !== id));

  const parseQty = (v) => parseFloat(String(v).replace(',', '.'));

  const handleMerma = async () => {
    setErrMsg('');
    if (!mSucursal) { show?.('Selecciona una sucursal', 'warning'); return; }
    if (items.length === 0) { show?.('Agrega al menos un producto', 'warning'); return; }
    const malos = items.filter(it => !(parseQty(it.cantidad) > 0));
    if (malos.length > 0) {
      show?.(`Cantidad inválida en: ${malos.map(it => it.producto.nombre).join(', ')}`, 'warning');
      return;
    }
    if (!motivo || motivo.trim().length < 5) {
      show?.('Escribe el motivo (mín. 5 caracteres)', 'warning');
      return;
    }
    if (!user?.id) { show?.('No se pudo identificar al usuario — vuelve a iniciar sesión', 'error'); return; }
    setSaving(true);
    try {
      const { data, error } = await db.rpc('registrar_merma', {
        p_items: items.map(it => ({ producto_id: it.producto.id, cantidad: parseQty(it.cantidad) })),
        p_sucursal_id: mSucursal,
        p_motivo: motivo.trim(),
        p_usuario_id: user.id,
        p_notas: notas.trim() || null,
      });
      if (error) throw error;
      const r = data || {};
      show?.(`Merma registrada: ${r.productos ?? items.length} producto(s), ${n(r.unidades ?? 0)} unidades, $${n(r.valor ?? 0)}`, 'success');
      setItems([]); setMotivo(''); setNotas(''); setErrMsg('');
    } catch (e) {
      // El servidor valida motivo y usuario — mostramos SU mensaje, no uno genérico
      const msg = e?.message || 'Error al registrar la merma';
      setErrMsg(msg);
      show?.(msg, 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="card" style={{ maxWidth: 480, marginTop: 16 }}>
      <div className="sec-title" style={{ marginBottom: 4 }}>🗑️ Registrar merma</div>
      <p className="text-xs text-muted-foreground mb-4">
        Producto que se botó, se venció o se quemó. Queda como merma en el kardex (no como ajuste).
      </p>

      <div className="space-y-3">
        <div className="field">
          <label>Sucursal</label>
          <select value={mSucursal} onChange={e => setMSucursal(e.target.value)} className={selectCls}>
            <option value="">Selecciona...</option>
            {sucursales.map(s => (
              <option key={s.id} value={s.id}>
                {s.store_code} — {s.nombre || STORES[s.store_code] || s.store_code}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Agregar producto</label>
          <CatalogoSearch placeholder="Buscar producto..." onSelect={addItem} />
        </div>

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map(it => (
              <div key={it.producto.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2" style={{ background: K.card2 }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{it.producto.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {TIPOS[it.producto.tipo]?.full || it.producto.tipo}
                    {it.stock !== null ? ` · Stock: ${n(it.stock)}` : ''}
                  </p>
                </div>
                <Input
                  type="text" inputMode="decimal" placeholder="Cant."
                  value={it.cantidad}
                  onChange={e => setCantidad(it.producto.id, e.target.value)}
                  style={{ width: 80, textAlign: 'right' }}
                />
                <button onClick={() => removeItem(it.producto.id)}
                  className="text-lg px-1" style={{ color: K.red, background: 'none', border: 'none', cursor: 'pointer' }}
                  aria-label={`Quitar ${it.producto.nombre}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="field">
          <label>Motivo (obligatorio, mín. 5 caracteres)</label>
          <textarea
            placeholder="Ej: Se venció el queso, se quemó la carne en plancha..."
            value={motivo} onChange={e => setMotivo(e.target.value)}
            className="inp" style={{ minHeight: 72, resize: 'vertical' }} />
        </div>

        <div className="field">
          <label>Notas (opcional)</label>
          <Input placeholder="Detalle adicional..." value={notas} onChange={e => setNotas(e.target.value)} />
        </div>

        {errMsg && (
          <div className="rounded-md border px-3 py-2 text-xs font-semibold"
            style={{ background: tint(K.red, '1c'), borderColor: tint(K.red, '55'), color: K.red }}>
            {errMsg}
          </div>
        )}

        <button className="btn btn-red" onClick={handleMerma}
          disabled={saving || items.length === 0}>
          {saving ? 'Registrando...' : '🗑️ Registrar merma'}
        </button>
      </div>
    </div>
  );
}

// ── Editor de unidades y conversión compra→almacén ──
function UnidadesModal({ item, onClose, onSaved }) {
  const [um, setUm] = useState(item.unidad_medida || 'unidad');
  const [uc, setUc] = useState(item.unidad_compra || '');
  const [factor, setFactor] = useState(item.factor_compra ?? 1);
  const [saving, setSaving] = useState(false);
  const guardar = async () => {
    setSaving(true);
    const { error } = await db.rpc('set_unidades_producto', {
      p_producto_id: item.id, p_unidad_medida: um, p_unidad_compra: uc || null, p_factor_compra: Number(factor) || 1,
    });
    setSaving(false);
    if (!error) onSaved();
  };
  const inp = { background: K.card2, border: `1px solid ${K.border}`, color: '#f0f0f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, width: '100%' };
  const lbl = { fontSize: 11, color: K.dim, display: 'block', marginBottom: 3 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 12, padding: 16, width: '100%', maxWidth: 440 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>Unidades y conversión</div>
        <div style={{ fontSize: 12, color: K.dim, marginBottom: 12 }}>{item.nombre}</div>
        <label style={lbl}>Unidad de almacén (cómo se guarda y se usa en recetas)</label>
        <UnidadSelect value={um} onChange={setUm} selectStyle={inp} style={{ marginBottom: 10 }} />
        <label style={lbl}>Unidad de compra (cómo viene en el DTE)</label>
        <UnidadSelect value={uc} onChange={setUc} allowEmpty emptyLabel="(igual que almacén)" selectStyle={inp} style={{ marginBottom: 10 }} />
        <label style={lbl}>Factor: 1 {uc || 'compra'} = ? {um || 'almacén'}</label>
        <input type="number" step="any" value={factor} onChange={e => setFactor(e.target.value)} style={{ ...inp, marginBottom: 6 }} />
        <div style={{ fontSize: 11, color: K.dim, marginBottom: 14 }}>Ej: comprás caja de 30 lb → compra "caja", almacén "lb", factor 30. Al recibir 5 cajas entran 150 lb.</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: K.border, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={{ background: K.green, color: '#04220f', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Guardando…' : 'Guardar'}</button>
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
      // '' = limpiar (el backend lo vuelve null); null = no tocar. Como este
      // editor manda el form completo, siempre se manda el valor visible.
      p_conteo_clase: form.conteo_clase || '',
    });
    setSaving(false);
    if (error) { setErr(error.message); show?.('❌ ' + error.message, 'error'); return; }
    onSaved();
  };
  const inp = { background: K.card2, border: `1px solid ${K.border}`, color: '#f0f0f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, width: '100%' };
  const lbl = { fontSize: 11, color: K.dim, display: 'block', marginBottom: 3 };
  const row = { display: 'flex', gap: 8 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: K.card, border: `1px solid ${K.border}`, borderRadius: 12, padding: 16, width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>Editar ítem</div>
        {!form ? (
          <div style={{ color: K.dim, padding: 20, textAlign: 'center' }}>Cargando…</div>
        ) : (
          <>
            <label style={lbl}>Nombre *</label>
            <input value={form.nombre || ''} onChange={e => set('nombre', e.target.value)} style={{ ...inp, marginBottom: 10 }} />

            <label style={lbl}>Clasificación</label>
            <div className="flex gap-2 mb-3 flex-wrap">
              {Object.entries(TIPOS).map(([key, t]) => (
                <button key={key} onClick={() => set('tipo', key)}
                  className="rounded-lg p-2 text-center border-2" style={{
                    minWidth: 64, background: form.tipo === key ? tint(t.color) : 'transparent',
                    borderColor: form.tipo === key ? t.color : K.border, color: form.tipo === key ? t.color : K.dim, cursor: 'pointer',
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
            <UnidadSelect value={form.unidad_medida || 'unidad'} onChange={v => set('unidad_medida', v)} selectStyle={inp} style={{ marginBottom: 10 }} />

            <div style={{ ...row, marginBottom: 10 }}>
              <div style={{ flex: 2 }}>
                <label style={lbl}>Unidad de compra (DTE)</label>
                <UnidadSelect value={form.unidad_compra || ''} onChange={v => set('unidad_compra', v)} allowEmpty emptyLabel="(igual que almacén)" selectStyle={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Factor</label>
                <input type="number" step="any" value={form.factor_compra ?? 1} onChange={e => set('factor_compra', e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: K.dim, marginBottom: 12 }}>1 {form.unidad_compra || 'compra'} = {form.factor_compra ?? 1} {form.unidad_medida || 'almacén'} · afecta el costo por unidad.</div>

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
            {!!form.incluir_conteo && (
              <div style={{ marginLeft: 24, marginBottom: 8 }}>
                <label style={lbl}>Clase en el dashboard de Fugas</label>
                <select value={form.conteo_clase || ''} onChange={e => set('conteo_clase', e.target.value || null)} style={inp}>
                  <option value="">(sin clasificar — se trata como fuga real)</option>
                  <option value="venta">Fuga real · insumo de venta (faltante = merma/robo)</option>
                  <option value="consumo_interno">Consumo interno · se gasta operando (limpieza/empaques/papelería)</option>
                </select>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#f0f0f0', marginBottom: 14, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.incluir_inventario_fisico} onChange={e => set('incluir_inventario_fisico', e.target.checked)} /> Incluir en Inventario Físico
            </label>

            {err && <div style={{ color: K.red, fontSize: 12, marginBottom: 10 }}>❌ {err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: K.border, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={guardar} disabled={saving} style={{ background: K.green, color: '#04220f', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 800, cursor: 'pointer' }}>{saving ? 'Guardando…' : 'Guardar'}</button>
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
  // Poner el item en la posición N dentro de su grupo → el RPC reacomoda el resto (numeración limpia 1..K).
  const reordenar = async (id, nuevoOrden) => {
    const n = Number(nuevoOrden);
    if (nuevoOrden === '' || Number.isNaN(n)) return;
    await db.rpc('reordenar_conteo_item', { p_producto_id: id, p_nuevo_orden: n });
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

  // Alias local a la paleta compartida (el componente ya usaba "C")
  const C = { card: K.card, card2: K.panel, border: K.border, dim: K.dim, green: K.green, blue: K.blue };
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
            <select value={nuevaCat} onChange={e => setNuevaCat(e.target.value)} style={{ background: K.card2, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 13 }}>
              <option value="">Grupo…</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div style={{ flex: 1, minWidth: 200 }}>
              <CatalogoSearch placeholder="Buscar producto…" onSelect={agregar} />
            </div>
            <button onClick={() => setAdding(false)} style={{ background: K.border, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', cursor: 'pointer' }}>Cancelar</button>
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
                        {it.match_receta_nombre && <span style={{ color: K.orange, fontSize: 11, marginLeft: 8 }}>= {it.match_receta_nombre}</span>}
                        {it.receta && <span onClick={() => setOpenR(o => ({ ...o, [it.id]: !o[it.id] }))} style={{ color: C.blue, fontSize: 11, marginLeft: 8, cursor: 'pointer' }}>{openR[it.id] ? '▾ receta' : '▸ receta'}</span>}
                      </div>
                      {puede && (
                        <>
                          <button onClick={() => setEdit(e => e === it.id ? null : it.id)} title="Editar / clasificar"
                            style={{ background: edit === it.id ? K.border : K.card2, color: '#ccc', border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>✎</button>
                          <select value={it.grupo || g.grupo} onChange={e => setItem(it.id, { categoria: e.target.value })}
                            style={{ background: K.card2, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '3px 6px', fontSize: 11 }} title="Mover de grupo">
                            {cats.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input key={`ord-${it.id}-${it.orden}`} type="number" defaultValue={it.orden ?? ''}
                            onBlur={e => reordenar(it.id, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                            placeholder="orden" style={{ width: 56, background: K.card2, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '3px 6px', fontSize: 11 }}
                            title="Número de posición en el grupo; al cambiarlo, los demás se reacomodan" />
                          <button onClick={() => quitar(it.id, it.nombre)} style={{ background: tint(K.red, '26'), color: K.red, border: 'none', borderRadius: 6, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}>Quitar</button>
                        </>
                      )}
                    </div>

                    {/* Panel de edición: nombre, tipo, match a sub-receta */}
                    {puede && edit === it.id && (
                      <div style={{ marginTop: 8, padding: 10, background: K.panel, borderRadius: 8, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Nombre del ingrediente</div>
                          <input defaultValue={it.nombre} onBlur={e => { const v = e.target.value.trim(); if (v && v !== it.nombre) renombrar(it.id, v); }}
                            style={{ width: '100%', boxSizing: 'border-box', background: K.card2, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '6px 8px', fontSize: 13 }} />
                        </div>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Tipo</div>
                            <select value={it.tipo || 'materia_prima'} onChange={e => cambiarTipo(it.id, e.target.value)}
                              style={{ background: K.card2, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
                              <option value="materia_prima">🥩 Materia Prima</option>
                              <option value="sub_producto">🧪 Sub Producto</option>
                              <option value="producto_terminado">🍔 Terminado (reventa)</option>
                              <option value="insumo">🧰 Insumo (no alimento)</option>
                            </select>
                          </div>
                          <div style={{ flex: 1, minWidth: 200 }}>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Es la sub-receta… (si es un preparado de CM)</div>
                            <select value={it.match_receta_id || ''} onChange={e => matchSub(it.id, e.target.value)}
                              style={{ width: '100%', background: K.card2, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 6, padding: '5px 8px', fontSize: 12 }}>
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
