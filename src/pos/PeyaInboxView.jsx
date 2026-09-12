// ────────────────────────────────────────────────────────────────────
// Bandeja de PedidosYa · los pedidos entran solos y acá se contestan
//
// Hasta ahora un pedido de PedidosYa se tecleaba a mano desde la tablet de
// ellos. Con la integración entra solo; lo que falta es contestarlo, y eso
// tiene reloj: si nadie acepta ni rechaza antes del `expiryDate`, Delivery
// Hero lo cancela solo con NO_RESPONSE y, si pasa seguido, cierra la tienda
// para proteger su tasa de fallas.
//
// Por eso la cuenta regresiva es lo más grande de la pantalla. Todo lo demás
// —productos, cliente, dirección— es contexto para decidir; el reloj es la
// decisión.
//
// El alcance lo decide el servidor a partir del PIN (RPC `peya_panel`), igual
// que el panel de delivery. Nada de secretos en el frontend: el POS corre en
// un navegador y cualquier secreto fijo se lee con F12.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react'
import { db, URL_SB } from '../supabase'

const REFRESH_MS = 15000

const C = {
  fondo: '#0f0f12', card: '#191920', borde: '#2a2a33', texto: '#f0f0f3',
  dim: '#8a8a95', verde: '#4ade80', amarillo: '#fbbf24', rojo: '#e63946',
  azul: '#60a5fa', naranja: '#f97316', morado: '#a78bfa',
}

// Los tres tipos del contrato de Delivery Hero. Cambian quién lleva la comida
// y, por lo tanto, cuál es el botón que sigue después de aceptar.
const TIPO = {
  pickup:          { et: '🛍️', label: 'Retiro en tienda', sig: 'retirado',  sigLabel: 'Cliente lo retiró' },
  vendor_delivery: { et: '🛵', label: 'Lo lleva PedidosYa', sig: 'preparado', sigLabel: 'Comida lista' },
  own_delivery:    { et: '🚗', label: 'Lo llevamos nosotros', sig: 'retirado', sigLabel: 'Salió con el motorista' },
  desconocido:     { et: '❓', label: 'Tipo desconocido',  sig: null,        sigLabel: '' },
}

const ESTADO = {
  recibido:  { label: 'Por contestar', col: C.amarillo },
  aceptado:  { label: 'Aceptado',      col: C.verde },
  preparado: { label: 'Listo',         col: C.azul },
  rechazado: { label: 'Rechazado',     col: C.rojo },
  retirado:  { label: 'Entregado',     col: C.dim },
  cancelado: { label: 'Cancelado',     col: C.rojo },
}

// Los motivos de rechazo los define Delivery Hero (son 24). Estos son los que
// la operación usa de verdad; el resto sólo aparecen en su documentación.
const MOTIVOS = [
  { v: 'ITEM_UNAVAILABLE',            t: 'Se acabó un producto' },
  { v: 'TOO_BUSY',                    t: 'Cocina saturada' },
  { v: 'CLOSED',                      t: 'Tienda cerrada' },
  { v: 'TECHNICAL_PROBLEM',           t: 'Problema técnico' },
  { v: 'ADDRESS_OUT_OF_DELIVERY_AREA',t: 'Fuera de zona' },
  { v: 'CUSTOMER_CALLED_TO_CANCEL',   t: 'El cliente canceló' },
  { v: 'TEST_ORDER',                  t: 'Pedido de prueba' },
]

const dosDig = (n) => String(n).padStart(2, '0')

// El reloj lo corre el navegador a partir de los segundos que mandó el
// servidor: si dependiera del refresco, la cuenta saltaría de 15 en 15.
function useReloj(activo) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!activo) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [activo])
  return tick
}

// Timbre corto generado en el navegador: no depende de tener un archivo ni de
// que el sistema lo permita. Mismo recurso que usa el panel de delivery.
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

// ── Cuenta regresiva ──
// Verde arriba de 5 min, ámbar entre 2 y 5, rojo y parpadeando abajo de 2.
// Los umbrales no son estéticos: abajo de 2 minutos ya no se puede aceptar
// (DH exige que el acceptanceTime esté al menos 2 min en el futuro).
function Reloj({ segundosBase, desde }) {
  useReloj(true)
  const pasados = Math.floor((Date.now() - desde) / 1000)
  const queda = Math.max(0, (segundosBase ?? 0) - pasados)
  const m = Math.floor(queda / 60), s = queda % 60

  const col = queda === 0 ? C.rojo : queda < 120 ? C.rojo : queda < 300 ? C.amarillo : C.verde
  const urgente = queda > 0 && queda < 120

  return (
    <div style={{ textAlign: 'center', minWidth: 92 }}>
      <div style={{
        fontSize: 30, fontWeight: 800, color: col, lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        animation: urgente ? 'peyaLatido 1s ease-in-out infinite' : 'none',
      }}>
        {queda === 0 ? '⌛' : `${dosDig(m)}:${dosDig(s)}`}
      </div>
      <div style={{ fontSize: 10, color: C.dim, marginTop: 3, textTransform: 'uppercase', letterSpacing: .5 }}>
        {queda === 0 ? 'vencido' : 'para contestar'}
      </div>
    </div>
  )
}

