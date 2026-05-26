import { useState, useEffect, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { kaeru } from '@/lib/supabase';
import { useSession } from '@/lib/auth';
import { formatUSD } from '@/lib/utils';

interface Producto {
  id: string;
  codigo: string;
  nombre: string;
  precio_venta: number;
  categoria_id: string | null;
  tipo_producto: string | null;
  impuesto_aplica_iva: boolean | null;
}
interface Categoria { id: string; nombre: string; orden: number; }
interface ModificadorPreset {
  id: string;
  categoria_id: string | null;
  nombre: string;
  precio_extra: number;
  orden: number;
}
interface ClienteCorp {
  id: string;
  nombre_razon_social: string;
  nit: string | null;
  nrc: string | null;
}
interface Item {
  id?: string;
  producto_id: string;
  producto_nombre: string;
  producto_codigo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  iva_linea: number;
  notas: string | null;
  impuesto_aplica_iva: boolean;
  estado_cocina?: 'pendiente' | 'listo';
}

const IVA_PCT = 0.13;
const PROPINA_SUGERIDA_PCT = 0.10;

// IVA helper: si producto aplica IVA, precio_unitario INCLUYE IVA → iva = total - total/1.13
function calcularIvaLinea(subtotal: number, aplicaIva: boolean): number {
  if (!aplicaIva) return 0;
  return +(subtotal - subtotal / (1 + IVA_PCT)).toFixed(4);
}

export default function POSMesa() {
  const { codigo } = useParams<{ codigo: string }>();
  const mesa = decodeURIComponent(codigo || '');
  const esPeya = mesa.startsWith('PEYA-');
  const { session } = useSession();
  const navigate = useNavigate();

  const [ventaId, setVentaId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [presets, setPresets] = useState<ModificadorPreset[]>([]);
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCobro, setShowCobro] = useState(false);
  const [showNotaPara, setShowNotaPara] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mobile: tab activa cuando viewport < 768px
  const [mobileTab, setMobileTab] = useState<'menu' | 'cuenta'>('menu');

  // Cargar productos + categorías + presets + cuenta existente
  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);

      const canalEsperado = esPeya ? 'peya' : 'mesa';
      const [pRes, cRes, mRes, vRes] = await Promise.all([
        kaeru.from('productos')
          .select('id,codigo,nombre,precio_venta,categoria_id,tipo_producto,impuesto_aplica_iva')
          .eq('activo', true).eq('tipo_producto', 'plato_principal').order('nombre'),
        kaeru.from('categorias_menu').select('id,nombre,orden').order('orden'),
        kaeru.from('modificador_preset').select('id,categoria_id,nombre,precio_extra,orden').eq('activo', true).order('orden'),
        kaeru.from('ventas').select('id').eq('canal', canalEsperado).eq('mesa_numero', mesa).eq('estado', 'abierta').maybeSingle()
      ]);

      if (cancel) return;

      setProductos((pRes.data || []) as Producto[]);
      setCategorias((cRes.data || []) as Categoria[]);
      setPresets((mRes.data || []) as ModificadorPreset[]);
      if ((cRes.data || []).length > 0) setCategoriaActiva((cRes.data as any)[0].id);

      if (vRes.data?.id) {
        setVentaId(vRes.data.id);
        const { data: dets } = await kaeru.from('venta_detalles')
          .select('id,producto_id,cantidad,precio_unitario,subtotal,iva_linea,notas,estado_cocina,productos:producto_id(codigo,nombre,impuesto_aplica_iva)')
          .eq('venta_id', vRes.data.id);
        if (!cancel) {
          setItems(((dets || []) as any[]).map((d) => ({
            id: d.id, producto_id: d.producto_id,
            producto_codigo: d.productos?.codigo || '',
            producto_nombre: d.productos?.nombre || '',
            cantidad: Number(d.cantidad), precio_unitario: Number(d.precio_unitario), subtotal: Number(d.subtotal),
            iva_linea: Number(d.iva_linea || 0),
            notas: d.notas,
            impuesto_aplica_iva: d.productos?.impuesto_aplica_iva ?? true,
            estado_cocina: d.estado_cocina
          })));
        }
      }

      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [mesa, esPeya]);

  const presetsParaCategoria = useMemo(() => {
    return (cat: string | null) => presets.filter((p) => p.categoria_id === null || p.categoria_id === cat);
  }, [presets]);

  const productosFiltrados = productos.filter((p) => {
    if (categoriaActiva && p.categoria_id !== categoriaActiva) return false;
    if (search.trim() && !p.nombre.toLowerCase().includes(search.toLowerCase()) && !p.codigo.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const totalCuenta = items.reduce((s, i) => s + i.subtotal, 0);
  const ivaTotal = items.reduce((s, i) => s + i.iva_linea, 0);
  const subtotalSinIva = totalCuenta - ivaTotal;
  const totalItems = items.reduce((s, i) => s + i.cantidad, 0);

  async function abrirCuentaSiNecesario(): Promise<string | null> {
    if (ventaId) return ventaId;
    const canal = esPeya ? 'peya' : 'mesa';
    const { data, error: e } = await kaeru.from('ventas').insert({
      canal, mesa_numero: mesa, estado: 'abierta',
      subtotal: 0, iva: 0, propina: 0, total: 0,
      mesero_id: session?.empleado_id ?? null,
      tipo_dte: 'factura'
    }).select('id').single();
    if (e || !data) { setError(e?.message || 'Error abriendo cuenta'); return null; }
    setVentaId(data.id);
    return data.id;
  }

  async function agregarItem(p: Producto) {
    setError(null);
    const id = await abrirCuentaSiNecesario();
    if (!id) return;

    const aplicaIva = p.impuesto_aplica_iva ?? true;
    // Si ya hay item igual (mismo producto, sin notas), incrementa cantidad. Items con notas son únicos.
    const existing = items.find((i) => i.producto_id === p.id && !i.notas);
    if (existing) {
      const nuevaCant = existing.cantidad + 1;
      const nuevoSub = +(nuevaCant * existing.precio_unitario).toFixed(2);
      const nuevoIva = calcularIvaLinea(nuevoSub, existing.impuesto_aplica_iva);
      const { error: e } = await kaeru.from('venta_detalles').update({
        cantidad: nuevaCant, subtotal: nuevoSub, iva_linea: nuevoIva
      }).eq('id', existing.id);
      if (e) { setError(e.message); return; }
      setItems((prev) => prev.map((i) => i.id === existing.id ? { ...i, cantidad: nuevaCant, subtotal: nuevoSub, iva_linea: nuevoIva } : i));
    } else {
      const subtotal = +Number(p.precio_venta).toFixed(2);
      const iva_linea = calcularIvaLinea(subtotal, aplicaIva);
      const { data, error: e } = await kaeru.from('venta_detalles').insert({
        venta_id: id, producto_id: p.id,
        cantidad: 1, precio_unitario: p.precio_venta, subtotal, iva_linea,
        estado_cocina: 'pendiente'
      }).select('id').single();
      if (e || !data) { setError(e?.message || 'Error insertando'); return; }
      setItems((prev) => [...prev, {
        id: data.id, producto_id: p.id, producto_codigo: p.codigo, producto_nombre: p.nombre,
        cantidad: 1, precio_unitario: p.precio_venta, subtotal, iva_linea,
        notas: null, impuesto_aplica_iva: aplicaIva,
        estado_cocina: 'pendiente'
      }]);
    }

    await actualizarTotalVenta(id);
  }

  async function cambiarCantidad(item: Item, delta: number) {
    const nuevaCant = item.cantidad + delta;
    if (nuevaCant <= 0) {
      if (item.id) await kaeru.from('venta_detalles').delete().eq('id', item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } else {
      const nuevoSub = +(nuevaCant * item.precio_unitario).toFixed(2);
      const nuevoIva = calcularIvaLinea(nuevoSub, item.impuesto_aplica_iva);
      if (item.id) await kaeru.from('venta_detalles').update({ cantidad: nuevaCant, subtotal: nuevoSub, iva_linea: nuevoIva }).eq('id', item.id);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, cantidad: nuevaCant, subtotal: nuevoSub, iva_linea: nuevoIva } : i));
    }
    if (ventaId) await actualizarTotalVenta(ventaId);
  }

  async function guardarNotaItem(item: Item, notas: string | null) {
    if (!item.id) return;
    await kaeru.from('venta_detalles').update({ notas }).eq('id', item.id);
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, notas } : i));
    setShowNotaPara(null);
  }

  async function actualizarTotalVenta(id: string) {
    const { data: dets } = await kaeru.from('venta_detalles').select('subtotal,iva_linea').eq('venta_id', id);
    const total = (dets || []).reduce((s: number, d: any) => s + Number(d.subtotal || 0), 0);
    const iva = (dets || []).reduce((s: number, d: any) => s + Number(d.iva_linea || 0), 0);
    const subtotal = total - iva;
    await kaeru.from('ventas').update({ subtotal, iva, total }).eq('id', id);
  }

  async function cancelarCuenta() {
    if (!ventaId) { navigate('/pos'); return; }
    if (!confirm(`¿Cancelar la cuenta de ${mesa}? Se borrarán todos los items.`)) return;
    await kaeru.from('venta_detalles').delete().eq('venta_id', ventaId);
    await kaeru.from('ventas').delete().eq('id', ventaId);
    navigate('/pos');
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg-base)' }}>
        <div className="text-muted">● Cargando {esPeya ? 'orden PeYa' : `mesa ${mesa}`}…</div>
      </div>
    );
  }

  const colorMesa = esPeya ? 'var(--accent-purple)' : 'var(--accent-kaeru)';

  return (
    <div className="pos-mesa-wrap" style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <style>{`
        .pos-mesa-wrap { display: grid; grid-template-rows: auto 1fr; max-width: 1600px; margin: 0 auto; }
        .pos-mesa-body { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(320px, 380px); overflow: hidden; }
        .pos-mobile-tabs { display: none; }
        .pos-pane-menu, .pos-pane-cuenta { overflow-y: auto; }
        .pos-pane-cuenta { background: var(--bg-card); display: flex; flex-direction: column; }
        @media (max-width: 767px) {
          .pos-mesa-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
          .pos-mobile-tabs { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); position: sticky; top: 0; z-index: 5; }
          .pos-mobile-tabs button { flex: 1; min-height: 40px; }
          .pos-pane-menu { display: ${mobileTab === 'menu' ? 'block' : 'none'}; }
          .pos-pane-cuenta { display: ${mobileTab === 'cuenta' ? 'flex' : 'none'}; border-right: none; border-top: 1px solid var(--border-subtle); }
        }
      `}</style>

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
        <div className="row" style={{ minWidth: 0, gap: 8 }}>
          <Link to="/pos" className="btn btn-ghost btn-sm">← Mesas</Link>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-metric)', fontSize: 22, lineHeight: 1, color: colorMesa }}>
              {esPeya ? '🛵 ' : ''}{mesa}
            </div>
            <div className="text-muted" style={{ fontSize: 10 }}>
              {ventaId ? 'Cuenta abierta' : (esPeya ? 'Orden PeYa libre — abre al agregar item' : 'Mesa libre — abre cuenta al agregar item')}
            </div>
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: 11, textAlign: 'right' }}>{session?.nombre_display}</div>
      </header>

      {/* Tabs mobile */}
      <div className="pos-mobile-tabs">
        <button onClick={() => setMobileTab('menu')} className={`btn ${mobileTab === 'menu' ? 'btn-kaeru' : 'btn-outline'} btn-sm`}>
          Menú
        </button>
        <button onClick={() => setMobileTab('cuenta')} className={`btn ${mobileTab === 'cuenta' ? 'btn-kaeru' : 'btn-outline'} btn-sm`}>
          Cuenta ({totalItems}) — {formatUSD(totalCuenta)}
        </button>
      </div>

      <div className="pos-mesa-body">
        {/* PANEL MENÚ */}
        <div className="pos-pane-menu" style={{ padding: 12, borderRight: '1px solid var(--border-subtle)' }}>
          <input className="ki-input" placeholder="🔍 Buscar producto..."
            value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 10 }} />
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <button className={`btn btn-sm ${!categoriaActiva ? 'btn-kaeru' : 'btn-outline'}`} onClick={() => setCategoriaActiva(null)}>Todas</button>
            {categorias.map((c) => (
              <button key={c.id}
                className={`btn btn-sm ${categoriaActiva === c.id ? 'btn-kaeru' : 'btn-outline'}`}
                onClick={() => setCategoriaActiva(c.id)}>{c.nombre}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {productosFiltrados.map((p) => {
              const aplicaIva = p.impuesto_aplica_iva ?? true;
              return (
                <button key={p.id} onClick={() => agregarItem(p)}
                  style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border-default)',
                    borderRadius: 'var(--r-md)', padding: 12, textAlign: 'left', cursor: 'pointer',
                    color: 'var(--text-primary)', minHeight: 76, display: 'flex', flexDirection: 'column', gap: 4
                  }}>
                  <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{p.nombre}</div>
                  {!aplicaIva && (
                    <span className="badge" style={{ background: 'rgba(154,111,209,0.15)', color: 'var(--accent-purple)', fontSize: 9, padding: '1px 5px', alignSelf: 'flex-start' }}>EXENTO IVA</span>
                  )}
                  <div className="text-kaeru" style={{ fontFamily: 'var(--font-metric)', fontSize: 16, marginTop: 'auto' }}>{formatUSD(p.precio_venta)}</div>
                </button>
              );
            })}
          </div>

          {productosFiltrados.length === 0 && (
            <div className="text-muted" style={{ padding: 20, textAlign: 'center', fontSize: 13 }}>
              Sin productos en esta categoría
            </div>
          )}
        </div>

        {/* PANEL CUENTA */}
        <div className="pos-pane-cuenta">
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            <div className="row-between" style={{ marginBottom: 12 }}>
              <span className="card-title">Cuenta ({totalItems} items)</span>
              {ventaId && <button onClick={cancelarCuenta} className="btn btn-ghost btn-sm text-danger">Cancelar</button>}
            </div>

            {items.length === 0 ? (
              <div className="text-dim" style={{ textAlign: 'center', padding: 30, fontSize: 13 }}>
                Toca un producto del menú para agregar
              </div>
            ) : items.map((item) => (
              <div key={item.id} style={{ background: 'var(--bg-inset)', borderRadius: 'var(--r-md)', padding: 8, marginBottom: 6 }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{item.producto_nombre}</div>
                    <div className="row" style={{ gap: 6, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                      <span className="text-muted" style={{ fontSize: 10 }}>{formatUSD(item.precio_unitario)} c/u</span>
                      {!item.impuesto_aplica_iva && (
                        <span style={{ fontSize: 9, color: 'var(--accent-purple)' }}>· EXENTO</span>
                      )}
                      {item.estado_cocina === 'listo' && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-kaeru)', background: 'rgba(95,224,169,0.15)', padding: '1px 5px', borderRadius: 3 }}>✓ LISTO</span>
                      )}
                      {item.estado_cocina === 'pendiente' && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent-purple)', background: 'rgba(154,111,209,0.15)', padding: '1px 5px', borderRadius: 3 }}>● COCINA</span>
                      )}
                    </div>
                    {item.notas && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4, borderLeft: '2px solid var(--accent-purple)', paddingLeft: 6 }}>
                        ✎ {item.notas}
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{formatUSD(item.subtotal)}</div>
                </div>
                <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
                  <button onClick={() => setShowNotaPara(item)}
                    className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '4px 8px' }}
                    title="Agregar nota o modificador a este item">
                    {item.notas ? '✎ Editar nota' : '+ Nota / mod'}
                  </button>
                  <div className="row" style={{ gap: 6 }}>
                    <button onClick={() => cambiarCantidad(item, -1)}
                      style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer' }}>−</button>
                    <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{item.cantidad}</span>
                    <button onClick={() => cambiarCantidad(item, 1)}
                      style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--accent-kaeru)', background: 'rgba(95,224,169,0.15)', color: 'var(--accent-kaeru)', cursor: 'pointer' }}>+</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Totales + cobrar */}
          <div style={{ borderTop: '1px solid var(--border-default)', padding: 12, background: 'var(--bg-elevated)' }}>
            <div className="row-between" style={{ marginBottom: 4, fontSize: 12 }}>
              <span className="text-muted">Subtotal (sin IVA)</span>
              <span>{formatUSD(subtotalSinIva)}</span>
            </div>
            <div className="row-between" style={{ marginBottom: 4, fontSize: 12 }}>
              <span className="text-muted">IVA 13%</span>
              <span>{formatUSD(ivaTotal)}</span>
            </div>
            <div className="row-between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 6 }}>
              <span className="card-title">TOTAL</span>
              <span style={{ fontFamily: 'var(--font-metric)', fontSize: 26, color: colorMesa }}>{formatUSD(totalCuenta)}</span>
            </div>

            {error && <div className="text-danger" style={{ fontSize: 11, marginTop: 6 }}>{error}</div>}

            <button onClick={() => setShowCobro(true)}
              className="btn btn-kaeru" style={{ width: '100%', marginTop: 12, fontSize: 14, padding: '12px 16px', minHeight: 48 }}
              disabled={items.length === 0}>
              {`Cobrar ${formatUSD(totalCuenta)} →`}
            </button>
          </div>
        </div>
      </div>

      {showCobro && ventaId && (
        <ModalCobro
          ventaId={ventaId}
          totalConIVA={totalCuenta}
          ivaTotal={ivaTotal}
          esPeya={esPeya}
          onClose={() => setShowCobro(false)}
          onCobrado={() => navigate('/pos')}
        />
      )}

      {showNotaPara && (
        <ModalNotaItem
          item={showNotaPara}
          presets={presetsParaCategoria(productos.find((p) => p.id === showNotaPara.producto_id)?.categoria_id ?? null)}
          onClose={() => setShowNotaPara(null)}
          onSave={(notas) => guardarNotaItem(showNotaPara, notas)}
        />
      )}
    </div>
  );
}

