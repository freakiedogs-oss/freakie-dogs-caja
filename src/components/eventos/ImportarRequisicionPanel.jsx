/* ═══════════════════════════════════════════════════════════════════════
   Importar requisición de evento desde el Excel de Edgar

   Antes había que teclear los ~50 renglones de la hoja de control uno por
   uno en la pestaña de requisición. Ahora se sube el archivo, se elige la
   pestaña del montaje, se revisa lo que el sistema no pudo emparejar solo,
   y con un botón se llena la requisición.

   El panel NO crea el pedido: deja las cantidades cargadas en la pantalla.
   El pedido a Casa Matriz sigue saliendo del botón de guardar del evento,
   que es el que ya tenía los permisos y la validación.
   ═══════════════════════════════════════════════════════════════════════ */

import { useState } from 'react'
import { leerLibro, emparejar, resumir } from './importarRequisicion'

const C = {
  card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', warn: '#fbbf24', bad: '#ef4444', acc: '#60a5fa',
}
const inp = {
  background: '#101012', color: C.txt, border: `1px solid ${C.line}`,
  borderRadius: 7, padding: '7px 9px', fontSize: 13.5, fontFamily: 'inherit',
}
const btn = (color, off) => ({
  background: off ? '#3a3a3e' : color, color: '#fff', border: 'none', borderRadius: 9,
  padding: '10px 17px', fontSize: 14.5, fontWeight: 700, cursor: off ? 'not-allowed' : 'pointer',
  opacity: off ? 0.55 : 1, fontFamily: 'inherit',
})

// Los metadatos del pie de la hoja se muestran con nombre humano.
const ETIQUETA_META = {
  nombre: 'Nombre del evento',
  lugar: 'Lugar',
  hora_evento: 'Hora del evento',
  hora_recibir: 'Recibir producto',
  hora_salida: 'Salida Casa Matriz',
}

/* Excel guarda las horas como fracción de día (0.6666 = 4:00 PM). Cuando
   viene así lo pasamos a HH:MM; cuando viene como texto ("7:00 PM A 10:00 PM")
   se deja tal cual, porque un rango no cabe en un campo de hora. */
