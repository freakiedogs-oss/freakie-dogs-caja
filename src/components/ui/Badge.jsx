export function Badge({ estado }) {
  const map = {
    enviado: ['badge-yellow', 'Enviado'],
    aprobado: ['badge-green', 'Aprobado'],
    preparando: ['badge-blue', 'Preparando'],
    despachado: ['badge-orange', 'Despachado'],
    en_ruta: ['badge-orange', 'En Ruta'],
    recibido: ['badge-green', 'Recibido'],
    cancelado: ['badge-gray', 'Cancelado'],
    pendiente: ['badge-yellow', 'Pendiente'],
    borrador: ['badge-gray', 'Borrador'],
  }
  const [cls, label] = map[estado] || ['badge-gray', estado || '—']
  return <span className={`badge ${cls}`}>{label}</span>
}
