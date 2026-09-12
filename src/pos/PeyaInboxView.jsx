// ────────────────────────────────────────────────────────────────────
// Bandeja de PedidosYa · lo que hace la cajera cuando llega el driver
//
// Con la aceptación automática prendida, el trabajo cambió: ya nadie tiene que
// aceptar nada. El driver llega, dice un número, y la cajera tiene que
// encontrarlo rápido y cerrarlo. Por eso el NÚMERO es lo más grande de la
// pantalla y el botón es uno solo.
//
// El número es el `shortCode` de Delivery Hero, no el `code` largo. Su spec:
// «Used for rider to identify which order to pickup in a user friendly way».
//
// Marcar retirado hace tres cosas de un golpe: le avisa a PedidosYa, cierra la
// cuenta como CxC PeYa y registra el pago. No entra efectivo — PeYa liquida el
// viernes, igual que hoy.
//
// El alcance lo decide el servidor a partir del PIN (RPC `peya_panel`), igual
// que el panel de delivery. Nada de secretos en el frontend: el POS corre en un
// navegador y cualquier secreto fijo se lee con F12.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react'
import { db, URL_SB } from '../supabase'

const REFRESH_MS = 15000

const C = {
  fondo: '#0f0f12', card: '#191920', borde: '#2a2a33', texto: '#f0f0f3',
  dim: '#8a8a95', verde: '#4ade80', amarillo: '#fbbf24', rojo: '#e63946',
  azul: '#60a5fa', morado: '#a78bfa',
}

// Los tres tipos del contrato. Cambian quién se lleva la comida y, por lo tanto,
// cuál es el botón de cierre.
const TIPO = {
  pickup:          { et: '🛍️', label: 'Lo retira el cliente', cierre: 'retirado',  boton: 'Cliente lo retiró' },
  vendor_delivery: { et: '🛵', label: 'Lo lleva PedidosYa',    cierre: 'preparado', boton: 'Listo para el driver' },
  own_delivery:    { et: '🚗', label: 'Lo llevamos nosotros',  cierre: 'retirado',  boton: 'Salió con el motorista' },
  desconocido:     { et: '❓', label: 'Tipo desconocido',      cierre: 'retirado',  boton: 'Marcar retirado' },
}

const ESTADO = {
  recibido:  { label: 'Sin contestar', col: C.amarillo },
  aceptado:  { label: 'En cocina',     col: C.verde },
  preparado: { label: 'Listo',         col: C.azul },
  rechazado: { label: 'Rechazado',     col: C.rojo },
  retirado:  { label: 'Entregado',     col: C.dim },
  cancelado: { label: 'Cancelado',     col: C.rojo },
}

// Los 24 motivos los define Delivery Hero; éstos son los que usa la operación.
const MOTIVOS = [
  { v: 'ITEM_UNAVAILABLE',             t: 'Se acabó un producto' },
  { v: 'TOO_BUSY',                     t: 'Cocina saturada' },
  { v: 'CLOSED',                       t: 'Tienda cerrada' },
  { v: 'TECHNICAL_PROBLEM',            t: 'Problema técnico' },
  { v: 'ADDRESS_OUT_OF_DELIVERY_AREA', t: 'Fuera de zona' },
  { v: 'CUSTOMER_CALLED_TO_CANCEL',    t: 'El cliente canceló' },
  { v: 'TEST_ORDER',                   t: 'Pedido de prueba' },
]

const dosDig = (n) => String(n).padStart(2, '0')

function timbre() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator(), gan = ctx.createGain()
    osc.connect(gan); gan.connect(ctx.destination)
    osc.frequency.value = 880
    gan.gain.setValueAtTime(0.001, ctx.currentTime)
    gan.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
    gan.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(); osc.stop(ctx.currentTime + 0.5)
    setTimeout(() => ctx.close(), 800)
  } catch { /* sin sonido, la pantalla igual avisa en color */ }
}

