// Prueba offline (sin red) de la validación de ruta de api/supaproxy.js.
// 11-nov-2026: el gate de finanzas/RRHH se saltaba con `..` en `_p`.
//
// No se importa el módulo (las funciones no se exportan para no tocar cómo
// Vercel trata el archivo Edge): se lee el bloque marcado INICIO/FIN del fuente
// y se evalúa tal cual, así la prueba corre el código real y no una copia.
//
// Uso: node scripts/test-supaproxy-ruta.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fuente = readFileSync(join(raiz, 'api', 'supaproxy.js'), 'utf8');
const bloque = /\/\/ ── INICIO validación de ruta[\s\S]*?\/\/ ── FIN validación de ruta ──/.exec(fuente);
if (!bloque) {
  console.error('No se encontró el bloque de validación en api/supaproxy.js');
  process.exit(1);
}
const SUPA_URL = 'https://btboxlwfqcbrdfrlnwln.supabase.co';
const { resolverRuta } = new Function(
  'SUPA_URL',
  `${bloque[0]}\nreturn { resolverRuta };`
)(SUPA_URL);

// `_p` llega al handler YA decodificado una vez (URLSearchParams.get), así que
// los casos se escriben como los vería el handler. `viaQuery` simula ese paso.
const viaQuery = (crudo) => new URL(`https://x.test/api/supaproxy?_p=${crudo}`).searchParams.get('_p');

const GATEADOS = new Set(['planilla_detalle', 'planillas', 'v_dtes_emitidos', 'v_empleados_expediente']);

// [descripción, ruta, qs, esperado] — esperado: 'rechazo' | { objeto, pathname }
const casos = [
  // ── Ataques: deben rechazarse ──
  ['.. simple (el bug original)', 'rest/v1/v_dtes_emitidos/../planilla_detalle', '?select=*', 'rechazo'],
  ['.. hacia otro servicio', 'rest/v1/v_dtes_emitidos/../../../auth/v1/admin/users', '', 'rechazo'],
  ['segmento . suelto', 'rest/v1/./planilla_detalle', '', 'rechazo'],
  ['.. al final', 'rest/v1/v_dtes_emitidos/..', '', 'rechazo'],
  ['%2e%2e (doble codificado en la query)', viaQuery('rest/v1/v_dtes_emitidos/%252e%252e/planilla_detalle'), '', 'rechazo'],
  ['%2E%2E en mayúsculas', 'rest/v1/v_dtes_emitidos/%2E%2E/planilla_detalle', '', 'rechazo'],
  ['.%2e mixto', 'rest/v1/v_dtes_emitidos/.%2e/planilla_detalle', '', 'rechazo'],
  ['%252e (triple codificado en la query)', viaQuery('rest/v1/v_dtes_emitidos/%25252e%25252e/planilla_detalle'), '', 'rechazo'],
  ['%2e codificado una vez en la query', viaQuery('rest/v1/v_dtes_emitidos/%2e%2e/planilla_detalle'), '', 'rechazo'],
  ['barra invertida', 'rest/v1/v_dtes_emitidos\\..\\planilla_detalle', '', 'rechazo'],
  ['barra doble', 'rest/v1//planilla_detalle', '', 'rechazo'],
  ['tabulador (la URL lo borra)', 'rest/v1/v_dtes_emitidos/.\t./planilla_detalle', '', 'rechazo'],
  ['salto de línea', 'rest/v1/planilla\n_detalle', '', 'rechazo'],
  ['NUL', 'rest/v1/planilla_detalle\u0000', '', 'rechazo'],
  ['.. antes de ?', 'rest/v1/v_dtes_emitidos/..?x=1', '', 'rechazo'],

  // ── Legítimas: deben pasar ──
  ['tabla abierta', 'rest/v1/productos', '?select=*&activo=eq.true', { objeto: 'productos', pathname: '/rest/v1/productos' }],
  ['tabla gateada', 'rest/v1/planilla_detalle', '?select=*', { objeto: 'planilla_detalle', pathname: '/rest/v1/planilla_detalle' }],
  ['vista gateada en mayúsculas', 'rest/v1/V_DTES_EMITIDOS', '', { objeto: 'v_dtes_emitidos', pathname: '/rest/v1/V_DTES_EMITIDOS' }],
  ['rpc', 'rest/v1/rpc/staff_login', '', { objeto: 'staff_login', pathname: '/rest/v1/rpc/staff_login' }],
  ['leading slash', '/rest/v1/productos', '', { objeto: 'productos', pathname: '/rest/v1/productos' }],
  ['raíz de rest', 'rest/v1/', '', { objeto: null, pathname: '/rest/v1/' }],
  ['auth', 'auth/v1/token', '?grant_type=password', { objeto: null, pathname: '/auth/v1/token' }],
  ['functions', 'functions/v1/dte-service/emit-factura', '', { objeto: null, pathname: '/functions/v1/dte-service/emit-factura' }],
  ['storage con punto', 'storage/v1/object/public/qr-uploads/x.jpg', '', { objeto: null, pathname: '/storage/v1/object/public/qr-uploads/x.jpg' }],
  ['storage con varios puntos', 'storage/v1/object/fotos/2026/a.b.jpg', '', { objeto: null, pathname: '/storage/v1/object/fotos/2026/a.b.jpg' }],
  ['storage con puntos seguidos en el nombre', 'storage/v1/object/fotos/a..b.jpg', '', { objeto: null, pathname: '/storage/v1/object/fotos/a..b.jpg' }],
  ['storage con archivo oculto', 'storage/v1/object/fotos/.keep', '', { objeto: null, pathname: '/storage/v1/object/fotos/.keep' }],
  ['storage con espacio (codificado en la query)', viaQuery('storage/v1/object/fotos/mi%20foto.jpg'), '', { objeto: null, pathname: '/storage/v1/object/fotos/mi%20foto.jpg' }],
  ['filtro con puntos en el query string', 'rest/v1/productos', '?nombre=like.*..*&x=%2e%2e', { objeto: 'productos', pathname: '/rest/v1/productos' }],
  ['ruta vacía', '', '', { objeto: null, pathname: '/' }],

  // ── No se rechazan, pero NO deben quedar identificadas como objeto gateado
  //    (sin identificación no hay token privilegiado: va con la llave anon) ──
  ['%2f tras objeto gateado', 'rest/v1/v_dtes_emitidos%2f..%2fplanilla_detalle', '', { objeto: null }],
  ['sufijo tras objeto gateado', 'rest/v1/v_dtes_emitidos/extra', '', { objeto: null }],
];

let fallos = 0;
for (const [desc, ruta, qs, esperado] of casos) {
  const r = resolverRuta(ruta, qs);
  let ok;
  let detalle = '';
  if (esperado === 'rechazo') {
    ok = Boolean(r.error) && !r.target;
    detalle = r.error ? `rechazada: ${r.error}` : `PASÓ → ${r.target}`;
  } else {
    const final = r.target ? new URL(r.target) : null;
    ok = !r.error
      && r.objeto === esperado.objeto
      && (esperado.pathname === undefined || final.pathname === esperado.pathname)
      && final.origin === SUPA_URL
      // Invariante del arreglo: si el gate identifica un objeto, la URL que
      // se va a pedir apunta exactamente a ese objeto.
      && (!GATEADOS.has(r.objeto) || final.pathname.toLowerCase().endsWith(`/${r.objeto}`));
    detalle = r.error ? `RECHAZADA: ${r.error}` : `objeto=${r.objeto} → ${final.pathname}`;
  }
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'} ${desc} — ${detalle}`);
}

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos ? 1 : 0);
