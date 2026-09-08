// ────────────────────────────────────────────────────────────────────
// Pago con tarjeta — pasarela n1co (EPay)
//
// Se monta después de que `crear_pedido_delivery` ya guardó el pedido. Eso es
// deliberado: el pedido existe (impago) antes de pedir la tarjeta, así que si
// el cobro falla o el cliente cierra el navegador, la torre igual lo ve y puede
// rescatarlo por WhatsApp. Nada se pierde.
//
// Este componente NO habla con n1co: manda los datos a /api/n1co, que tiene el
// secreto y decide el monto contra la BD. Acá el número de tarjeta solo vive en
// el estado de React el tiempo que dura el POST, y se borra al aprobar.
//
// ── Tarjeta guardada ──
// El objetivo es que el cliente que vuelve toque un botón y listo. La tarjeta
// se guarda en n1co (token multi-uso) y queda atada a ESTE dispositivo por un
// secreto aleatorio que vive solo en su localStorage. No se busca por teléfono
// a propósito: el teléfono es un dato público, y con él cualquiera pediría
// comida a su casa cobrándosela a la tarjeta de otro.
//
// El reto 3DS se resuelve en un iframe con postMessage, que es como lo expone
// n1co. Ojo con el origen del mensaje: sin validarlo, cualquier página embebida
// podría gritar "authentication.complete / SUCCESS" y saltarse el reto.
// ────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react'

const fmt = (n) => `$${Number(n).toFixed(2)}`

const ORIGEN_3DS = 'https://front-3ds.n1co.com'
const API = '/api/n1co'

// n1co manda el resultado del reto a veces como objeto y a veces como string.
const seguroJson = (s) => { try { return JSON.parse(s) } catch { return null } }

// ── Identidad del dispositivo ────────────────────────────────────────
// Secreto aleatorio que no sale de este navegador; al servidor viaja y allá se
// convierte en SHA-256 antes de tocar la base.
//
// OJO AL CAMBIO DE DOMINIO: localStorage es POR ORIGEN. Si el menú se muda de
// freakiedelivery.vercel.app a freakiedogs.com, este secreto no viaja y todas
// las tarjetas guardadas quedan huérfanas — el cliente tiene que reingresarlas.
// Por eso conviene estrenar la tarjeta guardada ya en el dominio definitivo.
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
    // Modo incógnito o storage lleno: se cobra igual, solo que sin guardar.
    return null
  }
}

// ── Helpers de tarjeta ───────────────────────────────────────────────
const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

