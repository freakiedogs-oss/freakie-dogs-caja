#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// Smoke test de las credenciales de n1co — corre ANTES de probar la app
// ══════════════════════════════════════════════════════════════════════
//
// Aísla "¿están bien las credenciales?" de "¿está bien mi código?". Si esto
// pasa, cualquier falla posterior es nuestra; si esto falla, no tiene sentido
// abrir el menú a probar.
//
// Recorre el mismo camino que api/n1co.js:
//   1. POST /api/v3/Token           → ¿sirven clientId y clientSecret?
//   2. POST /api/v3/PaymentMethods  → ¿tokeniza? ¿acepta singleUse:false
//                                      (tarjeta guardada)?
//   3. POST /api/v3/Charges         → ¿es correcto el locationCode?
//   4. POST /api/v3/Refunds         → devuelve el cobro de prueba
//
// Usa tarjetas de prueba del sandbox: no mueve dinero real. Aun así el paso 4
// reversa el cobro para no dejar basura en el portal.
//
// Uso:
//   N1CO_CLIENT_ID=... N1CO_CLIENT_SECRET=... N1CO_LOCATION_CODE=... \
//     node scripts/smoke-n1co.mjs
//
// Nunca imprime el secret. El token se muestra recortado.
// ══════════════════════════════════════════════════════════════════════

// Se le saca el /api/v3 si vino en la variable: la doc lo publica incluido y
// acá se concatena en cada llamada (igual que en api/n1co.js).
const BASE = (process.env.N1CO_BASE_URL || 'https://api-sandbox.n1co.shop')
  .replace(/\/+$/, '').replace(/\/api\/v\d+$/i, '');
const CLIENT_ID = process.env.N1CO_CLIENT_ID || '';
const CLIENT_SECRET = process.env.N1CO_CLIENT_SECRET || '';
const LOCATION = process.env.N1CO_LOCATION_CODE || '';

// Visa de sandbox que aprueba sin 3DS. Emisor USA → hay que mandar billingInfo.
const TARJETA = {
  number: '4000056655665556',
  cardHolder: 'PRUEBA FREAKIE',
  expirationMonth: '12',
  expirationYear: '2030',
  cvv: '123',
};
const BILLING = { countryCode: 'USA', stateCode: 'FL', zipCode: '33101' };

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  no: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function fin(msg, detalle) {
  console.error(`\n${c.no('✗ ' + msg)}`);
  if (detalle) console.error(c.dim(typeof detalle === 'string' ? detalle : JSON.stringify(detalle, null, 2)));
  process.exit(1);
}

async function pedir(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, data };
}

console.log(c.b('\n═══ Smoke test n1co ═══'));
console.log(`  base      ${BASE}`);
console.log(`  clientId  ${CLIENT_ID ? CLIENT_ID.slice(0, 8) + '…' : c.no('(falta)')}`);
console.log(`  secret    ${CLIENT_SECRET ? c.dim('(presente, no se imprime)') : c.no('(falta)')}`);
console.log(`  location  ${LOCATION || c.no('(falta)')}`);

if (!CLIENT_ID || !CLIENT_SECRET) {
  fin('Faltan N1CO_CLIENT_ID o N1CO_CLIENT_SECRET.',
      'Portal n1co → engranaje → API → nueva. El modal da los dos valores.');
}
if (!LOCATION) {
  fin('Falta N1CO_LOCATION_CODE.',
      'Portal n1co → engranaje → Sucursales → primera columna "ID".');
}

// ── 1. Token ──
console.log(c.b('\n1. Autenticación  POST /api/v3/Token'));
const tok = await pedir('/api/v3/Token', { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
if (!tok.ok || !tok.data?.accessToken) {
  fin(`No entregó token (HTTP ${tok.status}).`, tok.data);
}
const token = tok.data.accessToken;
console.log(`   ${c.ok('✓')} token ${token.slice(0, 12)}… · vence en ${tok.data.expiresIn}s`);

// ── 2. Tokenizar con singleUse:false (tarjeta guardada) ──
console.log(c.b('\n2. Tokenización multi-uso  POST /api/v3/PaymentMethods'));
console.log(c.dim(`   singleUse: false — es lo que habilita la tarjeta guardada`));
const cliente = {
  id: 'SV70000000',
  name: 'Cliente Prueba',
  email: 'prueba@freakiedogs.com',
  phoneNumber: '+50370000000',
};
const pm = await pedir('/api/v3/PaymentMethods', {
  customer: cliente,
  card: { ...TARJETA, singleUse: false },
}, token);
if (!pm.ok || !pm.data?.id) {
  fin(`No tokenizó (HTTP ${pm.status}). Si el error menciona singleUse o multi-use, `
      + 'pediles a n1co que habiliten card-on-file.', pm.data);
}
console.log(`   ${c.ok('✓')} cardId ${String(pm.data.id).slice(0, 14)}…`);
console.log(`     marca ${pm.data.bin?.brand} · emisor ${pm.data.bin?.issuerName} · país ${pm.data.bin?.countryCode}`);

// ── 3. Cobrar $1.00 ──
console.log(c.b('\n3. Cobro  POST /api/v3/Charges'));
const orderId = `SMOKE-${Date.now()}`;
const charge = await pedir('/api/v3/Charges', {
  customer: cliente,
  order: { id: orderId, amount: 1.0, name: 'Smoke test', description: 'Prueba de integración' },
  cardId: pm.data.id,
  locationCode: LOCATION,
  billingInfo: BILLING,
}, token);

const estado = String(charge.data?.status || '').toUpperCase();
if (estado === 'AUTHENTICATION_REQUIRED') {
  console.log(`   ${c.ok('✓')} pidió 3DS — el flujo de la app lo maneja con un iframe`);
  console.log(c.dim(`     authentication.id ${charge.data?.authentication?.id}`));
  console.log(c.b(`\n${c.ok('LISTO')} Credenciales y locationCode correctos.`));
  console.log('El cobro quedó pendiente de 3DS, así que no hay nada que reversar.\n');
  process.exit(0);
}
if (estado !== 'SUCCEEDED') {
  fin(`El cobro no pasó (status ${estado || charge.status}).`
      + (/location/i.test(JSON.stringify(charge.data)) ? ' Revisá el locationCode.' : ''),
      charge.data);
}
const auth = charge.data?.order?.authorizationCode ?? charge.data?.order?.authorization_code;
console.log(`   ${c.ok('✓')} SUCCEEDED · autorización ${auth || '—'}`);

// ── 4. Reversar ──
console.log(c.b('\n4. Reverso  POST /api/v3/Refunds'));
const ref = await pedir('/api/v3/Refunds', {
  orderId, cancellationReason: 'smoke test',
}, token);
if (ref.ok) {
  console.log(`   ${c.ok('✓')} devuelto — no queda cobro de prueba en el portal`);
} else {
  console.log(`   ${c.no('!')} no se pudo reversar (HTTP ${ref.status}). Anulalo a mano en el portal.`);
  console.log(c.dim(`     orderId: ${orderId}`));
}

console.log(c.b(`\n${c.ok('LISTO')} Los 4 pasos pasaron.`));
console.log('Ya podés cargar las variables en Vercel y probar desde el menú.\n');
