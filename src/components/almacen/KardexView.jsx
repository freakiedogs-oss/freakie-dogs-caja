import { useState, useEffect } from 'react';
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

// Shared select styles (native selects can't use shadcn Input easily)
const selectCls = 'w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export default function KardexView({ user, show }) {
  const [sucursales, setSucursales] = useState([]);
  const [sucursal, setSucursal] = useState('');

  // Load sucursales from DB
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

  // ── Movimientos tab ────────────────────────────────────────────────────────
  const [movimientos, setMovimientos] = useState([]);
  const [searchProd, setSearchProd] = useState('');
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [dateEnd, setDateEnd] = useState(() => today());
  const [loadingMov, setLoadingMov] = useState(false);

  const fetchMovimientos = async () => {
    if (!sucursal) return;
    setLoadingMov(true);
    try {
      const { data, error } = await db
        .from('kardex_movimientos')
        .select(`id, tipo, cantidad, stock_anterior, stock_posterior, notas, created_at,
          catalogo_productos(nombre)`)
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
    } catch (err) {
      show?.('Error al cargar movimientos', 'error');
    } finally {
      setLoadingMov(false);
    }
  };

  useEffect(() => { fetchMovimientos(); }, [sucursal, dateStart, dateEnd, searchProd]);

  // ── Mapeo DTE tab ──────────────────────────────────────────────────────────
  const [unmappedItems, setUnmappedItems] = useState([]);
  const [dtesData, setDtesData] = useState({});
  const [loadingMap, setLoadingMap] = useState(false);
  const [mappingItem, setMappingItem] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [productOptions, setProductOptions] = useState([]);
  const [extracting, setExtracting] = useState(false);

  const fetchUnmappedItems = async () => {
    setLoadingMap(true);
    try {
      const { data, error } = await db
        .from('compras_dte_items')
        .select('id, compras_dte_id, dte_codigo, linea, descripcion_original, cantidad, precio_unitario, monto_linea')
        .is('producto_id', null);

      if (error) throw error;
      setUnmappedItems(data || []);

      if (data && data.length > 0) {
        const dteCodigos = [...new Set(data.map(d => d.dte_codigo))];
        const { data: dtes } = await db
          .from('compras_dte')
          .select('dte_codigo, proveedor_nombre')
          .in('dte_codigo', dteCodigos);

        if (dtes) {
          const dteMap = {};
          dtes.forEach(d => { dteMap[d.dte_codigo] = d.proveedor_nombre; });
          setDtesData(dteMap);
        }
      }
    } catch (err) {
      show?.('Error al cargar items', 'error');
    } finally {
      setLoadingMap(false);
    }
  };

  const searchProducts = async (query) => {
    if (!query) { setProductOptions([]); return; }
    const { data } = await db
      .from('catalogo_productos')
      .select('id, nombre')
      .ilike('nombre', `%${query}%`)
      .limit(10);
    setProductOptions(data || []);
  };

  const handleMapItem = async (itemId, productoId) => {
    const { error } = await db
      .from('compras_dte_items')
      .update({ producto_id: productoId, confianza_mapeo: 'manual', mapeado_por: user.id, mapeado_at: new Date().toISOString() })
      .eq('id', itemId);

    if (error) { show?.('Error al mapear producto', 'error'); return; }
    show?.('Producto mapeado exitosamente', 'success');
    setMappingItem(null);
    setProductSearch('');
    fetchUnmappedItems();
  };

  const handleExtractItems = async () => {
    setExtracting(true);
    try {
      const { data, error } = await db.rpc('extraer_items_dte');
      if (error) throw error;
      show?.(`${data} items extraídos correctamente`, 'success');
      fetchUnmappedItems();
    } catch {
      show?.('Error al extraer items', 'error');
    } finally {
      setExtracting(false);
    }
  };

  // ── Ajustes tab ────────────────────────────────────────────────────────────
  const [adjProduct, setAdjProduct] = useState(null);
  const [adjCantidad, setAdjCantidad] = useState('');
  const [adjNotas, setAdjNotas] = useState('');
  const [currentStock, setCurrentStock] = useState(null);
  const [savingAdj, setSavingAdj] = useState(false);
  const [prodSearch, setProdSearch] = useState('');
  const [prodOptions, setProdOptions] = useState([]);

  const searchProdForAdj = async (query) => {
    if (!query) { setProdOptions([]); return; }
    const { data } = await db
      .from('catalogo_productos')
      .select('id, nombre')
      .ilike('nombre', `%${query}%`)
      .limit(10);
    setProdOptions(data || []);
  };

  const selectProduct = async (prodId, prodNombre) => {
    setAdjProduct({ id: prodId, nombre: prodNombre });
    setProdSearch(prodNombre);
    setProdOptions([]);
    if (!sucursal) { show?.('Selecciona una sucursal primero', 'warning'); return; }
    const { data } = await db
      .from('inventario')
      .select('stock_actual')
      .eq('producto_id', prodId)
      .eq('sucursal_id', sucursal)
      .single();
    setCurrentStock(data?.stock_actual ?? 0);
  };

  const handleRegisterAdjuste = async () => {
    if (!adjProduct) { show?.('Selecciona un producto', 'warning'); return; }
    if (!adjCantidad || isNaN(adjCantidad)) { show?.('Ingresa una cantidad válida', 'warning'); return; }
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

      const { error: invErr } = await db.from('inventario')
        .update({ stock_actual: stockPosterior })
        .eq('producto_id', adjProduct.id)
        .eq('sucursal_id', sucursal);
      if (invErr && invErr.code !== 'PGRST116') throw invErr;

      show?.('Ajuste registrado correctamente', 'success');
      setAdjProduct(null);
      setAdjCantidad('');
      setAdjNotas('');
      setProdSearch('');
      setCurrentStock(null);
    } catch {
      show?.('Error al registrar ajuste', 'error');
    } finally {
      setSavingAdj(false);
    }
  };

  // ── Grouped DTE items ──────────────────────────────────────────────────────
  const groupedByDte = {};
  unmappedItems.forEach(item => {
    if (!groupedByDte[item.dte_codigo]) groupedByDte[item.dte_codigo] = [];
    groupedByDte[item.dte_codigo].push(item);
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 min-h-screen bg-background text-foreground">
      <Tabs defaultValue="movimientos">
        <TabsList className="mb-5 w-full justify-start">
          <TabsTrigger value="movimientos">📊 Movimientos</TabsTrigger>
          <TabsTrigger value="mapeo" onClick={fetchUnmappedItems}>🔗 Mapeo DTE</TabsTrigger>
          <TabsTrigger value="ajustes">⚙️ Ajustes</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Movimientos ───────────────────────────────────────────── */}
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
                  <Input
                    placeholder="Buscar producto..."
                    value={searchProd}
                    onChange={e => setSearchProd(e.target.value)}
                  />
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

        {/* ── TAB 2: Mapeo DTE ─────────────────────────────────────────────── */}
        <TabsContent value="mapeo">
          <h3 className="sec-title">Mapeo de Items DTE → Catálogo</h3>

          <div className="flex items-center gap-3 mb-4">
            <Button variant="success" size="sm" onClick={handleExtractItems} disabled={extracting}>
              {extracting ? 'Extrayendo...' : '📥 Extraer Ítems DTE'}
            </Button>
            <Badge variant={unmappedItems.length > 0 ? 'destructive' : 'success'}>
              {unmappedItems.length} sin mapear
            </Badge>
          </div>

          {loadingMap ? (
            <div className="spin" style={{ width: 28, height: 28, margin: '40px auto' }} />
          ) : unmappedItems.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">✅</div>
              <div className="empty-text">Todos los items están mapeados</div>
            </div>
          ) : (
            <div className="grid gap-3">
              {Object.entries(groupedByDte).map(([dteCod, items]) => (
                <Card key={dteCod}>
                  <CardHeader>
                    <div className="text-xs text-muted-foreground">DTE: {dteCod}</div>
                    <CardTitle className="text-sm">{dtesData[dteCod] || 'Proveedor desconocido'}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {items.map(item => (
                      <div key={item.id} className="p-3 rounded-md bg-muted/50 border border-border">
                        <div className="mb-2">
                          <p className="text-sm font-medium">{item.descripcion_original}</p>
                          <p className="text-xs text-muted-foreground">
                            {n(item.cantidad)} × ${n(item.precio_unitario)} = ${n(item.monto_linea || 0)}
                          </p>
                        </div>

                        {mappingItem?.id === item.id ? (
                          <div className="space-y-2">
                            <div className="relative">
                              <Input
                                placeholder="Buscar producto en catálogo..."
                                value={productSearch}
                                onChange={e => { setProductSearch(e.target.value); searchProducts(e.target.value); }}
                                autoFocus
                              />
                              {productOptions.length > 0 && (
                                <div className="absolute top-full left-0 right-0 z-10 bg-card border border-border rounded-b-md shadow-lg">
                                  {productOptions.map(opt => (
                                    <div
                                      key={opt.id}
                                      onClick={() => handleMapItem(item.id, opt.id)}
                                      className="px-3 py-2 text-sm cursor-pointer hover:bg-muted border-b border-border/50 last:border-0"
                                    >
                                      {opt.nombre}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => setMappingItem(null)}>
                              Cancelar
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => { setMappingItem(item); setProductSearch(''); setProductOptions([]); }}
                          >
                            Mapear →
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: Ajustes ───────────────────────────────────────────────── */}
        <TabsContent value="ajustes">
          <h3 className="sec-title">Ajustes Manuales de Stock</h3>

          <Card className="max-w-lg">
            <CardHeader>
              <CardTitle>Registrar Ajuste</CardTitle>
            </CardHeader>
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

              <div className="space-y-1 relative">
                <label className="text-xs text-muted-foreground">Producto</label>
                <Input
                  placeholder="Buscar producto..."
                  value={prodSearch}
                  onChange={e => { setProdSearch(e.target.value); searchProdForAdj(e.target.value); }}
                />
                {prodOptions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 bg-card border border-border rounded-b-md shadow-lg mt-[-2px]">
                    {prodOptions.map(opt => (
                      <div
                        key={opt.id}
                        onClick={() => selectProduct(opt.id, opt.nombre)}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-muted border-b border-border/50 last:border-0"
                      >
                        {opt.nombre}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {adjProduct && currentStock !== null && (
                <div className="p-3 rounded-md bg-muted/50 border border-border text-sm">
                  <p className="font-semibold">{adjProduct.nombre}</p>
                  <p className="text-muted-foreground">
                    Stock actual: <span className="text-success font-bold">{n(currentStock)}</span>
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Cantidad (+ entrada / − salida)</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ej: 5 o -3"
                  value={adjCantidad}
                  onChange={e => setAdjCantidad(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Notas/Motivo (mín. 5 caracteres)</label>
                <textarea
                  placeholder="Ej: Conteo físico revela diferencia, Merma por rotura..."
                  value={adjNotas}
                  onChange={e => setAdjNotas(e.target.value)}
                  className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-h-[72px] resize-y font-inherit"
                />
              </div>

              <Button
                variant="success"
                className="w-full"
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