function horaLegible(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || v === '' || v == null) return String(v ?? '')
  if (n < 0 || n >= 1) return String(v)
  const min = Math.round(n * 24 * 60)
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export default function ImportarRequisicionPanel({ catalogo, onAplicar, onCerrar }) {
  const [hojas, setHojas]   = useState(null)    // [{nombre, items, meta, filasSinNombre}]
  const [iHoja, setIHoja]   = useState(null)
  const [filas, setFilas]   = useState([])      // lo emparejado, editable
  const [cargando, setCarg] = useState(false)
  const [error, setError]   = useState('')
  const [archivo, setArch]  = useState('')

  async function subir(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCarg(true); setError(''); setHojas(null); setIHoja(null); setFilas([])
    setArch(file.name)
    try {
      const hs = await leerLibro(file)
      setHojas(hs)
      // Si solo una pestaña trae ítems, se abre sola.
      const conItems = hs.map((h, i) => [h, i]).filter(([h]) => h.items.length > 0)
      if (conItems.length === 1) elegirHoja(hs, conItems[0][1])
    } catch (err) {
      setError('No se pudo leer el archivo: ' + (err?.message || err))
    }
    setCarg(false)
    e.target.value = ''   // para poder volver a subir el mismo archivo
  }

  function elegirHoja(hs, i) {
    setIHoja(i)
    setFilas(emparejar(hs[i].items, catalogo).map((f, k) => ({ ...f, k, omitir: false })))
  }

  const hoja = hojas && iHoja != null ? hojas[iHoja] : null
  const res  = hoja ? resumir(filas.filter(f => !f.omitir)) : null

  const editar = (k, campo, valor) => setFilas(v => v.map(f => (f.k === k ? { ...f, [campo]: valor } : f)))

  function elegirItem(k, itemId) {
    const it = catalogo.find(c => c.id === itemId) || null
    setFilas(v => v.map(f => (f.k === k
      ? { ...f, item_id: it?.id || null, item_nombre: it?.nombre || null,
          producto_id: it?.producto_id || null, despachable: !!it?.producto_id,
          confianza: it ? 'manual' : null, revisar: !it }
      : f)))
  }

  // Lo que realmente va a pasar a la requisición. Dos renglones al mismo
  // ítem se suman (la hoja a veces repite "Guantes" en dos secciones).
  function construirMapa() {
    const mapa = {}
    for (const f of filas) {
      if (f.omitir || !f.item_id) continue
      const c = Number(f.cantidad)
      if (!Number.isFinite(c) || c <= 0) continue
      mapa[f.item_id] = (mapa[f.item_id] || 0) + c
    }
    return mapa
  }

  const mapa        = construirMapa()
  const aPasar      = Object.keys(mapa).length
  const sinResolver = filas.filter(f => !f.omitir && !f.item_id && Number(f.cantidad) > 0).length
  const dudosas     = filas.filter(f => !f.omitir && f.dudosa && Number(f.cantidad) > 0).length

  return (
    <div style={{ background: C.card, border: `1px solid ${C.acc}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>📄 Importar la hoja de control (Excel)</b>
        <button onClick={onCerrar} style={{ background: 'none', border: 'none', color: C.dim, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ color: C.dim, fontSize: 12.5, marginTop: 5, marginBottom: 12, lineHeight: 1.5 }}>
        Subí la “Hoja de Control Eventos” tal como la llenás. Se lee la columna
        de alimentos y la de cantidad; lo que no se reconozca queda marcado para
        que lo arregles acá antes de pasarlo a la requisición.
      </div>

      <label style={{ ...btn(C.acc), display: 'inline-block' }}>
        {cargando ? 'Leyendo…' : hojas ? 'Cambiar archivo' : 'Elegir archivo Excel'}
        <input type="file" accept=".xlsx,.xls,.xlsm,.csv" onChange={subir} disabled={cargando}
          style={{ display: 'none' }} />
      </label>
      {archivo && <span style={{ color: C.dim, fontSize: 12.5, marginLeft: 10 }}>{archivo}</span>}

      {error && (
        <div style={{ marginTop: 11, background: '#3a1212', color: '#fecaca', borderRadius: 8, padding: '9px 11px', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* ── Paso 1: elegir pestaña ─────────────────────────────────── */}
      {hojas && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, color: C.dim, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 7 }}>
            ¿Qué pestaña es este evento?
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hojas.map((h, i) => (
              <button key={h.nombre} onClick={() => elegirHoja(hojas, i)}
                style={{
                  ...btn(i === iHoja ? C.ok : '#3f3f46'),
                  padding: '9px 14px', fontSize: 13.5,
                  opacity: h.items.length ? 1 : 0.5,
                }}>
                {h.nombre}
                <span style={{ fontWeight: 400, marginLeft: 7, fontSize: 12 }}>
                  {h.items.length} ítems
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Paso 2: revisar ─────────────────────────────────────────── */}
      {hoja && (
        <>
          {!!hoja.filasSinNombre && (
            <div style={{ marginTop: 12, background: '#3a2a12', color: '#fde68a', borderRadius: 8, padding: '9px 11px', fontSize: 13, lineHeight: 1.5 }}>
              ⚠ En esta pestaña hay <b>{hoja.filasSinNombre} renglones con cantidad pero sin nombre</b> —
              la columna de alimentos está vacía. Esos no se pueden importar: escribí
              los nombres en el Excel y volvé a subirlo, o cargalos a mano abajo.
            </div>
          )}

          {Object.keys(hoja.meta).length > 0 && (
            <div style={{ marginTop: 12, background: '#101827', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: C.acc, marginBottom: 6 }}>Datos del evento en la hoja</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', fontSize: 13 }}>
                {Object.entries(hoja.meta).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                  <span key={k} style={{ color: C.dim }}>
                    {ETIQUETA_META[k] || k}: <b style={{ color: C.txt }}>
                      {k.startsWith('hora') ? horaLegible(v) : v}
                    </b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '13px 0 9px', fontSize: 13 }}>
            <span style={{ color: C.ok }}>✓ {aPasar} listos</span>
            {!!dudosas && <span style={{ color: C.warn }} title="La cantidad venía escrita; se leyó el número, confirmá la unidad">
              ⚠ {dudosas} con cantidad escrita
            </span>}
            {!!sinResolver && <span style={{ color: C.bad }}>✕ {sinResolver} sin producto</span>}
            {!!res.enCero && <span style={{ color: C.dim }}>{res.enCero} en cero</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 420, overflowY: 'auto' }}>
            {filas.map(f => {
              const cant = Number(f.cantidad)
              const cero = !Number.isFinite(cant) || cant <= 0
              const malo = !f.item_id && !cero
              return (
                <div key={f.k} style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  background: f.omitir ? '#141416' : malo ? '#2a1212' : f.dudosa && !cero ? '#2a2412' : '#101012',
                  borderRadius: 8, padding: '7px 10px',
                  opacity: f.omitir || cero ? 0.5 : 1,
                }}>
                  <span style={{ width: 168, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={`${f.seccion} · ${f.nombre}`}>
                    {f.nombre}
                  </span>

                  <input type="number" min="0" step="any" value={f.cantidad ?? ''} placeholder="—"
                    onChange={e => editar(f.k, 'cantidad', e.target.value === '' ? null : Number(e.target.value))}
                    style={{ ...inp, width: 72, textAlign: 'center' }} />

                  {f.textoCantidad && (
                    <span style={{ color: C.warn, fontSize: 11.5 }} title="Así venía en el Excel">
                      «{f.textoCantidad}»
                    </span>
                  )}

                  <span style={{ color: C.dim, fontSize: 13 }}>→</span>

                  <select value={f.item_id || ''} onChange={e => elegirItem(f.k, e.target.value)}
                    style={{ ...inp, flex: 1, minWidth: 190, borderColor: malo ? C.bad : C.line }}>
                    <option value="">— elegí el producto —</option>
                    {catalogo.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}{c.producto_id ? '' : '  (no despachable)'}
                      </option>
                    ))}
                  </select>

                  <button onClick={() => editar(f.k, 'omitir', !f.omitir)} title="No importar este renglón"
                    style={{ background: 'none', border: `1px solid ${C.line}`, color: f.omitir ? C.ok : C.dim,
                             borderRadius: 7, padding: '5px 9px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {f.omitir ? 'incluir' : 'omitir'}
                  </button>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => onAplicar(mapa, hoja.meta || {}, hoja.nombre)}
              disabled={!aPasar} style={btn(C.ok, !aPasar)}>
              Pasar {aPasar} ítems a la requisición
            </button>
            {!!sinResolver && (
              <span style={{ color: C.warn, fontSize: 12.5 }}>
                {sinResolver} sin producto quedan fuera. Elegilos arriba o marcalos “omitir”.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
