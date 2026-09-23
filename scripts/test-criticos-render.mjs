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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 0.7168,
      "cid_sug_enteros": 3,
      "cid_sug_sueltas": 5,
      "clase": "porcionado",
      "tolerancia_pct": null
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 8.25,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": null
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
      "fraccionado": true,
      "unidad_suelta": "de bolsa",
      "factor_suelta": 1,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 3.22,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
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
      "fraccionado": true,
      "unidad_suelta": "de bolsa",
      "factor_suelta": 1,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 11.5775,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
    },
    {
      "item_id": "it5",
      "orden": 5,
      "categoria": "Lacteos",
      "nombre": "Queso P Freir",
      "presentacion": "Paquete",
      "unidades_derivadas": "25 Bolsitas",
      "unidad_conteo": "Paquete de 25 bolsitas",
      "unidad_stock": "lb",
      "factor": 7.5,
      "fraccionado": true,
      "unidad_suelta": "bolsitas",
      "factor_suelta": 0.3,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 3.903,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": null
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
      "unidad_suelta": "de bolsa",
      "factor_suelta": 5,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 3.45,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
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
      "fraccionado": true,
      "unidad_suelta": "de bolsa",
      "factor_suelta": 1,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 3.4484,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 2.4476,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": 5
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
      "fraccionado": true,
      "unidad_suelta": "de bolsa",
      "factor_suelta": 5,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 1.2667,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
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
      "fraccionado": true,
      "unidad_suelta": "de bolsa",
      "factor_suelta": 5.5,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 1.0035,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
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
      "fraccionado": true,
      "unidad_suelta": "de bolsa",
      "factor_suelta": 7,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 0.2002,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "peso",
      "tolerancia_pct": null
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 2.5,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": null
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 0.3768,
      "cid_sug_enteros": 5,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": null
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 1.42,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": null
    },
    {
      "item_id": "it15",
      "orden": 15,
      "categoria": "Harinas Panes",
      "nombre": "Pan Super Friek",
      "presentacion": "Bolsa",
      "unidades_derivadas": "21 Uni",
      "unidad_conteo": "Bolsa de 21 unidades",
      "unidad_stock": "bolsa",
      "factor": 1,
      "fraccionado": true,
      "unidad_suelta": "panes",
      "factor_suelta": 0.047619047619047616,
      "nota_config": null,
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
      "cid_enteros": null,
      "cid_sueltas": null,
      "pedido_enteros": null,
      "descarga_am": null,
      "descarga_pm": null,
      "tps_enteros": null,
      "linea_sueltas": null,
      "notas": null,
      "guardado": false,
      "costo_unit": 6.93,
      "cid_sug_enteros": null,
      "cid_sug_sueltas": null,
      "clase": "porcionado",
      "tolerancia_pct": null
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
          if (fn === 'fn_criticos_semana') return { data: globalThis.__semana, error: null }
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
// Semana sintética: 6 días contados, la carne con un faltante de 120 bolitas.
globalThis.__semana = {
  store_code: 'S004', sucursal: 'Paseo Venecia',
  desde: '2026-09-14', hasta: '2026-09-20',
  dias: ['2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20']
          .map(f => ({ fecha: f, estado: 'abierto', filas: 15 })),
  items: HOJA.items.map(i => ({
    item_id: i.item_id, orden: i.orden, categoria: i.categoria, nombre: i.nombre,
    unidad_conteo: i.unidad_conteo, unidad_stock: i.unidad_stock,
    factor: i.factor, fraccionado: i.fraccionado,
    unidad_suelta: i.unidad_suelta, factor_suelta: i.factor_suelta,
    costo_unit: i.costo_unit,
    venta: i.venta_dia * 6, pedido: i.pedido_sistema * 6, descargas: 12,
    dias_completos: i.orden === 1 ? 6 : 0,
    diferencia: i.orden === 1 ? -120 : null,
  })),
}
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
// Desde el 23-sep el CID NO se digita cuando hay cierre de ayer: se muestra
// y se arrastra. Las filas con arrastre quedan con 5 casillas (Se pidió,
// Desc AM, Desc PM, TPS, En línea) y las que no lo tienen abren el CID para
// poder arrancar la cadena, así que llevan 7.
const conArrastre = HOJA.items.filter(i => i.cid_sug_enteros != null).length
const esperadas = conArrastre * 5 + (HOJA.items.length - conArrastre) * 7
chk(document.querySelectorAll('input[type=number]').length === esperadas,
    `son ${esperadas} (${conArrastre} filas arrastradas × 5 + ${HOJA.items.length - conArrastre} × 7)`)
const filaArr = [...document.querySelectorAll('tbody tr')].find(t => t.textContent.includes('Carne P Burguer'))
chk(filaArr.querySelectorAll('input[type=number]').length === 5,
    'la carne trae arrastre: su CID es de sólo lectura')
chk(filaArr.textContent.includes('↩'), 'y lo marca con ↩')
const filaSin = [...document.querySelectorAll('tbody tr')].find(t => t.textContent.includes('Chili'))
chk(filaSin.querySelectorAll('input[type=number]').length === 7,
    'el chili no tiene cierre de ayer: su CID se abre para arrancar')
chk(filaSin.textContent.includes('✎'), 'y lo marca con ✎')
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


/* ── Interacción: el arrastre cierra la ecuación sin digitar la apertura ── */
console.log('\n═ Interacción: se teclea el cierre y aparece la diferencia ═\n')
function teclear(el, valor) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
  setter.call(el, String(valor))
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}
const filaCarne = [...document.querySelectorAll('tr')].find(t => t.textContent.includes('Carne P Burguer'))
const ins = filaCarne.querySelectorAll('input[type=number]')
chk(ins.length === 5, `la carne tiene 5 casillas (el CID va arrastrado) — dio ${ins.length}`)
// Orden: Se pidió, Desc AM, Desc PM, TPS Final, En línea.
// CID arrastrado = 3 paquetes + 5 bolitas = 65. Pedido del sistema 400,
// venta 336 → teórico 129 un = 6.45 paquetes.
// Cerrando con 2 paquetes + 7 bolitas = 47 un = 2.35 → dif −82 un = −4.1 paq.
await act(async () => { teclear(ins[3], '2') })   // TPS Final
await act(async () => { teclear(ins[4], '7') })   // En línea

