import { db } from '../supabase'

// Fotos guardadas en buckets privados (p. ej. `despachos-fotos`).
//
// Las pantallas guardan en la base la URL de `getPublicUrl(...)`, pero en un
// bucket privado esa URL responde 400: el enlace se ve y no abre nada. Pasaba con
// las fotos de recepción de despachos y con la foto de entrega al motorista de
// PedidosYa. En vez de reescribir las URLs ya guardadas (vienen con hosts
// distintos: supabase.co, el proxy /sb y api.freakiedogs.com), se saca de la URL
// el bucket y la ruta, y al tocar el enlace se pide una URL firmada. `anon` tiene
// SELECT en el bucket, así que la firma funciona sin sesión.
export function bucketYRuta(url) {
  const m = String(url || '').match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/)
  if (!m) return null
  return { bucket: m[1], ruta: decodeURIComponent(m[2]) }
}

export async function urlFirmada(url, segundos = 3600) {
  const br = bucketYRuta(url)
  if (!br) return url // no es de Storage: se usa tal cual
  const { data, error } = await db.storage.from(br.bucket).createSignedUrl(br.ruta, segundos)
  if (error || !data?.signedUrl) throw error || new Error('No se pudo firmar la foto')
  return data.signedUrl
}

// Para un onClick: abre la pestaña de inmediato (si no, iOS bloquea el pop-up
// que se abre después del await) y le pone la URL firmada cuando llega.
export async function abrirFotoPrivada(url, e) {
  e?.preventDefault?.(); e?.stopPropagation?.()
  const ventana = window.open('', '_blank')
  try {
    const firmada = await urlFirmada(url)
    if (ventana) ventana.location.href = firmada
    else window.location.href = firmada
  } catch {
    if (ventana) ventana.close()
    alert('No se pudo abrir la foto')
  }
}