// Reloj sólo para lo que sigue sin contestar. Con la aceptación automática esto
// casi no aparece — cuando aparece, es que algo falló y hay que mirarlo.
function Reloj({ segundosBase, desde }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const queda = Math.max(0, (segundosBase ?? 0) - Math.floor((Date.now() - desde) / 1000))
  // Abajo de 2 minutos ya no se puede aceptar: DH exige que el acceptanceTime
  // esté al menos 2 min en el futuro.
  const col = queda < 120 ? C.rojo : queda < 300 ? C.amarillo : C.verde
  return (
    <div style={{ textAlign: 'right', minWidth: 74 }}>
      <div style={{
        fontSize: 22, fontWeight: 800, color: col, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        animation: queda > 0 && queda < 120 ? 'peyaLatido 1s ease-in-out infinite' : 'none',
      }}>{queda === 0 ? '⌛' : `${dosDig(Math.floor(queda / 60))}:${dosDig(queda % 60)}`}</div>
      <div style={{ fontSize: 9.5, color: C.dim, textTransform: 'uppercase', letterSpacing: .5 }}>
        {queda === 0 ? 'vencido' : 'para contestar'}
      </div>
    </div>
  )
}

// ── Hoja de rechazo ──
function HojaRechazo({ pedido, onCerrar, onConfirmar, enviando }) {
  const [motivo, setMotivo] = useState('')
  const [nota, setNota] = useState('')
  return (
    <div onClick={onCerrar} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 60,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: C.card, borderTop: `2px solid ${C.rojo}`, borderRadius: '18px 18px 0 0',
        padding: '20px 18px 28px', width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
          Rechazar PeYa #{pedido.short_code || pedido.remote_order_id}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 16 }}>
          El cliente recibe el aviso de PedidosYa. Elegí el motivo real: de esto salen sus reportes.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {MOTIVOS.map((m) => (
            <button key={m.v} onClick={() => setMotivo(m.v)} style={{
              padding: '13px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5,
              fontWeight: 600, textAlign: 'left', lineHeight: 1.25,
              border: `1px solid ${motivo === m.v ? C.rojo : C.borde}`,
              background: motivo === m.v ? '#2a1116' : '#141418',
              color: motivo === m.v ? '#ffd9dd' : C.texto,
            }}>{m.t}</button>
          ))}
        </div>
        <input value={nota} onChange={(e) => setNota(e.target.value)}
          placeholder="Detalle opcional (ej. se acabó el pan brioche)"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 10,
            border: `1px solid ${C.borde}`, background: '#141418', color: C.texto,
            fontSize: 14, marginBottom: 16,
          }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCerrar} style={{
            flex: 1, padding: '15px', borderRadius: 11, border: `1px solid ${C.borde}`,
            background: 'transparent', color: C.dim, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}>Cancelar</button>
          <button disabled={!motivo || enviando} onClick={() => onConfirmar(motivo, nota)} style={{
            flex: 2, padding: '15px', borderRadius: 11, border: 'none',
            background: motivo ? C.rojo : '#33333c', color: motivo ? '#fff' : C.dim,
            fontSize: 15, fontWeight: 800, cursor: motivo ? 'pointer' : 'not-allowed',
            opacity: enviando ? .6 : 1,
          }}>{enviando ? 'Rechazando…' : 'Confirmar rechazo'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Tarjeta ──
// El número manda. Todo lo demás está para confirmar que es el pedido correcto.
function Tarjeta({ p, ahoraBase, onAccion, ocupado }) {
  const [abierto, setAbierto] = useState(false)
  const tipo = TIPO[p.tipo_orden] || TIPO.desconocido
  const est = ESTADO[p.estado] || { label: p.estado, col: C.dim }
  const productos = Array.isArray(p.productos) ? p.productos : []
  const cliente = [p.cliente?.firstName, p.cliente?.lastName].filter(Boolean).join(' ')
  const nota = p.comentarios?.customerComment
  const enCocina = p.estado === 'aceptado' || p.estado === 'preparado'
  const sinContestar = p.estado === 'recibido'
  const cerrado = ['rechazado', 'retirado', 'cancelado'].includes(p.estado)

  return (
    <div style={{
      background: C.card, borderRadius: 14, marginBottom: 12, overflow: 'hidden',
      border: `1px solid ${enCocina ? C.verde + '55' : sinContestar ? C.amarillo : C.borde}`,
      opacity: cerrado ? .65 : 1,
    }}>
      <div onClick={() => setAbierto((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 15px', cursor: 'pointer' }}>
        {/* El número, en grande. Es lo que grita el driver al llegar. */}
        <div style={{ textAlign: 'center', minWidth: 76 }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: C.morado, letterSpacing: 1,
            textTransform: 'uppercase', marginBottom: 1,
          }}>PeYa</div>
          <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {p.short_code || '—'}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: `${est.col}1e`, color: est.col,
            }}>{est.label}</span>
            {p.es_prueba && (
              <span style={{
                fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 5,
                background: '#3a2a00', color: C.amarillo, textTransform: 'uppercase', letterSpacing: .5,
              }}>Prueba</span>
            )}
          </div>
          <div style={{ fontSize: 13, color: C.texto, marginTop: 4, fontWeight: 600 }}>
            {tipo.et} {cliente || 'Cliente sin nombre'}
          </div>
          <div style={{ fontSize: 11.5, color: C.dim, marginTop: 1 }}>
            {productos.length} ítem{productos.length === 1 ? '' : 's'} · {tipo.label}
            {p.store_code ? ` · ${p.store_code}` : ''}
          </div>
        </div>

        {sinContestar
          ? <Reloj segundosBase={p.segundos_restantes} desde={ahoraBase} />
          : <span style={{ color: C.dim, fontSize: 17 }}>{abierto ? '▾' : '▸'}</span>}
      </div>

      {abierto && (
        <div style={{ padding: '0 15px 12px' }}>
          <div style={{ borderTop: `1px solid ${C.borde}`, paddingTop: 11 }}>
            {productos.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, fontSize: 13.5 }}>
                <span style={{ color: C.morado, fontWeight: 800, minWidth: 24 }}>{it.quantity}×</span>
                <span style={{ flex: 1 }}>{it.name}</span>
              </div>
            ))}
            {!productos.length && (
              <div style={{ fontSize: 13, color: C.dim }}>Sin detalle de productos.</div>
            )}
          </div>
          {nota && (
            <div style={{
              marginTop: 10, padding: '9px 11px', borderRadius: 9,
              background: '#2a2207', border: `1px solid ${C.amarillo}44`,
              fontSize: 12.5, color: '#ffe9b0',
            }}>📝 {nota}</div>
          )}
          {p.motivo_rechazo && (
            <div style={{ marginTop: 9, fontSize: 12.5, color: C.rojo }}>Rechazado: {p.motivo_rechazo}</div>
          )}
          {/* Un pedido que se ve vivo mientras se vence es el peor de los mundos. */}
          {p.respuesta_http >= 400 && (
            <div style={{
              marginTop: 10, padding: '9px 11px', borderRadius: 9,
              background: '#2a1116', border: `1px solid ${C.rojo}66`, fontSize: 12.5, color: '#ffc9cf',
            }}>⚠️ PedidosYa devolvió {p.respuesta_http}. Este pedido no está contestado de su lado.</div>
          )}
          {p.notas && (
            <div style={{ marginTop: 9, fontSize: 12, color: C.amarillo }}>⚠️ {p.notas}</div>
          )}
        </div>
      )}

      {/* Un solo botón, del ancho de la tarjeta: es lo único que hay que hacer. */}
      {enCocina && (
        <button disabled={ocupado} onClick={() => onAccion(p, tipo.cierre)} style={{
          width: '100%', padding: '17px', border: 'none', borderTop: `1px solid ${C.borde}`,
          background: ocupado ? '#2a3a30' : C.verde, color: '#06210f',
          fontSize: 16.5, fontWeight: 800, cursor: 'pointer',
        }}>{ocupado ? 'Cerrando…' : tipo.boton}</button>
      )}

      {sinContestar && (
        <div style={{ display: 'flex', gap: 8, padding: '0 15px 14px' }}>
          <button disabled={ocupado} onClick={() => onAccion(p, 'rechazar')} style={{
            flex: 1, padding: '14px', borderRadius: 11, border: `1px solid ${C.rojo}`,
            background: 'transparent', color: C.rojo, fontSize: 14.5, fontWeight: 700, cursor: 'pointer',
          }}>Rechazar</button>
          <button disabled={ocupado} onClick={() => onAccion(p, 'aceptar')} style={{
            flex: 2, padding: '14px', borderRadius: 11, border: 'none',
            background: C.verde, color: '#06210f', fontSize: 15, fontWeight: 800, cursor: 'pointer',
          }}>{ocupado ? 'Enviando…' : 'Aceptar'}</button>
        </div>
      )}
    </div>
  )
}

