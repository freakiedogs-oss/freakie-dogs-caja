/* Render real de ConteoCriticosTab en jsdom, con los efectos corridos.
 *
 *   npm i --no-save jsdom esbuild        # no van en package.json: sólo sirven acá
 *   node scripts/test-criticos-render.mjs
 *
 * `node scripts/test-criticos.mjs` prueba la aritmética; esto prueba que la
 * PANTALLA la muestra: que pinta las 15 filas con sus casillas, que teclear
 * recalcula la diferencia en vivo, y que React no tira un solo warning.
 *
 * `db.rpc` va stubbeado con la respuesta de fn_criticos_hoja para Venecia
 * (S004) el 20-sep-2026, con la venta real de ese día (336 bolitas de carne,
 * 167 panes) verificada contra el kardex.
 */
import { JSDOM } from 'jsdom'
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const HOJA = {
  "cabecera": {
    "store_code": "S004",
    "sucursal": "Paseo Venecia",
    "fecha": "2026-09-20",
    "estado": "sin_hoja",
    "notas": null,
    "ingresado_por_nombre": null,
    "actualizado": null
  },
  "items": [
    {
      "item_id": "it1",
      "orden": 1,
      "categoria": "Carnicos",
      "nombre": "Carne P Burguer",
      "presentacion": "Paquete",
      "unidades_derivadas": "20 Bolitas",
      "unidad_conteo": "Paquete de 20 bolitas",
      "unidad_stock": "unidad",
      "factor": 20,
      "fraccionado": true,
      "unidad_suelta": "bolitas",
      "factor_suelta": 1,
      "nota_config": null,
      "productos": [
        {
          "id": "p1",
          "nombre": "Carne P Burguer",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 336,
      "pedido_sistema": 400,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it2",
      "orden": 2,
      "categoria": "Carnicos",
      "nombre": "Salchichas",
      "presentacion": "Paquete",
      "unidades_derivadas": "25 Unidades",
      "unidad_conteo": "Bolsa de 25 unidades",
      "unidad_stock": "paquete",
      "factor": 1,
      "fraccionado": true,
      "unidad_suelta": "salchichas",
      "factor_suelta": 0.04,
      "nota_config": null,
      "productos": [
        {
          "id": "p2",
          "nombre": "Salchichas",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 3.08,
      "pedido_sistema": 5,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it3",
      "orden": 3,
      "categoria": "Carnicos",
      "nombre": "Tocineta",
      "presentacion": "Caja",
      "unidades_derivadas": "* Libras",
      "unidad_conteo": "Bandeja de 200 lascas",
      "unidad_stock": "paquete",
      "factor": 1,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": "La hoja dice \"Caja / *Libras\"; el kardex lo mueve por BANDEJA de 200 lascas.",
      "productos": [
        {
          "id": "p3",
          "nombre": "Tocineta",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 1.4609,
      "pedido_sistema": 2,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it4",
      "orden": 4,
      "categoria": "Carnicos",
      "nombre": "Chili",
      "presentacion": "Bolsa 5 Libras",
      "unidades_derivadas": "*Libras",
      "unidad_conteo": "Bolsa de 5 libras",
      "unidad_stock": "bolsa",
      "factor": 1,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": null,
      "productos": [
        {
          "id": "p4",
          "nombre": "Chili",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 2.1563,
      "pedido_sistema": 3,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it5",
      "orden": 5,
      "categoria": "Lacteos",
      "nombre": "Queso P Freir",
      "presentacion": "Paquete",
      "unidades_derivadas": "25 Bolsitas",
      "unidad_conteo": "Libra",
      "unidad_stock": "lb",
      "factor": 1,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": "El kardex lo mueve en LIBRAS y el producto no tiene presentacion cargada.",
      "productos": [
        {
          "id": "p5",
          "nombre": "Queso P Freir",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 7.2,
      "pedido_sistema": 0,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it6",
      "orden": 6,
      "categoria": "Lacteos",
      "nombre": "Queso Mozzarela",
      "presentacion": "Paquete 5 Libras",
      "unidades_derivadas": "*Libras",
      "unidad_conteo": "Paquete de 5 libras",
      "unidad_stock": "lb",
      "factor": 5,
      "fraccionado": true,
      "unidad_suelta": "lascas",
      "factor_suelta": 0.034,
      "nota_config": null,
      "productos": [
        {
          "id": "p6",
          "nombre": "Queso Mozzarela",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 0.8732,
      "pedido_sistema": 0,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it7",
      "orden": 7,
      "categoria": "Lacteos",
      "nombre": "Queso Cheedar",
      "presentacion": "Bol de 2.25 Libras",
      "unidades_derivadas": "*Libras",
      "unidad_conteo": "Bolsa de 2 libras",
      "unidad_stock": "bolsa",
      "factor": 1,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": "La hoja dice bol de 2.25 libras; el catalogo lo tiene como bolsa de 2 libras.",
      "productos": [
        {
          "id": "p7",
          "nombre": "Queso Cheedar",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 2.625,
      "pedido_sistema": 8,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it8",
      "orden": 8,
      "categoria": "Lacteos",
      "nombre": "Queso Amaricano A",
      "presentacion": "Bloque 3 Libras",
      "unidades_derivadas": "Rebanadas",
      "unidad_conteo": "Paquete de 3 libras",
      "unidad_stock": "lb",
      "factor": 3,
      "fraccionado": true,
      "unidad_suelta": "lascas",
      "factor_suelta": 0.0333,
      "nota_config": null,
      "productos": [
        {
          "id": "p8",
          "nombre": "Queso Amaricano A",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 11.2057,
      "pedido_sistema": 24,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it9",
      "orden": 9,
      "categoria": "Congelados",
      "nombre": "Papas Sazonadas",
      "presentacion": "Caja de 6 Bolsas",
      "unidades_derivadas": "*5 Li C/Bolsa",
      "unidad_conteo": "Bolsa de 5 libras",
      "unidad_stock": "libra",
      "factor": 5,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": "La hoja anota la caja de 6 bolsas; aca se cuenta POR BOLSA (5 lb).",
      "productos": [
        {
          "id": "p9",
          "nombre": "Papas Sazonadas",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 0.7,
      "pedido_sistema": 150,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it10",
      "orden": 10,
      "categoria": "Congelados",
      "nombre": "Papas Francesas",
      "presentacion": "Caja de 4 Bolsas",
      "unidades_derivadas": "*5.5 Li C/Bolsa",
      "unidad_conteo": "Bolsa de 5.5 libras",
      "unidad_stock": "lb",
      "factor": 5.5,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": "La hoja anota la caja de 4 bolsas; aca se cuenta POR BOLSA (5.5 lb).",
      "productos": [
        {
          "id": "p10",
          "nombre": "Papas Francesas",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 2.9,
      "pedido_sistema": 16.5,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it11",
      "orden": 11,
      "categoria": "Congelados",
      "nombre": "Aros de Cebolla",
      "presentacion": "Bolsa de 2.5 Libras",
      "unidades_derivadas": "*Libras",
      "unidad_conteo": "Bolsa de 2.5 libras",
      "unidad_stock": "porcion",
      "factor": 7,
      "fraccionado": false,
      "unidad_suelta": null,
      "factor_suelta": null,
      "nota_config": "El kardex lo descarga en PORCIONES (7 por bolsa), no en libras.",
      "productos": [
        {
          "id": "p11",
          "nombre": "Aros de Cebolla",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 6,
      "pedido_sistema": 0,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it12",
      "orden": 12,
      "categoria": "Congelados",
      "nombre": "Cheesecake",
      "presentacion": "Caja",
      "unidades_derivadas": "10 Porciones",
      "unidad_conteo": "Caja de 10 porciones",
      "unidad_stock": "porcion",
      "factor": 10,
      "fraccionado": true,
      "unidad_suelta": "porciones",
      "factor_suelta": 1,
      "nota_config": null,
      "productos": [
        {
          "id": "p12",
          "nombre": "Cheesecake",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 2,
      "pedido_sistema": 0,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it13",
      "orden": 13,
      "categoria": "Harinas Panes",
      "nombre": "Pan Para Burguer",
      "presentacion": "Bolsa",
      "unidades_derivadas": "12 Uni",
      "unidad_conteo": "Bolsa de 12 unidades",
      "unidad_stock": "unidad",
      "factor": 12,
      "fraccionado": true,
      "unidad_suelta": "panes",
      "factor_suelta": 1,
      "nota_config": null,
      "productos": [
        {
          "id": "p13",
          "nombre": "Pan Para Burguer",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 167,
      "pedido_sistema": 180,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it14",
      "orden": 14,
      "categoria": "Harinas Panes",
      "nombre": "Pan Tradicional HD",
      "presentacion": "Bolsa",
      "unidades_derivadas": "10 Uni",
      "unidad_conteo": "Bolsa de 10 unidades",
      "unidad_stock": "bolsa",
      "factor": 1,
      "fraccionado": true,
      "unidad_suelta": "panes",
      "factor_suelta": 0.1,
      "nota_config": "Esta fila mapea a DOS productos del catalogo porque el insumo se cambio el 25-ago-2026.",
      "productos": [
        {
          "id": "p14",
          "nombre": "Pan Tradicional HD",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 7.3,
      "pedido_sistema": 10,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    },
    {
      "item_id": "it15",
      "orden": 15,
      "categoria": "Harinas Panes",
      "nombre": "Pan Super Friek",
      "presentacion": "Bolsa",
      "unidades_derivadas": "48 Uni",
      "unidad_conteo": "Bolsa de 21 unidades",
      "unidad_stock": "bolsa",
      "factor": 1,
      "fraccionado": true,
      "unidad_suelta": "panes",
      "factor_suelta": 0.047619,
      "nota_config": "La hoja dice bolsa de 48 unidades; el catalogo usa la bolsa de 21.",
      "productos": [
        {
          "id": "p15",
          "nombre": "Pan Super Friek",
          "factor_a_item": 1,
          "principal": true
        }
      ],
      "venta_dia": 0.1904,
      "pedido_sistema": 2,
      "cid_sugerido": null,
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false
    }
  ]
}

const dom = new JSDOM('<!doctype html><html><body><div id="r"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Stubs: supabase y config, para no pegarle a la red.
const stubs = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /supabase$|\/supabase$/ }, () => ({ path: 'stub-sb', namespace: 's' }))
    b.onResolve({ filter: /\/config$/ }, () => ({ path: 'stub-cfg', namespace: 's' }))
    b.onLoad({ filter: /.*/, namespace: 's' }, (a) => {
      if (a.path === 'stub-sb') return { contents: `
        export const db = { rpc: async (fn, args) => {
          globalThis.__llamadas.push([fn, args])
          if (fn === 'fn_criticos_hoja') return { data: globalThis.__hoja, error: null }
          if (fn === 'fn_criticos_guardar') return { data: { ok:true, guardados: 2 }, error: null }
          return { data: null, error: null }
        } }`, loader: 'js' }
      return { contents: `
        export const STORES_SHORT = { M001:'Cafetalón', S001:'Soyapango', S002:'Usulután',
          S003:'Lourdes', S004:'Venecia', S006:'Metrocentro' }
        export const today = () => '2026-09-21'
        export const shiftDate = (d,k) => { const x=new Date(d+'T12:00:00'); x.setDate(x.getDate()+k); return x.toISOString().slice(0,10) }
        export const n = (v) => parseFloat(v)||0`, loader: 'js' }
    })
  },
}

const out = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/components/dashboard/ConteoCriticosTab.jsx')],
  bundle: true, write: false, format: 'esm', jsx: 'automatic',
  alias: { '@': path.join(ROOT, 'src') },
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [stubs], logLevel: 'error',
})
const BUNDLE = path.join(ROOT, 'node_modules', `.criticos-render-${process.pid}.mjs`)
fs.writeFileSync(BUNDLE, out.outputFiles[0].text)

globalThis.__hoja = HOJA
globalThis.__llamadas = []

// Capturar warnings de React como fallos.
const warnings = []
const origErr = console.error, origWarn = console.warn
console.error = (...a) => { warnings.push(a.join(' ')); origErr(...a) }
console.warn  = (...a) => { warnings.push(a.join(' ')); origWarn(...a) }

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const Tab = (await import('file://' + BUNDLE)).default

const root = createRoot(document.getElementById('r'))
await act(async () => { root.render(React.createElement(Tab, { user: { id:'u1', nombre:'Saúl', rol:'ejecutivo' } })) })
await act(async () => { await new Promise(r => setTimeout(r, 30)) })

console.error = origErr; console.warn = origWarn

const html = document.getElementById('r').innerHTML
const txt = document.getElementById('r').textContent
let fallos = 0, n = 0
const chk = (ok, t) => { n++; console.log(`  ${ok?'✓':'✗'} ${t}`); if(!ok) fallos++ }

console.log('\n═ Render real en jsdom ═\n')
chk(globalThis.__llamadas.some(([f]) => f === 'fn_criticos_hoja'), 'el efecto llama a fn_criticos_hoja al montar')
chk(html.length > 3000, `pinta la hoja (${html.length} bytes de HTML)`)
for (const p of ['Carne P Burguer','Chili','Queso Mozzarela','Papas Sazonadas','Pan Super Friek'])
  chk(txt.includes(p), `sale "${p}"`)
for (const c of ['Carnicos','Lacteos','Congelados','Harinas Panes'])
  chk(txt.includes(c), `sale la categoría "${c}"`)
chk(document.querySelectorAll('input[type=number]').length > 0,
    `${document.querySelectorAll('input[type=number]').length} casillas de captura`)
// Por fila: CID enteros, Se pidió, Desc AM, Desc PM, TPS Final, En línea = 6.
// Los fraccionados suman UNA más: las sueltas del CID. Ninguna otra columna
// lleva doble casilla — es la corrección de Saúl del 21-sep.
const frac = HOJA.items.filter(i => i.fraccionado).length
const esperadas = HOJA.items.length * 6 + frac
chk(document.querySelectorAll('input[type=number]').length === esperadas,
    `son exactamente ${esperadas} (15 filas × 6 + ${frac} fraccionados × 1 por las sueltas del CID)`)
chk(txt.includes('Venecia'), 'el encabezado nombra la sucursal')
chk(txt.includes('CID') && txt.includes('TPS Final') && txt.includes('En línea'),
    'están las columnas de la hoja')
chk(txt.includes('Desc. AM') && txt.includes('Desc. PM'), 'están las descargas bodega→cocina')
chk(txt.includes('Venta día'), 'está la columna de venta del día')
chk(!txt.includes('CORTE AM/PM') && !txt.includes('Turno de caja'),
    'ya NO está el control de corte AM/PM (la venta es un solo número del día)')
chk(!txt.includes('un solo turno'), 'ni el banner de turnos')
chk(txt.includes('no dicen lo mismo'), 'avisa de las discrepancias hoja vs catálogo')
chk(txt.includes('sin contar'), 'la hoja vacía dice "sin contar", no "descuadre"')
chk(!txt.includes('NaN') && !txt.includes('undefined'), 'no hay NaN ni undefined en pantalla')
chk(warnings.length === 0, warnings.length ? `React tiró ${warnings.length} warning(s): ${warnings[0].slice(0,140)}` : 'React no tiró ningún warning')


/* ── Interacción: teclear el conteo y ver aparecer la diferencia ──────── */
console.log('\n═ Interacción: se teclea y la diferencia se recalcula ═\n')
function teclear(el, valor) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(el, String(valor))
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
const filaCarne = [...document.querySelectorAll('tr')].find(t => t.textContent.includes('Carne P Burguer'))
const ins = filaCarne.querySelectorAll('input[type=number]')
chk(ins.length === 7, `la carne (fraccionada) tiene 7 casillas, no 8 — dio ${ins.length}`)

// CID 3 paquetes + 5 bolitas (65), TPS 2 paquetes (40), En línea 7 bolitas.
// Con venta 336 y pedido 400:
//   teórico = 65 + 400 − 336 = 129 un = 6.45 paquetes
//   real    = 47 un = 2.35 paquetes  →  dif = −82 un = −4.1 paquetes (−24.4%)
await act(async () => { teclear(ins[0], '3') })   // CID enteros
await act(async () => { teclear(ins[1], '5') })   // CID sueltas
await act(async () => { teclear(ins[5], '2') })   // TPS Final
await act(async () => { teclear(ins[6], '7') })   // En línea
// (ins[2] es Se pidió y se deja vacío a propósito: así el teórico usa los
//  400 del sistema y se prueba de paso el camino de la sugerencia.)

const filaAhora = [...document.querySelectorAll('tr')].find(t => t.textContent.includes('Carne P Burguer'))
const celdas = [...filaAhora.querySelectorAll('td')].map(t => t.textContent.trim())
chk(celdas.includes('6.45'), `el teórico sale 6.45 paquetes (fila: ${celdas.join(' | ').slice(-60)})`)
chk(celdas.includes('2.35'), 'el real sale 2.35 paquetes')
chk(celdas.some(t => t === '-4.1'), 'la diferencia sale −4.1 paquetes')
chk(celdas.some(t => t.includes('-24.4%')), 'y el porcentaje −24.4%')

// Las descargas bodega→cocina se digitan pero NO deben mover la diferencia.
await act(async () => { teclear(ins[3], '8') })   // Desc. AM
await act(async () => { teclear(ins[4], '4') })   // Desc. PM
const tras = [...[...document.querySelectorAll('tr')].find(t => t.textContent.includes('Carne P Burguer'))
  .querySelectorAll('td')].map(t => t.textContent.trim())
chk(tras.includes('6.45') && tras.some(t => t === '-4.1'),
    'digitar las descargas NO cambia el teórico ni la diferencia')

const resumenTxt = document.getElementById('r').textContent
chk(/✕ 1 descuadres/.test(resumenTxt), 'el resumen pasa a contar 1 descuadre')
chk(/○ 14 sin contar/.test(resumenTxt), 'y deja 14 filas sin contar')
chk(warnings.length === 0, 'seguimos sin warnings de React tras teclear')

console.log('\n' + '─'.repeat(56))
console.log(fallos === 0 ? `✓ ${n} comprobaciones OK` : `✗ ${fallos} de ${n} fallaron`)
fs.rmSync(BUNDLE, { force: true })
process.exit(fallos ? 1 : 0)
