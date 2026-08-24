// ── UI compartida del Kardex ─────────────────────────────────────────────
// Paleta única y piezas visuales que usan KardexView y DiferenciasTab.
// La referencia de estilo es el tab Fugas (DiferenciasTab): tarjetas con
// borde de color a la izquierda, pills y tablas limpias. Antes cada tab
// traía sus propios hex sueltos; ahora todos salen de acá.

export const K = {
  // superficies
  card:   '#14141b',   // tarjeta principal
  card2:  '#1a1a22',   // superficie secundaria (inputs, pills apagadas)
  panel:  '#101016',   // panel expandible / fondo hundido
  border: '#262630',
  // texto
  text:   '#e8e6ee',
  dim:    '#8b8794',   // texto secundario
  faint:  '#6b6878',   // texto terciario (labels de tarjetas)
  // acentos (mismos que ya usaba Fugas)
  red:    '#e63946',   // = --primary del tema global
  green:  '#2dd4a8',
  orange: '#f4a261',
  blue:   '#4a9eff',
  purple: '#b085f5',
};

// Tinte translúcido para fondos de pills: hex de 6 dígitos + alpha.
export const tint = (color, a = '22') => color + a;

// Pill de filtro (mismo estilo que los filtros de Fugas)
export const pill = (activo, color) => ({
  background: activo ? color : K.card2,
  color: activo ? '#fff' : K.dim,
  border: '1px solid ' + (activo ? color : '#333'),
  borderRadius: 8, padding: '6px 11px', fontSize: 12.5,
  fontWeight: activo ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
});

// Tablas limpias
export const tituloSec = { fontSize: 13, fontWeight: 800, color: '#ddd', margin: '0 0 10px' };
export const th = { padding: '6px 8px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.3px' };
export const td = { padding: '7px 8px', color: '#aaa' };

// Tarjeta de total/KPI con borde de color a la izquierda
export function Tarjeta({ titulo, valor, sub, color }) {
  return (
    <div style={{ background: K.card, border: `1px solid ${K.border}`,
                  borderLeft: '3px solid ' + color, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontSize: 10.5, color: K.faint, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.4px' }}>{titulo}</div>
      <div style={{ fontSize: 21, fontWeight: 900, color, marginTop: 3 }}>{valor}</div>
      {sub != null && <div style={{ fontSize: 11.5, color: K.faint, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
