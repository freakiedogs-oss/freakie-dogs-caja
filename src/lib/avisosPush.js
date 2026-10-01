// Avisos del ERP en el celular o la tablet (Web Push) — 1-oct-2026.
// Hoy los usa la bandeja de cancelaciones: cuando se cancela algo que ya estaba
// en cocina, el gerente de la sucursal (y a los 15 min, otra vez él) recibe una
// notificación aunque el ERP esté cerrado.
//
// · Android (Chrome): funciona con el ERP cerrado y el teléfono bloqueado.
// · iPhone: solo si el ERP está instalado en la pantalla de inicio
//   (Compartir → "Agregar a pantalla de inicio") y se abre desde ese ícono.
// La clave pública VAPID se pide a la base; la privada nunca sale del servidor.
import { db } from '../supabase'

const b64aBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

// navigator.serviceWorker.ready nunca resuelve si el service worker no se
// registró (falló la carga, modo privado raro): sin este límite la pantalla se
// quedaba en «Revisando…» para siempre.
const swListo = () => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, rej) => setTimeout(() => rej(new Error('El ERP no terminó de cargar en este dispositivo. Recargá la página e intentá de nuevo.')), 5000)),
])

const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const esInstalada = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

// Estado de este dispositivo: 'no_soportado' | 'ios_sin_instalar' | 'bloqueado' | 'activo' | 'inactivo'
export async function estadoAvisos() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return esIOS() && !esInstalada() ? 'ios_sin_instalar' : 'no_soportado'
  }
  if (Notification.permission === 'denied') return 'bloqueado'
  try {
    const reg = await swListo()
    const sub = await reg.pushManager.getSubscription()
    return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo'
  } catch {
    return 'inactivo'
  }
}

// Pide permiso, se suscribe y guarda la suscripción a nombre del usuario.
// Hay que llamarlo desde un toque del usuario (iPhone lo exige).
export async function activarAvisos(user) {
  const est = await estadoAvisos()
  if (est === 'ios_sin_instalar') throw new Error('En iPhone, primero instalá el ERP: Compartir → "Agregar a pantalla de inicio", y abrilo desde ese ícono.')
  if (est === 'no_soportado') throw new Error('Este navegador no recibe avisos. Usá Chrome en Android o el ERP instalado en iPhone.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('No se dio permiso para avisos. Activalo en los ajustes del navegador para este sitio.')

  const { data: clave, error: ek } = await db.rpc('push_vapid_publica')
  if (ek || !clave) throw new Error('No se pudo preparar el aviso (falta la clave del servidor).')

  const reg = await swListo()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aBytes(clave) })
  }
  const j = sub.toJSON()
  const { data, error } = await db.rpc('push_suscribir', {
    p_usuario_id: user.id,
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) throw new Error('No se pudo guardar el aviso: ' + error.message)
  return data
}

export async function desactivarAvisos() {
  try {
    const reg = await swListo()
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await db.rpc('push_desuscribir', { p_endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
  } catch { /* nada que hacer */ }
}

export async function probarAvisos(user) {
  const { data, error } = await db.rpc('push_probar', { p_usuario_id: user.id })
  if (error) throw new Error(error.message)
  return data
}
