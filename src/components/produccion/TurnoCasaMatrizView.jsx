/* ═══════════════════════════════════════════════════════════════════════
   Turno de Casa Matriz · lo que Kevin necesita ver sin ir a preguntar

   Pedido de Cesar (4-oct-2026): una tabla en vivo con quién marcó entrada y
   salida, qué pesó e imprimió cada persona y de qué productos ya registró
   insumos. Hasta hoy un pendiente se descubría recién cuando alguien quería
   marcar salida y Mi Asistencia lo frenaba: tarde, con la persona apurada.

   Arriba van los que deben algo; abajo, los que están al día o no vinieron.
   Se refresca sola cada 20 s y al volver a la pestaña. Solo lee: registrar
   insumos se sigue haciendo en /preparacion.html con el PIN de cada quien.
   ═══════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useState } from 'react'
import { db } from '../../supabase'
import { today } from '../../config'

const C = {
  card: '#1a1a1c', line: '#2a2a2e', txt: '#f0f0f2', dim: '#8a8a92',
  ok: '#22c55e', okBg: '#0b2417', warn: '#f59e0b', warnBg: '#2a1f06',
  bad: '#ef4444', badBg: '#2a1212', acc: '#60a5fa',
}
const REFRESCO_MS = 20000

const hora = (iso) => iso
  ? new Date(iso).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' })
  : null
const nombreCorto = (n = '') => { const p = n.split(' '); return p.length > 2 ? `${p[0]} ${p[p.length - 2]}` : n }
const lb = (g) => (Number(g) / 453.59237).toFixed(1)
const diaLegible = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })
}

// Qué le pasa a esta persona hoy, en una sola palabra para la columna de estado.
function estadoDe(p) {
  const imprimio = p.productos.length > 0
  if (p.salida && p.pendientes > 0) return { txt: 'Salió debiendo', color: C.bad, bg: C.badBg }
  if (p.pendientes > 0) return { txt: `Debe ${p.pendientes} ${p.pendientes === 1 ? 'producto' : 'productos'}`, color: C.warn, bg: C.warnBg }
  if (p.recibidos.length > 0) return { txt: 'Recibió un lote', color: C.warn, bg: C.warnBg }
  if (imprimio) return { txt: 'Al día', color: C.ok, bg: C.okBg }
  if (p.salida) return { txt: 'Salió', color: C.dim, bg: 'transparent' }
  if (p.entrada) return { txt: 'Sin imprimir', color: C.dim, bg: 'transparent' }
  return { txt: 'No vino', color: '#55555c', bg: 'transparent' }
}

export default function TurnoCasaMatrizView({ user }) {
  const [fecha, setFecha] = useState(today())
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [cargando, setCargando] = useState(true)
  const [verTodos, setVerTodos] = useState(false)

  const cargar = useCallback(async () => {
    const { data: d, error } = await db.rpc('fn_prep_turno', { p_actor: user?.id, p_fecha: fecha })
    if (error) { setErr(error.message); setCargando(false); return }
    setErr(''); setData(d); setCargando(false)
  }, [user?.id, fecha])

  useEffect(() => {
    setCargando(true); cargar()
    // Solo el día de hoy cambia solo; un día pasado no tiene nada que refrescar.
    if (fecha !== today()) return
    const t = setInterval(cargar, REFRESCO_MS)
    const alVolver = () => { if (document.visibilityState === 'visible') cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', alVolver) }
  }, [cargar, fecha])

  const mover = (dias) => {
    const [y, m, d] = fecha.split('-').map(Number)
    const x = new Date(y, m - 1, d + dias)
    const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    if (iso <= today()) setFecha(iso)
  }

  if (err) return (
    <div style={{ padding: 16 }}>
      <div style={{ background: C.badBg, border: `1px solid ${C.bad}`, color: '#fecaca', borderRadius: 12, padding: 14 }}>{err}</div>
    </div>
  )
  if (cargando && !data) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spin" style={{ width: 26, height: 26, margin: '0 auto' }} /></div>

  const r = data?.resumen || {}
  const personas = data?.personas || []
  // Los que no vinieron ni imprimieron solo hacen ruido: se esconden salvo que se pidan.
  const visibles = verTodos ? personas : personas.filter(p => p.entrada || p.productos.length > 0 || p.recibidos.length > 0 || p.deudas_viejas > 0)
  const ocultos = personas.length - visibles.length
  const esHoy = fecha === today()

  return (
    <div style={{ padding: 14, maxWidth: 1100, margin: '0 auto', color: C.txt }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 19, fontWeight: 800 }}>Turno de Casa Matriz</div>
          <div style={{ color: C.dim, fontSize: 13, textTransform: 'capitalize' }}>
            {diaLegible(fecha)}{esHoy && <span style={{ textTransform: 'none' }}> · se actualiza solo</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => mover(-1)} style={btn}>← Día anterior</button>
          {!esHoy && <button onClick={() => setFecha(today())} style={btn}>Hoy</button>}
          {!esHoy && <button onClick={() => mover(1)} style={btn}>Día siguiente →</button>}
        </div>
      </div>

      {/* Números del día */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 14 }}>
        <Cifra label="Trabajando ahora" valor={r.presentes} color={C.acc} />
        <Cifra label="Ya marcaron salida" valor={r.salieron} />
        <Cifra label="Productos con insumos" valor={r.productos_registrados} color={C.ok} />
        <Cifra label="Productos sin insumos" valor={r.productos_pendientes}
               color={r.productos_pendientes > 0 ? C.warn : C.ok}
               sub={r.personas_con_pendientes > 0 ? `${r.personas_con_pendientes} ${r.personas_con_pendientes === 1 ? 'persona' : 'personas'}` : 'nadie debe'} />
      </div>

      {/* Tabla */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '10px 14px',
                      fontSize: 11.5, color: C.dim, borderBottom: `1px solid ${C.line}`, textTransform: 'uppercase', letterSpacing: .4 }}>
          <span>Persona</span><span>Entrada</span><span>Salida</span><span>Qué pesó e imprimió · insumos</span><span>Estado</span>
        </div>

        {visibles.map(p => {
          const e = estadoDe(p)
          return (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 10, padding: '12px 14px',
                                      borderBottom: `1px solid ${C.line}`, alignItems: 'start',
                                      background: p.pendientes > 0 ? 'rgba(245,158,11,.04)' : 'transparent' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{nombreCorto(p.nombre)}</div>
                <div style={{ color: C.dim, fontSize: 12 }}>{p.rol === 'jefe_casa_matriz' ? 'encargado' : p.rol}</div>
              </div>

              <div style={{ fontSize: 14, fontFamily: 'ui-monospace, monospace' }}>
                {hora(p.entrada) || <span style={{ color: '#55555c' }}>—</span>}
                {p.minutos_tarde > 0 && <div style={{ fontSize: 11, color: C.warn, fontFamily: 'inherit' }}>+{p.minutos_tarde} min</div>}
              </div>

              <div style={{ fontSize: 14, fontFamily: 'ui-monospace, monospace' }}>
                {hora(p.salida) || <span style={{ color: '#55555c' }}>—</span>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {p.productos.length === 0 && p.recibidos.length === 0 && (
                  <span style={{ color: '#55555c', fontSize: 13 }}>—</span>
                )}
                {p.productos.map((x, i) => <FilaProducto key={i} x={x} propio={p.nombre} />)}
                {p.recibidos.map((x, i) => (
                  <div key={'r' + i} style={{ fontSize: 12.5, color: C.warn }}>
                    ↪ Recibió el lote {x.lote} de {nombreCorto(x.de || '')} · le toca registrarlo
                  </div>
                ))}
                {p.deudas_viejas > 0 && (
                  <div style={{ fontSize: 12.5, color: C.bad }}>
                    ⚠ Tiene {p.deudas_viejas} {p.deudas_viejas === 1 ? 'lote' : 'lotes'} de días anteriores sin insumos
                  </div>
                )}
              </div>

              <div>
                <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: e.color, background: e.bg,
                               border: `1px solid ${e.color}55`, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>
                  {e.txt}
                </span>
              </div>
            </div>
          )
        })}

        {visibles.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: C.dim }}>Nadie marcó entrada ni imprimió etiquetas este día.</div>
        )}
      </div>

      {ocultos > 0 && (
        <button onClick={() => setVerTodos(v => !v)} style={{ ...btn, marginTop: 10 }}>
          {verTodos ? 'Ocultar a los que no vinieron' : `Ver también a los ${ocultos} que no vinieron`}
        </button>
      )}

      <div style={{ color: C.dim, fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
        Los insumos se registran al final del turno en la estación de preparación, con el PIN de cada persona.
        Un producto queda en verde cuando su lote tiene insumos de su receta. Si los registró otra persona
        (porque le pasaron el lote o lo hizo un encargado), se dice quién.
      </div>
    </div>
  )
}