// ── Hoja de rechazo ──
// Rechazar sin motivo lo rebota Delivery Hero, así que el motivo no es opcional
// y se elige de una lista en vez de escribirse.
function HojaRechazo({ pedido, onCerrar, onConfirmar, enviando }) {
  const [motivo, setMotivo] = useState('')
  const [nota, setNota] = useState('')

  return (
    <div onClick={onCerrar} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 60,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, borderTop: `2px solid ${C.rojo}`, borderRadius: '18px 18px 0 0',
        padding: '20px 18px 28px', width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto',
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
          Rechazar {pedido.short_code || pedido.remote_order_id}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 16 }}>
          El cliente recibe el aviso de PedidosYa. Elegí el motivo real: de esto salen sus reportes.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {MOTIVOS.map(m => (
            <button key={m.v} onClick={() => setMotivo(m.v)} style={{
              padding: '13px 10px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: 600,
              textAlign: 'left', lineHeight: 1.25,
              border: `1px solid ${motivo === m.v ? C.rojo : C.borde}`,
              background: motivo === m.v ? '#2a1116' : '#141418',
              color: motivo === m.v ? '#ffd9dd' : C.texto,
            }}>{m.t}</button>
          ))}
        </div>

        <input
          value={nota} onChange={e => setNota(e.target.value)}
          placeholder="Detalle opcional (ej. se acabó el pan brioche)"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 10,
            border: `1px solid ${C.borde}`, background: '#141418', color: C.texto,
            fontSize: 14, marginBottom: 16,
          }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCerrar} style={{
            flex: 1, padding: '15px', borderRadius: 11, border: `1px solid ${C.borde}`,
            background: 'transparent', color: C.dim, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          }}>Cancelar</button>
          <button
            disabled={!motivo || enviando}
            onClick={() => onConfirmar(motivo, nota)}
            style={{
              flex: 2, padding: '15px', borderRadius: 11, border: 'none',
              background: motivo ? C.rojo : '#33333c', color: motivo ? '#fff' : C.dim,
              fontSize: 15, fontWeight: 800, cursor: motivo ? 'pointer' : 'not-allowed',
              opacity: enviando ? .6 : 1,
            }}>
            {enviando ? 'Rechazando…' : 'Confirmar rechazo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tarjeta de pedido ──
function Tarjeta({ p, ahoraBase, onAccion, ocupado }) {
  const [abierto, setAbierto] = useState(p.estado === 'recibido')
  const tipo = TIPO[p.tipo_orden] || TIPO.desconocido
  const est = ESTADO[p.estado] || { label: p.estado, col: C.dim }
  const productos = Array.isArray(p.productos) ? p.productos : []
  const total = p.precio?.grandTotal ?? p.precio?.totalNet
  const cliente = [p.cliente?.firstName, p.cliente?.lastName].filter(Boolean).join(' ')
  const nota = p.comentarios?.customerComment

  const enJuego = p.estado === 'recibido'
  const puedeSiguiente = p.estado === 'aceptado' && tipo.sig

  return (
    <div style={{
      background: C.card, borderRadius: 14, marginBottom: 12, overflow: 'hidden',
      border: `1px solid ${enJuego ? est.col : C.borde}`,
      boxShadow: enJuego ? `0 0 0 1px ${est.col}22` : 'none',
    }}>
      {/* Cabecera: identidad + reloj. Siempre visible aunque se colapse. */}
      <div onClick={() => setAbierto(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', cursor: 'pointer',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>
              {tipo.et} {p.short_code || p.remote_order_id}
            </span>
            {p.es_prueba && (
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                background: '#3a2a00', color: C.amarillo, border: `1px solid ${C.amarillo}66`,
                textTransform: 'uppercase', letterSpacing: .5,
              }}>Prueba · no cocinar</span>
            )}
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: `${est.col}1e`, color: est.col,
            }}>{est.label}</span>
          </div>
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>
            {cliente || 'Cliente sin nombre'} · {tipo.label}
            {total ? ` · $${total}` : ''}
            {p.store_code ? ` · ${p.store_code}` : ''}
          </div>
        </div>

        {enJuego
          ? <Reloj segundosBase={p.segundos_restantes} desde={ahoraBase} />
          : <span style={{ color: C.dim, fontSize: 18 }}>{abierto ? '▾' : '▸'}</span>}
      </div>

      {abierto && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ borderTop: `1px solid ${C.borde}`, paddingTop: 12 }}>
            {productos.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 7, fontSize: 14 }}>
                <span style={{ color: C.morado, fontWeight: 800, minWidth: 26 }}>{it.quantity}×</span>
                <div style={{ flex: 1 }}>
                  <div>{it.name}</div>
                  {(it.selectedToppings || []).map((t, j) => (
                    <div key={j} style={{ fontSize: 12, color: C.dim, paddingLeft: 2 }}>
                      + {t.name}{t.quantity > 1 ? ` ×${t.quantity}` : ''}
                    </div>
                  ))}
                </div>
                {it.paidPrice && <span style={{ color: C.dim, fontSize: 13 }}>${it.paidPrice}</span>}
              </div>
            ))}
            {!productos.length && (
              <div style={{ fontSize: 13, color: C.dim }}>El pedido no trajo detalle de productos.</div>
            )}
          </div>

          {/* La nota del cliente arriba de los botones: es lo que más se pasa por alto. */}
          {nota && (
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: 9,
              background: '#2a2207', border: `1px solid ${C.amarillo}44`,
              fontSize: 13, color: '#ffe9b0',
            }}>📝 {nota}</div>
          )}

          {p.delivery?.address && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: C.dim }}>
              📍 {[p.delivery.address.street, p.delivery.address.number, p.delivery.address.city]
                    .filter(Boolean).join(', ')}
            </div>
          )}
          {p.cliente?.mobilePhone && (
            <div style={{ marginTop: 4, fontSize: 12.5, color: C.dim }}>📞 {p.cliente.mobilePhone}</div>
          )}

          {p.motivo_rechazo && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: C.rojo }}>
              Rechazado: {p.motivo_rechazo}
            </div>
          )}
          {/* Cuando PedidosYa rebota nuestra respuesta, el pedido se ve "vivo" en
              pantalla pero se está venciendo. Hay que decirlo, no esconderlo. */}
          {p.respuesta_http && p.respuesta_http >= 400 && (
            <div style={{
              marginTop: 10, padding: '9px 12px', borderRadius: 9,
              background: '#2a1116', border: `1px solid ${C.rojo}66`, fontSize: 12.5, color: '#ffc9cf',
            }}>
              ⚠️ PedidosYa devolvió {p.respuesta_http}. El pedido sigue sin contestar de su lado.
            </div>
          )}

          <div style={{ display: 'flex', gap: 9, marginTop: 14 }}>
            {enJuego && (
              <>
                <button
                  disabled={ocupado}
                  onClick={() => onAccion(p, 'rechazar')}
                  style={{
                    flex: 1, padding: '16px', borderRadius: 11, border: `1px solid ${C.rojo}`,
                    background: 'transparent', color: C.rojo, fontSize: 15, fontWeight: 700,
                    cursor: 'pointer', opacity: ocupado ? .5 : 1,
                  }}>Rechazar</button>
                <button
                  disabled={ocupado}
                  onClick={() => onAccion(p, 'aceptar')}
                  style={{
                    flex: 2, padding: '16px', borderRadius: 11, border: 'none',
                    background: C.verde, color: '#06210f', fontSize: 16, fontWeight: 800,
                    cursor: 'pointer', opacity: ocupado ? .5 : 1,
                  }}>{ocupado ? 'Enviando…' : 'Aceptar pedido'}</button>
              </>
            )}

            {puedeSiguiente && (
              <button
                disabled={ocupado}
                onClick={() => onAccion(p, tipo.sig)}
                style={{
                  flex: 1, padding: '16px', borderRadius: 11, border: 'none',
                  background: C.azul, color: '#04121f', fontSize: 15, fontWeight: 800,
                  cursor: 'pointer', opacity: ocupado ? .5 : 1,
                }}>{ocupado ? 'Enviando…' : tipo.sigLabel}</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Vista ──
const ROLES_SIMULAR = ['gerente', 'admin', 'superadmin', 'ejecutivo']

export default function PeyaInboxView({ user, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(null)     // remote_order_id en vuelo
  const [rechazando, setRechazando] = useState(null)
  const [ahoraBase, setAhoraBase] = useState(Date.now())
  const [sonido, setSonido] = useState(() => localStorage.getItem('peya_sonido') !== '0')
  const idsVistos = useRef(null)

  const cargar = useCallback(async () => {
    if (!user?.pin) { setError('Sin PIN de sesión'); return }
    try {
      const { data: r, error: e } = await db.rpc('peya_panel', { p_pin: String(user.pin) })
      if (e) throw e

      // Timbre sólo por lo que entró después de abrir la pantalla: si no, sonaría
      // por todos los que ya estaban ahí al cargar.
      const porContestar = (r?.pedidos || []).filter(p => p.estado === 'recibido')
      const ids = new Set(porContestar.map(p => p.id))
      if (idsVistos.current) {
        const nuevos = [...ids].filter(id => !idsVistos.current.has(id))
        if (nuevos.length && sonido) timbre()
      }
      idsVistos.current = ids

      setData(r)
      setAhoraBase(Date.now())   // ancla del reloj: los segundos vienen del servidor
      setError('')
    } catch (e) { setError(e.message || 'No se pudo cargar') }
  }, [user?.pin, sonido])

  useEffect(() => {
    cargar()
    const t = setInterval(cargar, REFRESH_MS)
    return () => clearInterval(t)
  }, [cargar])

  const enviar = async (p, accion, motivo, mensaje) => {
    setOcupado(p.remote_order_id)
    setError(''); setAviso('')
    try {
      const r = await fetch(`${URL_SB}/functions/v1/peya-responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: String(user.pin),
          remoteOrderId: p.remote_order_id,
          accion, motivo, mensaje,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) {
        // El detalle importa: un 403 de otra sucursal y un rebote de PedidosYa
        // se arreglan de formas distintas.
        throw new Error(j.error === 'pedido_de_otra_sucursal'
          ? 'Ese pedido es de otra sucursal'
          : j.respuesta?.http
            ? `PedidosYa respondió ${j.respuesta.http}`
            : j.error || j.message || `HTTP ${r.status}`)
      }
      setAviso(accion === 'aceptar' ? `Aceptado ${p.short_code || p.remote_order_id}`
             : accion === 'rechazar' ? `Rechazado ${p.short_code || p.remote_order_id}`
             : `Actualizado ${p.short_code || p.remote_order_id}`)
      setRechazando(null)
      await cargar()
    } catch (e) {
      setError(e.message || 'No se pudo enviar')
    } finally { setOcupado(null) }
  }

  const onAccion = (p, accion) => {
    if (accion === 'rechazar') { setRechazando(p); return }
    enviar(p, accion)
  }

  const simular = async () => {
    setError(''); setAviso('')
    try {
      const { data: r, error: e } = await db.rpc('peya_simular_pedido', { p_pin: String(user.pin) })
      if (e) throw e
      setAviso(`Pedido de prueba creado: ${r?.remoteOrderId || ''}`)
      await cargar()
    } catch (e) { setError(e.message || 'No se pudo simular') }
  }

  const pedidos = data?.pedidos || []
  const porContestar = pedidos.filter(p => p.estado === 'recibido')
  const enCurso = pedidos.filter(p => ['aceptado', 'preparado'].includes(p.estado))
  const cerrados = pedidos.filter(p => ['rechazado', 'retirado', 'cancelado'].includes(p.estado))

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
            {' · '}{porContestar.length} por contestar
          </div>
        </div>
        <button
          onClick={() => setSonido(v => { localStorage.setItem('peya_sonido', v ? '0' : '1'); return !v })}
          title="Sonido al entrar un pedido nuevo"
          style={{ marginLeft: 'auto', background: '#141418', border: `1px solid ${C.borde}`,
                   color: sonido ? C.verde : C.dim, borderRadius: 7, padding: '6px 10px',
                   fontSize: 11.5, cursor: 'pointer' }}>
          {sonido ? '🔔' : '🔕'}
        </button>
      </div>

      {(error || aviso) && (
        <div style={{
          margin: '12px 14px 0', padding: '11px 14px', borderRadius: 10, fontSize: 13.5,
          background: error ? '#2a1116' : '#0d2018',
          border: `1px solid ${error ? C.rojo : C.verde}66`,
          color: error ? '#ffc9cf' : '#bff3d4',
        }}>{error ? `⚠️ ${error}` : `✅ ${aviso}`}</div>
      )}

      <div style={{ padding: '14px 14px 40px', maxWidth: 640, margin: '0 auto' }}>
        {porContestar.length > 0 && (
          <>
            <Seccion titulo="Por contestar" nota="El reloj corre: si vence, PedidosYa lo cancela solo." />
            {porContestar.map(p => (
              <Tarjeta key={p.id} p={p} ahoraBase={ahoraBase} onAccion={onAccion}
                       ocupado={ocupado === p.remote_order_id} />
            ))}
          </>
        )}

        {enCurso.length > 0 && (
          <>
            <Seccion titulo="En curso" />
            {enCurso.map(p => (
              <Tarjeta key={p.id} p={p} ahoraBase={ahoraBase} onAccion={onAccion}
                       ocupado={ocupado === p.remote_order_id} />
            ))}
          </>
        )}

        {cerrados.length > 0 && (
          <>
            <Seccion titulo="Cerrados hoy" />
            {cerrados.map(p => (
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
              No toca PedidosYa: las respuestas van a nuestro propio endpoint
            </div>
          </button>
        )}
      </div>
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
