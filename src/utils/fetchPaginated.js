/**
 * fetchPaginated — helpers para paginación segura de Supabase JS.
 *
 * Supabase JS LIMITA la respuesta a 1000 filas por request (configurable
 * server-side, pero por defecto anon=1000). Si necesitás todas las filas
 * de una query >1000 hay que iterar `.range()` reconstruyendo el query
 * builder en cada iteración (el builder NO es reusable — muta entre llamadas).
 *
 * API:
 *   import { fetchAllRows, fetchInChunks, fetchPaginated } from '@/utils/fetchPaginated'
 *
 *   // 1) Forma recomendada — factory function
 *   const rows = await fetchAllRows(db, 'compras_dte',
 *     q => q.select('id,proveedor_nombre,fecha_emision').gte('fecha_emision', desde)
 *   )
 *
 *   // 2) .in() con muchos ids — pagina además del chunking
 *   const items = await fetchInChunks(db, 'compras_dte_items',
 *     'id,compras_dte_id,descripcion,cantidad,precio_unitario',
 *     'compras_dte_id', dteIds, 100
 *   )
 *
 *   // 3) Legacy — alias `fetchPaginated` para compat (acepta builder pre-construido,
 *   //    solo seguro hasta 1000 filas — emite warn si se trunca).
 */

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_CHUNK_SIZE = 100

/**
 * Paginar una tabla/vista completa hasta agotar filas.
 * El builderFn DEBE devolver un nuevo query en cada llamada (no compartir state).
 *
 * @param {object}   client     - Cliente Supabase (db / supabase).
 * @param {string}   table      - Nombre de tabla o vista.
 * @param {function} builderFn  - Función `(q) => q.select(...).filtros...` — recibe `client.from(table)` y aplica select+filtros.
 * @param {number}   [pageSize] - Filas por página (default 1000, máx anon).
 * @returns {Promise<Array>}
 */
export async function fetchAllRows(client, table, builderFn, pageSize = DEFAULT_PAGE_SIZE) {
  if (!client || typeof client.from !== 'function') {
    throw new Error('fetchAllRows: client inválido (esperado supabase client con .from())')
  }
  if (typeof builderFn !== 'function') {
    throw new Error('fetchAllRows: builderFn debe ser función `(q) => q.select(...).filtros()`')
  }
  const all = []
  let from = 0
  // Safety cap: 200 páginas × 1000 = 200K filas. Si superás esto algo está mal.
  const MAX_PAGES = 200
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = builderFn(client.from(table))
    const { data, error } = await q.range(from, from + pageSize - 1)
    if (error) {
      console.error(`[fetchAllRows] error en ${table} pag ${page}:`, error)
      throw error
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

/**
 * Hacer una query `.in(col, ids)` partiendo los ids en chunks y paginando
 * cada chunk por si la respuesta supera 1000 filas.
 *
 * @param {object}   client       - Cliente Supabase.
 * @param {string}   table        - Tabla/vista.
 * @param {string}   selectCols   - Columnas para select() — ej 'id,nombre'.
 * @param {string}   byCol        - Columna del .in() — ej 'compras_dte_id'.
 * @param {Array}    ids          - Array de ids/valores.
 * @param {number}   [chunkSize]  - Tamaño de chunk (default 100).
 * @param {function} [extraFilter] - Optional fn `(q) => q` para añadir filtros (eq, gte, order, etc.).
 * @returns {Promise<Array>}
 */
export async function fetchInChunks(client, table, selectCols, byCol, ids, chunkSize = DEFAULT_CHUNK_SIZE, extraFilter = null) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const uniq = [...new Set(ids)]
  const all = []
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize)
    // Paginar el output del chunk por si excede 1000 filas
    const rows = await fetchAllRows(client, table, q => {
      let qq = q.select(selectCols).in(byCol, chunk)
      if (extraFilter) qq = extraFilter(qq)
      return qq
    })
    all.push(...rows)
  }
  return all
}

/**
 * LEGACY — acepta un builder Supabase pre-construido.
 *
 * ⚠️ El builder se reusa entre iteraciones, lo que NO es seguro en Supabase JS.
 *    Solo úsalo si garantizás <1000 filas. Para datasets más grandes migrá a
 *    `fetchAllRows(client, table, q => ...)`.
 *
 * Mantenido para compat mientras se completa la migración.
 *
 * @param {object} builder         - Query Supabase pre-construida.
 * @param {object} [opts]          - { pageSize?, label? }
 */
export async function fetchPaginated(builder, opts = {}) {
  const pageSize = opts.pageSize || DEFAULT_PAGE_SIZE
  const label = opts.label || 'rows'
  const { data, error } = await builder.range(0, pageSize - 1)
  if (error) { console.error(`[fetchPaginated:${label}]`, error); return [] }
  if (data && data.length === pageSize) {
    console.warn(`[fetchPaginated:${label}] devolvió ${pageSize} filas — posible truncado. Migrá a fetchAllRows(client, table, q => ...).`)
  }
  return data || []
}
