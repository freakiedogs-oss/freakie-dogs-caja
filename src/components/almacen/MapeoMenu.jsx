import { useState, useEffect, useCallback } from 'react';
import { db } from '../../supabase';

// ── MAPEO MENÚ → RECETA → SUB-RECETA → MP → DTE ───────────────────────
// Herramienta para dejar mapeado el ciclo completo, item por item del menú
// del POS. Cada platillo se enlaza a una receta (o a un producto directo,
// p.ej. bebidas BEES). El árbol BOM (ficha técnica) muestra hasta la MP y
// si cada MP tiene costo/DTE de compra. Al mapear, la venta empieza a
// descontar inventario automáticamente (POSMain → pos_deducir_inventario),
// por eso cada fila muestra su confiabilidad: NO mapees recetas malas.
// Reutiliza receta_costo_total / costo_producto / kardex (no duplica costeo).

const C = { card:'#1a1a1a', border:'#2a2a2a', text:'#f0f0f0', dim:'#8a8a8a',
  green:'#4ade80', red:'#e63946', yellow:'#fbbf24', blue:'#60a5fa', panel:'#141414' };
const money = (v) => v == null ? '—' : `$${Number(v).toFixed(2)}`;
const pct = (v) => v == null ? '—' : `${Number(v).toFixed(1)}%`;

const ESTADOS = {
  sin_mapear:   { label:'Sin mapear',   color:C.dim,    bg:'#2a2a2a' },
  directo:      { label:'Directo/BEES', color:C.blue,   bg:'#1e3a5f' },
  receta_vacia: { label:'Receta vacía', color:C.yellow, bg:'#3a2f0f' },
  completo:     { label:'Completo',     color:C.green,  bg:'#123020' },
};

const FILTROS = [
  { id:'todos', label:'Todos' },
  { id:'sin_mapear', label:'Sin mapear' },
  { id:'receta_vacia', label:'Receta vacía' },
  { id:'directo', label:'Directo/BEES' },
  { id:'completo', label:'Completos' },
  { id:'no_confiable', label:'⚠️ No confiables' },
];