const celdas = [...[...document.querySelectorAll('tr')]
  .find(t => t.textContent.includes('Carne P Burguer')).querySelectorAll('td')].map(t => t.textContent.trim())
chk(celdas.includes('6.45'), `teórico 6.45 paquetes, calculado sobre el cierre de ayer (${celdas.slice(-5).join(' | ')})`)
chk(celdas.includes('2.35'), 'el real sale 2.35 paquetes')
chk(celdas.some(t => t === '-4.1'), 'la diferencia sale −4.1 paquetes')

// Es PORCIONADO: −82 bolitas tiene que ser descuadre, no "cuadra".
const resumenTrasCarne = document.getElementById('r').textContent
chk(/✕ 1 descuadres/.test(resumenTrasCarne), 'un porcionado con 82 piezas de diferencia es descuadre')
chk(!/a revisar/.test(resumenTrasCarne), 'ya no existe el estado intermedio "a revisar"')

// Las descargas bodega→cocina siguen sin tocar el cálculo.
await act(async () => { teclear(ins[1], '8') })
await act(async () => { teclear(ins[2], '4') })
const tras = [...[...document.querySelectorAll('tr')]
  .find(t => t.textContent.includes('Carne P Burguer')).querySelectorAll('td')].map(t => t.textContent.trim())
chk(tras.includes('6.45') && tras.some(t => t === '-4.1'),
    'digitar las descargas NO cambia el teórico ni la diferencia')

