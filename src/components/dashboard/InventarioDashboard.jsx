import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES } from '../../config';

/* ─── helpers ─── */
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const clamp = (v) => Math.max(0, Math.min(100, v));

/* Status classification */
const classify = (item) => {
  const { stock_actual: s, stock_minimo: min, stock_maximo: max } = item;
  if (!min || min === 0) return 'sin_min';        // no threshold set
  if (s <= 0) return 'agotado';                    // out of stock
  if (s < min * 0.5) return 'critico';             // < 50% of min
  if (s < min) return 'bajo';                      // below min
  if (max && s > max * 1.2) return 'exceso';       // > 120% of max
  return 'ok';                                      // healthy
};

const STATUS_META = {
  agotado:  { label: 'Agotado',     color: '#ef4444', bg: '#450a0a', icon: '🔴', order: 0 },
  critico:  { label: 'Crítico',     color: '#f97316', bg: '#431407', icon: '🟠', order: 1 },
  bajo:     { label: 'Bajo mín',    color: '#facc15', bg: '#422006', icon: '🟡', order: 2 },
  ok:       { label: 'OK',          color: '#4ade80', bg: '#052e16', icon: '🟢', order: 3 },
  exceso:   { label: 'Exceso',      color: '#60a5fa', bg: '#172554', icon: '🔵', order: 4 },
  sin_min:  { label: 'Sin umbral',  color: '#888',    bg: '#1a1a1a', icon: '⚪', order: 5 },
};

/* ─── Bar component ─── */
function StatusBar({ counts, total }) {
  if (!total) return null;
  const order = ['agotado', 'critico', 'bajo', 'ok', 'exceso', 'sin_min'];
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#222' }}>
      {order.map(key => {
        const w = pct(counts[key] || 0, total);
        if (!w) return null;
        return <div key={key} style={{ width: `${w}%`, background: STATUS_META[key].color, transition: 'width .3s' }} />;
      })}
    </div>
  );
}

/* ─── Location card ─── */
// Labels for merged locations
const MERGE_LABELS = { S003: '(incluye Drive Thru)' };

