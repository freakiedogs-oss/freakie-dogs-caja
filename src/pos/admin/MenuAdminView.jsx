import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'

/* ── Paleta eye-efficient ── */
const C = {
  bg: '#141418', surface: '#1c1c22', card: '#1e1e26',
  accent: '#ff6b35', teal: '#2dd4a8', text: '#e8e6ef',
  muted: '#8b8997', border: '#2a2a32', danger: '#f87171',
}

const TABS = [
  { key: 'categorias', label: '📂 Categorías' },
  { key: 'items',      label: '🍔 Ítems' },
  { key: 'grupos',     label: '⚙️ Grupos Modificadores' },
  { key: 'asignar',    label: '🔗 Asignar a Ítems' },
]

/* ── Helpers ── */
const toast = (msg, ok = true) => {
  const d = document.createElement('div')
  d.textContent = msg
  Object.assign(d.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: ok ? C.teal : C.danger, color: ok ? '#0d2818' : '#fff',
    padding: '10px 20px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
    zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,.4)',
  })
  document.body.appendChild(d)
  setTimeout(() => d.remove(), 2200)
}

/* ================================================================
   MenuAdminView — CRUD completo para menú POS
   Tabs: Categorías | Ítems | Grupos Modificadores | Asignar a Ítems
   ================================================================ */
export default function MenuAdminView({ user, storeCode, onBack }) {
  const [tab, setTab] = useState('categorias')
  const [menuId, setMenuId] = useState(null)
  const [menus, setMenus] = useState([])
  const [loading, setLoading] = useState(true)

  // Load menus for this store (two-step: resolve sucursal_id first)
  useEffect(() => {
    const load = async () => {
      // Step 1: get sucursal UUID from store_code
      const { data: suc } = await db
        .from('sucursales')
        .select('id')
        .eq('store_code', storeCode)
        .single()

      let menusData = []
      if (suc?.id) {
        // Step 2: get menus for this sucursal
        const { data } = await db
          .from('pos_menus')
          .select('id, nombre, canal, activo, sucursal_id')
          .eq('sucursal_id', suc.id)
          .order('nombre')
        menusData = data || []
      }

      // Fallback: if no menus found for this store, show ALL menus (admin convenience)
      if (menusData.length === 0) {
        const { data } = await db
          .from('pos_menus')
          .select('id, nombre, canal, activo, sucursal_id, sucursales(store_code, nombre)')
          .eq('activo', true)
          .order('nombre')
        menusData = (data || []).map(m => ({
          ...m,
          _label: `${m.nombre} (${m.canal}) — ${m.sucursales?.nombre || m.sucursales?.store_code || '?'}`
        }))
      }

      setMenus(menusData)
      if (menusData.length) setMenuId(menusData[0].id)
      setLoading(false)
    }
    load()
  }, [storeCode])

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spin" style={{ width: 28, height: 28 }} />
    </div>
  )

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      {/* Header */}
      <div className="pos-header">
        <button className="pos-header-btn" onClick={onBack}>← Volver</button>
        <img src="/icon-192.png" className="pos-header-logo" alt="" />
        <span className="pos-header-brand">Admin Menú</span>
        <span className="pos-header-store">{storeCode}</span>
        <div className="pos-header-sep" />
        {/* Menu selector */}
        {menus.length > 0 && (
          <select
            value={menuId || ''}
            onChange={e => setMenuId(e.target.value)}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
          >
            {menus.map(m => <option key={m.id} value={m.id}>{m._label || `${m.nombre} (${m.canal})`}</option>)}
          </select>
        )}
        <span className="pos-header-user">{user?.nombre?.split(' ')[0]}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1, padding: '12px 8px', border: 'none', cursor: 'pointer',
              background: tab === t.key ? C.card : 'transparent',
              color: tab === t.key ? C.accent : C.muted,
              fontWeight: tab === t.key ? 700 : 500, fontSize: 13,
              borderBottom: tab === t.key ? `2px solid ${C.accent}` : '2px solid transparent',
              transition: 'all .15s',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
        {!menuId ? (
          <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>
            No hay menús configurados para {storeCode}
          </div>
        ) : (
          <>
            {tab === 'categorias' && <CategoriasTab menuId={menuId} />}
            {tab === 'items' && <ItemsTab menuId={menuId} />}
            {tab === 'grupos' && <GruposTab />}
            {tab === 'asignar' && <AsignarTab menuId={menuId} />}
          </>
        )}
      </div>
    </div>
  )
}

