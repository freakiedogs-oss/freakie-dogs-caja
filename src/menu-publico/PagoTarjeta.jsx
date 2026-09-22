// ────────────────────────────────────────────────────────────────────
// Bloque de pago con tarjeta — pasarela n1co (EPay)
//
// Vive DENTRO del checkout, no en una ventana aparte, y es dueño del botón
// final ("Pagar y confirmar $X"). Eso es lo que hace que el pedido no exista
// hasta que el cobro se resuelve: el que abandona el formulario nunca aprieta
// el botón, así que nunca se crea nada y la torre no ve un pedido impago.
//
// La versión anterior era un drawer que se abría DESPUÉS de crear el pedido, y
// tenía 7 salidas distintas —la ✕, el click afuera, etc.— que aterrizaban
// todas en "¡Pedido enviado!". Con el pedido invisible eso habría sido un
// callejón: el cliente le escribía a Karina por un pedido que ella no podía ver.
//
// Este componente NO habla con n1co: manda todo a /api/n1co, que tiene el
// secreto y saca el monto de la base. El número de tarjeta vive en el estado de
// React el tiempo que dura el POST y se borra al aprobar.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react'
import './pagoTarjeta.css'

const fmt = (n) => `$${Number(n).toFixed(2)}`

// El reto 3DS puede venir de más de un host de n1co según el emisor, y un
// origen no contemplado se descartaba en silencio: el cliente quedaba mirando
// el spinner para siempre. Se acepta cualquier dominio de n1co —que es quien
// sirve el reto— y nada más.
const ORIGEN_3DS = 'https://front-3ds.n1co.com'
const es3dsDeN1co = (origin) =>
  origin === ORIGEN_3DS || /^https:\/\/[a-z0-9.-]+\.n1co\.(com|shop)$/.test(origin)

// Cuánto esperamos al banco antes de ofrecerle una salida al cliente. El 10% de
// los retos nunca devuelve nada (red mala, ACS que no carga, popup bloqueado) y
// sin esto la única opción era cerrar la página y perder el pedido.
const ESPERA_3DS_MS = 90_000
const API = '/api/n1co'

const seguroJson = (s) => { try { return JSON.parse(s) } catch { return null } }

// ── Identidad del dispositivo (para la tarjeta guardada) ─────────────
// Secreto aleatorio que no sale de este navegador; al servidor viaja y allá se
// convierte en SHA-256 antes de tocar la base. No se busca por teléfono a
// propósito: el teléfono es un dato público y con él cualquiera pediría comida
// cobrándosela a la tarjeta de otro.
const DISPOSITIVO_KEY = 'freakie_dispositivo_v1'
function idDispositivo() {
  try {
    let id = localStorage.getItem(DISPOSITIVO_KEY)
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID()
      localStorage.setItem(DISPOSITIVO_KEY, id)
    }
    return id
  } catch {
    return null   // incógnito: se cobra igual, solo que sin guardar
  }
}

