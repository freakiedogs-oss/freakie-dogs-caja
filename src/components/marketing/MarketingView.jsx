import { useState, useEffect, useCallback } from 'react'
import { db } from '../../supabase'
import { today, fmtDate, n } from '../../config'

const TABS = ['Feed', 'Correlación', 'Horarios', 'Campañas', 'Métricas Diarias']
const PLATAFORMAS = ['instagram', 'tiktok']
const TIPOS = ['foto', 'video', 'reel', 'story', 'carrusel', 'tiktok_video', 'tiktok_photo', 'live']

const badge = (txt, bg = '#333', color = '#fff') => (
  <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>{txt}</span>
)
const card = (children, style = {}) => (
  <div style={{ background: '#1a1a1a', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #333', ...style }}>{children}</div>
)

export default function MarketingView({ user }) {
  const [tab, setTab] = useState(0)
  const [posts, setPosts] = useState([])
  const [correlacion, setCorrelacion] = useState([])
  const [horarios, setHorarios] = useState([])
  const [tipoRendimiento, setTipoRendimiento] = useState([])
  const [campanas, setCampanas] = useState([])
  const [metricas, setMetricas] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroPlataforma, setFiltroPlataforma] = useState('todas')
  const [showNewPost, setShowNewPost] = useState(false)
  const [showNewCampana, setShowNewCampana] = useState(false)
  const [sucursales, setSucursales] = useState([])
  const [newPost, setNewPost] = useState({
    plataforma: 'instagram', tipo_contenido: 'reel', fecha_publicacion: '',
    caption: '', url: '', likes: 0, comentarios: 0, compartidos: 0,
    guardados: 0, reproducciones: 0, alcance: 0, impresiones: 0,
    sucursal_id: '', producto_mencionado: '', hashtags: ''
  })
  const [newCampana, setNewCampana] = useState({
    nombre: '', descripcion: '', fecha_inicio: today(), fecha_fin: '', objetivo: 'engagement', presupuesto: ''
  })

  const loadData = useCallback(async () => {
    setLoading(true)
    const [postsR, corrR, horR, tipoR, campR, metR, sucR] = await Promise.all([
      db.from('posts_redes').select('*').order('fecha_publicacion', { ascending: false }).limit(100),
      db.from('marketing_ventas_correlacion').select('*').order('fecha_publicacion', { ascending: false }).limit(100),
      db.from('v_mejores_horarios_publicacion').select('*'),
      db.from('v_rendimiento_tipo_contenido').select('*'),
      db.from('campanas_marketing').select('*').order('fecha_inicio', { ascending: false }),
      db.from('metricas_redes_diarias').select('*').order('fecha', { ascending: false }).limit(60),
      db.from('sucursales').select('id, nombre, store_code').eq('activa', true)
    ])
    setPosts(postsR.data || [])
    setCorrelacion(corrR.data || [])
    setHorarios(horR.data || [])
    setTipoRendimiento(tipoR.data || [])
    setCampanas(campR.data || [])
    setMetricas(metR.data || [])
    setSucursales(sucR.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const filteredPosts = filtroPlataforma === 'todas' ? posts : posts.filter(p => p.plataforma === filtroPlataforma)
  const filteredCorr = filtroPlataforma === 'todas' ? correlacion : correlacion.filter(c => c.plataforma === filtroPlataforma)

  const guardarPost = async () => {
    const payload = {
      ...newPost,
      likes: n(newPost.likes), comentarios: n(newPost.comentarios), compartidos: n(newPost.compartidos),
      guardados: n(newPost.guardados), reproducciones: n(newPost.reproducciones), alcance: n(newPost.alcance),
      impresiones: n(newPost.impresiones),
      sucursal_id: newPost.sucursal_id || null,
      producto_mencionado: newPost.producto_mencionado ? newPost.producto_mencionado.split(',').map(s => s.trim()).filter(Boolean) : null,
      hashtags: newPost.hashtags ? newPost.hashtags.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean) : null,
      fecha_publicacion: newPost.fecha_publicacion || new Date().toISOString()
    }
    const { error } = await db.from('posts_redes').insert(payload)
    if (error) return alert('Error: ' + error.message)
    setShowNewPost(false)
    setNewPost({ plataforma: 'instagram', tipo_contenido: 'reel', fecha_publicacion: '', caption: '', url: '', likes: 0, comentarios: 0, compartidos: 0, guardados: 0, reproducciones: 0, alcance: 0, impresiones: 0, sucursal_id: '', producto_mencionado: '', hashtags: '' })
    loadData()
  }

  const guardarCampana = async () => {
    const payload = { ...newCampana, presupuesto: newCampana.presupuesto ? n(newCampana.presupuesto) : null, fecha_fin: newCampana.fecha_fin || null }
    const { error } = await db.from('campanas_marketing').insert(payload)
    if (error) return alert('Error: ' + error.message)
    setShowNewCampana(false)
    setNewCampana({ nombre: '', descripcion: '', fecha_inicio: today(), fecha_fin: '', objetivo: 'engagement', presupuesto: '' })
    loadData()
  }

  const refreshCorrelacion = async () => {
    await db.rpc('refresh_marketing_correlacion')
    loadData()
  }

  // ---------- STATS resumen ----------
  const totalPosts = posts.length
  const avgEng = totalPosts > 0 ? (posts.reduce((s, p) => s + n(p.engagement_rate), 0) / totalPosts * 100).toFixed(1) : '0'
  const totalLikes = posts.reduce((s, p) => s + n(p.likes), 0)
  const totalReach = posts.reduce((s, p) => s + n(p.alcance), 0)

  const inputStyle = { background: '#222', border: '1px solid #444', borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 14, width: '100%' }
  const labelStyle = { fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }
  const btnStyle = (bg = '#e74c3c') => ({ background: bg, color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' })

  if (loading) return <div style={{ padding: 20, color: '#aaa', textAlign: 'center' }}>Cargando marketing analytics...</div>

  return (
    <div style={{ padding: '16px 12px', maxWidth: 800, margin: '0 auto' }}>
      <h2 style={{ color: '#fff', margin: '0 0 4px' }}>📱 Marketing Analytics</h2>
      <p style={{ color: '#888', fontSize: 13, margin: '0 0 16px' }}>Instagram + TikTok • Engagement vs Ventas</p>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Posts', val: totalPosts, color: '#e74c3c' },
          { label: 'Eng. Rate', val: avgEng + '%', color: '#f39c12' },
          { label: 'Likes', val: totalLikes.toLocaleString(), color: '#e91e63' },
          { label: 'Alcance', val: totalReach.toLocaleString(), color: '#2196f3' },
        ].map((k, i) => (
          <div key={i} style={{ background: '#1a1a1a', borderRadius: 10, padding: '12px 8px', textAlign: 'center', border: `1px solid ${k.color}33` }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.val}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filtro plataforma */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {['todas', ...PLATAFORMAS].map(p => (
          <button key={p} onClick={() => setFiltroPlataforma(p)}
            style={{ ...btnStyle(filtroPlataforma === p ? '#e74c3c' : '#333'), padding: '6px 14px', fontSize: 12 }}>
            {p === 'todas' ? 'Todas' : p === 'instagram' ? '📸 Instagram' : '🎵 TikTok'}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)}
            style={{ ...btnStyle(tab === i ? '#e74c3c' : '#222'), padding: '8px 14px', fontSize: 12, whiteSpace: 'nowrap', border: tab === i ? 'none' : '1px solid #444' }}>
            {t}
          </button>
        ))}
      </div>

      {/* =================== TAB 0: FEED =================== */}
      {tab === 0 && (
        <div>
          <button onClick={() => setShowNewPost(!showNewPost)} style={{ ...btnStyle(), marginBottom: 12 }}>
            {showNewPost ? '✕ Cerrar' : '+ Registrar Post'}
          </button>

          {showNewPost && card(
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Plataforma</label>
                <select value={newPost.plataforma} onChange={e => setNewPost({ ...newPost, plataforma: e.target.value })} style={inputStyle}>
                  {PLATAFORMAS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Tipo</label>
                <select value={newPost.tipo_contenido} onChange={e => setNewPost({ ...newPost, tipo_contenido: e.target.value })} style={inputStyle}>
                  {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Fecha publicación</label>
                <input type="datetime-local" value={newPost.fecha_publicacion} onChange={e => setNewPost({ ...newPost, fecha_publicacion: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Caption / Descripción</label>
                <textarea value={newPost.caption} onChange={e => setNewPost({ ...newPost, caption: e.target.value })} style={{ ...inputStyle, minHeight: 60 }} />
              </div>
              <div>
                <label style={labelStyle}>URL del post</label>
                <input value={newPost.url} onChange={e => setNewPost({ ...newPost, url: e.target.value })} style={inputStyle} placeholder="https://..." />
              </div>
              <div>
                <label style={labelStyle}>Sucursal (opcional)</label>
                <select value={newPost.sucursal_id} onChange={e => setNewPost({ ...newPost, sucursal_id: e.target.value })} style={inputStyle}>
                  <option value="">General (todas)</option>
                  {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Productos mencionados (coma)</label>
                <input value={newPost.producto_mencionado} onChange={e => setNewPost({ ...newPost, producto_mencionado: e.target.value })} style={inputStyle} placeholder="Smash Burger, Royal Truffle" />
              </div>
              <div>
                <label style={labelStyle}>Hashtags (coma)</label>
                <input value={newPost.hashtags} onChange={e => setNewPost({ ...newPost, hashtags: e.target.value })} style={inputStyle} placeholder="freakiedogs, smashburger" />
              </div>
              <div style={{ gridColumn: '1/-1', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {['likes', 'comentarios', 'compartidos', 'guardados', 'reproducciones', 'alcance', 'impresiones'].map(f => (
                  <div key={f}>
                    <label style={labelStyle}>{f.charAt(0).toUpperCase() + f.slice(1)}</label>
                    <input type="number" value={newPost[f]} onChange={e => setNewPost({ ...newPost, [f]: e.target.value })} style={inputStyle} />
                  </div>
                ))}
              </div>
              <div style={{ gridColumn: '1/-1', textAlign: 'right' }}>
                <button onClick={guardarPost} style={btnStyle('#27ae60')}>💾 Guardar Post</button>
              </div>
            </div>
          )}

          {filteredPosts.length === 0 ? (
            card(<p style={{ color: '#888', textAlign: 'center', margin: 0 }}>No hay posts registrados. Conecta Instagram/TikTok o registra manualmente.</p>)
          ) : (
            filteredPosts.map(p => (
              <div key={p.id} style={{ background: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 10, border: '1px solid #333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {badge(p.plataforma, p.plataforma === 'instagram' ? '#c13584' : '#000', '#fff')}
                    {badge(p.tipo_contenido, '#444')}
                    {p.sucursal_id && badge(sucursales.find(s => s.id === p.sucursal_id)?.nombre || '?', '#2196f3')}
                  </div>
                  <span style={{ fontSize: 11, color: '#666' }}>{fmtDate((p.fecha_publicacion || '').slice(0, 10))}</span>
                </div>
                {p.caption && <p style={{ fontSize: 13, color: '#ccc', margin: '0 0 8px', lineHeight: 1.4 }}>{p.caption.length > 120 ? p.caption.slice(0, 120) + '...' : p.caption}</p>}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: '#aaa' }}>
                  <span>❤️ {n(p.likes).toLocaleString()}</span>
                  <span>💬 {n(p.comentarios).toLocaleString()}</span>
                  <span>🔄 {n(p.compartidos).toLocaleString()}</span>
                  <span>🔖 {n(p.guardados).toLocaleString()}</span>
                  {n(p.reproducciones) > 0 && <span>▶️ {n(p.reproducciones).toLocaleString()}</span>}
                  <span>👁️ {n(p.alcance).toLocaleString()}</span>
                  <span style={{ color: n(p.engagement_rate) > 0.05 ? '#27ae60' : '#f39c12', fontWeight: 600 }}>
                    Eng: {(n(p.engagement_rate) * 100).toFixed(1)}%
                  </span>
                </div>
                {p.producto_mencionado && p.producto_mencionado.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {p.producto_mencionado.map((prod, i) => <span key={i} style={{ background: '#333', padding: '2px 8px', borderRadius: 6, fontSize: 11, color: '#f39c12' }}>🍔 {prod}</span>)}
                  </div>
                )}
                {p.url && <a href={p.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#2196f3', marginTop: 4, display: 'inline-block' }}>Ver post ↗</a>}
              </div>
            ))
          )}
        </div>
      )}

      {/* =================== TAB 1: CORRELACIÓN =================== */}
      {tab === 1 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Impacto de cada post en ventas (día 0, 1, 2 vs baseline 7d)</p>
            <button onClick={refreshCorrelacion} style={btnStyle('#333')}>🔄 Refrescar</button>
          </div>
          {filteredCorr.length === 0 ? (
            card(<p style={{ color: '#888', textAlign: 'center', margin: 0 }}>Sin datos de correlación. Registra posts y espera a que se acumulen ventas.</p>)
          ) : (
            filteredCorr.map(c => (
              <div key={c.post_id} style={{ background: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${n(c.lift_pct) > 5 ? '#27ae60' : n(c.lift_pct) < -5 ? '#e74c3c' : '#333'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {badge(c.plataforma, c.plataforma === 'instagram' ? '#c13584' : '#000')}
                    {badge(c.tipo_contenido, '#444')}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: n(c.lift_pct) > 0 ? '#27ae60' : '#e74c3c' }}>
                      {n(c.lift_pct) > 0 ? '+' : ''}{n(c.lift_pct)}%
                    </div>
                    <div style={{ fontSize: 10, color: '#666' }}>lift vs baseline</div>
                  </div>
                </div>
                {c.caption && <p style={{ fontSize: 12, color: '#999', margin: '0 0 8px' }}>{(c.caption || '').slice(0, 80)}...</p>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 12 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#888' }}>Baseline 7d</div>
                    <div style={{ color: '#fff', fontWeight: 600 }}>${n(c.ventas_baseline_7d).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#888' }}>Día 0</div>
                    <div style={{ color: '#fff', fontWeight: 600 }}>${n(c.ventas_dia_0).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#888' }}>Día 1</div>
                    <div style={{ color: '#fff', fontWeight: 600 }}>${n(c.ventas_dia_1).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ color: '#888' }}>Día 2</div>
                    <div style={{ color: '#fff', fontWeight: 600 }}>${n(c.ventas_dia_2).toLocaleString()}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: '#777' }}>
                  <span>❤️ {n(c.likes)}</span>
                  <span>💬 {n(c.comentarios)}</span>
                  <span>👁️ {n(c.alcance).toLocaleString()}</span>
                  <span>Eng: {(n(c.engagement_rate) * 100).toFixed(1)}%</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* =================== TAB 2: HORARIOS =================== */}
      {tab === 2 && (
        <div>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>Mejores horarios y días para publicar según engagement promedio</p>
          {/* Rendimiento por tipo */}
          <h3 style={{ color: '#fff', fontSize: 15, marginBottom: 8 }}>Por tipo de contenido</h3>
          {tipoRendimiento.length === 0 ? (
            card(<p style={{ color: '#888', textAlign: 'center', margin: 0 }}>Sin datos suficientes</p>)
          ) : (
            <div style={{ overflowX: 'auto', marginBottom: 20 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccc' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444' }}>
                    <th style={{ textAlign: 'left', padding: 8, color: '#888' }}>Plataforma</th>
                    <th style={{ textAlign: 'left', padding: 8, color: '#888' }}>Tipo</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Posts</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Eng %</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Alcance</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Likes</th>
                  </tr>
                </thead>
                <tbody>
                  {tipoRendimiento.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: 8 }}>{badge(r.plataforma, r.plataforma === 'instagram' ? '#c13584' : '#000')}</td>
                      <td style={{ padding: 8 }}>{r.tipo_contenido}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{r.total_posts}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: '#f39c12', fontWeight: 600 }}>{(n(r.avg_engagement) * 100).toFixed(1)}%</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{n(r.avg_alcance).toLocaleString()}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{n(r.avg_likes).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Horarios */}
          <h3 style={{ color: '#fff', fontSize: 15, marginBottom: 8 }}>Por día y hora</h3>
          {horarios.length === 0 ? (
            card(<p style={{ color: '#888', textAlign: 'center', margin: 0 }}>Sin datos suficientes. Necesitas más posts para ver patrones.</p>)
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccc' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444' }}>
                    <th style={{ textAlign: 'left', padding: 8, color: '#888' }}>Plat.</th>
                    <th style={{ textAlign: 'left', padding: 8, color: '#888' }}>Día</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Hora</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Posts</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Eng %</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Alcance</th>
                  </tr>
                </thead>
                <tbody>
                  {horarios.slice(0, 20).map((h, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: 8 }}>{h.plataforma === 'instagram' ? '📸' : '🎵'}</td>
                      <td style={{ padding: 8 }}>{h.dia_nombre}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{h.hora}:00</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{h.total_posts}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: '#f39c12', fontWeight: 600 }}>{(n(h.avg_engagement) * 100).toFixed(1)}%</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{n(h.avg_alcance).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =================== TAB 3: CAMPAÑAS =================== */}
      {tab === 3 && (
        <div>
          <button onClick={() => setShowNewCampana(!showNewCampana)} style={{ ...btnStyle(), marginBottom: 12 }}>
            {showNewCampana ? '✕ Cerrar' : '+ Nueva Campaña'}
          </button>
          {showNewCampana && card(
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Nombre</label>
                <input value={newCampana.nombre} onChange={e => setNewCampana({ ...newCampana, nombre: e.target.value })} style={inputStyle} placeholder="Ej: Lanzamiento Royal Truffle" />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={labelStyle}>Descripción</label>
                <textarea value={newCampana.descripcion} onChange={e => setNewCampana({ ...newCampana, descripcion: e.target.value })} style={{ ...inputStyle, minHeight: 50 }} />
              </div>
              <div>
                <label style={labelStyle}>Fecha inicio</label>
                <input type="date" value={newCampana.fecha_inicio} onChange={e => setNewCampana({ ...newCampana, fecha_inicio: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Fecha fin</label>
                <input type="date" value={newCampana.fecha_fin} onChange={e => setNewCampana({ ...newCampana, fecha_fin: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Objetivo</label>
                <select value={newCampana.objetivo} onChange={e => setNewCampana({ ...newCampana, objetivo: e.target.value })} style={inputStyle}>
                  {['awareness', 'engagement', 'conversion', 'branding', 'promocion', 'lanzamiento'].map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Presupuesto ($)</label>
                <input type="number" value={newCampana.presupuesto} onChange={e => setNewCampana({ ...newCampana, presupuesto: e.target.value })} style={inputStyle} placeholder="0.00" />
              </div>
              <div style={{ gridColumn: '1/-1', textAlign: 'right' }}>
                <button onClick={guardarCampana} style={btnStyle('#27ae60')}>💾 Guardar Campaña</button>
              </div>
            </div>
          )}
          {campanas.length === 0 ? (
            card(<p style={{ color: '#888', textAlign: 'center', margin: 0 }}>No hay campañas. Crea una para agrupar posts por iniciativa.</p>)
          ) : (
            campanas.map(c => (
              <div key={c.id} style={{ background: '#1a1a1a', borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${c.activa ? '#27ae60' : '#555'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{c.nombre}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{c.fecha_inicio} → {c.fecha_fin || 'En curso'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {badge(c.objetivo, '#333', '#f39c12')}
                    {c.presupuesto && <div style={{ fontSize: 12, color: '#27ae60', marginTop: 4 }}>${n(c.presupuesto).toLocaleString()}</div>}
                  </div>
                </div>
                {c.descripcion && <p style={{ fontSize: 12, color: '#999', margin: '8px 0 0' }}>{c.descripcion}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {/* =================== TAB 4: MÉTRICAS DIARIAS =================== */}
      {tab === 4 && (
        <div>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>Seguidores, alcance y clicks por día (se llena automáticamente con Make.com)</p>
          {metricas.length === 0 ? (
            card(<p style={{ color: '#888', textAlign: 'center', margin: 0 }}>Sin métricas diarias aún. Se poblarán automáticamente cuando conectes las APIs.</p>)
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccc' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #444' }}>
                    <th style={{ textAlign: 'left', padding: 8, color: '#888' }}>Fecha</th>
                    <th style={{ textAlign: 'left', padding: 8, color: '#888' }}>Plat.</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Seguidores</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Nuevos</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Alcance</th>
                    <th style={{ textAlign: 'right', padding: 8, color: '#888' }}>Clicks</th>
                  </tr>
                </thead>
                <tbody>
                  {metricas.map((m, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #222' }}>
                      <td style={{ padding: 8 }}>{m.fecha}</td>
                      <td style={{ padding: 8 }}>{m.plataforma === 'instagram' ? '📸' : '🎵'}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{n(m.seguidores).toLocaleString()}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: n(m.seguidores_nuevos) > 0 ? '#27ae60' : '#ccc' }}>+{n(m.seguidores_nuevos)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{n(m.alcance_total).toLocaleString()}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{n(m.clicks_web)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
