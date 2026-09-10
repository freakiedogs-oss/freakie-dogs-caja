#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════
// Prueba de los frenos de producción del cobro con tarjeta
// ══════════════════════════════════════════════════════════════════════
//
// Como el sandbox de n1co no se pudo usar, el estreno es con dinero real y
// estos dos frenos son lo único que acota el daño de un error:
//
//   · N1CO_TELEFONOS_PRUEBA — piloto: solo esos números pagan con tarjeta
//   · N1CO_MONTO_MAX        — techo por cobro (default $150)
//
// Se prueban de verdad porque deciden si se cobra o no, y eso no se verifica
// leyendo el código. Cada caso recarga el módulo con otras variables de
// entorno, porque los frenos se leen una sola vez al importar.
//
// Uso: node scripts/test-frenos-n1co.mjs
// ══════════════════════════════════════════════════════════════════════

const casos = [];
let ok = 0, fallas = 0;

// El módulo lee process.env al importarse, así que hay que invalidar la caché
// de ESM entre casos. Un query distinto en la URL fuerza una instancia nueva.
let n = 0;
async function conEnv(vars, fn) {
  const previas = {};
  for (const [k, v] of Object.entries(vars)) {
    previas[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const mod = await import(`../api/n1co.js?caso=${++n}`);
  try { return await fn(mod); }
  finally {
    for (const [k, v] of Object.entries(previas)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function afirmar(nombre, condicion, detalle) {
  if (condicion) { ok++; casos.push(`  \x1b[32m✓\x1b[0m ${nombre}`); }
  else { fallas++; casos.push(`  \x1b[31m✗ ${nombre}\x1b[0m\n      ${detalle || ''}`); }
}

const pedido = (tel, monto) => ({ cliente_telefono: tel, monto });

// ── Sin piloto: el pago está abierto a todos ──
await conEnv({ N1CO_TELEFONOS_PRUEBA: undefined, N1CO_MONTO_MAX: undefined }, ({ frenoDeProduccion }) => {
  afirmar('sin N1CO_TELEFONOS_PRUEBA → cualquier teléfono puede pagar',
    frenoDeProduccion(pedido('70123456', 12.5)) === null);
});

// ── Con piloto: solo los números de la lista ──
await conEnv({ N1CO_TELEFONOS_PRUEBA: '7012-3456, 60009999' }, ({ frenoDeProduccion }) => {
  afirmar('teléfono en el piloto → pasa (y tolera guiones en la env)',
    frenoDeProduccion(pedido('70123456', 12.5)) === null);

  afirmar('segundo teléfono de la lista → pasa',
    frenoDeProduccion(pedido('60009999', 5)) === null);

  const fuera = frenoDeProduccion(pedido('79999999', 12.5));
  afirmar('teléfono ajeno → FRENADO con FUERA_DE_PILOTO',
    fuera?.code === 'FUERA_DE_PILOTO', JSON.stringify(fuera));

  afirmar('el mensaje al cliente no filtra que existe un piloto interno',
    !/piloto|prueba.*tel|whitelist/i.test(fuera?.mensaje || '') || /efectivo/.test(fuera?.mensaje || ''),
    fuera?.mensaje);

  afirmar('el detalle para soporte enmascara el teléfono',
    !/79999999/.test(fuera?.detalle || ''), fuera?.detalle);
});

// ── Techo por monto ──
await conEnv({ N1CO_TELEFONOS_PRUEBA: undefined, N1CO_MONTO_MAX: undefined }, ({ frenoDeProduccion }) => {
  afirmar('monto normal ($45) → pasa con el techo por defecto',
    frenoDeProduccion(pedido('70123456', 45)) === null);

  const alto = frenoDeProduccion(pedido('70123456', 150.01));
  afirmar('monto sobre el techo por defecto → FRENADO',
    alto?.code === 'MONTO_SOBRE_TECHO', JSON.stringify(alto));

  afirmar('exactamente el techo ($150) → pasa',
    frenoDeProduccion(pedido('70123456', 150)) === null);
});

await conEnv({ N1CO_TELEFONOS_PRUEBA: undefined, N1CO_MONTO_MAX: '20' }, ({ frenoDeProduccion }) => {
  afirmar('techo bajado a $20 → un pedido de $25 se frena',
    frenoDeProduccion(pedido('70123456', 25))?.code === 'MONTO_SOBRE_TECHO');

  afirmar('techo bajado a $20 → un pedido de $18 pasa',
    frenoDeProduccion(pedido('70123456', 18)) === null);
});

await conEnv({ N1CO_MONTO_MAX: 'no-es-un-numero' }, ({ frenoDeProduccion }) => {
  // Una env mal escrita no puede desactivar el techo: caería a NaN y toda
  // comparación con NaN es false, dejando pasar cualquier monto.
  afirmar('N1CO_MONTO_MAX basura → cae al default, NO se desactiva el techo',
    frenoDeProduccion(pedido('70123456', 9999))?.code === 'MONTO_SOBRE_TECHO');
});

// ── El piloto manda sobre el monto ──
await conEnv({ N1CO_TELEFONOS_PRUEBA: '70123456', N1CO_MONTO_MAX: '10' }, ({ frenoDeProduccion }) => {
  afirmar('un ajeno con monto chico igual se frena por piloto',
    frenoDeProduccion(pedido('79999999', 5))?.code === 'FUERA_DE_PILOTO');

  afirmar('el del piloto con monto sobre el techo se frena por monto',
    frenoDeProduccion(pedido('70123456', 50))?.code === 'MONTO_SOBRE_TECHO');
});

console.log('\n\x1b[1m═══ Frenos de producción ═══\x1b[0m');
console.log(casos.join('\n'));
console.log(`\n  ${ok}/${ok + fallas} pasaron\n`);
process.exit(fallas ? 1 : 0);
