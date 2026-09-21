/* ═══════════════════════════════════════════════════════════════════════
   Importar la hoja de control de eventos (Excel) como requisición

   Pedido de Cesar (21-sep-2026): Edgar ya arma cada evento en una hoja de
   Excel ("Copia Hoja de Control Eventos FreakieDogs"), con una pestaña por
   montaje — BURGERS, HOT DOGS — y tres columnas: Alimentos, Cantidad, Listo.
   Volver a teclear eso en el ERP era trabajo doble y fuente de olvidos.

   Este módulo NO asume que el archivo venga perfecto, porque no viene:
     · los nombres traen erratas ("Esmasher", "Cuchillo de cierra", "Ketchu")
     · hay cantidades escritas ("1 C/U", "3 paquetes", "1 caja")
     · hay renglones de sección (Utensilios, Cocina, Extras) mezclados
     · al final hay metadatos del evento (lugar, horas) que no son ítems
     · una pestaña puede venir con la columna de nombres vacía
   Por eso lee lo que puede, marca lo que no, y deja que Edgar lo corrija en
   pantalla antes de crear el pedido.
   ═══════════════════════════════════════════════════════════════════════ */

// Renglones que son título de sección, no productos.
const SECCIONES = ['alimentos', 'utensilios', 'cocina', 'extras', 'empaque', 'montaje', 'cobro', 'seguridad', 'cierre'];

// Renglones del pie con datos del evento. La clave es lo que guardamos.
const META = [
  ['nombre del evento', 'nombre'],
  ['lugar del evento', 'lugar'],
  ['hora del evento', 'hora_evento'],
  ['recibir producto', 'hora_recibir'],
  ['salida casa matiz', 'hora_salida'],   // así está escrito en la hoja
  ['salida casa matriz', 'hora_salida'],
];

// Para comparar nombres: sin tildes, sin signos, sin plurales obvios.
export function normalizar(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(pqt|paquete|paquetes|caja|cajas|unidad|unidades|c\/u|cu)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Erratas y sinónimos que aparecen en las hojas de Edgar. Se mapean al
// nombre del catálogo del ERP. Sin esto, media hoja quedaría sin emparejar.
const ALIAS = {
  'esmasher': 'smasher',
  'cuchillo de cierra': 'cuchillo de sierra',
  'ketchu sobresitos': 'sobres de ketchup',
  'mayonesa sobresitos': 'sobres de mayonesa',
  'salsa picante': 'sobres de salsa picante',
  'pan burguer': 'pan de hamburguesa',
  'pan hotdogs': 'pan de hot dog',
  'pan hot dogs': 'pan de hot dog',
  'carne': 'carne para hamburguesa',
  'pepinillos burguer': 'pepinillos para burger',
  'pepinillo burguer': 'pepinillos para burger',
  'pepinillos triturado': 'pepinillo triturado',
  'chedar': 'cheddar',
  'espatulas': 'espatula',
  'espatula': 'espatula',
  'pinza': 'pinzas',
  'bolsa brandeadas': 'bolsas brandeadas',
  'bandejas cafes': 'bandejas cafes',
  'bolsas de basura': 'bolsas para basura',
  'bolsa de basura': 'bolsas para basura',
  'guantes caja': 'guantes',
  'bolsas de hielo': 'bolsas de hielo',
  'hielo': 'bolsas de hielo',
  'extension': 'extension electrica',
  'gas': 'gas cilindro',
  'sal y pimienta': 'sal y pimienta',
  'sal y pimineta': 'sal y pimienta',
  'pimineta': 'pimienta',
  'mesa para plancha': 'mesa para plancha',
  'banco para dispensador': 'banco para dispensador',
  'dispensador de agua': 'dispensador de agua',
  'servilletas': 'servilletas',
  'hielera': 'hieleras',
  'vinagre': 'vinagre',
  'soda': 'soda o te',
  'soda o te': 'soda o te',
};

const aplicaAlias = (norm) => ALIAS[norm] || norm;

/* ── Cantidad ──────────────────────────────────────────────────────────
   "45" → 45 limpio. "1 C/U", "3 paquetes", "1 caja" → número + el texto
   original, para que Edgar confirme a qué unidad se refiere. */
export function leerCantidad(v) {
  if (v == null || v === '') return { cantidad: null, texto: '', dudosa: false };
  if (typeof v === 'number') return { cantidad: v, texto: '', dudosa: false };
  const txt = String(v).trim();
  const m = txt.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return { cantidad: null, texto: txt, dudosa: true };
  const num = parseFloat(m[0].replace(',', '.'));
  const soloNumero = /^-?\d+(?:[.,]\d+)?$/.test(txt);
  return { cantidad: num, texto: soloNumero ? '' : txt, dudosa: !soloNumero };
}

/* ── Lectura del archivo ───────────────────────────────────────────────
   SheetJS entra por import dinámico: son ~400 kB que no tienen por qué
   viajar en el bundle de todos los que abren la pantalla de eventos. */
export async function leerLibro(file) {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((nombre) => {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, blankrows: false, defval: null });
    return { nombre, ...leerHoja(filas) };
  });
}