const ROLES_SIMULAR = ['gerente', 'admin', 'superadmin', 'ejecutivo']

export default function PeyaInboxView({ user, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(null)
  const [rechazando, setRechazando] = useState(null)
  const [ahoraBase, setAhoraBase] = useState(Date.now())
  const [sonido, setSonido] = useState(() => localStorage.getItem('peya_sonido') !== '0')
  const idsVistos = useRef(null)

  const cargar = useCallback(async () => {
    if (!user?.pin) { setError('Sin PIN de sesión'); return }
    try {
      const { data: r, error: e } = await db.rpc('peya_panel', { p_pin: String(user.pin) })
      if (e) throw e
      // El timbre suena por lo que ENTRA, no por lo que falta contestar: con la
      // aceptación automática lo normal es que ya esté aceptado al aparecer.
      const activos = (r?.pedidos || []).filter((p) => ['recibido', 'aceptado'].includes(p.estado))
      const ids = new Set(activos.map((p) => p.id))
      if (idsVistos.current) {
        const nuevos = [...ids].filter((id) => !idsVistos.current.has(id))
        if (nuevos.length && sonido) timbre()
      }
      idsVistos.current = ids
      setData(r); setAhoraBase(Date.now()); setError('')
    } catch (e) { setError(e.message || 'No se pudo cargar') }
  }, [user?.pin, sonido])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, REFRESH_MS)
    return () => clearInterval(t)
  }, [cargar])

  const enviar = async (p, accion, motivo, mensaje) => {
    setOcupado(p.remote_order_id); setError(''); setAviso('')
    try {
      const r = await fetch(`${URL_SB}/functions/v1/peya-responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: String(user.pin), remoteOrderId: p.remote_order_id, accion, motivo, mensaje,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        throw new Error(
          j.error === 'pedido_de_otra_sucursal' ? 'Ese pedido es de otra sucursal'
          : j.respuesta?.http ? `PedidosYa respondió ${j.respuesta.http}`
          : j.error || j.message || `HTTP ${r.status}`)
      }
      // El cierre a cuentas por cobrar lo hace el servidor al confirmar el retiro.
      // Se avisa con el monto para que la cajera lo vea y no tenga que ir a buscarlo.
      if (j.cierre?.ok) {
        setAviso(`PeYa #${p.short_code} cerrado · $${Number(j.cierre.total).toFixed(2)} a cuentas por cobrar`)
      } else if (j.cierre && !j.cierre.ok) {
        setError(`Se avisó a PedidosYa, pero la cuenta NO se cerró: ${j.cierre.error}`)
      } else {
        setAviso(accion === 'rechazar' ? `PeYa #${p.short_code} rechazado` : `PeYa #${p.short_code} actualizado`)
      }
      setRechazando(null)
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo enviar') }
    finally { setOcupado(null) }
  }

  const onAccion = (p, accion) => {
    if (accion === 'rechazar') { setRechazando(p); return }
    enviar(p, accion)
  }

  const simular = async () => {
    setError(''); setAviso('')
    try {
      // Va a la sucursal que el cajero tiene abierta en pantalla, no a la de su
      // usuario: Casa Matriz está excluida del POS, así que un superadmin no
      // podría ver nunca lo que simula en su propia sucursal.
      const { data: r, error: e } = await db.rpc('peya_simular_pedido', {
        p_pin: String(user.pin),
        p_store_code: user.store_code || null,
      })
      if (e) throw e
      setAviso(`Prueba creada en ${r?.sucursal || ''}: PeYa #${r?.shortCode || ''} — la comanda dice NO COCINAR`)
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo simular') }
  }

  const pedidos = data?.pedidos || []
  const sinContestar = pedidos.filter((p) => p.estado === 'recibido')
  const enCocina = pedidos.filter((p) => ['aceptado', 'preparado'].includes(p.estado))
  const cerrados = pedidos.filter((p) => ['rechazado', 'retirado', 'cancelado'].includes(p.estado))

  return (
    <div style={{ minHeight: '100vh', background: C.fondo, color: C.texto,
                  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' }}>
      <style>{`@keyframes peyaLatido { 0%,100% { opacity: 1 } 50% { opacity: .35 } }`}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
                    borderBottom: `1px solid ${C.borde}`, position: 'sticky', top: 0,
                    background: C.fondo, zIndex: 10 }}>
        <button onClick={onBack} style={{
          background: '#242430', color: C.texto, border: 'none', borderRadius: 8,
          padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>← Volver</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🛵 PedidosYa</div>
          <div style={{ fontSize: 12, color: C.dim }}>
            {data?.ve_todas ? 'Todas las sucursales' : (data?.sucursal || '…')}
            {' · '}{enCocina.length} en cocina
          </div>
        </div>
        <button
          onClick={() => setSonido((v) => { localStorage.setItem('peya_sonido', v ? '0' : '1'); return !v })}
          title="Sonido al entrar un pedido nuevo"
          style={{ marginLeft: 'auto', background: '#141418', border: `1px solid ${C.borde}`,
                   color: sonido ? C.verde : C.dim, borderRadius: 7, padding: '6px 10px',
                   fontSize: 11.5, cursor: 'pointer' }}>
          {sonido ? '🔔' : '🔕'}
        </button>
      </div>

      {(error || aviso) && (
        <div style={{
          margin: '12px 14px 0', padding: '12px 14px', borderRadius: 10, fontSize: 14,
          background: error ? '#2a1116' : '#0d2018',
          border: `1px solid ${error ? C.rojo : C.verde}66`,
          color: error ? '#ffc9cf' : '#bff3d4', fontWeight: 600,
        }}>{error ? `⚠️ ${error}` : `✅ ${aviso}`}</div>
      )}

      <div style={{ padding: '14px 14px 40px', maxWidth: 620, margin: '0 auto' }}>
        {sinContestar.length > 0 && (
          <>
            <Seccion titulo="Sin contestar"
              nota="Con la aceptación automática esto no debería aparecer. Si está acá, revisalo." />
            {sinContestar.map((p) => (
              <Tarjeta key={p.id} p={p} ahoraBase={ahoraBase} onAccion={onAccion}
                       ocupado={ocupado === p.remote_order_id} />
            ))}
          </>
        )}

        {enCocina.length > 0 && (
          <>
            <Seccion titulo="Esperando al driver" nota="Buscá el número que te dice y cerralo." />
            {enCocina.map((p) => (
              <Tarjeta key={p.id} p={p} ahoraBase={ahoraBase} onAccion={onAccion}
                       ocupado={ocupado === p.remote_order_id} />
            ))}
          </>
        )}

        {cerrados.length > 0 && (
          <>
            <Seccion titulo="Cerrados hoy" />
            {cerrados.map((p) => (
              <Tarjeta key={p.id} p={p} ahoraBase={ahoraBase} onAccion={onAccion}
                       ocupado={ocupado === p.remote_order_id} />
            ))}
          </>
        )}

        {!pedidos.length && (
          <div style={{ textAlign: 'center', padding: '70px 20px', color: C.dim }}>
            <div style={{ fontSize: 44, marginBottom: 12 }}>🛵</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.texto }}>Sin pedidos de PedidosYa</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>
              Cuando entre uno aparece acá solo{sonido ? ' y suena el timbre' : ''}.
            </div>
          </div>
        )}

        {ROLES_SIMULAR.includes(user.rol) && (
          <button onClick={simular} style={{
            marginTop: 26, width: '100%', padding: '13px', borderRadius: 10,
            border: `1px dashed ${C.borde}`, background: 'transparent', color: C.dim,
            fontSize: 13, cursor: 'pointer',
          }}>
            🧪 Simular un pedido de prueba
            <div style={{ fontSize: 11, marginTop: 3, color: '#5f5f6b' }}>
              Cae en {user.store_code} · la comanda sale marcada NO COCINAR · no toca PedidosYa
            </div>
          </button>
        )}
      </div>

      {rechazando && (
        <HojaRechazo
          pedido={rechazando}
          enviando={ocupado === rechazando.remote_order_id}
          onCerrar={() => setRechazando(null)}
          onConfirmar={(motivo, nota) => enviar(rechazando, 'rechazar', motivo, nota)}
        />
      )}
    </div>
  )
}

function Seccion({ titulo, nota }) {
  return (
    <div style={{ margin: '4px 2px 10px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.dim,
                    textTransform: 'uppercase', letterSpacing: .7 }}>{titulo}</div>
      {nota && <div style={{ fontSize: 11.5, color: '#5f5f6b', marginTop: 2 }}>{nota}</div>}
    </div>
  )
}
