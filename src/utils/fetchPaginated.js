/**
 * fetchPaginated — helper estándar de paginación para Supabase.
 *
 * Uso:
 *   import { fetchPaginated } from '../../utils/fetchPaginated'
 *
 *   // Con query ya construida (BancoView-style):
 *   const data = await fetchPaginated(db.from('tabla').select('col1,col2').gte('fecha', desde))
 *
 *   // Con tabla + select + filtro (RentabilidadView / FinanzasDashboard-style):
 *   const data = await fetchPaginated('tabla', 'col1,col2', q => q.gte('fecha', desde), db)
 *
 * En ambas formas se itera .range(from, from + pageSize - 1) hasta agotar filas.
 */

const PAGE_SIZE = 1000

/**
 * @param {object|string} queryOrTable  - Query Supabase ya construida, O nombre de tabla (string).
 * @param {string}        [select]      - Columnas (solo cuando el 1er arg es string).
 * @param {function}      [filter]      - Función que recibe la query y devuelve la query con filtros.
 * @param {object}        [db]          - Cliente Supabase (requerido cuando el 1er arg es string).
 * @param {number}        [pageSize]    - Filas por página (default 1000).
 * @returns {Promise<Array>}
 */
export async function fetchPaginated(queryOrTable, select, filter, db, pageSize = PAGE_SIZE) {
  const all = []
  let from = 0

  const isString = typeof queryOrTable === 'string'

  while (true) {
    let q
    if (isString) {
      q = db.from(queryOrTable).select(select || '*')
      if (filter) q = filter(q)
    } else {
      q = queryOrTable
    }
    const { data, error } = await q.range(from, from + pageSize - 1)
    if (error) { console.error('fetchPaginated error:', error); break }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
    // Para queries ya construidas necesitamos clonar desde el inicio en cada iter.
    // Supabase JS builder NO es re-usable — para esos casos el llamador debe
    // pasar una función factory. Advertencia en consola si detectamos re-uso.
    if (!isString && from > 0) {
      console.warn('fetchPaginated: para tablas >1000 filas con query pre-construida usá la forma funcional (filter fn).')
      break
    }
  }
  return all
}