const COLS = 'minmax(130px,1.1fr) 70px 70px minmax(240px,3fr) 130px'
const btn = { background: '#1c1c20', border: `1px solid ${C.line}`, color: C.txt, borderRadius: 8,
              padding: '7px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }

function Cifra({ label, valor, color, sub }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ color: C.dim, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: color || C.txt, lineHeight: 1.2 }}>{valor ?? 0}</div>
      {sub && <div style={{ color: C.dim, fontSize: 11.5 }}>{sub}</div>}
    </div>
  )
}

function FilaProducto({ x, propio }) {
  const ok = x.registrado
  const porOtro = ok && x.registrado_por && !x.registrado_por.split(', ').includes(propio)
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 13.5 }}>
      <span style={{ color: ok ? C.ok : C.warn, fontWeight: 800, width: 14 }}>{ok ? '✓' : '○'}</span>
      <span style={{ fontWeight: 600 }}>{x.nombre}</span>
      <span style={{ color: C.dim, fontSize: 12.5 }}>
        {x.unidades} {x.unidades === 1 ? 'unidad' : 'unidades'}{Number(x.gramos) > 0 ? ` · ${lb(x.gramos)} lb` : ''}
        {' · '}{hora(x.primera)}{x.ultima && hora(x.ultima) !== hora(x.primera) ? `–${hora(x.ultima)}` : ''}
      </span>
      {ok ? (
        <span style={{ color: C.ok, fontSize: 12.5 }}>
          insumos {hora(x.registrado_at)}{porOtro ? ` · los registró ${nombreCorto(x.registrado_por)}` : ''}
        </span>
      ) : (
        <span style={{ color: C.warn, fontSize: 12.5 }}>
          sin insumos{x.debe && x.debe !== propio ? ` · se lo pasó a ${nombreCorto(x.debe)}` : ''}
          {x.autorizado ? ` · salió autorizado por ${x.autorizado.por}${x.autorizado.motivo ? ` («${x.autorizado.motivo}»)` : ''}` : ''}
        </span>
      )}
    </div>
  )
}