// ============================================================================
// MODAL NOTA / MODIFICADORES POR ITEM
// ============================================================================
function ModalNotaItem({ item, presets, onClose, onSave }: {
  item: Item;
  presets: ModificadorPreset[];
  onClose: () => void;
  onSave: (notas: string | null) => void;
}) {
  // Parsear notas existentes para detectar qué presets ya están aplicados
  const presetNombres = presets.map((p) => p.nombre);
  const partes = (item.notas || '').split('·').map((s) => s.trim()).filter(Boolean);
  const presetsSeleccionadosInit = partes.filter((p) => presetNombres.includes(p));
  const notaLibreInit = partes.filter((p) => !presetNombres.includes(p)).join(' · ');

  const [selected, setSelected] = useState<Set<string>>(new Set(presetsSeleccionadosInit));
  const [notaLibre, setNotaLibre] = useState(notaLibreInit);

  function toggle(nombre: string) {
    const next = new Set(selected);
    if (next.has(nombre)) next.delete(nombre);
    else next.add(nombre);
    setSelected(next);
  }

  function handleGuardar() {
    const partes: string[] = [];
    presets.forEach((p) => { if (selected.has(p.nombre)) partes.push(p.nombre); });
    if (notaLibre.trim()) partes.push(notaLibre.trim());
    onSave(partes.length === 0 ? null : partes.join(' · '));
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 0
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-default)',
        borderTopLeftRadius: 'var(--r-lg)', borderTopRightRadius: 'var(--r-lg)',
        padding: 20, maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto'
      }}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Modificadores / Nota</div>
            <div className="text-muted" style={{ fontSize: 11 }}>{item.producto_nombre}</div>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        {presets.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 8, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Presets rápidos</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {presets.map((p) => {
                const on = selected.has(p.nombre);
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.nombre)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--r-pill)',
                      fontSize: 12,
                      fontWeight: 600,
                      border: `1.5px solid ${on ? 'var(--accent-purple)' : 'var(--border-default)'}`,
                      background: on ? 'rgba(154,111,209,0.2)' : 'var(--bg-elevated)',
                      color: on ? 'var(--accent-purple)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      minHeight: 36
                    }}>
                    {on ? '✓ ' : ''}{p.nombre}
                    {p.precio_extra > 0 && (
                      <span className="text-muted" style={{ marginLeft: 4, fontSize: 10 }}>+{formatUSD(p.precio_extra)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Nota libre</div>
          <textarea className="ki-input" rows={3}
            value={notaLibre} onChange={(e) => setNotaLibre(e.target.value)}
            placeholder="Ej: aparte la salsa, alergia a maní, etc." />
        </div>

        <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
          {item.notas && (
            <button className="btn btn-ghost text-danger" onClick={() => onSave(null)}>Borrar nota</button>
          )}
          <button className="btn btn-kaeru" onClick={handleGuardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MODAL COBRO (con CCF + cliente corporativo)
// ============================================================================
function ModalCobro({ ventaId, totalConIVA, ivaTotal, esPeya, onClose, onCobrado }: {
  ventaId: string; totalConIVA: number; ivaTotal: number; esPeya: boolean;
  onClose: () => void; onCobrado: () => void
}) {
  const [propinaPct, setPropinaPct] = useState(esPeya ? 0 : PROPINA_SUGERIDA_PCT);
  const [metodo, setMetodo] = useState<string>(esPeya ? 'peya' : 'efectivo');
  const [tipoDte, setTipoDte] = useState<'factura' | 'ccf'>('factura');
  const [clientes, setClientes] = useState<ClienteCorp[]>([]);
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [mostrarCrearCliente, setMostrarCrearCliente] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar clientes corporativos solo cuando se cambia a CCF
  useEffect(() => {
    if (tipoDte === 'ccf' && clientes.length === 0) {
      kaeru.from('cliente_corporativo')
        .select('id,nombre_razon_social,nit,nrc')
        .order('ultimo_uso_at', { ascending: false })
        .then(({ data }) => setClientes((data || []) as ClienteCorp[]));
    }
  }, [tipoDte, clientes.length]);

  const clientesFiltrados = useMemo(() => {
    if (!busquedaCliente.trim()) return clientes.slice(0, 8);
    const q = busquedaCliente.toLowerCase();
    return clientes.filter((c) =>
      c.nombre_razon_social.toLowerCase().includes(q) ||
      (c.nit || '').toLowerCase().includes(q) ||
      (c.nrc || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [clientes, busquedaCliente]);

  const propina = +(totalConIVA * propinaPct).toFixed(2);
  const totalFinal = +(totalConIVA + propina).toFixed(2);
  const subtotal = +(totalConIVA - ivaTotal).toFixed(2);

  const puedeCobrar = tipoDte === 'factura' || clienteId !== null;

  async function handleCobrar() {
    if (!puedeCobrar) {
      setError('Para CCF debes seleccionar o crear un cliente corporativo');
      return;
    }
    setSaving(true); setError(null);
    const { error: e } = await kaeru.from('ventas').update({
      estado: 'cerrada',
      subtotal, iva: ivaTotal, propina, total: totalFinal,
      metodo_pago: metodo,
      tipo_dte: tipoDte,
      cliente_corporativo_id: clienteId,
      fecha_hora: new Date().toISOString()
    }).eq('id', ventaId);
    if (e) { setError(e.message); setSaving(false); return; }
    // Bump ultimo_uso del cliente
    if (clienteId) {
      await kaeru.from('cliente_corporativo').update({ ultimo_uso_at: new Date().toISOString() }).eq('id', clienteId);
    }
    onCobrado();
  }

  async function handleCrearCliente(nuevo: { nombre_razon_social: string; nit: string; nrc: string }) {
    const { data, error: e } = await kaeru.from('cliente_corporativo').insert({
      nombre_razon_social: nuevo.nombre_razon_social,
      nit: nuevo.nit || null,
      nrc: nuevo.nrc || null
    }).select('id,nombre_razon_social,nit,nrc').single();
    if (e || !data) { setError(e?.message || 'Error creando cliente'); return; }
    setClientes((prev) => [data as ClienteCorp, ...prev]);
    setClienteId((data as any).id);
    setBusquedaCliente((data as any).nombre_razon_social);
    setMostrarCrearCliente(false);
  }

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto'
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--r-lg)', padding: 24, maxWidth: 520, width: '100%',
        maxHeight: '95vh', overflow: 'auto'
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
          {esPeya ? '🛵 Cobrar orden PeYa' : 'Cobrar'}
        </div>

        <div style={{ background: 'var(--bg-inset)', borderRadius: 'var(--r-md)', padding: 12, marginBottom: 16 }}>
          <div className="row-between"><span className="text-muted" style={{ fontSize: 12 }}>Subtotal</span><span style={{ fontWeight: 600 }}>{formatUSD(subtotal)}</span></div>
          <div className="row-between"><span className="text-muted" style={{ fontSize: 12 }}>IVA 13%</span><span style={{ fontWeight: 600 }}>{formatUSD(ivaTotal)}</span></div>
          <div className="row-between"><span className="text-muted" style={{ fontSize: 12 }}>Total cuenta</span><span style={{ fontWeight: 600 }}>{formatUSD(totalConIVA)}</span></div>
          {propina > 0 && (
            <div className="row-between" style={{ marginTop: 4 }}><span className="text-muted" style={{ fontSize: 12 }}>Propina sugerida</span><span className="text-purple" style={{ fontWeight: 600 }}>{formatUSD(propina)}</span></div>
          )}
          <div className="row-between" style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--border-default)' }}>
            <span className="card-title">A cobrar</span>
            <span style={{ fontFamily: 'var(--font-metric)', fontSize: 28, color: 'var(--accent-kaeru)' }}>{formatUSD(totalFinal)}</span>
          </div>
        </div>

        {/* Tipo de DTE */}
        <div style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Tipo de comprobante</div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" onClick={() => { setTipoDte('factura'); setClienteId(null); }}
              className={`btn ${tipoDte === 'factura' ? 'btn-kaeru' : 'btn-outline'}`}
              style={{ flex: 1, minHeight: 44 }}>
              🧾 Factura
            </button>
            <button type="button" onClick={() => setTipoDte('ccf')}
              className={`btn ${tipoDte === 'ccf' ? 'btn-purple' : 'btn-outline'}`}
              style={{ flex: 1, minHeight: 44, background: tipoDte === 'ccf' ? 'var(--accent-purple)' : 'transparent', color: tipoDte === 'ccf' ? '#fff' : 'var(--text-muted)' }}>
              📋 Crédito Fiscal
            </button>
          </div>
          <div className="text-muted" style={{ fontSize: 10, marginTop: 4 }}>
            {tipoDte === 'factura' ? 'Consumidor final — no requiere datos del cliente' : 'Requiere NIT/NRC del cliente corporativo'}
          </div>
        </div>

        {/* Selector cliente corporativo */}
        {tipoDte === 'ccf' && (
          <div style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Cliente corporativo *</div>
            {mostrarCrearCliente ? (
              <CrearClienteInline
                nombreInit={busquedaCliente}
                onCancel={() => setMostrarCrearCliente(false)}
                onCreado={handleCrearCliente}
              />
            ) : (
              <>
                <input className="ki-input" placeholder="🔍 Buscar por nombre, NIT o NRC..."
                  value={busquedaCliente} onChange={(e) => { setBusquedaCliente(e.target.value); setClienteId(null); }}
                  style={{ marginBottom: 6 }} />
                {!clienteId && busquedaCliente.length > 0 && (
                  <div style={{ background: 'var(--bg-inset)', borderRadius: 'var(--r-md)', padding: 6, maxHeight: 200, overflow: 'auto' }}>
                    {clientesFiltrados.length === 0 ? (
                      <div className="text-muted" style={{ fontSize: 11, padding: 6 }}>Sin resultados</div>
                    ) : clientesFiltrados.map((c) => (
                      <button key={c.id} type="button"
                        onClick={() => { setClienteId(c.id); setBusquedaCliente(c.nombre_razon_social); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '6px 8px', background: 'transparent', border: 'none',
                          color: 'var(--text-primary)', cursor: 'pointer',
                          borderRadius: 4, fontSize: 12
                        }}>
                        <div style={{ fontWeight: 600 }}>{c.nombre_razon_social}</div>
                        <div className="text-muted" style={{ fontSize: 10 }}>NIT {c.nit || '—'} · NRC {c.nrc || '—'}</div>
                      </button>
                    ))}
                    <button type="button" onClick={() => setMostrarCrearCliente(true)}
                      className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 6 }}>
                      + Nuevo cliente "{busquedaCliente}"
                    </button>
                  </div>
                )}
                {clienteId && (
                  <div style={{ fontSize: 11, color: 'var(--accent-kaeru)', marginTop: 4 }}>
                    ✓ Cliente seleccionado
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Propina */}
        {!esPeya && (
          <div style={{ marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 6 }}>Propina</div>
            <div className="row" style={{ gap: 6 }}>
              {[0, 0.05, 0.10, 0.15, 0.20].map((p) => (
                <button key={p} type="button" onClick={() => setPropinaPct(p)}
                  style={{
                    flex: 1, minHeight: 40,
                    background: propinaPct === p ? 'var(--accent-purple)' : 'transparent',
                    color: propinaPct === p ? '#fff' : 'var(--text-muted)',
                    border: `1px solid ${propinaPct === p ? 'var(--accent-purple)' : 'var(--border-default)'}`,
                    borderRadius: 'var(--r-md)', cursor: 'pointer', fontWeight: 600
                  }}>
                  {(p * 100).toFixed(0)}%
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Método de pago */}
        <div style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>Método de pago</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {[
              { v: 'efectivo', l: '💵 Efectivo', show: !esPeya },
              { v: 'tarjeta_pos_bac', l: '💳 Tarjeta BAC', show: !esPeya },
              { v: 'transferencia', l: '🏦 Transfer', show: !esPeya },
              { v: 'peya', l: '🛵 PeYa', show: true }
            ].filter((m) => m.show).map((m) => (
              <button key={m.v} type="button" onClick={() => setMetodo(m.v)}
                className={`btn ${metodo === m.v ? 'btn-kaeru' : 'btn-outline'}`}
                style={{ padding: '14px 12px', fontSize: 13, minHeight: 48 }}>{m.l}</button>
            ))}
          </div>
        </div>

        {error && <div className="text-danger" style={{ fontSize: 11, marginBottom: 12 }}>{error}</div>}

        <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-kaeru" onClick={handleCobrar} disabled={saving || !puedeCobrar}>
            {saving ? 'Cobrando…' : `✓ Cerrar venta ${formatUSD(totalFinal)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CREAR CLIENTE INLINE (dentro del modal de cobro)
// ============================================================================
function CrearClienteInline({ nombreInit, onCancel, onCreado }: {
  nombreInit: string;
  onCancel: () => void;
  onCreado: (datos: { nombre_razon_social: string; nit: string; nrc: string }) => void;
}) {
  const [nombre, setNombre] = useState(nombreInit);
  const [nit, setNit] = useState('');
  const [nrc, setNrc] = useState('');
  const [busy, setBusy] = useState(false);

  function handleCrear() {
    if (!nombre.trim()) return;
    setBusy(true);
    onCreado({ nombre_razon_social: nombre.trim(), nit: nit.trim(), nrc: nrc.trim() });
  }

  return (
    <div style={{ background: 'var(--bg-inset)', borderRadius: 'var(--r-md)', padding: 10 }}>
      <div className="text-muted" style={{ fontSize: 11, marginBottom: 6 }}>Nuevo cliente corporativo</div>
      <input className="ki-input" placeholder="Razón social *"
        value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ marginBottom: 6 }} autoFocus />
      <div className="row" style={{ gap: 6, marginBottom: 6 }}>
        <input className="ki-input" placeholder="NIT" value={nit} onChange={(e) => setNit(e.target.value)} style={{ flex: 1 }} />
        <input className="ki-input" placeholder="NRC" value={nrc} onChange={(e) => setNrc(e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button className="btn btn-kaeru btn-sm" onClick={handleCrear} disabled={busy || !nombre.trim()}>
          {busy ? '...' : '+ Crear'}
        </button>
      </div>
    </div>
  );
}