function LocationCard({ name, storeCode, items, onSelect, selected }) {
  const counts = {};
  for (const it of items) { const s = classify(it); counts[s] = (counts[s] || 0) + 1; }
  const total = items.length;
  const alertas = (counts.agotado || 0) + (counts.critico || 0) + (counts.bajo || 0);

  return (
    <div
      onClick={() => onSelect(storeCode)}
      className="card"
      style={{
        padding: '14px 16px', cursor: 'pointer', transition: 'all .2s',
        borderColor: selected ? '#e63946' : alertas > 0 ? '#7c2d12' : '#2a2a2a',
        background: selected ? '#1a0a0a' : '#111',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#f0f0f0' }}>{name}</div>
          {MERGE_LABELS[storeCode] && <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>{MERGE_LABELS[storeCode]}</div>}
          <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{total} productos registrados</div>
        </div>
        {alertas > 0 ? (
          <div style={{ background: '#7c2d12', color: '#fb923c', padding: '4px 10px', borderRadius: 8, fontWeight: 700, fontSize: 13 }}>
            {alertas} ⚠️
          </div>
        ) : (
          <div style={{ background: '#052e16', color: '#4ade80', padding: '4px 10px', borderRadius: 8, fontWeight: 700, fontSize: 12 }}>
            ✓ OK
          </div>
        )}
      </div>

      <StatusBar counts={counts} total={total} />

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {['agotado', 'critico', 'bajo', 'ok', 'exceso', 'sin_min'].map(key => {
          const c = counts[key] || 0;
          if (!c) return null;
          const m = STATUS_META[key];
          return (
            <span key={key} style={{ fontSize: 11, color: m.color, background: m.bg, padding: '2px 8px', borderRadius: 6, fontWeight: 600 }}>
              {m.icon} {c}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Detail view ─── */
function DetailView({ storeCode, storeName, items, onClose }) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('todas');
  const [statusFilter, setStatusFilter] = useState('todos');

  const enriched = useMemo(() =>
    items.map(it => ({ ...it, _status: classify(it) }))
      .sort((a, b) => STATUS_META[a._status].order - STATUS_META[b._status].order),
    [items]);

  const categorias = useMemo(() => {
    const cats = new Set(items.map(i => i.catalogo_productos?.categoria).filter(Boolean));
    return ['todas', ...Array.from(cats).sort()];
  }, [items]);

  const filtered = useMemo(() => {
    let list = enriched;
    if (statusFilter !== 'todos') list = list.filter(i => i._status === statusFilter);
    if (catFilter !== 'todas') list = list.filter(i => i.catalogo_productos?.categoria === catFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => i.catalogo_productos?.nombre?.toLowerCase().includes(q) || i.catalogo_productos?.categoria?.toLowerCase().includes(q));
    }
    return list;
  }, [enriched, search, catFilter, statusFilter]);

  const counts = {};
  for (const it of enriched) { counts[it._status] = (counts[it._status] || 0) + 1; }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#e63946' }}>{storeName}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{enriched.length} productos · {storeCode}</div>
        </div>
        <button onClick={onClose} style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          ← Volver
        </button>
      </div>

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button
          onClick={() => setStatusFilter('todos')}
          style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid #333', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: statusFilter === 'todos' ? '#e63946' : '#1a1a1a', color: statusFilter === 'todos' ? '#fff' : '#888'
          }}
        >
          Todos ({enriched.length})
        </button>
        {['agotado', 'critico', 'bajo', 'ok', 'exceso', 'sin_min'].map(key => {
          const c = counts[key] || 0;
          if (!c) return null;
          const m = STATUS_META[key];
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(statusFilter === key ? 'todos' : key)}
              style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${statusFilter === key ? m.color : '#333'}`,
                background: statusFilter === key ? m.bg : '#1a1a1a',
                color: statusFilter === key ? m.color : '#888'
              }}
            >
              {m.icon} {m.label} ({c})
            </button>
          );
        })}
      </div>

      {/* Search + category */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text" placeholder="🔍 Buscar producto..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 2, padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13 }}
        />
        <select
          value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ flex: 1, padding: '10px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }}
        >
          {categorias.map(c => <option key={c} value={c}>{c === 'todas' ? 'Categoría' : c}</option>)}
        </select>
      </div>

      {/* Results count */}
      <div style={{ fontSize: 12, color: '#555', marginBottom: 8 }}>{filtered.length} producto(s)</div>

      {/* Product list */}
      {filtered.map(it => {
        const name = it.catalogo_productos?.nombre || 'Producto';
        const cat = it.catalogo_productos?.categoria || '';
        const unit = it.catalogo_productos?.unidad_medida || 'unid';
        const m = STATUS_META[it._status];
        const fillPct = it.stock_maximo ? clamp(pct(it.stock_actual, it.stock_maximo)) : null;

        return (
          <div key={it.id} className="card" style={{ padding: '12px 14px', borderColor: it._status === 'ok' ? '#2a2a2a' : m.color + '44' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#f0f0f0' }}>{name}</div>
                <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>{cat} · {unit}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: m.color }}>{it.stock_actual || 0}</div>
                <span style={{ fontSize: 10, color: m.color, background: m.bg, padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                  {m.icon} {m.label}
                </span>
              </div>
            </div>

            {/* Mini level bar */}
            {fillPct !== null && (
              <div style={{ height: 6, borderRadius: 3, background: '#222', marginBottom: 6, overflow: 'hidden', position: 'relative' }}>
                {/* Min line */}
                {it.stock_minimo > 0 && it.stock_maximo > 0 && (
                  <div style={{
                    position: 'absolute', left: `${clamp(pct(it.stock_minimo, it.stock_maximo))}%`,
                    top: 0, bottom: 0, width: 2, background: '#facc15', zIndex: 2, opacity: 0.7
                  }} />
                )}
                <div style={{ height: '100%', width: `${fillPct}%`, background: m.color, borderRadius: 3, transition: 'width .3s' }} />
              </div>
            )}

            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#555' }}>
              <span>Mín: <strong style={{ color: '#facc15' }}>{it.stock_minimo || '—'}</strong></span>
              <span>Máx: <strong style={{ color: '#60a5fa' }}>{it.stock_maximo || '—'}</strong></span>
              {fillPct !== null && <span>Nivel: <strong style={{ color: m.color }}>{fillPct}%</strong></span>}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 14 }}>No se encontraron productos con este filtro</div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  MAIN DASHBOARD                             */
/* ═══════════════════════════════════════════ */
// S005 (Driver Thru Lourdes) shares kitchen/inventory with S003 (Lourdes)
const MERGE_MAP = { S005: 'S003' };
// Sucursales to always show (bodega) even without sales
const ALWAYS_SHOW = ['CM001'];

export default function InventarioDashboard({ user, onBack }) {
  const [loading, setLoading] = useState(true);
  const [sucursales, setSucursales] = useState([]);
  const [allInv, setAllInv] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeCodes, setActiveCodes] = useState(new Set());

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data: sucs } = await db.from('sucursales').select('id, nombre, store_code').eq('activa', true).order('nombre');
      if (!sucs) { setLoading(false); return; }
      setSucursales(sucs);

      // Determine which store_codes have actual sales (= operational)
      const { data: salesData } = await db.from('ventas_diarias')
        .select('store_code')
        .limit(1000);
      const codesWithSales = new Set((salesData || []).map(r => r.store_code));
      // Also include ALWAYS_SHOW codes
      ALWAYS_SHOW.forEach(c => codesWithSales.add(c));
      setActiveCodes(codesWithSales);

      // Load ALL inventory in one query
      const { data: inv, error } = await db.from('inventario')
        .select('id, sucursal_id, producto_id, stock_actual, stock_minimo, stock_maximo, catalogo_productos(nombre, categoria, unidad_medida)')
        .order('stock_actual', { ascending: true });
      if (error) throw error;
      setAllInv(inv || []);
    } catch (e) {
      console.error('Error loading inventory dashboard:', e);
    } finally {
      setLoading(false);
    }
  };

  // Group inventory by sucursal, merging Driver Thru into Lourdes
  const bySucursal = useMemo(() => {
    const map = {};
    // Only create entries for active sucursales (with sales or in ALWAYS_SHOW), excluding merged ones
    for (const suc of sucursales) {
      const code = suc.store_code;
      if (MERGE_MAP[code]) continue; // skip merged sucursales (e.g. S005)
      if (!activeCodes.has(code)) continue; // skip sucursales without sales
      map[code] = { ...suc, items: [] };
    }
    // Assign inventory items, merging where needed
    for (const it of allInv) {
      const suc = sucursales.find(s => s.id === it.sucursal_id);
      if (!suc) continue;
      const targetCode = MERGE_MAP[suc.store_code] || suc.store_code;
      if (map[targetCode]) map[targetCode].items.push(it);
    }
    return map;
  }, [sucursales, allInv, activeCodes]);

  // Global summary (only count items in visible locations)
  const visibleItems = useMemo(() => {
    const items = [];
    for (const loc of Object.values(bySucursal)) items.push(...loc.items);
    return items;
  }, [bySucursal]);

  const globalStats = useMemo(() => {
    const counts = { agotado: 0, critico: 0, bajo: 0, ok: 0, exceso: 0, sin_min: 0 };
    for (const it of visibleItems) { counts[classify(it)]++; }
    return counts;
  }, [visibleItems]);

  const totalAlertas = globalStats.agotado + globalStats.critico + globalStats.bajo;

  if (loading) return (
    <div style={{ minHeight: '100vh', padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spin" />
    </div>
  );

  // Detail view for selected location
  if (selected && bySucursal[selected]) {
    const loc = bySucursal[selected];
    return (
      <div style={{ minHeight: '100vh', padding: '0 16px 60px' }}>
        <DetailView
          storeCode={selected}
          storeName={loc.nombre}
          items={loc.items}
          onClose={() => setSelected(null)}
        />
      </div>
    );
  }

  // Sort locations: most alerts first
  const sortedLocs = Object.entries(bySucursal).sort((a, b) => {
    const alertsA = a[1].items.filter(i => ['agotado', 'critico', 'bajo'].includes(classify(i))).length;
    const alertsB = b[1].items.filter(i => ['agotado', 'critico', 'bajo'].includes(classify(i))).length;
    return alertsB - alertsA;
  });

  return (
    <div style={{ minHeight: '100vh', padding: '0 16px 60px' }}>
      {/* Header */}
      <div style={{ padding: '20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>📦 Inventario Global</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{sucursales.length} ubicaciones · {allInv.length} registros</div>
        </div>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#fff' }}>✕</button>
      </div>

      {/* Global summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
        <div style={{ padding: '14px 10px', background: totalAlertas > 0 ? '#450a0a' : '#052e16', borderRadius: 10, textAlign: 'center', border: `1px solid ${totalAlertas > 0 ? '#7c2d12' : '#166534'}` }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: totalAlertas > 0 ? '#ef4444' : '#4ade80' }}>{totalAlertas}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Alertas</div>
        </div>
        <div style={{ padding: '14px 10px', background: '#052e16', borderRadius: 10, textAlign: 'center', border: '1px solid #166534' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#4ade80' }}>{globalStats.ok}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>OK</div>
        </div>
        <div style={{ padding: '14px 10px', background: '#1a1a1a', borderRadius: 10, textAlign: 'center', border: '1px solid #333' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{allInv.length}</div>
          <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Total</div>
        </div>
      </div>

      {/* Global status bar */}
      <div style={{ marginBottom: 8 }}>
        <StatusBar counts={globalStats} total={allInv.length} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['agotado', 'critico', 'bajo', 'ok', 'exceso', 'sin_min'].map(key => {
          const c = globalStats[key];
          if (!c) return null;
          const m = STATUS_META[key];
          return (
            <span key={key} style={{ fontSize: 11, color: m.color, fontWeight: 600 }}>
              {m.icon} {c} {m.label}
            </span>
          );
        })}
      </div>

      {/* Locations */}
      <div style={{ fontWeight: 700, fontSize: 14, color: '#888', marginBottom: 10 }}>
        📍 POR UBICACIÓN
      </div>

      {sortedLocs.map(([code, loc]) => (
        <LocationCard
          key={code}
          storeCode={code}
          name={loc.nombre}
          items={loc.items}
          onSelect={setSelected}
          selected={selected === code}
        />
      ))}

      {/* Legend */}
      <div className="card" style={{ marginTop: 16, padding: '12px 14px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#888', marginBottom: 8 }}>LEYENDA</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {Object.entries(STATUS_META).map(([key, m]) => (
            <div key={key} style={{ fontSize: 11, color: m.color }}>
              {m.icon} <strong>{m.label}</strong> — {
                key === 'agotado' ? 'stock = 0' :
                key === 'critico' ? '< 50% del mín' :
                key === 'bajo' ? '< mínimo' :
                key === 'ok' ? 'entre mín y máx' :
                key === 'exceso' ? '> 120% del máx' :
                'sin umbral definido'
              }
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
