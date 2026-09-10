#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// Verificador del despliegue del cobro con tarjeta — NO cobra nada
// ══════════════════════════════════════════════════════════════════════
//
// Corré esto INMEDIATAMENTE después de mergear, antes de probar con una
// tarjeta real. Es caja negra: no necesita secretos, ni tarjeta, ni plata.
//
// El caso central es el 3: se pide cobrar un pedido que **no existe**. Si la
// respuesta es `no_existe`, quedó probado que el Edge Function
//   · fue ruteado por el rewrite de vercel.json,
//   · leyó SUPABASE_SERVICE_ROLE_KEY,
//   · llegó a Postgres y pudo ejecutar `pago_online_iniciar`.
// Si en cambio contesta 502, falta la service_role key — el modo de falla en
// que n1co cobra la tarjeta y el pedido queda impago.
//
// Uso:
//   node scripts/verificar-despliegue-n1co.mjs https://pedidos.freakiedogs.com
//   node scripts/verificar-despliegue-n1co.mjs https://... 70123456
//                                                        ^ tu tel del piloto
// ══════════════════════════════════════════════════════════════════════

const BASE = (process.argv[2] || 'https://pedidos.freakiedogs.com').replace(/\/+$/, '');
const TEL_PILOTO = (process.argv[3] || '').replace(/\D/g, '');

const ORIGEN = 'https://pedidos.freakiedogs.com';
// Número de prueba público de n1co. Acá NUNCA llega a n1co: el pedido no existe,
// así que el cobro se rechaza antes. Solo sirve para pasar la validación local
// de Luhn y llegar a probar la capa de base de datos.
const TARJETA_FORMATO_OK = '4000056655665556';

