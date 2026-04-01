import { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabase';
import { STORES } from '../../config';
import { useToast } from '../../hooks/useToast';

export default function StockLevelsView({ user, onBack }) {
  const { show, Toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [store, setStore] = useState(user.store_code || 'M001');
  const [busqueda, setBusqueda] = useState('');
  const [catFilter, setCatFilter] = useState('todas');
  const [soloSinMin, setSoloSinMin] = useState(false);
  const [edited, setEdited] = useState({});

  const isAdmin = user.rol === 'admin' || user.rol === 'ejecutivo';
  const stores = isAdmin
    ? Object.entries(STORES).filter(([k]) => k !== 'CM001')
    : [[user.store_code, STORES[user.store_code] || user.store_code]];

  useEffect(() => { loadData(); }, [store]);

  const loadData = async () => {
    setLoading(true);
    setEdited({});
    try {
      const { data: suc } = await db.from('sucursales').select('id').eq('store_code', store).maybeSingle();
      if (!suc) { show('❌ Sucursal no encontrada'); setLoading(false); return; }

      const { data, error } = await db.from('inventario')
        .select('id, producto_id, stock_actual, stock_minimo, stock_maximo, catalogo_productos(nombre, categoria, unidad_medida)')
        .eq('sucursal_id', suc.id)
        .order('stock_minimo', { ascending: true });
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      show('❌ Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const categorias = useMemo(() => {
    const cats = new Set(items.map(i => i.catalogo_productos?.categoria).filter(Boolean));
    return ['todas', ...Array.from(cats).sort()];
  }, [items]);

  const filtrado = useMemo(() => {
    let list = items;
    if (soloSinMin) list = list.filter(i => !i.stock_minimo || i.stock_minimo === 0);
    if (catFilter !== 'todas') list = list.filter(i => i.catalogo_productos?.categoria === catFilter);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      list = list.filter(i => i.catalogo_productos?.nombre?.toLowerCase().includes(q));
    }
    return list;
  }, [items, busqueda, catFilter, soloSinMin]);

  const editCount = Object.keys(edited).length;

  const updateField = (id, field, value) => {
    const val = Math.max(0, parseFloat(value) || 0);
    setEdited(prev => {
      const curr = prev[id] || {};
      return { ...prev, [id]: { ...curr, [field]: val } };
    });
  };

  const guardar = async () => {
    if (!editCount) { show('⚠️ No hay cambios'); return; }
    setSaving(true);
    try {
      let ok = 0;
      for (const [id, changes] of Object.entries(edited)) {
        const { error } = await db.from('inventario').update(changes).eq('id', id);
        if (error) throw error;
        ok++;
      }
      show(`✅ ${ok} producto(s) actualizados`);
      setEdited({});
      loadData();
    } catch (e) {
      show('❌ Error guardando: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const aplicarPromedios = async () => {
    setSaving(true);
    try {
      const { data: suc } = await db.from('sucursales').select('id').eq('store_code', store).maybeSingle();
      if (!suc) throw new Error('Sucursal no encontrada');

      // Get averages from all other stores that have data
      const { data: avgs, error: avgErr } = await db.rpc('get_stock_averages_for_store', { p_sucursal_id: suc.id });

      // Fallback: do it client-side if RPC doesn't exist
      if (avgErr) {
        // Get all inventario from other stores with stock_minimo > 0
        const { data: allInv } = await db.from('inventario')
          .select('producto_id, stock_minimo, stock_maximo, sucursal_id')
          .gt('stock_minimo', 0)
          .neq('sucursal_id', suc.id);

        if (!allInv?.length) { show('⚠️ No hay datos de referencia'); setSaving(false); return; }

        // Calculate averages per product
        const grouped = {};
        for (const row of allInv) {
          if (!grouped[row.producto_id]) grouped[row.producto_id] = { mins: [], maxs: [] };
          grouped[row.producto_id].mins.push(row.stock_minimo);
          grouped[row.producto_id].maxs.push(row.stock_maximo);
        }

        // Apply to items that have 0 stock_minimo in this store
        const sinMin = items.filter(i => !i.stock_minimo || i.stock_minimo === 0);
        let applied = 0;
        for (const item of sinMin) {
          const g = grouped[item.producto_id];
          if (!g) continue;
          const avgMin = Math.round(g.mins.reduce((a, b) => a + b, 0) / g.mins.length);
          const avgMax = Math.round(g.maxs.reduce((a, b) => a + b, 0) / g.maxs.length);
          const { error } = await db.from('inventario')
            .update({ stock_minimo: avgMin, stock_maximo: avgMax })
            .eq('id', item.id);
          if (error) throw error;
          applied++;
        }
        show(`✅ ${applied} producto(s) actualizados con promedios`);
        loadData();
      }
    } catch (e) {
      show('❌ Error: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const getVal = (item, field) => {
    if (edited[item.id] && edited[item.id][field] !== undefined) return edited[item.id][field];
    return item[field] || 0;
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spin" />
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', padding: '0 16px 120px' }}>
      <Toast />

      {/* Header */}
      <div style={{ padding: '20px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>📊 Stock Mín / Máx</div>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#fff' }}>✕</button>
      </div>

      {/* Store selector */}
      {stores.length > 1 && (
        <select
          value={store}
          onChange={e => setStore(e.target.value)}
          className="field"
          style={{ width: '100%', marginBottom: 12, padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14 }}
        >
          {stores.map(([code, name]) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      )}

      {/* Search + filters */}
      <input
        type="text"
        placeholder="Buscar producto..."
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14, marginBottom: 8 }}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 12 }}
        >
          {categorias.map(c => (
            <option key={c} value={c}>{c === 'todas' ? 'Todas las categorías' : c}</option>
          ))}
        </select>
        <button
          onClick={() => setSoloSinMin(!soloSinMin)}
          style={{
            padding: '8px 12px', borderRadius: 8, border: '1px solid #333', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: soloSinMin ? '#7c2d12' : '#1a1a1a', color: soloSinMin ? '#fb923c' : '#888'
          }}
        >
          ⚠️ Sin mínimo ({items.filter(i => !i.stock_minimo || i.stock_minimo === 0).length})
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1, padding: '10px 12px', background: '#0a2e1a', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#4ade80' }}>{items.filter(i => i.stock_minimo > 0).length}</div>
          <div style={{ fontSize: 10, color: '#888' }}>Con mín</div>
        </div>
        <div style={{ flex: 1, padding: '10px 12px', background: '#2e1a0a', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#fb923c' }}>{items.filter(i => !i.stock_minimo || i.stock_minimo === 0).length}</div>
          <div style={{ fontSize: 10, color: '#888' }}>Sin mín</div>
        </div>
        <div style={{ flex: 1, padding: '10px 12px', background: '#1a1a2e', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#60a5fa' }}>{items.length}</div>
          <div style={{ fontSize: 10, color: '#888' }}>Total</div>
        </div>
      </div>

      {/* Auto-fill button for items missing min */}
      {items.some(i => !i.stock_minimo || i.stock_minimo === 0) && isAdmin && (
        <button
          onClick={aplicarPromedios}
          disabled={saving}
          style={{
            width: '100%', padding: '12px 14px', marginBottom: 16, borderRadius: 10,
            background: '#1e3a5f', border: '1px solid #2563eb', color: '#60a5fa',
            fontSize: 13, fontWeight: 700, cursor: 'pointer'
          }}
        >
          {saving ? 'Aplicando...' : '🔄 Auto-llenar desde promedios de otras sucursales'}
        </button>
      )}

      {/* Product list */}
      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
        {filtrado.length} productos | {editCount > 0 && <span style={{ color: '#f59e0b' }}>{editCount} editado(s)</span>}
      </div>

      {filtrado.map(item => {
        const name = item.catalogo_productos?.nombre || 'Producto';
        const cat = item.catalogo_productos?.categoria || '';
        const unit = item.catalogo_productos?.unidad_medida || '';
        const minVal = getVal(item, 'stock_minimo');
        const maxVal = getVal(item, 'stock_maximo');
        const isEdited = !!edited[item.id];
        const noMin = !item.stock_minimo || item.stock_minimo === 0;

        return (
          <div
            key={item.id}
            style={{
              marginBottom: 10, padding: '12px 14px', borderRadius: 10,
              background: isEdited ? '#1a2e1a' : noMin ? '#1a1208' : '#1a1a1a',
              border: `1px solid ${isEdited ? '#166534' : noMin ? '#713f12' : '#2a2a2a'}`
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f0f0' }}>{name}</div>
                <div style={{ fontSize: 11, color: '#666' }}>{cat} · {unit} · Stock: {item.stock_actual || 0}</div>
              </div>
              {noMin && <span style={{ fontSize: 10, background: '#7c2d12', color: '#fb923c', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>Sin mín</span>}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 3 }}>Mínimo</label>
                <input
                  type="number"
                  value={minVal}
                  onChange={e => updateField(item.id, 'stock_minimo', e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', background: '#0a0a0a', border: '1px solid #333',
                    borderRadius: 6, color: '#fff', fontSize: 14, textAlign: 'center'
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: '#888', display: 'block', marginBottom: 3 }}>Máximo</label>
                <input
                  type="number"
                  value={maxVal}
                  onChange={e => updateField(item.id, 'stock_maximo', e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', background: '#0a0a0a', border: '1px solid #333',
                    borderRadius: 6, color: '#fff', fontSize: 14, textAlign: 'center'
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}

      {filtrado.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#666' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 14 }}>No se encontraron productos</div>
        </div>
      )}

      {/* Sticky save button */}
      {editCount > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          padding: '12px 16px', background: 'linear-gradient(transparent, #0a0a0a 20%)',
          zIndex: 50
        }}>
          <button
            onClick={guardar}
            disabled={saving}
            className="btn btn-red"
            style={{ width: '100%', fontSize: 15, padding: 16 }}
          >
            {saving ? 'Guardando...' : `💾 Guardar ${editCount} cambio(s)`}
          </button>
        </div>
      )}
    </div>
  );
}
