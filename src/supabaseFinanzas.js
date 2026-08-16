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
// ────────────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'
import { db, URL_SB, KEY_SB } from './supabase'

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

// Adjunta el token a cada request sin fijarlo al crear el cliente: así toma
// la sesión nueva apenas se abre, sin recargar la página.
const fetchConSesion = (input, init = {}) => {
  const headers = new Headers(init.headers || {})
  const token = getTorreToken()
  if (token) headers.set('x-torre-token', token)
  return fetch(input, { ...init, headers })
}

export const dbFin = createClient(URL_SB, KEY_SB, {
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
