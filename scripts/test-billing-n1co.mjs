#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// Prueba del billingInfo para tarjetas de EE.UU./Canadá (n1co /Charges)
// ══════════════════════════════════════════════════════════════════════
//
// Del 11 al 20-sep-2026, 5 tarjetas de EE.UU. intentaron pagar y 0 pasaron:
// mandábamos `countryCode:'USA'` (n1co espera ISO-2, "US") con `stateCode:''`
// (obligatorio), y n1co respondía 400 con un ProblemDetails de .NET cuyo
// `title`/`errors` el log descartaba — quedaba `{"status":400}` y nada más.
//
// Acá se fija: (1) qué se le manda a n1co, (2) que un billing incompleto se
// vuelve a pedir en vez de gastar el intento, (3) que el 400 de n1co por
// billing se reconoce como "falta billing" y no como "tu banco rechazó", y
// (4) que el mensaje al cliente nunca es el título en inglés de .NET.
//
// Uso: node scripts/test-billing-n1co.mjs
// ══════════════════════════════════════════════════════════════════════

const { normalizarBilling, detalleError, faltaBilling, mensajeRechazo } = await import('../api/n1co.js');

const casos = [];
let ok = 0, fallas = 0;
function afirmar(nombre, condicion, detalle) {
  if (condicion) { ok++; casos.push(`  \x1b[32m✓\x1b[0m ${nombre}`); }
  else { fallas++; casos.push(`  \x1b[31m✗ ${nombre}\x1b[0m\n      ${detalle || ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── (1) Lo que se le manda a n1co ──
afirmar('USA + estado + zip → countryCode ISO-2 "US" (lo que pide n1co)',
  igual(normalizarBilling({ countryCode: 'USA', stateCode: 'ca', zipCode: ' 94105 ' }),
        { countryCode: 'US', stateCode: 'CA', zipCode: '94105' }));

afirmar('"US" ya en ISO-2 se respeta',
  normalizarBilling({ countryCode: 'US', stateCode: 'NY', zipCode: '10002' })?.countryCode === 'US');

afirmar('CAN → "CA" y el postal canadiense (alfanumérico) se conserva en mayúsculas',
  igual(normalizarBilling({ countryCode: 'CAN', stateCode: 'on', zipCode: 'm5v 3l9' }),
        { countryCode: 'CA', stateCode: 'ON', zipCode: 'M5V 3L9' }));

afirmar('sin país → asume US (el front viejo mandaba "USA" a secas)',
  normalizarBilling({ stateCode: 'TX', zipCode: '73301' })?.countryCode === 'US');

// ── (2) Incompleto = se vuelve a pedir, no se manda ──
afirmar('solo zip, sin estado (lo que mandaba el front hasta hoy) → null',
  normalizarBilling({ countryCode: 'USA', zipCode: '94105' }) === null);

afirmar('estado vacío explícito → null',
  normalizarBilling({ countryCode: 'USA', stateCode: '', zipCode: '94105' }) === null);

afirmar('estado de una letra o tres → null (n1co quiere el código de 2)',
  normalizarBilling({ stateCode: 'C', zipCode: '94105' }) === null &&
  normalizarBilling({ stateCode: 'CAL', zipCode: '94105' }) === null);

afirmar('sin zip → null', normalizarBilling({ stateCode: 'CA', zipCode: '' }) === null);
afirmar('body sin billing → null', normalizarBilling(undefined) === null);

// ── (3) El 400 de n1co por billing se reconoce ──
// Forma real de un ProblemDetails de ASP.NET, que es lo que n1co devuelve
// cuando el request no valida (distinto del rechazo del banco, que trae `error`).
const problem = {
  type: 'https://tools.ietf.org/html/rfc7231#section-6.5.1',
  title: 'One or more validation errors occurred.',
  status: 400, traceId: '00-abc-01',
  errors: { 'BillingInfo.StateCode': ['The StateCode field is required.'] },
};
afirmar('ProblemDetails con errors.BillingInfo.* → faltaBilling', faltaBilling(problem) === true);
afirmar('ProblemDetails con errors.billingInfo (minúscula) → faltaBilling',
  faltaBilling({ status: 400, errors: { billingInfo: ['required'] } }) === true);

const det = detalleError(problem);
afirmar('detalleError lee el title de .NET y lista los campos',
  det.code === '400' && det.titulo === problem.title && igual(det.campos, ['BillingInfo.StateCode']),
  JSON.stringify(det));

const rechazoBanco = {
  status: 'FAILED', message: 'El pago no se pudo procesar: Insuficiencia de fondos. Id: x',
  error: { code: '51', title: 'Insuficiencia de fondos', detail: 'No cuentas con el monto requerido para este pago.' },
};
afirmar('rechazo del banco (error.code 51) NO es falta de billing', faltaBilling(rechazoBanco) === false);
afirmar('un 400 "Error de validación" del banco (sin errors) NO es falta de billing',
  faltaBilling({ status: 'FAILED', error: { code: '400', message: 'Error de validación' } }) === false);
afirmar('cuerpo vacío / null → no revienta y no es billing',
  faltaBilling(null) === false && faltaBilling({}) === false);

// ── (4) Lo que ve el cliente ──
afirmar('el rechazo por código 51 sigue diciendo "sin fondos"',
  /fondos/.test(mensajeRechazo(rechazoBanco)));
const msg = mensajeRechazo(problem);
afirmar('el ProblemDetails NO le muestra al cliente el título en inglés ni el campo interno',
  !/validation errors|BillingInfo|StateCode/.test(msg) && /tarjeta/.test(msg), msg);

console.log('\n\x1b[1m═══ billingInfo EE.UU./Canadá ═══\x1b[0m');
console.log(casos.join('\n'));
console.log(`\n  ${ok}/${ok + fallas} pasaron\n`);
process.exit(fallas ? 1 : 0);