export default function MapeoMenu({ user }) {
  const [cob, setCob] = useState(null);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('todos');
  const [expandido, setExpandido] = useState(null);   // menu_item_id
  const [ficha, setFicha] = useState(null);
  const [enlazar, setEnlazar] = useState(null);        // fila en edición
  const [busy, setBusy] = useState(false);

  const cargar = useCallback(async () => {
    const [{ data: c }, { data: l }] = await Promise.all([
      db.rpc('cobertura_menu'),
      db.rpc('mapeo_menu_lista'),
    ]);
    setCob(c || {});
    setRows(l || []);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const verFicha = async (fila) => {
    if (expandido === fila.menu_item_id) { setExpandido(null); setFicha(null); return; }
    setExpandido(fila.menu_item_id); setFicha(null);
    const { data } = await db.rpc('ficha_menu_item', { p_menu_item_id: fila.menu_item_id });
    setFicha(data || null);
  };

  const autoEnlazar = async () => {
    if (!confirm('Auto-enlazar los platillos cuyo nombre coincide EXACTO con una receta (plato/combo). Solo enlaza; podés revisar y corregir después. ¿Continuar?')) return;
    setBusy(true);
    const { data } = await db.rpc('mapear_menu_auto');
    setBusy(false);
    alert(`Enlazados: ${data?.enlazados ?? 0} platillos.`);
    cargar();
  };

  const desmapear = async (fila) => {
    if (!confirm(`Quitar el mapeo de "${fila.nombre}"? Dejará de descontar inventario al venderse.`)) return;
    setBusy(true);
    await db.rpc('desmapear_menu_item', { p_menu_item_id: fila.menu_item_id });
    setBusy(false);
    cargar();
  };

  if (!rows) return <div style={{ padding:24, color:C.dim }}>Cargando menú…</div>;

  const vista = rows.filter(r => {
    if (q && !r.nombre?.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'todos') return true;
    if (filtro === 'no_confiable') return r.producto_id && !r.confiable;
    return r.estado === filtro;
  });

  const total = cob?.total_platillos || rows.length;
  const completos = cob?.completos || 0;
  const progreso = total ? Math.round(completos / total * 100) : 0;

  return (
    <div style={{ color:C.text }}>
      {/* Cobertura */}
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        <Kpi label="Platillos" value={total} color={C.text} />
        <Kpi label="Sin mapear" value={cob?.sin_mapear ?? 0} color={C.dim} />
        <Kpi label="Receta vacía" value={cob?.receta_vacia ?? 0} color={C.yellow} />
        <Kpi label="Directo/BEES" value={cob?.directo ?? 0} color={C.blue} />
        <Kpi label="Completos" value={completos} color={C.green} />
      </div>
      <div style={{ height:8, background:'#2a2a2a', borderRadius:6, overflow:'hidden', marginBottom:4 }}>
        <div style={{ width:`${progreso}%`, height:'100%', background:C.green, transition:'width .3s' }} />
      </div>
      <div style={{ fontSize:11, color:C.dim, marginBottom:12 }}>
        {progreso}% del menú con ciclo completo (menú → receta → MP). Mapear un platillo lo enlaza en los
        {' '}5 canales a la vez. ⚠️ Al mapear, la venta empieza a descontar inventario — revisá que la receta sea confiable.
      </div>

      {/* Toolbar */}
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:10, flexWrap:'wrap' }}>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar platillo…"
          style={{ flex:'1 1 200px', minWidth:160, background:C.panel, border:`1px solid ${C.border}`,
                   borderRadius:8, padding:'8px 12px', color:C.text, fontSize:13 }} />
        <button onClick={autoEnlazar} disabled={busy}
          style={{ background:'#333', color:C.text, border:'none', borderRadius:8, padding:'8px 12px',
                   fontWeight:700, cursor:'pointer', fontSize:12 }}>⚡ Auto-enlazar exactos</button>
        <button onClick={cargar} style={{ background:'#333', color:C.text, border:'none', borderRadius:8, padding:'8px 12px', cursor:'pointer' }}>↻</button>
      </div>
      <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
        {FILTROS.map(f => (
          <button key={f.id} onClick={()=>setFiltro(f.id)}
            style={{ padding:'5px 10px', borderRadius:16, border:'none', cursor:'pointer', fontSize:11, fontWeight:600,
                     background: filtro===f.id ? C.red : '#222', color: filtro===f.id ? '#fff' : '#888' }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {vista.map(r => {
          const est = ESTADOS[r.estado] || ESTADOS.sin_mapear;
          const abierto = expandido === r.menu_item_id;
          const alerta = r.producto_id && !r.confiable;
          return (
            <div key={r.menu_item_id} style={{ background:C.card, border:`1px solid ${alerta ? C.red : C.border}`, borderRadius:10 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', flexWrap:'wrap' }}>
                <div style={{ flex:'1 1 200px', minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>{r.nombre}
                    {alerta && <span title="Costo implausible: revisá rendimiento/ingredientes" style={{ color:C.red, fontSize:11, marginLeft:6 }}>⚠️ revisar receta</span>}
                  </div>
                  <div style={{ fontSize:11, color:C.dim }}>
                    {money(r.precio)} · {r.receta_nombre ? `receta: ${r.receta_nombre}` : 'sin receta'}
                    {r.n_ing ? ` · ${r.n_ing} ing` : ''} · {(r.canales||[]).length} canal(es)
                  </div>
                </div>
                <div style={{ textAlign:'right', fontSize:12, minWidth:90 }}>
                  <div style={{ color:C.dim }}>costo {money(r.costo)}</div>
                  <div style={{ color: r.margen_pct==null ? C.dim : r.margen_pct<15 ? C.red : r.margen_pct<30 ? C.yellow : C.green, fontWeight:700 }}>
                    margen {pct(r.margen_pct)}
                  </div>
                </div>
                <span style={{ fontSize:11, fontWeight:700, color:est.color, background:est.bg, padding:'3px 8px', borderRadius:12 }}>{est.label}</span>
                <button onClick={()=>verFicha(r)} style={btn(abierto)}>{abierto ? '▾ ficha' : '▸ ficha'}</button>
                <button onClick={()=>setEnlazar(r)} style={btn(false)}>{r.producto_id ? 'Reenlazar' : 'Enlazar'}</button>
                {r.producto_id && <button onClick={()=>desmapear(r)} style={{ ...btn(false), color:C.red }}>✕</button>}
              </div>
              {abierto && (
                <div style={{ borderTop:`1px solid ${C.border}`, padding:'10px 14px', background:C.panel }}>
                  {!ficha ? <div style={{ color:C.dim, fontSize:12 }}>Cargando ficha…</div> : <Ficha ficha={ficha} />}
                </div>
              )}
            </div>
          );
        })}
        {vista.length === 0 && <div style={{ color:C.dim, textAlign:'center', padding:24 }}>Sin platillos para este filtro.</div>}
      </div>

      {enlazar && <EnlazarModal fila={enlazar} onClose={()=>setEnlazar(null)} onDone={()=>{ setEnlazar(null); cargar(); }} />}
    </div>
  );
}

// ── Ficha técnica: árbol BOM recursivo ────────────────────────────────
function Ficha({ ficha }) {
  if (ficha.error) return <div style={{ color:C.red }}>{ficha.error}</div>;
  if (ficha.estado === 'sin_mapear')
    return <div style={{ color:C.dim, fontSize:12 }}>Este platillo aún no está enlazado a una receta ni a un producto. Usá <b>Enlazar</b>.</div>;
  const arbol = ficha.arbol || [];
  return (
    <div>
      <div style={{ fontSize:12, color:C.dim, marginBottom:8 }}>
        {ficha.receta_nombre ? `Receta: ${ficha.receta_nombre}` : 'Producto directo'} ·
        {' '}costo {money(ficha.costo)} · precio {money(ficha.precio)} · margen {pct(ficha.margen_pct)}
      </div>
      {arbol.length === 0
        ? <div style={{ color:C.yellow, fontSize:12 }}>Receta sin ingredientes — agregalos en la pestaña Recetas.</div>
        : <div style={{ display:'flex', flexDirection:'column', gap:3 }}>{arbol.map((n,i)=><Nodo key={i} n={n} depth={0} />)}</div>}
    </div>
  );
}

function Nodo({ n, depth }) {
  const [open, setOpen] = useState(depth < 1);
  const esSub = n.tipo === 'sub_receta';
  const hijos = n.hijos || [];
  return (
    <div style={{ marginLeft: depth*14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, padding:'2px 0' }}>
        {esSub
          ? <button onClick={()=>setOpen(o=>!o)} style={{ background:'none', border:'none', color:C.blue, cursor:'pointer', fontSize:11, padding:0 }}>{open?'▾':'▸'}</button>
          : <span style={{ color:C.dim, width:11, display:'inline-block' }}>·</span>}
        <span style={{ color: esSub ? C.blue : C.text, fontWeight: esSub ? 700 : 400 }}>
          {esSub ? '🧩 ' : '🥩 '}{n.nombre}
        </span>
        <span style={{ color:C.dim }}>{Number(n.cantidad)} {n.unidad || ''}</span>
        <div style={{ flex:1 }} />
        {n.tipo === 'materia_prima' && (
          n.mapeado_dte
            ? <span style={{ color:C.green, fontSize:10 }}>✔ DTE</span>
            : <span style={{ color:C.red, fontSize:10 }}>⚠ sin costo/DTE</span>
        )}
        <span style={{ color:C.dim, minWidth:56, textAlign:'right' }}>{money(n.costo)}</span>
      </div>
      {esSub && open && hijos.map((h,i)=><Nodo key={i} n={h} depth={depth+1} />)}
    </div>
  );
}

// ── Modal de enlace: receta o producto directo (BEES) ────────────────
function EnlazarModal({ fila, onClose, onDone }) {
  const [modo, setModo] = useState('receta');
  const [q, setQ] = useState('');
  const [recetas, setRecetas] = useState([]);
  const [prods, setProds] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    db.from('recetas').select('id,nombre,tipo,costo_calculado').eq('activo', true)
      .order('nombre').then(({ data }) => setRecetas(data || []));
  }, []);
  useEffect(() => {
    if (modo !== 'producto' || q.length < 2) { setProds([]); return; }
    const t = setTimeout(() => {
      db.from('catalogo_productos').select('id,nombre,tipo').ilike('nombre', `%${q}%`)
        .limit(25).then(({ data }) => setProds(data || []));
    }, 250);
    return () => clearTimeout(t);
  }, [q, modo]);

  const pickReceta = async (r) => {
    setBusy(true);
    const { data } = await db.rpc('mapear_menu_item', { p_menu_item_id: fila.menu_item_id, p_receta_id: r.id });
    setBusy(false);
    if (data?.ok) onDone(); else alert('Error: ' + (data?.error || 'no se pudo enlazar'));
  };
  const pickProducto = async (p) => {
    setBusy(true);
    const { data } = await db.rpc('mapear_menu_item_producto', { p_menu_item_id: fila.menu_item_id, p_producto_id: p.id });
    setBusy(false);
    if (data?.ok) onDone(); else alert('Error: ' + (data?.error || 'no se pudo enlazar'));
  };

  const recetasF = recetas.filter(r => !q || r.nombre.toLowerCase().includes(q.toLowerCase()));

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:50,
        display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14,
          width:'100%', maxWidth:520, maxHeight:'80vh', display:'flex', flexDirection:'column', color:C.text }}>
        <div style={{ padding:'14px 16px', borderBottom:`1px solid ${C.border}` }}>
          <div style={{ fontWeight:800, fontSize:15 }}>Enlazar «{fila.nombre}»</div>
          <div style={{ fontSize:11, color:C.dim }}>Se aplica a los {(fila.canales||[]).length} canales con este nombre.</div>
        </div>
        <div style={{ display:'flex', gap:6, padding:'10px 16px 0' }}>
          {[['receta','🍔 A una receta'],['producto','🥤 Producto directo (BEES/bebida)']].map(([id,l])=>(
            <button key={id} onClick={()=>setModo(id)} style={{ padding:'6px 10px', borderRadius:8, border:'none',
                cursor:'pointer', fontSize:12, fontWeight:700, background: modo===id ? C.red : '#222', color: modo===id ? '#fff' : '#888' }}>{l}</button>
          ))}
        </div>
        <div style={{ padding:'10px 16px' }}>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)}
            placeholder={modo==='receta' ? 'Buscar receta…' : 'Buscar producto (min 2 letras)…'}
            style={{ width:'100%', background:C.panel, border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', color:C.text, fontSize:13 }} />
        </div>
        <div style={{ overflowY:'auto', padding:'0 16px 16px', flex:1 }}>
          {modo === 'receta' ? (
            recetasF.length === 0 ? <Empty t="Sin recetas. Creala primero en la pestaña Recetas." /> :
            recetasF.map(r => (
              <Item key={r.id} onClick={()=>!busy && pickReceta(r)}
                nombre={r.nombre} sub={`${r.tipo}${r.costo_calculado?` · costo $${Number(r.costo_calculado).toFixed(2)}`:''}`} />
            ))
          ) : (
            q.length < 2 ? <Empty t="Escribí para buscar el producto de compra (ej. Coca-Cola)." /> :
            prods.length === 0 ? <Empty t="Sin resultados." /> :
            prods.map(p => (
              <Item key={p.id} onClick={()=>!busy && pickProducto(p)} nombre={p.nombre} sub={p.tipo} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const Item = ({ nombre, sub, onClick }) => (
  <button onClick={onClick} style={{ width:'100%', textAlign:'left', background:C.panel, border:`1px solid ${C.border}`,
      borderRadius:8, padding:'8px 12px', marginBottom:6, cursor:'pointer', color:C.text }}>
    <div style={{ fontWeight:600, fontSize:13 }}>{nombre}</div>
    <div style={{ fontSize:11, color:C.dim }}>{sub}</div>
  </button>
);
const Empty = ({ t }) => <div style={{ color:C.dim, fontSize:12, textAlign:'center', padding:20 }}>{t}</div>;
const Kpi = ({ label, value, color }) => (
  <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'8px 14px', minWidth:78, textAlign:'center' }}>
    <div style={{ fontSize:20, fontWeight:800, color }}>{value}</div>
    <div style={{ fontSize:10, color:C.dim }}>{label}</div>
  </div>
);
const btn = (active) => ({ background: active ? '#333' : '#222', color:'#ccc', border:'none', borderRadius:8,
  padding:'6px 10px', cursor:'pointer', fontSize:11, fontWeight:600, whiteSpace:'nowrap' });