/* ================================================================
   TAB 1: Categorías — CRUD + reorder
   ================================================================ */
function CategoriasTab({ menuId }) {
  const [cats, setCats] = useState([])
  const [loading, setLoading] = useState(true)
  const [editCat, setEditCat] = useState(null) // null = list, {} = new, {id} = edit

  const load = useCallback(async () => {
    const { data } = await db
      .from('pos_menu_categorias')
      .select('*')
      .eq('menu_id', menuId)
      .order('orden')
    setCats(data || [])
    setLoading(false)
  }, [menuId])

  useEffect(() => { setLoading(true); load() }, [load])

  const handleSave = async (cat) => {
    const payload = { menu_id: menuId, nombre: cat.nombre, color: cat.color || '#FF6B35', icono: cat.icono || '', orden: cat.orden ?? cats.length, activo: cat.activo ?? true }
    if (cat.id) {
      const { error } = await db.from('pos_menu_categorias').update(payload).eq('id', cat.id)
      if (error) { toast('Error: ' + error.message, false); return }
      toast('Categoría actualizada')
    } else {
      const { error } = await db.from('pos_menu_categorias').insert([payload])
      if (error) { toast('Error: ' + error.message, false); return }
      toast('Categoría creada')
    }
    setEditCat(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar categoría? Los ítems quedarán sin categoría.')) return
    const { error } = await db.from('pos_menu_categorias').delete().eq('id', id)
    if (error) { toast('Error: ' + error.message, false); return }
    toast('Categoría eliminada')
    load()
  }

  const handleMove = async (idx, dir) => {
    const arr = [...cats]
    const target = idx + dir
    if (target < 0 || target >= arr.length) return
    ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
    // Update orden for both
    await db.from('pos_menu_categorias').update({ orden: idx }).eq('id', arr[idx].id)
    await db.from('pos_menu_categorias').update({ orden: target }).eq('id', arr[target].id)
    load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>

  if (editCat !== null) {
    return <CatForm cat={editCat} onSave={handleSave} onCancel={() => setEditCat(null)} />
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Categorías ({cats.length})</div>
        <button onClick={() => setEditCat({})} style={btnStyle(C.accent, '#0d2818')}>+ Nueva categoría</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cats.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: c.color || C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
              {c.icono || '📂'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{c.nombre}</div>
              <div style={{ fontSize: 11, color: C.muted }}>Orden: {c.orden} · {c.activo ? '✅ Activa' : '⛔ Inactiva'}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => handleMove(i, -1)} style={smallBtn}>▲</button>
              <button onClick={() => handleMove(i, 1)} style={smallBtn}>▼</button>
              <button onClick={() => setEditCat(c)} style={smallBtn}>✏️</button>
              <button onClick={() => handleDelete(c.id)} style={{ ...smallBtn, color: C.danger }}>🗑️</button>
            </div>
          </div>
        ))}
        {cats.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: C.muted }}>Sin categorías. Crea la primera.</div>}
      </div>
    </div>
  )
}