/* ── Las dos clases se distinguen en pantalla ── */
console.log('\n═ Porcionado vs. peso ═\n')
chk(filaCarne.textContent.includes('='), 'la carne se marca como porcionada (=)')
const filaChili = [...document.querySelectorAll('tr')].find(t => t.textContent.includes('Chili'))
chk(filaChili.textContent.includes('⚖'), 'el chili se marca como de peso (⚖)')
const filaQA = [...document.querySelectorAll('tr')].find(t => t.textContent.includes('Queso Amaricano'))
chk(filaQA.textContent.includes('≈'), 'el Queso Amarillo se marca con margen provisional (≈)')

// La fracción de bolsa avisa si pasa de 1.
const insChili = filaChili.querySelectorAll('input[type=number]')
await act(async () => { teclear(insChili[5], '3') })   // TPS Final
await act(async () => { teclear(insChili[6], '2') })   // En línea = 2 bolsas (inválido)
const chiliTxt = [...document.querySelectorAll('tr')].find(t => t.textContent.includes('Chili')).textContent
chk(/&gt; 1 bolsa|> 1 bolsa/.test(chiliTxt), 'avisa que la fracción no puede pasar de 1 bolsa')

/* ── KPIs ─────────────────────────────────────────────────────────────── */
console.log('\n═ KPIs en dinero ═\n')
const kpiTxt = document.getElementById('r').textContent
for (const k of ['DESCUADRE', 'FALTANTE', 'SOBRANTE', 'VENTA EN CRÍTICOS', 'CONTADAS'])
  chk(kpiTxt.toUpperCase().includes(k), `está el KPI "${k}"`)
// Con la carne en -4.1 paquetes = -82 bolitas x $0.7168
chk(/PEOR DESCUADRE/i.test(kpiTxt), 'y está el peor descuadre')
chk(/-\$|\$/.test(kpiTxt), 'los KPIs salen valorizados en dinero')

/* ── Modo semana ──────────────────────────────────────────────────────── */
console.log('\n═ Modo semana ═\n')
const botonSemana = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Semana'))
chk(!!botonSemana, 'está el botón de Semana')
// Venimos de teclear, así que el guard de "cambios sin guardar" se dispara y
// jsdom no implementa confirm(). Que salte es lo correcto — lo que la prueba
// mide es lo de después, así que se contesta que sí.
let preguntoAntesDeIrse = false
dom.window.confirm = (m) => { preguntoAntesDeIrse = /sin guardar/i.test(m); return true }
await act(async () => { botonSemana.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
await act(async () => { await new Promise(r => setTimeout(r, 30)) })

chk(preguntoAntesDeIrse, 'avisa de los cambios sin guardar antes de cambiar de modo')
chk(globalThis.__llamadas.some(([f]) => f === 'fn_criticos_semana'), 'al cambiar de modo llama a fn_criticos_semana')
const semTxt = document.getElementById('r').textContent
const sel = document.querySelector('select')
chk(!!sel, 'hay un desplegable de semanas')
chk(sel && sel.options.length === 10, `con 10 semanas preseleccionadas (dio ${sel?.options.length})`)
chk(sel.options[0].textContent.includes('Esta semana'), 'la primera dice "Esta semana"')
chk(document.querySelectorAll('input[type=number]').length === 0,
    'la semana es SÓLO LECTURA: no hay ninguna casilla de captura')
chk(/Días/i.test(semTxt) && /Dif\. \$/i.test(semTxt), 'la tabla semanal trae Días y Dif. $')
chk(/-\$86\.02/.test(semTxt), 'la diferencia de la semana sale en dinero (−120 × $0.7168)')
chk(/6\/7 días con hoja/.test(semTxt), 'el KPI dice cuántos días de la semana tienen hoja')
chk(!semTxt.includes('Guardar'), 'y no se ofrece guardar nada')
chk(warnings.length === 0, 'sin warnings de React en todo el recorrido')

console.log('\n' + '─'.repeat(56))
console.log(fallos === 0 ? `✓ ${n} comprobaciones OK` : `✗ ${fallos} de ${n} fallaron`)
fs.rmSync(BUNDLE, { force: true })
process.exit(fallos ? 1 : 0)
