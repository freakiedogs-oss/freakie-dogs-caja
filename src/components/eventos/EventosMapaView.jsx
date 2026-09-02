/* ═══════════════════════════════════════════════════════════════════════
   Eventos — mapa, logística y requisición

   Complementa el EventosView que ya existía (menú, venta, cierre). Acá va lo
   que se llevaba a mano en Excel: dónde es el evento, a qué hora sale cada
   cosa, cuánta gente y en qué posición, y qué hay que cargar.

   Los 79 ítems de la requisición salen de consolidar 3 Excel y 5 PDF de hojas
   reales. La lista se filtra sola por tipo de evento — al de hot dogs no le
   aparecen el smasher ni la plancha.

   Mapa con Leaflet + OpenStreetMap, igual que MapaAsignacion: sin API key ni
   costo por carga.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useCallback } from 'react'
import { db } from '../../supabase'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Edgar (eventos) y Casa Matriz editan. Jazmin es 'admin' y solo consulta.
const ROLES_EDITAN = ['eventos', 'ejecutivo', 'jefe_casa_matriz', 'superadmin']
const ROLES_VEN    = [...ROLES_EDITAN, 'admin']

const CASA_MATRIZ = { lat: 13.6731, lng: -89.2894 }   // centro por defecto del mapa

const POSICIONES = ['Hot dogs', 'Hamburguesas', 'Papas fritas', 'Caja', 'Apoyo general']

const TIPOS = [
  { v: 'burger', t: '🍔 Hamburguesas' },
  { v: 'hotdog', t: '🌭 Hot dogs' },
  { v: 'ambos',  t: '🍔🌭 Ambos' },
]

const C = {
  bg: '#0f0f10', card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2',
  dim: '#8a8a92', ok: '#22c55e', warn: '#fbbf24', bad: '#ef4444', acc: '#60a5fa',
}
const card = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 14 }
const inp = {
  width: '100%', background: '#101012', color: C.txt, border: `1px solid ${C.line}`,
  borderRadius: 8, padding: '10px 11px', fontSize: 15, fontFamily: 'inherit',
}
const lbl = { fontSize: 12.5, color: C.dim, display: 'block', marginBottom: 4 }
const btn = (color, off) => ({
  background: off ? '#3a3a3e' : color, color: '#fff', border: 'none', borderRadius: 9,
  padding: '12px 20px', fontSize: 15, fontWeight: 700, cursor: off ? 'not-allowed' : 'pointer',
  opacity: off ? 0.55 : 1, fontFamily: 'inherit',
})

const VACIO = {
  nombre: '', tipo_evento: 'ambos', fecha_evento: '',
  contacto_nombre: '', contacto_telefono: '', direccion_texto: '',
  hora_llegada_cm: '', hora_salida_cm: '', hora_llegada_evento: '',
  hora_inicio: '', hora_fin: '', lat: null, lng: null, es_prueba: false,
}

export default function EventosMapaView({ user }) {
  const [eventos, setEventos] = useState([])
  const [sel, setSel]         = useState(null)
  const [form, setForm]       = useState(VACIO)
  const [creando, setCreando] = useState(false)
  const [personal, setPersonal] = useState([])
  const [items, setItems]     = useState([])
  const [reqs, setReqs]       = useState({})     // item_id -> cantidad
  const [tab, setTab]         = useState('datos')
  const [msg, setMsg]         = useState('')
  const [guardando, setG]     = useState(false)

  const mapRef = useRef(null)
  const divRef = useRef(null)
  const marcadoresRef = useRef([])
  const nuevoRef = useRef(null)
  const creandoRef = useRef(false)

  const rol = user?.rol || ''
  const puedeEditar = ROLES_EDITAN.includes(rol)
  const puedeVer    = ROLES_VEN.includes(rol)

  useEffect(() => { creandoRef.current = creando }, [creando])

  // ── Carga ──
  const cargar = useCallback(async () => {
    try {
      const [{ data: ev }, { data: it }] = await Promise.all([
        db.from('eventos').select('*').order('fecha_evento', { ascending: false }).limit(60),
        db.from('evento_items_catalogo').select('*').eq('activo', true).order('orden'),
      ])
      setEventos(ev || []); setItems(it || [])
    } catch (e) { setMsg(e.message) }
  }, [])

  useEffect(() => { if (puedeVer) cargar() }, [cargar, puedeVer])

  // ── Mapa ──
  useEffect(() => {
    if (!divRef.current || mapRef.current || !puedeVer) return
    const map = L.map(divRef.current).setView([CASA_MATRIZ.lat, CASA_MATRIZ.lng], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)

    L.marker([CASA_MATRIZ.lat, CASA_MATRIZ.lng], {
      icon: L.divIcon({
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
        html: `<div style="background:#E62329;color:#fff;width:28px;height:28px;border-radius:50%;
               display:flex;align-items:center;justify-content:center;font-size:13px;
               border:2px solid #fff">🏠</div>`,
      }),
    }).addTo(map).bindPopup('Casa Matriz')

    // Al crear, el clic en el mapa fija la ubicacion. Es lo primero que pide
    // el flujo: sin punto no hay evento.
    map.on('click', (e) => {
      if (!creandoRef.current) return
      const { lat, lng } = e.latlng
      setForm(f => ({ ...f, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }))
      if (nuevoRef.current) map.removeLayer(nuevoRef.current)
      nuevoRef.current = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '', iconSize: [30, 30], iconAnchor: [15, 15],
          html: `<div style="background:#22c55e;color:#fff;width:30px;height:30px;border-radius:50%;
                 display:flex;align-items:center;justify-content:center;font-size:15px;
                 border:3px solid #fff">📍</div>`,
        }),
      }).addTo(map)
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 200)
    return () => { map.remove(); mapRef.current = null }
  }, [puedeVer])

  // Pinta los eventos existentes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    marcadoresRef.current.forEach(m => map.removeLayer(m))
    marcadoresRef.current = eventos
      .filter(e => e.lat && e.lng)
      .map(e => {
        const pasado = e.fecha_evento && e.fecha_evento < new Date().toISOString().slice(0, 10)
        const prueba = e.es_prueba
        const m = L.marker([e.lat, e.lng], {
          icon: L.divIcon({
            className: '', iconSize: [26, 26], iconAnchor: [13, 13],
            html: `<div style="background:${prueba ? '#60a5fa' : pasado ? '#6b6a62' : '#fbbf24'};color:#1a1a1c;width:26px;
                   height:26px;border-radius:50%;display:flex;align-items:center;
                   justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff">
                   ${prueba ? '🧪' : e.tipo_evento === 'hotdog' ? '🌭' : e.tipo_evento === 'burger' ? '🍔' : '🎪'}</div>`,
          }),
        }).addTo(map)
        m.bindPopup(`<b>${e.nombre || 'Evento'}</b><br>${e.fecha_evento || ''}<br>${e.direccion_texto || ''}`)
        m.on('click', () => abrir(e))
        return m
      })
  }, [eventos])

  async function abrir(e) {
    setSel(e); setCreando(false); setTab('datos')
    setForm({ ...VACIO, ...e })
    const [{ data: p }, { data: ped }] = await Promise.all([
      db.from('evento_personal').select('*').eq('evento_id', e.id).order('created_at'),
      db.from('evento_pedidos').select('id, estado, evento_pedido_items(producto_id, cantidad_solicitada)')
        .eq('evento_id', e.id).order('created_at', { ascending: false }).limit(1),
    ])
    setPersonal(p || [])
    const r = {}
    ;(ped?.[0]?.evento_pedido_items || []).forEach(x => {
      const it = items.find(i => i.producto_id === x.producto_id)
      if (it) r[it.id] = Number(x.cantidad_solicitada)
    })
    setReqs(r)
    if (e.lat && e.lng && mapRef.current) mapRef.current.setView([e.lat, e.lng], 15)
  }

  function nuevo() {
    setSel(null); setCreando(true); setForm(VACIO)
    setPersonal(POSICIONES.slice(0, 3).map(p => ({ posicion: p, cantidad: 1 })))
    setReqs({}); setTab('datos'); setMsg('')
    if (nuevoRef.current && mapRef.current) { mapRef.current.removeLayer(nuevoRef.current); nuevoRef.current = null }
  }

  async function borrar() {
    if (!sel) return
    if (!window.confirm(`¿Borrar "${sel.nombre}"? No se puede deshacer.`)) return
    try {
      await db.from('eventos').delete().eq('id', sel.id)
      setSel(null); setCreando(false); setMsg('✓ Evento borrado')
      await cargar()
    } catch (e) { setMsg(e.message) }
  }

  async function guardar() {
    if (!form.lat || !form.lng) { setMsg('Marcá la ubicación en el mapa.'); setTab('datos'); return }
    if (!form.nombre.trim())    { setMsg('Poné el nombre del evento.'); return }
    if (!form.fecha_evento)     { setMsg('Poné la fecha del evento.'); return }
    setG(true); setMsg('')
    try {
      const payload = {
        nombre: form.nombre.trim(), tipo_evento: form.tipo_evento,
        fecha_evento: form.fecha_evento,
        lat: form.lat, lng: form.lng,
        direccion_texto: form.direccion_texto || null,
        ubicacion: form.direccion_texto || null,   // el campo viejo, por compatibilidad
        cliente: form.contacto_nombre || null,
        contacto_nombre: form.contacto_nombre || null,
        contacto_telefono: form.contacto_telefono || null,
        hora_llegada_cm: form.hora_llegada_cm || null,
        hora_salida_cm: form.hora_salida_cm || null,
        hora_llegada_evento: form.hora_llegada_evento || null,
        hora_inicio: form.hora_inicio || null,
        hora_fin: form.hora_fin || null,
        es_prueba: !!form.es_prueba,
      }
      let id = sel?.id
      if (id) {
        const { error } = await db.from('eventos').update(payload).eq('id', id)
        if (error) throw error
      } else {
        const { data, error } = await db.from('eventos')
          .insert({ ...payload, estado: 'planificado', responsable_id: user?.id || null })
          .select().single()
        if (error) throw error
        id = data.id
      }

      // Personal: se reemplaza completo, es una lista corta
      await db.from('evento_personal').delete().eq('evento_id', id)
      const conGente = personal.filter(p => p.posicion && Number(p.cantidad) > 0)
      if (conGente.length) {
        await db.from('evento_personal').insert(
          conGente.map(p => ({ evento_id: id, posicion: p.posicion, cantidad: Number(p.cantidad) }))
        )
      }

      // Requisicion -> pedido real a Casa Matriz. Solo entran los items que
      // estan enlazados al inventario; los que no (canopy, extension, banner)
      // van en la lista impresa pero no se pueden despachar por kardex.
      const pedidos = Object.entries(reqs)
        .filter(([, c]) => Number(c) > 0)
        .map(([iid, c]) => ({ item: items.find(i => i.id === iid), cant: Number(c) }))
        .filter(x => x.item?.producto_id)
      if (pedidos.length && !form.es_prueba) {
        const { data: ped, error: ePed } = await db.from('evento_pedidos')
          .insert({ evento_id: id, estado: 'solicitado', solicitado_por: user?.id || null,
                    notas: 'Requisición desde el mapa de eventos' })
          .select().single()
        if (ePed) throw ePed
        await db.from('evento_pedido_items').insert(
          pedidos.map(x => ({ evento_pedido_id: ped.id, producto_id: x.item.producto_id,
                              cantidad_solicitada: x.cant }))
        )
      }

      setMsg(form.es_prueba
        ? `✓ Evento de PRUEBA guardado. No se envió pedido a Casa Matriz${pedidos.length ? ` (se habrían pedido ${pedidos.length} productos)` : ''}. Borralo cuando termines.`
        : '✓ Guardado' + (pedidos.length ? ` · pedido de ${pedidos.length} productos enviado a Casa Matriz` : ''))
      setCreando(false)
      await cargar()
    } catch (e) { setMsg(e.message || 'No se pudo guardar') }
    setG(false)
  }

  if (!puedeVer) {
    return <div style={{ padding: 20, color: C.dim, background: C.bg, minHeight: '100%' }}>
      Tu rol no tiene acceso a eventos.
    </div>
  }

  const visibles = items.filter(i => i.aplica === 'ambos' || i.aplica === form.tipo_evento)
  const secciones = [...new Set(visibles.map(i => i.seccion))]
  const nReq = Object.values(reqs).filter(c => Number(c) > 0).length

  return (
    <div style={{ padding: 16, background: C.bg, color: C.txt, minHeight: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21 }}>🎪 Eventos · mapa y logística</h2>
          <div style={{ color: C.dim, fontSize: 13, marginTop: 3 }}>
            {eventos.length} eventos · {items.length} ítems de requisición
          </div>
        </div>
        {puedeEditar && (
          <button onClick={nuevo} style={btn(C.ok)}>+ Agregar evento</button>
        )}
      </div>

      {msg && (
        <div style={{ ...card, borderColor: msg.startsWith('✓') ? C.ok : C.bad,
                      background: msg.startsWith('✓') ? '#0e2a17' : '#3a1212',
                      color: msg.startsWith('✓') ? '#86efac' : '#fecaca' }}>{msg}</div>
      )}

      {creando && (
        <div style={{ ...card, background: '#101827', borderColor: C.acc, color: '#bfdbfe' }}>
          <b style={{ color: C.acc }}>Paso 1 · Tocá en el mapa dónde es el evento</b>
          {form.lat && <div style={{ marginTop: 5, fontSize: 13.5 }}>
            ✓ Ubicación marcada ({form.lat}, {form.lng}) — ya podés llenar los datos abajo.
          </div>}
        </div>
      )}

      <div ref={divRef} style={{ height: 340, borderRadius: 12, border: `1px solid ${C.line}`, marginBottom: 14 }} />

      {/* ── Lista de eventos ── */}
      {!creando && !sel && (
        <div style={card}>
          <b style={{ fontSize: 15 }}>Eventos</b>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {eventos.length === 0 && <span style={{ color: C.dim, fontSize: 14 }}>Todavía no hay eventos cargados.</span>}
            {eventos.slice(0, 15).map(e => (
              <button key={e.id} onClick={() => abrir(e)} style={{
                background: '#101012', border: `1px solid ${C.line}`, borderRadius: 9,
                padding: '11px 13px', textAlign: 'left', cursor: 'pointer', color: C.txt,
                fontFamily: 'inherit', fontSize: 14,
              }}>
                {e.es_prueba && <span style={{ color: C.acc, marginRight: 6 }}>🧪</span>}
                <b>{e.nombre}</b>
                <span style={{ color: C.dim, marginLeft: 8 }}>{e.fecha_evento}</span>
                {!e.lat && <span style={{ color: C.warn, marginLeft: 8, fontSize: 12 }}>· sin ubicación</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {(creando || sel) && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {[['datos', 'Datos y horarios'], ['personal', 'Personal'], ['req', `Requisición${nReq ? ` (${nReq})` : ''}`]].map(([k, t]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                background: tab === k ? C.acc : '#232327', color: '#fff', border: 'none',
                borderRadius: 8, padding: '8px 14px', fontSize: 14, cursor: 'pointer',
                fontWeight: tab === k ? 700 : 400, fontFamily: 'inherit',
              }}>{t}</button>
            ))}
          </div>

          {tab === 'datos' && (
            <div style={card}>
              {puedeEditar && (
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 11, cursor: 'pointer',
                  background: form.es_prueba ? '#101827' : '#101012',
                  border: `1px solid ${form.es_prueba ? C.acc : C.line}`,
                  borderRadius: 10, padding: '12px 14px', marginBottom: 16,
                }}>
                  <input type="checkbox" checked={!!form.es_prueba} style={{ width: 20, height: 20 }}
                    onChange={e => setForm(f => ({ ...f, es_prueba: e.target.checked }))} />
                  <span>
                    <b style={{ fontSize: 15, color: form.es_prueba ? C.acc : C.txt }}>
                      🧪 Esto es una prueba
                    </b>
                    <div style={{ fontSize: 13, color: form.es_prueba ? '#bfdbfe' : C.dim, marginTop: 2, lineHeight: 1.5 }}>
                      Podés recorrer todo el flujo igual que un evento real, pero
                      <b> no se manda pedido a Casa Matriz</b>. Borralo cuando termines.
                    </div>
                  </span>
                </label>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
                <div><label style={lbl}>Nombre del evento</label>
                  <input style={inp} value={form.nombre} disabled={!puedeEditar}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    placeholder="Colegio Cristóbal Colón" /></div>
                <div><label style={lbl}>Tipo</label>
                  <select style={inp} value={form.tipo_evento} disabled={!puedeEditar}
                    onChange={e => setForm(f => ({ ...f, tipo_evento: e.target.value }))}>
                    {TIPOS.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}
                  </select></div>
                <div><label style={lbl}>Fecha</label>
                  <input type="date" style={inp} value={form.fecha_evento || ''} disabled={!puedeEditar}
                    onChange={e => setForm(f => ({ ...f, fecha_evento: e.target.value }))} /></div>
                <div><label style={lbl}>Persona de contacto</label>
                  <input style={inp} value={form.contacto_nombre || ''} disabled={!puedeEditar}
                    onChange={e => setForm(f => ({ ...f, contacto_nombre: e.target.value }))} /></div>
                <div><label style={lbl}>Teléfono</label>
                  <input type="tel" style={inp} value={form.contacto_telefono || ''} disabled={!puedeEditar}
                    onChange={e => setForm(f => ({ ...f, contacto_telefono: e.target.value }))} /></div>
                <div><label style={lbl}>Referencia de la dirección</label>
                  <input style={inp} value={form.direccion_texto || ''} disabled={!puedeEditar}
                    onChange={e => setForm(f => ({ ...f, direccion_texto: e.target.value }))}
                    placeholder="Portón verde, frente a…" /></div>
              </div>

              <div style={{ marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
                <b style={{ fontSize: 15 }}>Los cinco horarios del día</b>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 11 }}>
                  {[
                    ['hora_llegada_cm', '1 · Llegar a Casa Matriz'],
                    ['hora_salida_cm', '2 · Salir de Casa Matriz'],
                    ['hora_llegada_evento', '3 · Llegar al evento'],
                    ['hora_inicio', '4 · Empieza el evento'],
                    ['hora_fin', '5 · Termina (estimado)'],
                  ].map(([k, t]) => (
                    <div key={k}><label style={lbl}>{t}</label>
                      <input type="time" style={inp} value={form[k] || ''} disabled={!puedeEditar}
                        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} /></div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'personal' && (
            <div style={card}>
              <b style={{ fontSize: 15 }}>Cuánta gente y en qué posición</b>
              <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {personal.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
                    <select style={{ ...inp, flex: 1 }} value={p.posicion} disabled={!puedeEditar}
                      onChange={e => setPersonal(v => v.map((x, j) => j === i ? { ...x, posicion: e.target.value } : x))}>
                      {POSICIONES.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input type="number" min="1" style={{ ...inp, width: 90, textAlign: 'center' }}
                      value={p.cantidad} disabled={!puedeEditar}
                      onChange={e => setPersonal(v => v.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} />
                    {puedeEditar && (
                      <button onClick={() => setPersonal(v => v.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', color: C.bad, fontSize: 20, cursor: 'pointer' }}>×</button>
                    )}
                  </div>
                ))}
              </div>
              {puedeEditar && (
                <button onClick={() => setPersonal(v => [...v, { posicion: POSICIONES[0], cantidad: 1 }])}
                  style={{ ...btn('#3f3f46'), marginTop: 11 }}>+ Agregar posición</button>
              )}
              <div style={{ color: C.dim, fontSize: 13, marginTop: 11 }}>
                Total: <b style={{ color: C.txt }}>{personal.reduce((a, p) => a + (Number(p.cantidad) || 0), 0)} personas</b>
              </div>
            </div>
          )}

          {tab === 'req' && (
            <div style={card}>
              <b style={{ fontSize: 15 }}>Requisición</b>
              <div style={{ color: C.dim, fontSize: 12.5, marginTop: 4, marginBottom: 12 }}>
                Filtrada para {TIPOS.find(t => t.v === form.tipo_evento)?.t}. Poné cantidad
                solo a lo que se necesita; lo demás queda en cero.
              </div>
              {secciones.map(sec => (
                <div key={sec} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: C.dim, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 7 }}>
                    {sec}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {visibles.filter(i => i.seccion === sec).map(i => (
                      <div key={i.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: reqs[i.id] > 0 ? '#0e2a17' : '#101012',
                        borderRadius: 8, padding: '8px 11px',
                      }}>
                        <span style={{ flex: 1, fontSize: 14 }}>
                          {i.nombre}
                          {i.sugerido && <span style={{ color: C.acc, fontSize: 11, marginLeft: 7 }}>sugerido</span>}
                          {!i.producto_id && <span style={{ color: C.warn, fontSize: 11, marginLeft: 7 }}>no despachable</span>}
                        </span>
                        <span style={{ color: C.dim, fontSize: 12, width: 62, textAlign: 'right' }}>{i.unidad}</span>
                        <input type="number" min="0" step="any" disabled={!puedeEditar}
                          value={reqs[i.id] ?? ''} placeholder="—"
                          onChange={e => setReqs(r => ({ ...r, [i.id]: e.target.value }))}
                          style={{ ...inp, width: 82, textAlign: 'center', padding: '7px 5px' }} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ color: C.dim, fontSize: 12.5, lineHeight: 1.5, borderTop: `1px solid ${C.line}`, paddingTop: 11 }}>
                Lo marcado <b style={{ color: C.warn }}>no despachable</b> (canopy, banner, extensión)
                sale en la lista pero no entra al pedido de Casa Matriz — no vive en el inventario.
              </div>
            </div>
          )}

          {puedeEditar && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={guardar} disabled={guardando} style={btn(C.ok, guardando)}>
                {guardando ? 'Guardando…' : sel ? 'Guardar cambios' : 'Crear evento y enviar requisición'}
              </button>
              <button onClick={() => { setSel(null); setCreando(false); setMsg('') }} style={btn('#3f3f46')}>
                Cancelar
              </button>
              {sel && (
                <button onClick={borrar} style={{ ...btn('#3f3f46'), color: C.bad }}>
                  {sel.es_prueba ? 'Borrar prueba' : 'Borrar evento'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