function CatForm({ cat, onSave, onCancel }) {
  const [f, setF] = useState({ nombre: cat.nombre || '', color: cat.color || '#FF6B35', icono: cat.icono || '', orden: cat.orden ?? 0, activo: cat.activo ?? true })
  const upd = (k, v) => setF(p => ({ ...p, [k]: v }))

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{cat.id ? 'Editar' : 'Nueva'} Categoría</div>
      <label style={labelStyle}>Nombre</label>
      <input value={f.nombre} onChange={e => upd('nombre', e.target.value)} style={inputStyle} placeholder="Ej: Smash Burgers" autoFocus />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>Color</label>
          <input type="color" value={f.color} onChange={e => upd('color', e.target.value)} style={{ ...inputStyle, height: 40, padding: 4, cursor: 'pointer' }} />
        </div>
        <div>
          <label style={labelStyle}>Ícono (emoji)</label>
          <input value={f.icono} onChange={e => upd('icono', e.target.value)} style={inputStyle} placeholder="🍔" />
        </div>
        <div>
          <label style={labelStyle}>Orden</label>
          <input type="number" value={f.orden} onChange={e => upd('orden', +e.target.value)} style={inputStyle} />
        </div>
      </div>
      <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.activo} onChange={e => upd('activo', e.target.checked)} /> Activa
      </label>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={() => onSave({ ...cat, ...f })} disabled={!f.nombre.trim()} style={btnStyle(C.teal, '#0d2818')}>💾 Guardar</button>
        <button onClick={onCancel} style={btnStyle(C.border, C.muted)}>Cancelar</button>
      </div>
    </div>
  )
}

/* ================================================================
   TAB 2: Ítems — CRUD with category filter
   ================================================================ */
