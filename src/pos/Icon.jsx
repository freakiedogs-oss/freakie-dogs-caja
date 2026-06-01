/**
 * Icon.jsx — Set de iconos del POS (SVG inline estilo lucide).
 * Sin dependencias externas → cero riesgo de build. Uso:
 *   <Icon name="armchair" />            (hereda color del texto)
 *   <Icon name="bell" size={18} color="#FFD900" />
 */
const PATHS = {
  store: '<path d="M3 9l1-5h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 22V12h6v10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  armchair: '<path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M3 13a2 2 0 0 1 2-2a2 2 0 0 1 2 2v3h10v-3a2 2 0 0 1 2-2a2 2 0 0 1 2 2v5H3z"/><path d="M5 18v3M19 18v3"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 17.5 9 9h6l-1.5 4M9 9l-2.5 8.5"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  car: '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chef: '<path d="M6 13.87V20h12v-6.13"/><path d="M6 14a4 4 0 1 1 1-7.87A4 4 0 0 1 12 4a4 4 0 0 1 5 2.13A4 4 0 1 1 18 14"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20v-1a5 5 0 0 1 10 0v1"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6M21.5 20v-1a5 5 0 0 0-4-4.9"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2M5 2v20M17 2v20M21 8c0 3-2 4-4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5 5l14 14"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9"/><path d="M12 8S10.5 3 8 4s.5 4 4 4zM12 8s1.5-5 4-4-.5 4-4 4z"/>',
  cup: '<path d="M6 2h12l-1.4 18.1A2 2 0 0 1 14.6 22H9.4a2 2 0 0 1-2-1.9L6 2z"/><path d="M5 8h14"/>',
  beer: '<path d="M17 11h1a3 3 0 0 1 0 6h-1"/><path d="M9 12v5M13 12v5"/><path d="M7 8.5V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V8.5"/><path d="M6 8.5a2 2 0 0 1 0-4 2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 5 0 2 2 0 0 1 0 4z"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2M5 11v11M16 2c-1.7 0-3 2-3 5s1 4 3 4v11"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  bank: '<path d="M3 21h18M4 10h16M5 10V7l7-4 7 4v3M6 10v8M10 10v8M14 10v8M18 10v8"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.8-2.3-1.5-3.5C8.2 6.6 9 4 12 2c.5 3 2 4.2 3.3 5.5C16.5 8.8 18 10.6 18 13a6 6 0 0 1-12 0c0-1 .2-1.7.5-2.5"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
};

// Mapa emoji → icono (para categorías guardadas en BD con emoji)
export const EMOJI_ICON = {
  '🎁': 'gift', '🌭': 'utensils', '🍔': 'utensils', '🍟': 'bag', '🥪': 'utensils',
  '🥤': 'cup', '🧃': 'cup', '☕': 'cup', '🍺': 'beer', '🍻': 'beer',
  '➕': 'plus', '+': 'plus', '🍴': 'utensils', '🍕': 'utensils', '🛒': 'cart',
};

export default function Icon({ name, size = 20, color, className = '', style = {}, strokeWidth = 2 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} style={{ flex: 'none', ...style }}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
