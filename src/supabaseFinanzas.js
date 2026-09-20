// ────────────────────────────────────────────────────────────────────
// Cliente de Supabase para las pantallas de FINANZAS (SEG-1 Capa 2).
//
// Por qué existe: el ERP pega con la `anon key`, que es PÚBLICA (viaja en el
// bundle desplegado). Cualquiera con esa llave podía leer banco, proveedores y
// socios desde internet. Los objetos de finanzas ya NO se le abren a anon: el
// proxy `/sb` exige una sesión de staff y recién ahí usa un rol privado de
// solo lectura (`erp_finanzas_ro`).
//
// Este cliente es idéntico al normal salvo que adjunta el token de sesión en
// el header `x-torre-token`. El proxy lo consume y NUNCA lo reenvía a Supabase.
//
// Se reusa la MISMA sesión que ya usan RRHH, SuperAdmin y la subida de fotos
// del menú (`staff_sesiones`), así que si ya abriste sesión en otra pantalla
// no te vuelve a pedir el PIN.
//
// ⚠️ En DEV local el cliente va directo a Supabase (no hay proxy), así que las
// pantallas de finanzas necesitan el deploy —o `vercel dev`— para leer datos.
//
// ⚠️ Este cliente NO usa `URL_SB`: la usa el resto del ERP y desde el 8-sep-2026
// apunta al dominio propio (`VITE_SB_URL` = api.freakiedogs.com), que es Supabase
// directo y por lo tanto NO pasa por el gate. Con la anon key y sin gate, todo
// objeto de finanzas cerrado a `anon` responde `permission denied` (ver abajo).
// ────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { db, URL_SB, KEY_SB } from './supabase'

// ── Por qué finanzas se queda en el proxy `/sb` ──
// El dominio propio mató al proxy para el resto del ERP (sin techo de 25 s, sin
// límite de concurrencia, con WebSocket). Pero el gate de finanzas ES el proxy:
// vive en `api/supaproxy.js` y es lo único que cambia la llave pública por el
// rol privado `erp_finanzas_ro`. Contra `api.freakiedogs.com` no hay dónde
// colgarlo — el request llega a Postgres como `anon` y `v_dtes_emitidos`,
// `v_empleados_expediente`, `planillas`, `planilla_detalle`, `v_planilla_*` y
// el RPC `dte_emitido_detalle` (todos revocados a `anon` a propósito) devuelven
// `permission denied for view ...`. Eso dejó muertas las pantallas de DTEs
// emitidos, expediente y planilla desde el switch del 8-sep.
//
// El costo de volver al proxy acá es aceptable: son consultas de back-office
// (unas pocas por pantalla, no la operación en vivo del POS), que es justo lo
// que el proxy sí aguanta. El día que el gate se mueva a la DB (RPC SECURITY
// DEFINER que valide el token de sesión), esta línea vuelve a ser `URL_SB`.
const isBrowser = typeof window !== 'undefined'
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true
const URL_FIN = isBrowser && !isDev ? `${window.location.origin}/sb` : URL_SB

// Misma clave que usan la torre de delivery y SubirFotoItem: sesión compartida.
export const TOKEN_KEY = 'freakie_torre_token'

export const getTorreToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' }
}
export const setTorreToken = (t) => {
  try { localStorage.setItem(TOKEN_KEY, t) } catch { /* modo privado */ }
}
export const limpiarTorreToken = () => {
  try { localStorage.removeItem(TOKEN_KEY) } catch { /* noop */ }
}

// Evento global: lo emite cualquier query que choque con el gate, y lo escucha
// `SesionFinanzasModal` (montado una sola vez en la raíz). Así el PIN se pide
// desde UN solo lugar en vez de repetir el prompt en cada pantalla.
export const EVENTO_SESION_REQUERIDA = 'freakie:sesion-finanzas-requerida'

// Adjunta el token a cada request sin fijarlo al crear el cliente: así toma
// la sesión nueva apenas se abre, sin recargar la página.
const fetchConSesion = async (input, init = {}) => {
  const headers = new Headers(init.headers || {})
  const token = getTorreToken()
  if (token) headers.set('x-torre-token', token)

  const res = await fetch(input, { ...init, headers })

  // 401 del gate = falta sesión (no es un error de datos). Se limpia el token
  // vencido y se avisa para que el modal pida el PIN.
  if (res.status === 401) {
    try {
      const cuerpo = await res.clone().text()
      if (cuerpo.includes('FIN_SIN_SESION')) {
        limpiarTorreToken()
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(EVENTO_SESION_REQUERIDA))
        }
      }
    } catch { /* si no se puede leer el cuerpo, se deja pasar el error tal cual */ }
  }
  return res
}

export const dbFin = createClient(URL_FIN, KEY_SB, {
  auth: { persistSession: false },
  global: { fetch: fetchConSesion },
})

/**
 * Abre la sesión de finanzas con el PIN.
 * Usa `erp_admin_sesion` (NO `staff_login`): tiene freno anti-fuerza-bruta
 * y restringe a admin/superadmin/ejecutivo/rrhh.
 * @returns {Promise<{token:string, nombre:string, rol:string}>}
 */
export async function abrirSesionFinanzas(pin) {
  const { data, error } = await db.rpc('erp_admin_sesion', { p_pin: String(pin || '').trim() })
  if (error) throw new Error(error.message || 'PIN incorrecto')
  if (!data?.token) throw new Error('No se pudo abrir la sesión')
  setTorreToken(data.token)
  return data
}

/** True si el error vino del gate (sesión ausente/vencida/rol sin acceso). */
export const esErrorDeSesion = (error) =>
  !!error && (error.code === 'FIN_SIN_SESION' || /FIN_SIN_SESION/.test(error.message || ''))