const soloDigitos = (s) => String(s || '').replace(/\D/g, '')
const agruparNumero = (v) => soloDigitos(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ').trim()

function marcaProbable(numero) {
  const d = soloDigitos(numero)
  if (/^4/.test(d)) return '💳 Visa'
  if (/^(5[1-5]|2[2-7])/.test(d)) return '💳 Mastercard'
  if (/^3[47]/.test(d)) return '💳 Amex'
  return null
}

function formatearVencimiento(valor, anterior) {
  let d = soloDigitos(valor).slice(0, 4)
  if (d.length === 1 && Number(d) > 1) d = `0${d}`
  if (d.length >= 3) return `${d.slice(0, 2)}/${d.slice(2)}`
  if (d.length === 2 && !String(anterior).endsWith('/')) return `${d}/`
  return d
}

async function postear(op, body) {
  const res = await fetch(`${API}/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

/**
 * @param {number}   total            lo que se va a cobrar (informativo; manda la BD)
 * @param {Function} construirPedido  valida el checkout y devuelve el payload, o null
 * @param {Function} onAprobado       cobro OK → el pedido ya está vivo
 * @param {Function} onEfectivo       el cliente eligió pagar al recibir
 * @param {Function} onNoDisponible   el cobro en línea no está habilitado
 * @param {string}   trackingToken    pedido YA creado que se viene a terminar de
 *                                    pagar (camino "retomar"). Con esto no se
 *                                    crea nada: se cobra el que ya existe.
 */
export default function BloquePago({ total, construirPedido, onAprobado, onEfectivo,
                                     onNoDisponible, trackingToken = null }) {
  // fondo | procesando | 3ds | rechazado | requiere_billing
  const [fase, setFase] = useState('fondo')
  const [tarjetas, setTarjetas] = useState([])
  const [elegida, setElegida] = useState(null)   // tarjeta guardada seleccionada
  const [numero, setNumero] = useState('')
  const [titular, setTitular] = useState('')
  const [vence, setVence] = useState('')
  const [cvv, setCvv] = useState('')
  const [email, setEmail] = useState('')
  const [guardar, setGuardar] = useState(true)
  // Facturación (solo tarjetas de EE.UU./Canadá): n1co exige país, estado y
  // postal, los tres. El país lo dice el servidor a partir del bin.
  const [zip, setZip] = useState('')
  const [estadoFact, setEstadoFact] = useState('')
  const [paisFact, setPaisFact] = useState('US')
  const [error, setError] = useState('')
  const [url3ds, setUrl3ds] = useState('')
  const [intentosRestantes, setIntentos] = useState(null)
  const [whatsapp, setWhatsapp] = useState('')
  const [numeroOrden, setNumeroOrden] = useState('')

  const dispRef = useRef(null)
  const pagoIdRef = useRef(null)
  const trackingRef = useRef(trackingToken)
  const datosRef = useRef(null)

  // ── Tarjetas guardadas de este dispositivo ──
  useEffect(() => {
    let vivo = true
    dispRef.current = idDispositivo()
    postear('tarjetas', { dispositivo: dispRef.current })
      .then(r => {
        if (!vivo) return
        if (r?.habilitado === false) { onNoDisponible?.(r.mensaje); return }
        const lista = r?.tarjetas || []
        setTarjetas(lista)
        if (lista.length) {
          setElegida(lista[0].id)
          if (lista[0].email) setEmail(lista[0].email)
        }
      })
      .catch(() => { /* si falla el listado se cobra igual con tarjeta nueva */ })
    return () => { vivo = false }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3DS: el resultado del reto del banco ──
  useEffect(() => {
    if (fase !== '3ds') return
    const onMensaje = async (ev) => {
      // Sin este corte el iframe deja de ser barrera: cualquier origen podría
      // postear "SUCCESS" y nos llevaría a dar por bueno el cobro.
      if (!es3dsDeN1co(ev.origin)) return
      const msg = typeof ev.data === 'string' ? seguroJson(ev.data) : ev.data
      if (!msg || msg.MessageType !== 'authentication.complete') return
      const estado = String(msg.Status || '').toUpperCase()
      if (estado === 'PENDING') return

      if (estado !== 'SUCCESS') {
        setUrl3ds(''); setFase('rechazado')
        setError(estado === 'EXPIRED'
          ? 'Se agotó el tiempo de la verificación de tu banco.'
          : 'Tu banco no autorizó la verificación.')
        return
      }
      setUrl3ds(''); setFase('procesando')
      try {
        const d = datosRef.current || {}
        aplicar(await postear('confirmar-3ds', {
          pago_id: pagoIdRef.current, email: d.email, billing: d.billing,
          dispositivo: dispRef.current, guardar: d.guardar,
          titular: d.titular, vence_mes: d.mes, vence_anio: d.anio,
        }))
      } catch {
        setFase('rechazado')
        setError('No pudimos confirmar el pago. Escribinos por WhatsApp antes de intentar de nuevo.')
      }
    }
    // Si el banco no contesta, no dejar al cliente colgado.
    const reloj = setTimeout(() => {
      setUrl3ds('')
      setFase('3ds_sin_respuesta')
    }, ESPERA_3DS_MS)

    window.addEventListener('message', onMensaje)
    return () => { clearTimeout(reloj); window.removeEventListener('message', onMensaje) }
  }, [fase])   // eslint-disable-line react-hooks/exhaustive-deps

  function aplicar(r) {
    if (r?.tracking_token) trackingRef.current = r.tracking_token
    if (r?.pago_id) pagoIdRef.current = r.pago_id
    if (r?.intentos_restantes != null) setIntentos(r.intentos_restantes)
    // Se guardan para las pantallas de salida: si el cobro no se puede
    // completar, el cliente necesita el número de su pedido y a quién escribirle.
    if (r?.whatsapp) setWhatsapp(String(r.whatsapp).replace(/\D/g, ''))
    if (r?.numero_orden) setNumeroOrden(r.numero_orden)

    if (r?.estado === 'aprobado') {
      setNumero(''); setCvv(''); setVence('')
      datosRef.current = null
      onAprobado?.(r)
      return
    }
    if (r?.estado === 'requiere_3ds' && r.autenticacion_url) {
      setUrl3ds(r.autenticacion_url); setFase('3ds'); return
    }
    if (r?.estado === 'requiere_billing') {
      setFase('requiere_billing')
      if (r.pais === 'US' || r.pais === 'CA') setPaisFact(r.pais)
      setError(r.mensaje || 'Necesitamos el estado y el código postal de facturación de tu tarjeta.')
      return
    }
    setFase('rechazado')
    setError(r?.mensaje || 'No pudimos procesar el pago.')
  }

  // ── Enviar: crea el pedido y lo cobra en un solo viaje ──
  const pagar = async () => {
    setError('')
    const usaGuardada = !!elegida && !tarjetas.every(t => t.id !== elegida)

    if (!usaGuardada) {
      const num = soloDigitos(numero)
      if (num.length < 13) return setError('Escribí el número completo de la tarjeta')
      if (!titular.trim()) return setError('Escribí el nombre como aparece en la tarjeta')
      const [mm, aa] = String(vence).split('/')
      if (!mm || !aa || aa.length < 2) return setError('Escribí el vencimiento como MM/AA')
      if (soloDigitos(cvv).length < 3) return setError('Escribí el código de seguridad (CVV)')
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      return setError('Escribí un correo válido para enviarte el comprobante')
    }
    if (fase === 'requiere_billing') {
      if (!/^[A-Z]{2}$/.test(estadoFact.trim().toUpperCase())) {
        return setError(paisFact === 'CA'
          ? 'Escribí la provincia de facturación con dos letras (ej. ON)'
          : 'Escribí el estado de facturación con dos letras (ej. CA)')
      }
      if (!zip.trim()) return setError('Escribí el código postal de facturación')
    }

    // Si ya hay pedido (se viene a retomar el pago) no hay checkout que
    // validar. Si no, el checkout valida lo suyo —dirección, ubicación,
    // mínimo— y devuelve el pedido listo; si algo falta, él muestra el error.
    const pedido = trackingRef.current ? null : construirPedido?.()
    if (!trackingRef.current && !pedido) return

    const billing = zip.trim() && estadoFact.trim()
      ? { countryCode: paisFact, stateCode: estadoFact.trim().toUpperCase(), zipCode: zip.trim() }
      : null
    const [mm, aa] = String(vence).split('/')
    const anio = aa ? (aa.length === 2 ? `20${aa}` : aa) : ''
    datosRef.current = { email: email.trim(), billing, guardar, titular: titular.trim(), mes: mm, anio }

    setFase('procesando')
    try {
      // Si ya hubo un intento, el pedido existe: se reintenta sobre ese mismo
      // en vez de crear uno nuevo por cada tarjeta que el cliente pruebe.
      const r = trackingRef.current
        ? await postear(usaGuardada ? 'cobrar-guardada' : 'pagar', {
            tracking_token: trackingRef.current,
            email: email.trim(), billing,
            dispositivo: dispRef.current, guardar,
            ...(usaGuardada ? { tarjeta_id: elegida } : {
              card: {
                number: soloDigitos(numero), cardHolder: titular.trim(),
                expirationMonth: mm, expirationYear: anio, cvv: soloDigitos(cvv),
              },
            }),
          })
        : await postear('crear-y-pagar', {
            pedido, email: email.trim(), billing,
            dispositivo: dispRef.current, guardar,
            card: {
              number: soloDigitos(numero), cardHolder: titular.trim(),
              expirationMonth: mm, expirationYear: anio, cvv: soloDigitos(cvv),
            },
          })

      if (r?.ok === false && !r?.estado) {
        // El pedido que teníamos en la sesión ya no se puede cobrar (lo tomó
        // efectivo, venció, se canceló…). En vez de dejar al cliente trabado
        // con un mensaje que no puede resolver, se suelta y se crea uno nuevo
        // con lo que tiene en el carrito ahora.
        if (r?.reiniciable && trackingRef.current) {
          trackingRef.current = null
          const nuevo = construirPedido?.()
          if (nuevo) {
            const r2 = await postear('crear-y-pagar', {
              pedido: nuevo, email: email.trim(), billing,
              dispositivo: dispRef.current, guardar,
              card: {
                number: soloDigitos(numero), cardHolder: titular.trim(),
                expirationMonth: mm, expirationYear: anio, cvv: soloDigitos(cvv),
              },
            })
            if (r2?.ok === false && !r2?.estado) {
              setFase('fondo')
              return setError(r2?.mensaje || 'No pudimos crear el pedido.')
            }
            return aplicar(r2)
          }
        }
        if (r?.tracking_token) trackingRef.current = r.tracking_token
        setFase('fondo')
        return setError(r?.mensaje || 'Revisá los datos de la tarjeta.')
      }
      aplicar(r)
    } catch {
      setFase('fondo')
      setError('No hay conexión. Revisá tu internet y probá de nuevo.')
    }
  }

  // ── Pagar en efectivo: la salida siempre disponible ──
  const pasarAEfectivo = async () => {
    setError('')
    // Si ya se creó el pedido (hubo un intento), se convierte. Si no, el
    // checkout lo crea como efectivo desde cero.
    if (!trackingRef.current) { onEfectivo?.(null); return }
    setFase('procesando')
    try {
      const tt = trackingRef.current
      const r = await postear('efectivo', { tracking_token: tt })
      if (!r?.ok) { setFase('rechazado'); return setError(r?.mensaje || 'No pudimos cambiarlo a efectivo.') }
      // Ese pedido ya no se cobra con tarjeta. Si no se suelta la referencia,
      // un reintento posterior intenta pagarlo y el servidor responde que ya
      // está tomado — que es como una clienta terminó viendo "ya está pagado"
      // sin que se le hubiera cobrado nada.
      trackingRef.current = null
      onEfectivo?.({ ...r, tracking_token: tt })
    } catch {
      setFase('rechazado')
      setError('No hay conexión. Probá de nuevo.')
    }
  }

  // ── 3DS ──
  if (fase === '3ds') {
    return (
      <div className="mp-pago-3ds-wrap">
        <p className="mp-pago-nota">
          Tu banco pide confirmar la compra. Completá la verificación acá abajo
          — no cierres esta página. Si no carga en un minuto, te damos otra
          opción.
        </p>
        <iframe
          className="mp-pago-3ds" src={url3ds} title="Verificación 3D Secure"
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    )
  }

  // ── El banco no contestó ──
  // No se sabe si aprobó o no: el reto quedó a medias, así que NO se cobró.
  // Lo único honesto es decirlo y dar las dos salidas.
  if (fase === '3ds_sin_respuesta') {
    // El cliente no tiene por qué cargar con un problema que no es suyo: no es
    // su tarjeta ni su pedido, es el procesador. Decirlo evita que crea que le
    // rebotó la tarjeta y que se vaya pensando que no tiene fondos.
    const waMsg =
      `¡Hola! 🌭 Hice el pedido ${numeroOrden || ''} pero no pude pagar con tarjeta: `
      + 'la verificación no respondió. ¿Me ayudan con un link de pago?'
    const waHref = whatsapp
      ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(waMsg)}`
      : null

    return (
      <div className="mp-pago-rechazo">
        <div className="mp-pago-rechazo-icono">⏳</div>
        <p><b>No pudimos completar el cobro</b></p>
        <p className="mp-pago-nota">
          No es tu tarjeta ni tu pedido: <b>nuestro procesador de pagos (n1co)
          no respondió</b> la verificación del banco. <b>No se te cobró nada.</b>
          {numeroOrden ? <> Tu pedido <b>{numeroOrden}</b> quedó guardado.</> : null}
        </p>

        <p className="mp-pago-nota"><b>¿Cómo querés seguir?</b></p>

        {waHref && (
          <a className="mp-pago-wa" href={waHref} target="_blank" rel="noreferrer">
            📲 Que me manden un link de pago
          </a>
        )}
        <button className="mp-btn-checkout" onClick={pasarAEfectivo}>
          💵 Pagar en efectivo al recibir
        </button>
        <button className="mp-pago-secundario" onClick={() => { setFase('fondo'); setError('') }}>
          Probar la tarjeta otra vez
        </button>
      </div>
    )
  }

  // ── Procesando ──
  if (fase === 'procesando') {
    return (
      <div className="mp-pago-esperando">
        <div className="mp-pago-spinner" />
        <p>Estamos cobrando {fmt(total)}.<br />No cierres ni recargues la página.</p>
      </div>
    )
  }

  // ── Rechazado: se resuelve acá mismo, sin pasar por Karina ──
  if (fase === 'rechazado') {
    const sinIntentos = intentosRestantes != null && intentosRestantes <= 0
    return (
      <div className="mp-pago-rechazo">
        <div className="mp-pago-rechazo-icono">😕</div>
        <p>{error}</p>
        <p className="mp-pago-nota">Todavía no se te cobró nada.</p>
        {!sinIntentos && (
          <button className="mp-btn-checkout" onClick={() => {
            setFase('fondo'); setError(''); setElegida(null)
            setNumero(''); setCvv(''); setVence('')
          }}>
            Probar con otra tarjeta
          </button>
        )}
        <button className="mp-pago-secundario" onClick={pasarAEfectivo}>
          💵 Pagar en efectivo al recibir
        </button>
      </div>
    )
  }

  // ── Formulario ──
  const usaGuardada = !!elegida
  const marca = marcaProbable(numero)
  const pideZip = fase === 'requiere_billing'

  return (
    <div className="mp-pago-bloque">
      {tarjetas.length > 0 && (
        <div className="mp-pago-lista">
          {tarjetas.map(t => (
            <label key={t.id} className={`mp-pago-guardada-op ${elegida === t.id ? 'sel' : ''}`}>
              <input type="radio" name="tarjeta" checked={elegida === t.id}
                     onChange={() => { setElegida(t.id); if (t.email) setEmail(t.email) }} />
              <span><b>{t.marca || 'Tarjeta'} ····{t.last4}</b><small>vence {t.vence}</small></span>
            </label>
          ))}
          <label className={`mp-pago-guardada-op ${!elegida ? 'sel' : ''}`}>
            <input type="radio" name="tarjeta" checked={!elegida} onChange={() => setElegida(null)} />
            <span><b>Usar otra tarjeta</b></span>
          </label>
        </div>
      )}

      {!usaGuardada && (
        <>
          <div className="mp-field">
            <label>Número de tarjeta</label>
            <div className="mp-pago-input-icono">
              <input type="text" inputMode="numeric" autoComplete="cc-number" value={numero}
                     onChange={e => setNumero(agruparNumero(e.target.value))}
                     placeholder="0000 0000 0000 0000" />
              {marca && <span className="mp-pago-marca">{marca}</span>}
            </div>
          </div>
          <div className="mp-field">
            <label>Nombre en la tarjeta</label>
            <input type="text" autoComplete="cc-name" value={titular}
                   onChange={e => setTitular(e.target.value.toUpperCase())}
                   placeholder="COMO APARECE EN LA TARJETA" />
          </div>
          <div className="mp-pago-fila">
            <div className="mp-field">
              <label>Vence</label>
              <input type="text" inputMode="numeric" autoComplete="cc-exp" value={vence}
                     onChange={e => setVence(formatearVencimiento(e.target.value, vence))}
                     placeholder="MM/AA" maxLength={5} />
            </div>
            <div className="mp-field">
              <label>CVV</label>
              <input type="text" inputMode="numeric" autoComplete="cc-csc" value={cvv}
                     onChange={e => setCvv(soloDigitos(e.target.value).slice(0, 4))}
                     placeholder="123" maxLength={4} />
            </div>
          </div>
        </>
      )}

      <div className="mp-field">
        <label>Correo (para el comprobante)</label>
        <input type="email" inputMode="email" autoComplete="email" value={email}
               onChange={e => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" />
      </div>

      {pideZip && (
        <div className="mp-pago-fila">
          <div className="mp-field">
            <label>{paisFact === 'CA' ? 'Provincia (facturación)' : 'Estado (facturación)'}</label>
            <input type="text" autoComplete="address-level1" maxLength={2}
                   value={estadoFact} onChange={e => setEstadoFact(e.target.value.toUpperCase())}
                   placeholder={paisFact === 'CA' ? 'ON' : 'CA'} />
          </div>
          <div className="mp-field">
            <label>Código postal</label>
            <input type="text" inputMode={paisFact === 'CA' ? 'text' : 'numeric'} autoComplete="postal-code"
                   value={zip} onChange={e => setZip(e.target.value)}
                   placeholder={paisFact === 'CA' ? 'M5V 3L9' : '12345'} />
          </div>
        </div>
      )}

      {!usaGuardada && dispRef.current && (
        <label className="mp-pago-guardar">
          <input type="checkbox" checked={guardar} onChange={e => setGuardar(e.target.checked)} />
          <span>
            <b>Guardar mi tarjeta para la próxima</b>
            <small>
              Solo en este teléfono. La guarda el banco procesador, no Freakie Dogs —
              nosotros nunca vemos tu número completo.
            </small>
          </span>
        </label>
      )}

      {error && <div className="mp-error">{error}</div>}

      <div className="mp-pago-seguro">
        🔒 Tus datos viajan cifrados directo a la pasarela. Freakie Dogs no
        guarda tu número de tarjeta.
      </div>

      <button className="mp-btn-checkout" onClick={pagar}>
        Pagar y confirmar · {fmt(total)}
      </button>
      <button className="mp-pago-secundario" onClick={pasarAEfectivo}>
        💵 Mejor pago en efectivo al recibir
      </button>
    </div>
  )
}
