// Presentación de un producto: cajas/fardos cerrados + sueltas ↔ unidades de stock.
// Misma lógica que el Conteo Nocturno (ConteoNocturno.jsx) y la entrega de
// La Constancia: la sucursal ve y digita cajas y sueltas; el inventario vive en
// unidades (botellas, latas, bolitas). Recibe el producto con sus campos de
// catálogo: conteo_unidad, conteo_factor, conteo_fraccionado,
// conteo_unidad_suelta, conteo_factor_suelta y unidad_medida.
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export const facCaja = (p) => { const f = num(p?.conteo_factor); return f > 0 ? f : 1; };
export const facSuelta = (p) => { const f = num(p?.conteo_factor_suelta); return f > 0 ? f : 1; };
export const tieneSueltas = (p) => !!p?.conteo_fraccionado;
// ¿Se maneja por caja/fardo? (si no, se digita la unidad tal cual)
export const porEmpaque = (p) => facCaja(p) !== 1 || tieneSueltas(p);
export const labelCaja = (p) => p?.conteo_unidad || 'Caja';
export const labelSuelta = (p) => p?.conteo_unidad_suelta || 'sueltas';
// Nombre de la unidad en la que vive el stock. `unidad_medida` dice "Caja" en
// varias bebidas aunque el stock sean botellas: se prefiere la casilla de sueltas.
export const unidadStock = (p) =>
  (tieneSueltas(p) && facSuelta(p) === 1 && p?.conteo_unidad_suelta)
    ? p.conteo_unidad_suelta
    : (porEmpaque(p) ? 'unidades' : (p?.unidad_medida || 'unidad'));

const r4 = (v) => Math.round(num(v) * 10000) / 10000;
export const fmtCant = (v) => { const x = r4(v); return Number.isInteger(x) ? String(x) : String(x); };

// cajas + sueltas → unidades de stock
export const aUnidades = (p, cajas, sueltas) =>
  r4(num(cajas) * facCaja(p) + (tieneSueltas(p) ? num(sueltas) * facSuelta(p) : 0));

// unidades de stock → cajas + sueltas (las sueltas son piezas enteras)
export const aCajas = (p, qty) => {
  const q = num(qty), f = facCaja(p);
  if (!tieneSueltas(p)) return { cajas: r4(q / f), sueltas: 0 };
  const c = Math.floor(q / f + 1e-9);
  return { cajas: Math.max(0, c), sueltas: Math.max(0, Math.round((q - c * f) / facSuelta(p))) };
};

// "1 botellas" → "1 botella", "15 unidad" → "15 unidades"
const concuerda = (cant, palabra) => {
  const w = String(palabra || '');
  if (Math.abs(cant) === 1) return w.replace(/([aeiou])s$/i, '$1');
  return /^unidad$/i.test(w) ? 'unidades' : w;
};
export const textoCajas = (p, qty) => {
  const q = r4(qty);
  if (!porEmpaque(p) || q < 0) return `${fmtCant(q)} ${concuerda(q, unidadStock(p))}`;
  const { cajas, sueltas } = aCajas(p, q);
  const partes = [];
  if (cajas > 0) partes.push(`${fmtCant(cajas)} caja${cajas === 1 ? '' : 's'}`);
  if (sueltas > 0) partes.push(`${sueltas} ${concuerda(sueltas, labelSuelta(p))}`);
  return `${partes.join(' + ') || '0'} = ${fmtCant(q)} ${concuerda(q, unidadStock(p))}`;
};
