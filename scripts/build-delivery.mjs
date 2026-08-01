// Deja el build listo para el dominio público del delivery.
//
// Vite copia TODO lo que hay en public/ tal cual, y ahí viven páginas sueltas
// que no son de cara al cliente: dashboards que consultan ventas con la llave
// pública, el manual del POS, utilidades de impresión. En el dominio del menú
// no tienen nada que hacer, así que se borran del resultado.
import { rm, copyFile } from 'node:fs/promises'

const FUERA = [
  'dashboard-ejecutivo.html',   // ventas diarias, sin login
  'dashboard-operativo.html',   // idem
  'quanto-upload.html',         // carga de datos internos
  'manual-pos.html',            // manual interno del POS
  'print-test.html',            // utilidad de impresión
  'tiktok-auth.html',
  'tiktok-auth-sandbox.html',
]

for (const f of FUERA) {
  await rm(new URL(`../dist/${f}`, import.meta.url), { force: true })
}

// La raíz del dominio es el menú
await copyFile(new URL('../dist/menu.html', import.meta.url),
               new URL('../dist/index.html', import.meta.url))

console.log(`✓ build público listo — ${FUERA.length} páginas internas excluidas`)
