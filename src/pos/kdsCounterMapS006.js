// ────────────────────────────────────────────────────────────────────
// KDS Contador — configuración específica de S006 (Metro Centro)
//
// Modo de uso: KDSScreen.jsx calcula los contadores desde la cola de
// cocina en tiempo real. Cada item de una comanda (por su `nombre_item`,
// case-insensitive) suma una o más categorías según KDS_CONTADOR_MAP.
// Los modificadores que coincidan con KDS_MODIFICADOR_MAP también suman.
//
// Para expandir a otras sucursales: importar este archivo y filtrar por
// storeCode antes de renderizar.
// ────────────────────────────────────────────────────────────────────

// Estaciones visibles en la barra del KDS (orden = orden visual)
export const KDS_CONTADOR_ESTACIONES = [
  {
    id: 'plancha',
    label: 'Plancha carne',
    color: '#ef4444',
    items: ['hamburguesa', 'hamburguesa_clasica', 'costra_queso'],
  },
  {
    id: 'hotdogs',
    label: 'Hot dogs',
    color: '#22c55e',
    items: ['freakie_dog', 'chili_dog', 'super_freak', 'dip_queso'],
  },
  {
    id: 'fritos',
    label: 'Fritos',
    color: '#f59e0b',
    items: ['papa', 'mini_fancy', 'fancy', 'aros', 'queso_frito', 'papa_blanca', 'papa_waffle'],
  },
]

// Nombre visible de cada contador
export const KDS_CONTADOR_LABELS = {
  hamburguesa:         'Hamburguesa',
  hamburguesa_clasica: 'Ham. Clásica',
  costra_queso:        'Costra Queso',
  freakie_dog:         'Freakie Dog',
  chili_dog:           'Chili Dog',
  super_freak:         'Super Freak',
  dip_queso:           'Dip Queso',
  papa:                'Papa',
  mini_fancy:          'Mini Fancy',
  fancy:               'Fancy',
  aros:                'Aros Cebolla',
  queso_frito:         'Queso Frito',
  papa_blanca:         'Papa Blanca',
  papa_waffle:         'Papa Waffle',
}

// Normaliza un nombre para comparación:
// lowercase, sin acentos, guiones/underscores → espacios, espacios colapsados
// ̀-ͯ = combining marks (acentos y diacríticos separados por NFD)
const norm = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[-_/]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

// Mapeo: nombre normalizado del item → { contador: cantidad, ... }
// Cuando el POS envíe el ítem a cocina, sumamos estas cantidades por
// cada unidad del item pedido (item.cantidad multiplica al mapeo).
const RAW_MAP = {
  // ─── Combos ───
  'fancy fries combo':      { freakie_dog: 4, fancy: 1 },
  'agrandado soda y papa':  { papa: 1 },
  'la clasica':             { hamburguesa_clasica: 1, papa: 1 },
  'combo hamburguesa':      { hamburguesa: 1, papa: 1 },
  'combo super freak':      { super_freak: 1, papa: 1 },
  'combo freakie dog':      { freakie_dog: 1, papa: 1 },
  'combo chilli dog':       { chili_dog: 1, papa: 1 },
  'combo chili dog':        { chili_dog: 1, papa: 1 },
  'pepsi combo':            { freakie_dog: 1, papa: 1 },
  'pepsi combo xl':         { freakie_dog: 2, papa: 1 },
  'coca cola combo':        { freakie_dog: 1, papa: 1 },
  'coca cola combo xl':     { freakie_dog: 2, papa: 1 },
  'burger duo':             { hamburguesa: 2, papa: 2 },
  'sweet burger duo':       { hamburguesa: 2, papa: 2 },
  'duo picossini':          { hamburguesa: 2, papa: 2, queso_frito: 1 },
  'combo fancy duo':        { freakie_dog: 2, mini_fancy: 1 },
  'royal truffle combo':    { hamburguesa: 2, mini_fancy: 1 },
  'burger box':             { hamburguesa: 2, freakie_dog: 2, papa: 2, costra_queso: 1 },
  'freakie box':            { freakie_dog: 3, papa: 1, papa_blanca: 1, papa_waffle: 1, aros: 1 },
  'combros':                { freakie_dog: 4, papa: 1, papa_blanca: 1, aros: 1 },
  'combleto':               { freakie_dog: 2, hamburguesa: 2, costra_queso: 1, queso_frito: 1, papa: 2, dip_queso: 1 },
  'burger la clasica':      { hamburguesa_clasica: 1, papa: 1 },
  'combo gol-oso':          { hamburguesa: 2, papa: 2 },
  'combo goloso':           { hamburguesa: 2, papa: 2 },
  'chili duo':              { chili_dog: 2, papa: 2, aros: 1 },

  // ─── Individuales ───
  'freakie dog':            { freakie_dog: 1 },
  'friki dog':              { freakie_dog: 1 },
  'super freak':            { super_freak: 1 },
  'chili dog':              { chili_dog: 1 },
  'hamburguesa':            { hamburguesa: 1 },
  'papa sazonada':          { papa: 1 },
  'freaki fries':           { papa: 1 },
  'freakie fries':          { papa: 1 },
  'friki fries':            { papa: 1 },
  'papa blanca':            { papa_blanca: 1 },
  'papa waffle':            { papa_waffle: 1 },
  'mini fancy':             { mini_fancy: 1 },
  'mini fancys':            { mini_fancy: 1 },
  'chili mini fancy':       { mini_fancy: 1 },
  'chili mini fancys':      { mini_fancy: 1 },
  'fancy xl':               { fancy: 1 },
  'aros de cebolla':        { aros: 1 },
  'queso frito':            { queso_frito: 1 },
  'dip de queso':           { dip_queso: 1 },
  'dip queso':              { dip_queso: 1 },
}

// Modificadores que suman al contador (nombre normalizado del mod)
const RAW_MOD_MAP = {
  'costra de queso': { costra_queso: 1 },
  'costra queso':    { costra_queso: 1 },
  'dip de queso':    { dip_queso: 1 },
  'dip queso':       { dip_queso: 1 },
}

// Pre-normalizar las claves una sola vez al importar
export const KDS_CONTADOR_MAP = Object.fromEntries(
  Object.entries(RAW_MAP).map(([k, v]) => [norm(k), v])
)
export const KDS_MODIFICADOR_MAP = Object.fromEntries(
  Object.entries(RAW_MOD_MAP).map(([k, v]) => [norm(k), v])
)

// Calcula los contadores desde las rows crudas de pos_cocina_queue.
// Solo suma items con estado 'pendiente' o 'en_preparacion'.
export function calcularContadoresS006(queueRows) {
  const contador = {}
  for (const row of queueRows || []) {
    if (row.estado === 'completado' || row.estado === 'cancelado') continue
    const cantidad = row.cantidad || 1
    const nombreN = norm(row.nombre_item)
    const mapeo = KDS_CONTADOR_MAP[nombreN]
    if (mapeo) {
      for (const [k, q] of Object.entries(mapeo)) {
        contador[k] = (contador[k] || 0) + q * cantidad
      }
    }
    // Modificadores del row
    for (const mod of row.modificadores || []) {
      const modN = norm(mod?.nombre)
      const modMap = KDS_MODIFICADOR_MAP[modN]
      if (modMap) {
        for (const [k, q] of Object.entries(modMap)) {
          contador[k] = (contador[k] || 0) + q * cantidad
        }
      }
    }
  }
  return contador
}
