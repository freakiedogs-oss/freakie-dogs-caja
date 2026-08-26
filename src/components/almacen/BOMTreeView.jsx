import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

const C = {
  bg: '#0a0a0a', card: '#111', border: '#1e1e1e', panel: '#161616',
  text: '#f0f0f0', dim: '#777', muted: '#555',
  green: '#4ade80', red: '#e63946', yellow: '#fbbf24', blue: '#60a5fa',
  orange: '#fb923c', purple: '#a78bfa', teal: '#2dd4bf',
};
const money = v => v == null ? '—' : `$${Number(v).toFixed(2)}`;
const pct = v => v == null ? '—' : `${Number(v).toFixed(1)}%`;

export default function BOMTreeView() {
  const [items, setItems] = useState(null);
  const [fichas, setFichas] = useState({});
  const [expanded, setExpanded] = useState({});
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [stats, setStats] = useState(null);

  const cargar = useCallback(async () => {
    const { data } = await db.rpc('mapeo_menu_lista');
    setItems(data || []);
    const completos = (data || []).filter(r => r.estado === 'completo').length;
    const sinMapear = (data || []).filter(r => r.estado === 'sin_mapear').length;
    const sinReceta = (data || []).filter(r => r.estado === 'receta_vacia').length;
    const noConf = (data || []).filter(r => r.producto_id && !r.confiable).length;
    setStats({ total: (data || []).length, completos, sinMapear, sinReceta, noConf });
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const toggleItem = async (menuItemId) => {
    if (expanded[menuItemId]) {
      setExpanded(prev => { const n = { ...prev }; delete n[menuItemId]; return n; });
      return;
    }
    setExpanded(prev => ({ ...prev, [menuItemId]: true }));
    if (!fichas[menuItemId]) {
      const { data } = await db.rpc('ficha_menu_item', { p_menu_item_id: menuItemId });
      setFichas(prev => ({ ...prev, [menuItemId]: data }));
    }
  };

  if (!items) return <div style={{ padding: 24, color: C.dim }}>Cargando BOM…</div>;

  const vista = items.filter(r => {
    if (q && !r.nombre?.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'todos') return true;
    if (filtro === 'no_confiable') return r.producto_id && !r.confiable;
    return r.estado === filtro;
  });

  return (
    <div style={{ color: C.text }}>
      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 16 }}>
          <StatCard label="Total" value={stats.total} color={C.text} />
          <StatCard label="Completos" value={stats.completos} color={C.green} />
          <StatCard label="Sin mapear" value={stats.sinMapear} color={C.dim} />
          <StatCard label="Sin receta" value={stats.sinReceta} color={C.yellow} />
          <StatCard label="No confiable" value={stats.noConf} color={C.red} />
        </div>
      )}

      {/* Search + Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar platillo…"
          style={{ flex: '1 1 200px', minWidth: 160, background: C.panel, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '10px 14px', color: C.text, fontSize: 13, outline: 'none' }} />
        <button onClick={cargar} style={{ ...btnStyle, background: C.panel }}>↻</button>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          ['todos', 'Todos'], ['completo', 'Completos'], ['sin_mapear', 'Sin mapear'],
          ['receta_vacia', 'Sin receta'], ['no_confiable', 'No confiables'],
        ].map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            style={{ padding: '6px 14px', borderRadius: 20, border: 'none', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all .15s',
              background: filtro === k ? C.red : C.panel, color: filtro === k ? '#fff' : C.dim }}>
            {l}
          </button>
        ))}
      </div>

      {/* Items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vista.map(item => (
          <MenuItemCard key={item.menu_item_id} item={item}
            isOpen={!!expanded[item.menu_item_id]}
            ficha={fichas[item.menu_item_id]}
            onToggle={() => toggleItem(item.menu_item_id)} />
        ))}
        {vista.length === 0 && (
          <div style={{ textAlign: 'center', color: C.dim, padding: 40 }}>Sin platillos para este filtro.</div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '10px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: C.dim, fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function MenuItemCard({ item, isOpen, ficha, onToggle }) {
  const margenColor = item.margen_pct == null ? C.dim
    : item.margen_pct < 30 ? C.red : item.margen_pct < 50 ? C.yellow : C.green;
  const noConfiable = item.producto_id && !item.confiable;

  return (
    <div style={{ background: C.card, border: `1px solid ${noConfiable ? C.red + '60' : C.border}`,
      borderRadius: 14, overflow: 'hidden', transition: 'border-color .2s' }}>
      {/* Header */}
      <button onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
          color: C.text, textAlign: 'left' }}>
        <div style={{ fontSize: 11, color: isOpen ? C.blue : C.dim, transition: 'transform .2s',
          transform: isOpen ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>▶</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
            {item.nombre}
            {noConfiable && <span style={{ color: C.red, fontSize: 10, marginLeft: 8 }}>⚠ revisar</span>}
          </div>
          <div style={{ fontSize: 11, color: C.dim }}>
            {money(item.precio)}
            {item.receta_nombre ? ` · receta: ${item.receta_nombre}` : ' · sin receta'}
            {item.n_ing ? ` · ${item.n_ing} ing` : ''}
            {' · '}{(item.canales || []).length} canal(es)
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.dim }}>
            costo {money(item.costo)}
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, color: margenColor }}>
            margen {pct(item.margen_pct)}
          </div>
        </div>
      </button>

      {/* BOM Tree */}
      {isOpen && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 16px', background: C.bg }}>
          {!ficha ? (
            <div style={{ color: C.dim, fontSize: 12, padding: 8 }}>Cargando árbol…</div>
          ) : ficha.error ? (
            <div style={{ color: C.red, fontSize: 12, padding: 8 }}>{ficha.error}</div>
          ) : ficha.estado === 'sin_mapear' ? (
            <div style={{ color: C.dim, fontSize: 12, padding: 8 }}>
              Sin mapear — enlazá desde la pestaña Menú (BOM).
            </div>
          ) : (
            <div>
              {/* Recipe summary bar */}
              <div style={{ display: 'flex', gap: 16, padding: '8px 12px', marginBottom: 8,
                background: C.panel, borderRadius: 10, fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: C.dim }}>Receta: <b style={{ color: C.text }}>{ficha.receta_nombre}</b></span>
                <span style={{ color: C.dim }}>Costo: <b style={{ color: C.orange }}>{money(ficha.costo)}</b></span>
                <span style={{ color: C.dim }}>Precio: <b style={{ color: C.text }}>{money(ficha.precio)}</b></span>
                <span style={{ color: C.dim }}>Margen: <b style={{ color: margenColor }}>{pct(ficha.margen_pct)}</b></span>
              </div>
              {/* Tree */}
              {(ficha.arbol || []).length === 0 ? (
                <div style={{ color: C.yellow, fontSize: 12, padding: 8 }}>
                  Receta sin ingredientes — agregalos en Recetas.
                </div>
              ) : (
                <div>{(ficha.arbol || []).map((n, i) => (
                  <TreeNode key={i} node={n} depth={0} parentCost={ficha.costo} />
                ))}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, depth, parentCost }) {
  const [open, setOpen] = useState(depth < 2);
  const isSub = node.tipo === 'sub_receta';
  const hijos = node.hijos || [];
  const costPct = parentCost > 0 ? (node.costo / parentCost * 100) : 0;

  const nodeColor = isSub ? C.blue : C.text;
  const icon = isSub ? '⚙️' : '🥩';
  const indent = depth * 20;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
        marginLeft: indent, borderBottom: `1px solid ${C.border}20`, position: 'relative' }}>
        {/* Tree connector line */}
        {depth > 0 && (
          <div style={{ position: 'absolute', left: -12, top: 0, bottom: 0, width: 1,
            background: C.border }} />
        )}

        {/* Expand/collapse or bullet */}
        {isSub ? (
          <button onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: C.blue, fontSize: 10, width: 16, flexShrink: 0 }}>
            {open ? '▼' : '▶'}
          </button>
        ) : (
          <span style={{ width: 16, textAlign: 'center', color: C.muted, fontSize: 8, flexShrink: 0 }}>●</span>
        )}

        {/* Icon + Name */}
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ color: nodeColor, fontWeight: isSub ? 700 : 400, fontSize: 13,
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.nombre}
        </span>

        {/* Quantity + unit */}
        <span style={{ color: C.dim, fontSize: 11, flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
          {Number(node.cantidad)} {node.unidad || ''}
        </span>

        {/* DTE badge (materia prima only) */}
        {node.tipo === 'materia_prima' && (
          <span style={{ fontSize: 10, fontWeight: 700, flexShrink: 0, minWidth: 55, textAlign: 'center',
            padding: '2px 6px', borderRadius: 6,
            color: node.mapeado_dte ? C.green : C.red,
            background: node.mapeado_dte ? C.green + '15' : C.red + '15' }}>
            {node.mapeado_dte ? '✔ DTE' : '⚠ sin'}
          </span>
        )}

        {/* Cost bar + value */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minWidth: 100, justifyContent: 'flex-end' }}>
          {costPct > 0 && (
            <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(costPct, 100)}%`, height: '100%', borderRadius: 2,
                background: costPct > 40 ? C.red : costPct > 15 ? C.orange : C.green }} />
            </div>
          )}
          <span style={{ color: node.costo > 0 ? C.orange : C.muted, fontSize: 12, fontWeight: 600,
            minWidth: 48, textAlign: 'right' }}>
            {money(node.costo)}
          </span>
        </div>
      </div>

      {/* Children */}
      {isSub && open && hijos.map((h, i) => (
        <TreeNode key={i} node={h} depth={depth + 1} parentCost={parentCost} />
      ))}
    </div>
  );
}

const btnStyle = { border: 'none', borderRadius: 10, padding: '10px 14px', color: C.dim,
  cursor: 'pointer', fontSize: 13, fontWeight: 600 };