/* Convierte las filas crudas de una hoja en ítems + metadatos del evento. */
export function leerHoja(filas) {
  const items = [];
  const meta = {};
  let seccion = 'Alimentos';
  let vistoEncabezado = false;
  let filasSinNombre = 0;

  for (const fila of filas || []) {
    // La columna del nombre no siempre es la A: en algunas hojas hay una
    // columna vacía al inicio. Se toma la primera celda con texto.
    const celdas = (fila || []).map((c) => (c == null ? '' : String(c).trim()));
    const iNombre = celdas.findIndex((c) => c !== '' && !/^-?\d+([.,]\d+)?$/.test(c));
    const nombre = iNombre >= 0 ? celdas[iNombre] : '';
    const cantidadCruda = iNombre >= 0 ? (fila[iNombre + 1] ?? null) : (fila.find((c) => c != null && c !== '') ?? null);
    const norm = normalizar(nombre);

    if (!nombre && cantidadCruda != null && cantidadCruda !== '') { filasSinNombre++; continue; }
    if (!nombre) continue;

    // Encabezado "Alimentos | Cantidad": marca dónde empieza la tabla.
    if (norm === 'alimentos' && normalizar(celdas[iNombre + 1]) === 'cantidad') { vistoEncabezado = true; continue; }

    // Pie con los datos del evento.
    const kv = META.find(([k]) => norm === normalizar(k));
    if (kv) { meta[kv[1]] = celdas[iNombre + 1] || ''; continue; }

    // Título de sección: viene sin cantidad al lado.
    if (SECCIONES.includes(norm) && (cantidadCruda == null || cantidadCruda === '')) {
      seccion = nombre;
      continue;
    }

    // Título de la hoja (BURGERS CON PAPAS FANCY, HOT DOGS...) antes del encabezado.
    if (!vistoEncabezado && (cantidadCruda == null || cantidadCruda === '')) continue;

    const { cantidad, texto, dudosa } = leerCantidad(cantidadCruda);
    if (cantidad == null && !dudosa) continue;   // renglón vacío

    items.push({ nombre, seccion, cantidad, textoCantidad: texto, dudosa });
  }

  return { items, meta, filasSinNombre };
}

/* ── Emparejado contra el catálogo del ERP ────────────────────────────
   Tres pasadas, de la más segura a la más floja. Nunca inventa: lo que no
   alcanza el umbral se devuelve sin item para que lo elija una persona. */
export function emparejar(items, catalogo) {
  const porNorm = new Map();
  for (const c of catalogo || []) {
    const k = normalizar(c.nombre);
    if (!porNorm.has(k)) porNorm.set(k, c);
  }

  return (items || []).map((it) => {
    const norm = aplicaAlias(normalizar(it.nombre));

    // 1. Coincidencia exacta.
    let cat = porNorm.get(norm) || null;
    let confianza = cat ? 'exacta' : null;

    // 2. Uno contiene al otro (Pan burguer → Pan de hamburguesa brioche…).
    if (!cat) {
      const candidatos = [...porNorm.entries()]
        .filter(([k]) => k.includes(norm) || norm.includes(k))
        .sort((a, b) => Math.abs(a[0].length - norm.length) - Math.abs(b[0].length - norm.length));
      if (candidatos.length) { cat = candidatos[0][1]; confianza = 'parcial'; }
    }

    // 3. Todas las palabras del nombre corto aparecen en el largo.
    if (!cat) {
      const palabras = norm.split(' ').filter((p) => p.length > 2);
      if (palabras.length) {
        const hit = [...porNorm.entries()].find(([k]) => palabras.every((p) => k.includes(p)));
        if (hit) { cat = hit[1]; confianza = 'parcial'; }
      }
    }

    return {
      ...it,
      item_id: cat?.id || null,
      item_nombre: cat?.nombre || null,
      producto_id: cat?.producto_id || null,
      despachable: !!cat?.producto_id,
      confianza,                                   // exacta | parcial | null
      // Lo que hay que revisar a mano antes de enviar.
      revisar: !cat || confianza === 'parcial' || it.dudosa,
    };
  });
}

/* Resumen para la pantalla: cuántos entran, cuántos hay que revisar. */
export function resumir(emparejados) {
  const conCantidad = emparejados.filter((e) => Number(e.cantidad) > 0);
  return {
    total: emparejados.length,
    pedibles: conCantidad.filter((e) => e.item_id && !e.revisar).length,
    revisar: conCantidad.filter((e) => e.revisar).length,
    sinEmparejar: conCantidad.filter((e) => !e.item_id).length,
    enCero: emparejados.length - conCantidad.length,
    noDespachables: conCantidad.filter((e) => e.item_id && !e.despachable).length,
  };
}