function agruparNumero(valor) {
  const d = soloDigitos(valor).slice(0, 19)
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

// Solo para pintar el ícono mientras el cliente escribe. La marca real la
// devuelve n1co con el bin; esta adivinanza no decide nada.
function marcaProbable(numero) {
  const d = soloDigitos(numero)
  if (/^4/.test(d)) return 'visa'
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'mastercard'
  if (/^3[47]/.test(d)) return 'amex'
  return null
}
const ICONO = { visa: '💳 Visa', mastercard: '💳 Mastercard', amex: '💳 Amex' }

function formatearVencimiento(valor, anterior) {
  let d = soloDigitos(valor).slice(0, 4)
  // Un "3" solito es marzo: se completa a 03/ para que no haya que pensar.
  if (d.length === 1 && Number(d) > 1) d = `0${d}`
  // Sin esto, borrar sobre "12/" se traba: el slash se vuelve a agregar solo.
  if (d.length >= 3) return `${d.slice(0, 2)}/${d.slice(2)}`
  if (d.length === 2 && !String(anterior).endsWith('/')) return `${d}/`
  return d
}

export default function PagoTarjeta({ pedido, onAprobado, onPagarEnEfectivo, onCerrar }) {
  // cargando → guardadas | form | procesando | 3ds | aprobado | rechazado
  const [fase, setFase] = useState('cargando')
  const [tarjetas, setTarjetas] = useState([])
  const [numero, setNumero] = useState('')
  const [titular, setTitular] = useState(pedido?.nombre || '')
  const [vence, setVence] = useState('')
  const [cvv, setCvv] = useState('')
  const [email, setEmail] = useState('')
  const [guardar, setGuardar] = useState(true)
  const [zip, setZip] = useState('')
  const [pideZip, setPideZip] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)
  const [url3ds, setUrl3ds] = useState('')

  const pagoIdRef = useRef(null)
  const dispRef = useRef(null)
  // El formulario se conserva entre reintentos (rechazo, o cuando el emisor
  // resulta ser de EE.UU. y hay que volver a mandar con el código postal).
  const datosRef = useRef(null)

  const total = Number(pedido?.total || 0)

  // ── Al abrir: ¿hay tarjeta guardada en este dispositivo? ───────────
  useEffect(() => {
    let vivo = true
    dispRef.current = idDispositivo()
    if (!dispRef.current) { setFase('form'); return }

    postear('tarjetas', { dispositivo: dispRef.current })
      .then(r => {
        if (!vivo) return
        const lista = r?.tarjetas || []
        setTarjetas(lista)
        setFase(lista.length ? 'guardadas' : 'form')
      })
      // Que falle el listado no puede bloquear el cobro: se cae al formulario.
      .catch(() => { if (vivo) setFase('form') })

    return () => { vivo = false }
  }, [])

  // ── 3DS: escuchar el resultado del reto del banco ──────────────────
  useEffect(() => {
    if (fase !== '3ds') return

    const onMensaje = async (ev) => {
      // Sin este corte el iframe deja de ser una barrera: cualquier origen
      // podría postear "SUCCESS" y nos llevaría a confirmar el cobro.
      if (ev.origin !== ORIGEN_3DS) return

      const msg = typeof ev.data === 'string' ? seguroJson(ev.data) : ev.data
      if (!msg || msg.MessageType !== 'authentication.complete') return

      const estado = String(msg.Status || '').toUpperCase()
      if (estado === 'PENDING') return

      if (estado !== 'SUCCESS') {
        setUrl3ds('')
        setFase('rechazado')
        setError(estado === 'EXPIRED'
          ? 'Se agotó el tiempo de la verificación. Probá de nuevo.'
          : 'Tu banco no autorizó la verificación. Probá con otra tarjeta.')
        return
      }

      // Verificación aprobada: el servidor reintenta el cobro con el
      // authenticationId que ya guardó (no se lo mandamos desde acá).
      setUrl3ds('')
      setFase('procesando')
      try {
        const d = datosRef.current || {}
        aplicarRespuesta(await postear('confirmar-3ds', {
          pago_id: pagoIdRef.current,
          email: d.email,
          billing: d.billing,
          dispositivo: dispRef.current,
          guardar: d.guardar,
          titular: d.titular,
          vence_mes: d.mes,
          vence_anio: d.anio,
        }))
      } catch {
        setFase('rechazado')
        setError('No pudimos confirmar el pago. Escribinos por WhatsApp antes de intentar de nuevo.')
      }
    }

    window.addEventListener('message', onMensaje)
    return () => window.removeEventListener('message', onMensaje)
  }, [fase])   // eslint-disable-line react-hooks/exhaustive-deps

  async function postear(op, body) {
    const res = await fetch(`${API}/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  function aplicarRespuesta(r) {
    if (r?.estado === 'aprobado') {
      // La tarjeta sale de memoria apenas deja de hacer falta.
      setNumero(''); setCvv(''); setVence('')
      datosRef.current = null
      setResultado({
        marca: r.marca, last4: r.last4, autorizacion: r.autorizacion,
        comandado: r.comandado !== false, guardada: !!r.guardada,
      })
      setFase('aprobado')
      onAprobado?.({ ...r, metodoPago: 'tarjeta' })
      return
    }
    if (r?.estado === 'requiere_3ds' && r.autenticacion_url) {
      pagoIdRef.current = r.pago_id
      setUrl3ds(r.autenticacion_url)
      setFase('3ds')
      return
    }
    if (r?.estado === 'requiere_billing') {
      setPideZip(true)
      setFase('form')
      setError(r.mensaje || 'Necesitamos el código postal de facturación de tu tarjeta.')
      return
    }
    setFase('rechazado')
    setError(r?.mensaje || 'No pudimos procesar el pago.')
  }

  // ── Cobro con tarjeta guardada: el cliente no teclea nada ──────────
  const pagarConGuardada = async (tarjeta) => {
    setError('')
    setFase('procesando')
    try {
      const r = await postear('cobrar-guardada', {
        tracking_token: pedido.tracking_token,
        dispositivo: dispRef.current,
        tarjeta_id: tarjeta.id,
      })
      if (r?.error === 'tarjeta_no_disponible') {
        // La tarjeta se cayó (vencida, borrada del lado de n1co): se saca de la
        // lista y se manda al formulario en vez de dejarlo en un callejón.
        setTarjetas(t => t.filter(x => x.id !== tarjeta.id))
        setFase('form')
        return setError(r.mensaje)
      }
      if (r?.ok === false && !r?.estado) {
        setFase('guardadas')
        return setError(r?.mensaje || 'No pudimos cobrar con esa tarjeta.')
      }
      // El 3DS de una tarjeta guardada vuelve al mismo iframe; si hay que
      // reintentar, ya no hay datos de tarjeta que reenviar.
      datosRef.current = { email: tarjeta.email, guardar: false }
      aplicarRespuesta(r)
    } catch {
      setFase('guardadas')
      setError('No hay conexión. Revisá tu internet y probá de nuevo.')
    }
  }

  const olvidar = async (tarjeta) => {
    setTarjetas(t => t.filter(x => x.id !== tarjeta.id))
    try { await postear('olvidar', { dispositivo: dispRef.current, tarjeta_id: tarjeta.id }) }
    catch { /* si falla, reaparece en la próxima compra: no vale un error en pantalla */ }
  }

  // ── Cobro con tarjeta nueva ────────────────────────────────────────
  const pagar = async () => {
    setError('')
    const num = soloDigitos(numero)
    if (num.length < 13) return setError('Escribí el número completo de la tarjeta')
    if (!titular.trim()) return setError('Escribí el nombre como aparece en la tarjeta')
    const [mm, aa] = String(vence).split('/')
    if (!mm || !aa || aa.length < 2) return setError('Escribí el vencimiento como MM/AA')
    if (soloDigitos(cvv).length < 3) return setError('Escribí el código de seguridad (CVV)')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      return setError('Escribí un correo válido para enviarte el comprobante')
    }
    if (pideZip && !zip.trim()) return setError('Escribí el código postal de facturación')

    const billing = pideZip ? { countryCode: 'USA', zipCode: zip.trim() } : null
    // n1co espera el año de 4 dígitos; el formulario pide 2 porque es lo que
    // está impreso en la tarjeta.
    const anio = aa.length === 2 ? `20${aa}` : aa
    const puedeGuardar = guardar && !!dispRef.current
    datosRef.current = {
      email: email.trim(), billing, guardar: puedeGuardar,
      titular: titular.trim(), mes: mm, anio,
    }

    setFase('procesando')
    try {
      const r = await postear('pagar', {
        tracking_token: pedido.tracking_token,
        email: email.trim(),
        billing,
        dispositivo: dispRef.current,
        guardar: puedeGuardar,
        card: {
          number: num,
          cardHolder: titular.trim(),
          expirationMonth: mm,
          expirationYear: anio,
          cvv: soloDigitos(cvv),
        },
      })
      pagoIdRef.current = r?.pago_id || pagoIdRef.current
      if (r?.ok === false && !r?.estado) {
        setFase('form')
        return setError(r?.mensaje || 'Revisá los datos de la tarjeta.')
      }
      aplicarRespuesta(r)
    } catch {
      setFase('form')
      setError('No hay conexión. Revisá tu internet y probá de nuevo.')
    }
  }

  const reintentar = () => { setFase(tarjetas.length ? 'guardadas' : 'form'); setError('') }

  // ── Cargando ───────────────────────────────────────────────────────
  if (fase === 'cargando') {
    return (
      <Marco titulo="Pagar con tarjeta" onCerrar={onCerrar}>
        <div className="mp-pago-esperando"><div className="mp-pago-spinner" /></div>
      </Marco>
    )
  }

  // ── Aprobado ───────────────────────────────────────────────────────
  if (fase === 'aprobado') {
    return (
      <Marco titulo="¡Pago aprobado! 🎉" onCerrar={onCerrar}>
        <div className="mp-pago-ok">
          <div className="mp-pago-ok-icono">✅</div>
          <div className="mp-pago-ok-monto">{fmt(total)}</div>
          <div className="mp-pago-ok-tarjeta">
            {resultado?.marca || 'Tarjeta'} ····{resultado?.last4 || ''}
            {resultado?.autorizacion ? ` · aut. ${resultado.autorizacion}` : ''}
          </div>
          <p className="mp-pago-ok-texto">
            {resultado?.comandado
              ? 'Tu pedido ya entró a la cocina. No hace falta que escribas por WhatsApp.'
              : 'Recibimos tu pago. Te confirmamos por WhatsApp en cuanto asignemos tu pedido a una tienda.'}
          </p>
          {resultado?.guardada && (
            <div className="mp-pago-guardada-ok">
              💾 Guardamos tu tarjeta en este teléfono. La próxima vez pagás de un toque.
            </div>
          )}
        </div>
        <button className="mp-btn-checkout" onClick={onCerrar}>Ver mi pedido</button>
      </Marco>
    )
  }

  // ── Reto 3DS del banco ─────────────────────────────────────────────
  if (fase === '3ds') {
    return (
      <Marco titulo="Verificación de tu banco" onCerrar={null}>
        <p className="mp-pago-nota">
          Tu banco pide confirmar la compra. Completá la verificación acá abajo
          — no cierres esta ventana.
        </p>
        <iframe
          className="mp-pago-3ds"
          src={url3ds}
          title="Verificación 3D Secure"
          // El reto del banco necesita ejecutar scripts y enviar formularios;
          // se le niega todo lo demás (top-navigation sobre todo, que sacaría
          // al cliente de la página con el pedido a medias).
          sandbox="allow-scripts allow-forms allow-same-origin"
        />
      </Marco>
    )
  }

  // ── Procesando ─────────────────────────────────────────────────────
  if (fase === 'procesando') {
    return (
      <Marco titulo="Procesando tu pago" onCerrar={null}>
        <div className="mp-pago-esperando">
          <div className="mp-pago-spinner" />
          <p>Estamos cobrando {fmt(total)}.<br />No cierres ni recargues la página.</p>
        </div>
      </Marco>
    )
  }

  // ── Rechazado ──────────────────────────────────────────────────────
  if (fase === 'rechazado') {
    return (
      <Marco titulo="No se pudo cobrar" onCerrar={onCerrar}>
        <div className="mp-pago-rechazo">
          <div className="mp-pago-rechazo-icono">😕</div>
          <p>{error}</p>
          <p className="mp-pago-nota">
            Tranquilo: tu pedido <b>{pedido?.numero_orden}</b> quedó guardado. No
            se te cobró nada.
          </p>
        </div>
        <button className="mp-btn-checkout" onClick={reintentar}>Probar con otra tarjeta</button>
        <button className="mp-pago-secundario" onClick={onPagarEnEfectivo}>
          Mejor pago en efectivo
        </button>
      </Marco>
    )
  }

  // ── Tarjetas guardadas: el camino de un toque ──────────────────────
  if (fase === 'guardadas') {
    return (
      <Marco titulo="Pagar con tarjeta" onCerrar={onCerrar}>
        <div className="mp-pago-resumen">
          <span>Pedido {pedido?.numero_orden}</span>
          <b>{fmt(total)}</b>
        </div>

        {error && <div className="mp-error">{error}</div>}

        <div className="mp-pago-lista">
          {tarjetas.map(t => (
            <div key={t.id} className="mp-pago-guardada">
              <button className="mp-pago-guardada-btn" onClick={() => pagarConGuardada(t)}>
                <span className="mp-pago-guardada-marca">{t.marca || 'Tarjeta'}</span>
                <span className="mp-pago-guardada-num">····{t.last4}</span>
                <span className="mp-pago-guardada-vence">{t.vence}</span>
                <span className="mp-pago-guardada-pagar">Pagar {fmt(total)}</span>
              </button>
              <button className="mp-pago-guardada-x" onClick={() => olvidar(t)}
                      title="Olvidar esta tarjeta" aria-label="Olvidar esta tarjeta">×</button>
            </div>
          ))}
        </div>

        <button className="mp-pago-secundario" onClick={() => { setFase('form'); setError('') }}>
          Usar otra tarjeta
        </button>
        <button className="mp-pago-secundario" onClick={onPagarEnEfectivo}>
          Mejor pago en efectivo
        </button>
      </Marco>
    )
  }

  // ── Formulario de tarjeta nueva ────────────────────────────────────
  const marca = marcaProbable(numero)

  return (
    <Marco titulo="Pagar con tarjeta" onCerrar={onCerrar}>
      <div className="mp-pago-resumen">
        <span>Pedido {pedido?.numero_orden}</span>
        <b>{fmt(total)}</b>
      </div>

      <div className="mp-field">
        <label>Número de tarjeta</label>
        <div className="mp-pago-input-icono">
          <input
            type="text" inputMode="numeric" autoComplete="cc-number"
            value={numero}
            onChange={e => setNumero(agruparNumero(e.target.value))}
            placeholder="0000 0000 0000 0000"
          />
          {marca && <span className="mp-pago-marca">{ICONO[marca]}</span>}
        </div>
      </div>

      <div className="mp-field">
        <label>Nombre en la tarjeta</label>
        <input
          type="text" autoComplete="cc-name"
          value={titular}
          onChange={e => setTitular(e.target.value.toUpperCase())}
          placeholder="COMO APARECE EN LA TARJETA"
        />
      </div>

      <div className="mp-pago-fila">
        <div className="mp-field">
          <label>Vence</label>
          <input
            type="text" inputMode="numeric" autoComplete="cc-exp"
            value={vence}
            onChange={e => setVence(formatearVencimiento(e.target.value, vence))}
            placeholder="MM/AA" maxLength={5}
          />
        </div>
        <div className="mp-field">
          <label>CVV</label>
          <input
            type="text" inputMode="numeric" autoComplete="cc-csc"
            value={cvv}
            onChange={e => setCvv(soloDigitos(e.target.value).slice(0, 4))}
            placeholder="123" maxLength={4}
          />
        </div>
      </div>

      <div className="mp-field">
        <label>Correo (para el comprobante)</label>
        <input
          type="email" inputMode="email" autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="tucorreo@ejemplo.com"
        />
      </div>

      {pideZip && (
        <div className="mp-field">
          <label>Código postal de facturación</label>
          <input
            type="text" inputMode="numeric" autoComplete="postal-code"
            value={zip} onChange={e => setZip(e.target.value)} placeholder="12345"
          />
        </div>
      )}

      {/* Sin localStorage (modo incógnito) no hay dónde atar la tarjeta, así que
          ni se ofrece: prometer que la guardamos y que no aparezca sería peor. */}
      {dispRef.current && (
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
        Pagar {fmt(total)}
      </button>
      {tarjetas.length > 0 && (
        <button className="mp-pago-secundario" onClick={() => { setFase('guardadas'); setError('') }}>
          Usar una tarjeta guardada
        </button>
      )}
      <button className="mp-pago-secundario" onClick={onPagarEnEfectivo}>
        Mejor pago en efectivo
      </button>
    </Marco>
  )
}

// Drawer con el mismo esqueleto que el resto del menú. `onCerrar` en null
// oculta la ✕: mientras se cobra o el banco verifica, salirse a medias deja
// el pedido en un limbo que nadie puede explicarle al cliente.
function Marco({ titulo, onCerrar, children }) {
  return (
    <div className="mp-drawer-overlay" onClick={onCerrar || undefined}>
      <div className="mp-drawer mp-pago" onClick={e => e.stopPropagation()}>
        <div className="mp-drawer-header">
          {onCerrar && <button className="mp-drawer-close" onClick={onCerrar}>×</button>}
          <h2>{titulo}</h2>
        </div>
        <div className="mp-drawer-body">{children}</div>
      </div>
    </div>
  )
}