function ItemsTab({ menuId }) {
  const [items, setItems] = useState([])
  const [cats, setCats] = useState([])
  const [filterCat, setFilterCat] = useState('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [editItem, setEditItem] = useState(null)

  const load = useCallback(async () => {
    const [{ data: itemsData }, { data: catsData }] = await Promise.all([
      db.from('pos_menu_items').select('*').eq('menu_id', menuId).order('orden'),
      db.from('pos_menu_categorias').select('id, nombre, orden').eq('menu_id', menuId).order('orden'),
    ])
    setItems(itemsData || [])
    setCats(catsData || [])
    setLoading(false)
  }, [menuId])

  useEffect(() => { setLoading(true); load() }, [load])

  const filtered = items.filter(i => {
    if (filterCat !== 'all' && i.categoria_id !== filterCat) return false
    if (search && !i.nombre.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleSave = async (item) => {
    const payload = {
      menu_id: menuId, categoria_id: item.categoria_id, nombre: item.nombre,
      nombre_corto: item.nombre_corto || '', descripcion: item.descripcion || '',
      precio: parseFloat(item.precio) || 0, precio_combo: item.precio_combo ? parseFloat(item.precio_combo) : null,
      disponible: item.disponible ?? true, orden: item.orden ?? items.length,
      requiere_preparacion: item.requiere_preparacion ?? true,
      tiempo_preparacion_min: parseInt(item.tiempo_preparacion_min) || null,
      estacion: item.estacion || null,
      imagen_url: item.imagen_url || null,
    }
    if (item.id) {
      const { error } = await db.from('pos_menu_items').update(payload).eq('id', item.id)
      if (error) { toast('Error: ' + error.message, false); return }
      toast('Ítem actualizado')
    } else {
      const { error } = await db.from('pos_menu_items').insert([payload])
      if (error) { toast('Error: ' + error.message, false); return }
      toast('Ítem creado')
    }
    setEditItem(null)
    load()
  }

  const handleToggle = async (item) => {
    await db.from('pos_menu_items').update({ disponible: !item.disponible }).eq('id', item.id)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar este ítem del menú?')) return
    const { error } = await db.from('pos_menu_items').delete().eq('id', id)
    if (error) { toast('Error: ' + error.message, false); return }
    toast('Ítem eliminado')
    load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>

  if (editItem !== null) {
    return <ItemForm item={editItem} cats={cats} onSave={handleSave} onCancel={() => setEditItem(null)} />
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Ítems ({filtered.length}/{items.length})</div>
        <button onClick={() => setEditItem({})} style={btnStyle(C.accent, '#0d2818')}>+ Nuevo ítem</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar ítem..."
          style={{ ...inputStyle, flex: 1, minWidth: 160 }}
        />
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...inputStyle, minWidth: 140 }}>
          <option value="all">Todas las categorías</option>
          {cats.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </div>

      {/* Items grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
        {filtered.map(item => {
          const cat = cats.find(c => c.id === item.categoria_id)
          return (
            <div key={item.id} style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12,
              opacity: item.disponible ? 1 : 0.5,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.nombre}</div>
                  {item.nombre_corto && <div style={{ fontSize: 11, color: C.muted }}>({item.nombre_corto})</div>}
                </div>
                <div style={{ fontWeight: 700, color: C.teal, fontSize: 15 }}>${parseFloat(item.precio).toFixed(2)}</div>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
                {cat?.nombre || '—'} · Orden {item.orden}
                {item.estacion && ` · 🔧 ${item.estacion}`}
                {item.precio_combo && ` · Combo $${parseFloat(item.precio_combo).toFixed(2)}`}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => handleToggle(item)} style={{ ...smallBtn, background: item.disponible ? '#0d2818' : '#2a1a1a', color: item.disponible ? C.teal : C.danger, fontSize: 11 }}>
                  {item.disponible ? '✅ Disponible' : '⛔ No disponible'}
                </button>
                <button onClick={() => setEditItem(item)} style={smallBtn}>✏️</button>
                <button onClick={() => handleDelete(item.id)} style={{ ...smallBtn, color: C.danger }}>🗑️</button>
              </div>
            </div>
          )
        })}
      </div>
      {filtered.length === 0 && <div style={{ textAlign: 'center', padding: 24, color: C.muted }}>Sin ítems{filterCat !== 'all' ? ' en esta categoría' : ''}.</div>}
    </div>
  )
}

function ItemForm({ item, cats, onSave, onCancel }) {
  const [f, setF] = useState({
    nombre: item.nombre || '', nombre_corto: item.nombre_corto || '', descripcion: item.descripcion || '',
    precio: item.precio ?? '', precio_combo: item.precio_combo ?? '',
    categoria_id: item.categoria_id || (cats[0]?.id || ''),
    disponible: item.disponible ?? true, orden: item.orden ?? 0,
    requiere_preparacion: item.requiere_preparacion ?? true,
    tiempo_preparacion_min: item.tiempo_preparacion_min ?? '',
    estacion: item.estacion || '', imagen_url: item.imagen_url || '',
  })
  const upd = (k, v) => setF(p => ({ ...p, [k]: v }))

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{item.id ? 'Editar' : 'Nuevo'} Ítem</div>

      <label style={labelStyle}>Nombre *</label>
      <input value={f.nombre} onChange={e => upd('nombre', e.target.value)} style={inputStyle} placeholder="Ej: Smash Classic" autoFocus />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>Nombre corto (ticket)</label>
          <input value={f.nombre_corto} onChange={e => upd('nombre_corto', e.target.value)} style={inputStyle} placeholder="S. Classic" />
        </div>
        <div>
          <label style={labelStyle}>Categoría *</label>
          <select value={f.categoria_id} onChange={e => upd('categoria_id', e.target.value)} style={inputStyle}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>Precio ($) *</label>
          <input type="number" step="0.01" value={f.precio} onChange={e => upd('precio', e.target.value)} style={inputStyle} placeholder="4.50" />
        </div>
        <div>
          <label style={labelStyle}>Precio combo ($)</label>
          <input type="number" step="0.01" value={f.precio_combo} onChange={e => upd('precio_combo', e.target.value)} style={inputStyle} placeholder="7.99" />
        </div>
        <div>
          <label style={labelStyle}>Orden</label>
          <input type="number" value={f.orden} onChange={e => upd('orden', +e.target.value)} style={inputStyle} />
        </div>
      </div>

      <label style={labelStyle}>Descripción</label>
      <textarea value={f.descripcion} onChange={e => upd('descripcion', e.target.value)} style={{ ...inputStyle, minHeight: 56, resize: 'vertical' }} placeholder="Descripción opcional..." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>Estación (cocina)</label>
          <select value={f.estacion} onChange={e => upd('estacion', e.target.value)} style={inputStyle}>
            <option value="">— Sin estación —</option>
            <option value="plancha">Plancha</option>
            <option value="freidora">Freidora</option>
            <option value="bebidas">Bebidas</option>
            <option value="postres">Postres</option>
            <option value="barra">Barra</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Tiempo prep. (min)</label>
          <input type="number" value={f.tiempo_preparacion_min} onChange={e => upd('tiempo_preparacion_min', e.target.value)} style={inputStyle} placeholder="5" />
        </div>
      </div>

      <label style={labelStyle}>URL imagen</label>
      <input value={f.imagen_url} onChange={e => upd('imagen_url', e.target.value)} style={inputStyle} placeholder="https://..." />

      <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.disponible} onChange={e => upd('disponible', e.target.checked)} /> Disponible
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.requiere_preparacion} onChange={e => upd('requiere_preparacion', e.target.checked)} /> Requiere preparación
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={() => onSave({ ...item, ...f })} disabled={!f.nombre.trim() || !f.precio} style={btnStyle(C.teal, '#0d2818')}>💾 Guardar</button>
        <button onClick={onCancel} style={btnStyle(C.border, C.muted)}>Cancelar</button>
      </div>
    </div>
  )
}

/* ================================================================
   TAB 3: Grupos Modificadores — CRUD grupos + sus opciones
   ================================================================ */
function GruposTab() {
  const [grupos, setGrupos] = useState([])
  const [loading, setLoading] = useState(true)
  const [editGrupo, setEditGrupo] = useState(null) // null=list, {}=new, {id}=edit
  const [editMods, setEditMods] = useState(null)   // grupo id → edit mods

  const load = useCallback(async () => {
    const { data } = await db
      .from('pos_modificadores_grupo')
      .select('*, pos_modificadores(id, nombre, nombre_corto, precio_extra, orden, activo)')
      .order('orden')
    setGrupos(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaveGrupo = async (g) => {
    const payload = { nombre: g.nombre, tipo: g.tipo || 'checkbox', obligatorio: g.obligatorio ?? false, min_selecciones: parseInt(g.min_selecciones) || 0, max_selecciones: parseInt(g.max_selecciones) || 0, orden: g.orden ?? grupos.length, activo: g.activo ?? true }
    if (g.id) {
      const { error } = await db.from('pos_modificadores_grupo').update(payload).eq('id', g.id)
      if (error) { toast('Error: ' + error.message, false); return }
      toast('Grupo actualizado')
    } else {
      const { error } = await db.from('pos_modificadores_grupo').insert([payload])
      if (error) { toast('Error: ' + error.message, false); return }
      toast('Grupo creado')
    }
    setEditGrupo(null)
    load()
  }

  const handleDeleteGrupo = async (id) => {
    if (!confirm('¿Eliminar grupo y todas sus opciones?')) return
    // Delete mods first, then grupo
    await db.from('pos_item_modificadores').delete().eq('grupo_id', id)
    await db.from('pos_modificadores').delete().eq('grupo_id', id)
    const { error } = await db.from('pos_modificadores_grupo').delete().eq('id', id)
    if (error) { toast('Error: ' + error.message, false); return }
    toast('Grupo eliminado')
    load()
  }

  const handleSaveMod = async (grupoId, mod) => {
    const payload = { grupo_id: grupoId, nombre: mod.nombre, nombre_corto: mod.nombre_corto || '', precio_extra: parseFloat(mod.precio_extra) || 0, orden: mod.orden ?? 0, activo: mod.activo ?? true }
    if (mod.id) {
      const { error } = await db.from('pos_modificadores').update(payload).eq('id', mod.id)
      if (error) { toast('Error: ' + error.message, false); return }
    } else {
      const { error } = await db.from('pos_modificadores').insert([payload])
      if (error) { toast('Error: ' + error.message, false); return }
    }
    toast('Modificador guardado')
    load()
  }

  const handleDeleteMod = async (modId) => {
    if (!confirm('¿Eliminar modificador?')) return
    await db.from('pos_modificadores').delete().eq('id', modId)
    toast('Modificador eliminado')
    load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>

  if (editGrupo !== null) {
    return <GrupoForm grupo={editGrupo} onSave={handleSaveGrupo} onCancel={() => setEditGrupo(null)} />
  }

  if (editMods !== null) {
    const grupo = grupos.find(g => g.id === editMods)
    if (!grupo) { setEditMods(null); return null }
    return <ModsEditor grupo={grupo} onSaveMod={handleSaveMod} onDeleteMod={handleDeleteMod} onBack={() => { setEditMods(null); load() }} />
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Grupos Modificadores ({grupos.length})</div>
        <button onClick={() => setEditGrupo({})} style={btnStyle(C.accent, '#0d2818')}>+ Nuevo grupo</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {grupos.map(g => {
          const mods = g.pos_modificadores || []
          return (
            <div key={g.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {g.nombre}
                    <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>
                      {g.tipo} · {g.obligatorio ? 'Obligatorio' : 'Opcional'}
                      {g.max_selecciones > 0 && ` · Max ${g.max_selecciones}`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                    {mods.length === 0 ? 'Sin opciones aún' : mods.map(m =>
                      <span key={m.id} style={{ display: 'inline-block', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px', marginRight: 4, marginBottom: 2, fontSize: 11 }}>
                        {m.nombre} {m.precio_extra > 0 && <span style={{ color: C.teal }}>+${m.precio_extra.toFixed(2)}</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                  <button onClick={() => setEditMods(g.id)} style={smallBtn} title="Editar opciones">📋</button>
                  <button onClick={() => setEditGrupo(g)} style={smallBtn}>✏️</button>
                  <button onClick={() => handleDeleteGrupo(g.id)} style={{ ...smallBtn, color: C.danger }}>🗑️</button>
                </div>
              </div>
            </div>
          )
        })}
        {grupos.length === 0 && (
          <div style={{ textAlign: 'center', padding: 24, color: C.muted }}>
            Sin grupos de modificadores. Ejemplos: "Tamaño", "Sin ingredientes", "Extras".
          </div>
        )}
      </div>
    </div>
  )
}

function GrupoForm({ grupo, onSave, onCancel }) {
  const [f, setF] = useState({
    nombre: grupo.nombre || '', tipo: grupo.tipo || 'checkbox',
    obligatorio: grupo.obligatorio ?? false,
    min_selecciones: grupo.min_selecciones ?? 0, max_selecciones: grupo.max_selecciones ?? 0,
    orden: grupo.orden ?? 0, activo: grupo.activo ?? true,
  })
  const upd = (k, v) => setF(p => ({ ...p, [k]: v }))

  return (
    <div style={{ maxWidth: 480 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{grupo.id ? 'Editar' : 'Nuevo'} Grupo</div>
      <label style={labelStyle}>Nombre *</label>
      <input value={f.nombre} onChange={e => upd('nombre', e.target.value)} style={inputStyle} placeholder="Ej: Tamaño" autoFocus />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>Tipo</label>
          <select value={f.tipo} onChange={e => upd('tipo', e.target.value)} style={inputStyle}>
            <option value="radio">Radio (uno solo)</option>
            <option value="checkbox">Checkbox (varios)</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Orden</label>
          <input type="number" value={f.orden} onChange={e => upd('orden', +e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label style={labelStyle}>Min selecciones</label>
          <input type="number" value={f.min_selecciones} onChange={e => upd('min_selecciones', +e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Max selecciones</label>
          <input type="number" value={f.max_selecciones} onChange={e => upd('max_selecciones', +e.target.value)} style={inputStyle} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.obligatorio} onChange={e => upd('obligatorio', e.target.checked)} /> Obligatorio
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={f.activo} onChange={e => upd('activo', e.target.checked)} /> Activo
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button onClick={() => onSave({ ...grupo, ...f })} disabled={!f.nombre.trim()} style={btnStyle(C.teal, '#0d2818')}>💾 Guardar</button>
        <button onClick={onCancel} style={btnStyle(C.border, C.muted)}>Cancelar</button>
      </div>
    </div>
  )
}

function ModsEditor({ grupo, onSaveMod, onDeleteMod, onBack }) {
  const mods = grupo.pos_modificadores || []
  const [newMod, setNewMod] = useState({ nombre: '', nombre_corto: '', precio_extra: '', orden: mods.length })

  return (
    <div style={{ maxWidth: 560 }}>
      <button onClick={onBack} style={{ ...smallBtn, marginBottom: 16 }}>← Volver a grupos</button>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Opciones de: {grupo.nombre}</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>{grupo.tipo} · {grupo.obligatorio ? 'Obligatorio' : 'Opcional'}</div>

      {/* Existing mods */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {mods.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>{m.nombre}</span>
              {m.nombre_corto && <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>({m.nombre_corto})</span>}
            </div>
            <span style={{ color: m.precio_extra > 0 ? C.teal : C.muted, fontSize: 13, fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
              {m.precio_extra > 0 ? `+$${m.precio_extra.toFixed(2)}` : 'gratis'}
            </span>
            <button onClick={() => onDeleteMod(m.id)} style={{ ...smallBtn, color: C.danger }}>✕</button>
          </div>
        ))}
        {mods.length === 0 && <div style={{ color: C.muted, textAlign: 'center', padding: 16 }}>Sin opciones. Agrega la primera abajo.</div>}
      </div>

      {/* Add new mod */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Agregar opción</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
          <div>
            <label style={labelStyle}>Nombre *</label>
            <input value={newMod.nombre} onChange={e => setNewMod(p => ({ ...p, nombre: e.target.value }))} style={inputStyle} placeholder="Ej: Sin cebolla" />
          </div>
          <div>
            <label style={labelStyle}>Corto</label>
            <input value={newMod.nombre_corto} onChange={e => setNewMod(p => ({ ...p, nombre_corto: e.target.value }))} style={inputStyle} placeholder="S/Ceb" />
          </div>
          <div>
            <label style={labelStyle}>Precio extra</label>
            <input type="number" step="0.01" value={newMod.precio_extra} onChange={e => setNewMod(p => ({ ...p, precio_extra: e.target.value }))} style={inputStyle} placeholder="0.00" />
          </div>
        </div>
        <button
          disabled={!newMod.nombre.trim()}
          onClick={() => { onSaveMod(grupo.id, newMod); setNewMod({ nombre: '', nombre_corto: '', precio_extra: '', orden: mods.length + 1 }) }}
          style={{ ...btnStyle(C.teal, '#0d2818'), marginTop: 10, width: '100%' }}
        >+ Agregar</button>
      </div>
    </div>
  )
}

/* ================================================================
   TAB 4: Asignar modificadores/extras a ítems
   ================================================================ */
function AsignarTab({ menuId }) {
  const [items, setItems] = useState([])
  const [grupos, setGrupos] = useState([])
  const [assignments, setAssignments] = useState({}) // { itemId: [grupoId, ...] }
  const [selectedItem, setSelectedItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const [{ data: itemsData }, { data: gruposData }, { data: assignData }] = await Promise.all([
      db.from('pos_menu_items').select('id, nombre, categoria_id').eq('menu_id', menuId).order('nombre'),
      db.from('pos_modificadores_grupo').select('id, nombre, tipo, obligatorio').order('orden'),
      db.from('pos_item_modificadores').select('menu_item_id, grupo_id'),
    ])
    setItems(itemsData || [])
    setGrupos(gruposData || [])
    // Build assignments map
    const map = {}
    ;(assignData || []).forEach(a => {
      if (!map[a.menu_item_id]) map[a.menu_item_id] = []
      map[a.menu_item_id].push(a.grupo_id)
    })
    setAssignments(map)
    setLoading(false)
  }, [menuId])

  useEffect(() => { load() }, [load])

  const handleToggleAssign = async (itemId, grupoId) => {
    const current = assignments[itemId] || []
    if (current.includes(grupoId)) {
      // Remove
      const { error } = await db.from('pos_item_modificadores').delete().eq('menu_item_id', itemId).eq('grupo_id', grupoId)
      if (error) { toast('Error: ' + error.message, false); return }
    } else {
      // Add
      const { error } = await db.from('pos_item_modificadores').insert([{ menu_item_id: itemId, grupo_id: grupoId }])
      if (error) { toast('Error: ' + error.message, false); return }
    }
    load()
  }

  const handleBulkAssign = async (grupoId) => {
    // Assign to ALL items that don't have it yet
    const toInsert = items.filter(i => !(assignments[i.id] || []).includes(grupoId)).map(i => ({ menu_item_id: i.id, grupo_id: grupoId }))
    if (toInsert.length === 0) { toast('Todos los ítems ya tienen este grupo', false); return }
    const { error } = await db.from('pos_item_modificadores').insert(toInsert)
    if (error) { toast('Error: ' + error.message, false); return }
    toast(`Asignado a ${toInsert.length} ítems`)
    load()
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 40 }}><div className="spin" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>

  if (grupos.length === 0) {
    return <div style={{ textAlign: 'center', padding: 40, color: C.muted }}>Primero crea grupos de modificadores en la pestaña "Grupos Modificadores".</div>
  }

  const filtered = items.filter(i => !search || i.nombre.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Asignar Grupos a Ítems</div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Selecciona un ítem para ver/editar sus grupos de modificadores.</div>

      {/* Bulk assign buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {grupos.map(g => (
          <button key={g.id} onClick={() => handleBulkAssign(g.id)} style={{ ...smallBtn, fontSize: 11 }} title={`Asignar "${g.nombre}" a todos los ítems`}>
            🔗 {g.nombre} → Todos
          </button>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar ítem..." style={{ ...inputStyle, marginBottom: 12, width: '100%', maxWidth: 320 }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {filtered.map(item => {
          const itemGrupos = assignments[item.id] || []
          const isOpen = selectedItem === item.id
          return (
            <div key={item.id} style={{ background: C.card, border: `1px solid ${isOpen ? C.accent : C.border}`, borderRadius: 10, padding: 12, cursor: 'pointer' }} onClick={() => setSelectedItem(isOpen ? null : item.id)}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                {item.nombre}
                <span style={{ color: C.muted, fontSize: 11, marginLeft: 6 }}>({itemGrupos.length} grupo{itemGrupos.length !== 1 ? 's' : ''})</span>
              </div>
              {isOpen && (
                <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                  {grupos.map(g => {
                    const assigned = itemGrupos.includes(g.id)
                    return (
                      <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer', fontSize: 12 }}>
                        <input type="checkbox" checked={assigned} onChange={() => handleToggleAssign(item.id, g.id)} />
                        <span style={{ color: assigned ? C.teal : C.muted }}>{g.nombre}</span>
                        <span style={{ fontSize: 10, color: C.muted }}>({g.tipo})</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Shared styles ── */
const inputStyle = { background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' }
const labelStyle = { display: 'block', fontSize: 11, color: C.muted, marginBottom: 4, marginTop: 8, fontWeight: 600 }
const smallBtn = { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: '5px 8px', cursor: 'pointer', fontSize: 13 }
const btnStyle = (bg, color) => ({ background: bg, color, border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer' })