const v = { ok: 0, no: 0, avisos: 0 };
const linea = [];
const C = { ok: '\x1b[32m', no: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

function chequeo(nombre, condicion, detalle) {
  if (condicion) { v.ok++; linea.push(`  ${C.ok}✓${C.x} ${nombre}`); }
  else { v.no++; linea.push(`  ${C.no}✗ ${nombre}${C.x}\n      ${C.dim}${detalle || ''}${C.x}`); }
}
function aviso(nombre, detalle) {
  v.avisos++; linea.push(`  ${C.warn}!${C.x} ${nombre}\n      ${C.dim}${detalle || ''}${C.x}`);
}

async function llamar(op, body, { origin = ORIGEN } = {}) {
  try {
    const res = await fetch(`${BASE}/api/n1co/${op}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      signal: AbortSignal.timeout(25_000),
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt.slice(0, 200) }; }
    return { status: res.status, data, cors: res.headers.get('access-control-allow-origin') };
  } catch (e) {
    return { status: 0, data: { _err: String(e?.message || e) }, cors: null };
  }
}

const uuid = () => crypto.randomUUID();

console.log(`${C.b}\n═══ Verificación del despliegue ═══${C.x}`);
console.log(`  ${BASE}`);
console.log(`  ${C.dim}no cobra nada · no necesita secretos${C.x}\n`);

// ── 0. ¿Estamos viendo la app, o una pantalla de login de Vercel? ──
// Los deployments de preview tienen Vercel Authentication activada y
// responden 401 a todo. Sin este corte, los chequeos de abajo leen la
// pantalla de protección como si fuera la respuesta de la app: el 7 llegó a
// anunciar "el cobro está ABIERTO A TODOS" cuando en realidad no había visto
// nada. Una herramienta de seguridad que adivina es peor que ninguna.
{
  const r = await llamar('tarjetas', { dispositivo: uuid() });
  if (r.status === 401 || r.data?.protection) {
    console.log(`${C.no}✗ El deployment está protegido (Vercel Authentication): 401 en todo.${C.x}`);
    console.log(`${C.dim}  No se puede verificar desde acá. Dos salidas:`);
    console.log(`   · correrlo contra PRODUCCIÓN después de mergear, que es lo normal;`);
    console.log(`   · o desactivar Deployment Protection para este preview`);
    console.log(`     (Vercel → proyecto → Settings → Deployment Protection).${C.x}\n`);
    process.exit(2);
  }
}

// ── 1. El endpoint existe (el rewrite de vercel.json quedó) ──
{
  const r = await llamar('tarjetas', { dispositivo: uuid() });
  if (r.status === 404) {
    console.log(`${C.no}✗ /api/n1co/tarjetas da 404.${C.x}`);
    console.log(`${C.dim}  El código no está desplegado o falta el rewrite en vercel.json.`);
    console.log(`  ¿Se mergeó el PR y terminó el deploy?${C.x}\n`);
    process.exit(1);
  }
  chequeo('1. el endpoint responde (rewrite de vercel.json aplicado)',
    r.status === 200, `HTTP ${r.status} · ${JSON.stringify(r.data).slice(0, 200)}`);
}

// ── 2. Credenciales de n1co cargadas ──
{
  const r = await llamar('tarjetas', { dispositivo: uuid() });
  if (r.data?.motivo === 'SIN_CREDENCIALES') {
    aviso('2. n1co responde "no disponible" — faltan N1CO_CLIENT_ID / N1CO_CLIENT_SECRET',
      'Cargalas en Vercel (solo Production) y redeployá.');
  } else {
    chequeo('2. credenciales de n1co presentes', r.data?.habilitado === true,
      JSON.stringify(r.data).slice(0, 200));
  }
}

// ── 3. EL CASO CENTRAL: se llega a Postgres con la service_role ──
{
  const r = await llamar('pagar', {
    tracking_token: uuid(),          // formato válido, pedido inexistente
    email: 'verificacion@freakiedogs.com',
    card: {
      number: TARJETA_FORMATO_OK, cardHolder: 'VERIFICACION',
      expirationMonth: '12', expirationYear: '2030', cvv: '123',
    },
  });

  if (r.status === 502) {
    chequeo('3. llega a Postgres con la service_role key', false,
      '502 upstream → falta SUPABASE_SERVICE_ROLE_KEY en ESTE proyecto de Vercel.\n'
      + '      Es el modo de falla grave: n1co cobraría la tarjeta y el pedido quedaría impago.');
  } else {
    chequeo('3. llega a Postgres con la service_role key (pedido inexistente → no_existe)',
      r.status === 409 && r.data?.error === 'no_existe',
      `HTTP ${r.status} · ${JSON.stringify(r.data).slice(0, 220)}`);
  }
}

// ── 4-6. Validaciones que ahorran intentos ──
{
  const r = await llamar('pagar', { tracking_token: 'no-es-un-uuid', email: 'a@b.com', card: {} });
  chequeo('4. tracking_token malformado → rechazado sin tocar la base',
    r.status === 400 && r.data?.error === 'pedido_invalido', JSON.stringify(r.data).slice(0, 150));
}
{
  const r = await llamar('pagar', { tracking_token: uuid(), email: 'no-es-correo', card: {} });
  chequeo('5. correo inválido → rechazado',
    r.status === 400 && r.data?.error === 'email_invalido', JSON.stringify(r.data).slice(0, 150));
}
{
  const r = await llamar('pagar', {
    tracking_token: uuid(), email: 'a@b.com',
    card: { number: '4111111111111112', cardHolder: 'X', expirationMonth: '12', expirationYear: '2030', cvv: '123' },
  });
  chequeo('6. tarjeta que no pasa Luhn → rechazada antes de gastar un intento',
    r.status === 400 && r.data?.error === 'numero_invalido', JSON.stringify(r.data).slice(0, 150));
}

// ── 7. El piloto: un teléfono ajeno no puede pagar ──
{
  const ajeno = '79999999';
  const r = await llamar('tarjetas', { dispositivo: uuid(), telefono: ajeno });

  // Solo se concluye algo si la app contestó de verdad. Antes se infería el
  // "abierto a todos" de la ausencia de un `habilitado:false`, y una respuesta
  // rara (401, 502, HTML) se leía como la peor noticia posible.
  //
  // El caso se decide por `motivo`, no por el texto del mensaje: los mensajes
  // al cliente se parecen entre sí (todos terminan en "elegí efectivo") y
  // matchearlos hacía que un piloto FUNCIONANDO se reportara como
  // "faltan credenciales".
  if (r.status !== 200 || typeof r.data?.habilitado !== 'boolean') {
    aviso(`7. no se pudo evaluar el piloto — la app no contestó como se esperaba`,
      `HTTP ${r.status} · ${JSON.stringify(r.data).slice(0, 160)}`);
  } else if (r.data.motivo === 'SIN_CREDENCIALES') {
    aviso('7. no se pudo evaluar el piloto (faltan credenciales, ver aviso 2)',
      'Con credenciales cargadas, volvé a correrlo.');
  } else if (r.data.motivo === 'FUERA_DE_PILOTO') {
    chequeo(`7. piloto activo: el teléfono ${ajeno} NO puede pagar con tarjeta`, true);
  } else if (r.data.habilitado === false) {
    aviso(`7. el teléfono ${ajeno} quedó bloqueado, pero por otro motivo`,
      `motivo=${r.data.motivo} · ${r.data.mensaje}`);
  } else {
    chequeo(`7. piloto activo: el teléfono ${ajeno} NO puede pagar con tarjeta`, false,
      'habilitado=true → N1CO_TELEFONOS_PRUEBA está vacía: el cobro con tarjeta\n'
      + '      está ABIERTO A TODOS LOS CLIENTES. Si no era la intención, cargala y redeployá.');
  }
}

// ── 8. El teléfono del piloto sí puede ──
if (TEL_PILOTO) {
  const r = await llamar('tarjetas', { dispositivo: uuid(), telefono: TEL_PILOTO });
  chequeo(`8. tu teléfono del piloto (····${TEL_PILOTO.slice(-4)}) SÍ puede pagar`,
    r.data?.habilitado === true,
    `${JSON.stringify(r.data).slice(0, 200)}\n      Si sale false, revisá que N1CO_TELEFONOS_PRUEBA tenga los 8 dígitos.`);
} else {
  aviso('8. no se probó el teléfono del piloto',
    `pasalo como 2º argumento:  node scripts/verificar-despliegue-n1co.mjs ${BASE} 70123456`);
}

// ── 9. CORS: nuestro origen sí, uno ajeno no ──
{
  const propio = await llamar('tarjetas', { dispositivo: uuid() }, { origin: ORIGEN });
  chequeo('9a. CORS permite pedidos.freakiedogs.com',
    propio.cors === ORIGEN, `Access-Control-Allow-Origin: ${propio.cors}`);

  const ajeno = await llamar('tarjetas', { dispositivo: uuid() }, { origin: 'https://sitio-ajeno.vercel.app' });
  chequeo('9b. CORS no habilita un vercel.app ajeno',
    ajeno.cors === null, `Access-Control-Allow-Origin: ${ajeno.cors}`);
}

// ── 10. Operación fuera de la whitelist ──
{
  const r = await llamar('borrar-todo', {});
  chequeo('10. una op inventada se rechaza',
    r.status === 400 && r.data?.error === 'op_not_allowed', `HTTP ${r.status}`);
}

console.log(linea.join('\n'));
console.log(`\n  ${v.ok} bien · ${v.no} mal · ${v.avisos} aviso(s)\n`);

if (v.no > 0) {
  console.log(`${C.no}Hay fallas: no pruebes con una tarjeta real todavía.${C.x}\n`);
  process.exit(1);
}
if (v.avisos > 0) {
  console.log(`${C.warn}Sin fallas, pero revisá los avisos.${C.x}\n`);
  process.exit(0);
}
console.log(`${C.ok}Cableado completo. Ya podés probar con tu tarjeta.${C.x}\n`);
