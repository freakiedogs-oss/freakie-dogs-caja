// ────────────────────────────────────────────────────────────────────
// Mapa 3D isométrico del seguimiento (19-nov-2026).
// Ciudad tipo maqueta flotante armada con datos reales de OpenStreetMap
// (teselas vectoriales de OpenFreeMap, sin API key), ruta real (OSRM),
// motorista con uniforme rojo en moto negra que avanza de forma continua
// entre cada señal GPS, cámara isométrica (seguir / dron / ver ruta),
// zoom con dedos o rueda, arrastrar para mover, y etiquetas de lugares
// conocidos (centros comerciales, supers, calles principales) para que el
// cliente se ubique.
// JS puro: no depende de React. Three.js r128 se carga del CDN solo cuando
// alguien abre el mapa 3D (no pesa en el bundle). Si algo falla, el
// componente cae al mapa normal (Leaflet).
// ────────────────────────────────────────────────────────────────────
const URL_THREE = 'https://esm.sh/three@0.128.0'
const URL_VT = 'https://esm.sh/@mapbox/vector-tile@2.0.3'
const URL_PBF = 'https://esm.sh/pbf@4.0.1'
const URL_TILEJSON = 'https://tiles.openfreemap.org/planet'
const URL_OSRM = 'https://router.project-osrm.org/route/v1/driving/'

let T = null // THREE
async function cargarThree() {
  if (!T) T = await import(/* @vite-ignore */ URL_THREE)
  return T
}

export function soportaWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')) } catch { return false }
}

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = (h ^ c.charCodeAt(0)) * 16777619 >>> 0; return h / 4294967295 }
const cerca = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

// Lugares conocidos: ícono + importancia (menor = más importante)
const POI = { mall: ['🛍️', 0], department_store: ['🛍️', 1], university: ['🎓', 1], college: ['🎓', 2], hospital: ['🏥', 1], stadium: ['🏟️', 1], attraction: ['⭐', 1], cinema: ['🎬', 2], supermarket: ['🛒', 2], marketplace: ['🛒', 3], townhall: ['🏛️', 2], park: ['🌳', 3], fuel: ['⛽', 3], place_of_worship: ['⛪', 3], hotel: ['🏨', 3], fast_food: ['🍔', 4], bank: ['🏦', 4], school: ['🏫', 4], police: ['🚓', 4], restaurant: ['🍽️', 5], pharmacy: ['💊', 5], cafe: ['☕', 5] }
const FAMA = /plaza|centro comercial|gran v[ií]a|multiplaza|metrocentro|galer[ií]as|universidad|hospital|estadio|redondel|monumento|catedral|parque|cafetal[oó]n|merliot|walmart|selectos|price ?smart|la skina|paseo|unicentro/i
const MENOR = /cl[ií]nica|laboratorio|unidad de salud|fosalud|m[eé]dic/i

/**
 * @param {HTMLElement} cont  contenedor (position:relative, con alto)
 * @param {object} o  { tienda:[lon,lat], casa:[lon,lat], driver:[lon,lat], paradas:[[lon,lat]], motorista, sucursal, onDato(txt) }
 */
export async function crearMapa3D(cont, o) {
  const THREE = await cargarThree()
  const motorista = o.motorista || 'Tu motorista'
  const casaLL = o.casa
  const tiendaLL = o.tienda || o.driver
  let driverLL = o.driver
  let paradasLL = o.paradas || []

  // ── coordenadas locales en metros ──
  const LON0 = (tiendaLL[0] + casaLL[0]) / 2, LAT0 = (tiendaLL[1] + casaLL[1]) / 2
  const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110540
  const xy = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KZ]

  // ── escena ──
  let W = cont.clientWidth || 360, H = cont.clientHeight || 300
  const R = new THREE.WebGLRenderer({ antialias: true })
  R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); R.setSize(W, H)
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap
  R.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:block'
  cont.appendChild(R.domElement)
  const capaEt = document.createElement('div'); capaEt.className = 'm3-etq'; cont.appendChild(capaEt)

  const hora = new Date().getHours(); const noche = hora >= 18 || hora < 5
  const S = new THREE.Scene(); S.background = new THREE.Color(noche ? 0x070b1c : 0x16405e)
  const C = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -5000, 5000)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6f8296, noche ? 0.35 : 0.5); S.add(hemi)
  const sol = new THREE.DirectionalLight(0xfff4e0, noche ? 0.25 : 0.62); sol.castShadow = true
  sol.shadow.mapSize.set(1024, 1024); Object.assign(sol.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 2000 }); S.add(sol, sol.target)
  const L = (c, extra) => new THREE.MeshLambertMaterial({ color: c, ...extra })
  const MAT = {
    suelo: L(noche ? 0x2d3a2a : 0xa8d17c), lado: L(0x5b6573), calle: L(noche ? 0x8a90b0 : 0xf7f7f4), calleP: L(noche ? 0x6f7590 : 0xeef0ea), parque: L(noche ? 0x24402a : 0x7cbf5a),
    edif: L(noche ? 0xa7a9d6 : 0xf5f5f2, noche ? { emissive: 0x221a44 } : {}), edif2: L(noche ? 0x9ca6cc : 0xe7edf3, noche ? { emissive: 0x2a2050 } : {}),
    edifC: [0xE63946, 0x6fb3e0, 0xf4c26b, 0x8fd0c6].map(c => L(c)),
    ruta: L(0xFFC928, noche ? { emissive: 0x664400 } : {}), rutaG: new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.45 }),
  }
  const basura = [] // geometrías para liberar al destruir

  function unir(geos) {
    let n = 0; const nonI = geos.map(g => { const q = g.index ? g.toNonIndexed() : g; n += q.attributes.position.count; return q })
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let k = 0
    nonI.forEach(g => { if (!g.attributes.normal) g.computeVertexNormals(); pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3); k += g.attributes.position.count })
    const r = new THREE.BufferGeometry(); r.setAttribute('position', new THREE.BufferAttribute(pos, 3)); r.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); basura.push(r); return r
  }
  // cinta plana (calles y ruta) con juntas redondas; triángulos mirando hacia arriba
  function cinta(pts, ancho, y) {
    const P = [], N = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * ancho / 2, nz = dx / l * ancho / 2
      const a = [ax + nx, y, az + nz], b = [ax - nx, y, az - nz], c = [bx + nx, y, bz + nz], d = [bx - nx, y, bz - nz]
      P.push(...a, ...c, ...b, ...b, ...c, ...d); for (let k = 0; k < 6; k++) N.push(0, 1, 0)
    }
    for (const [px, pz] of pts) {
      for (let k = 0; k < 8; k++) {
        const a1 = k / 8 * Math.PI * 2, a2 = (k + 1) / 8 * Math.PI * 2
        P.push(px, y, pz, px + Math.cos(a2) * ancho / 2, y, pz + Math.sin(a2) * ancho / 2, px + Math.cos(a1) * ancho / 2, y, pz + Math.sin(a1) * ancho / 2); for (let q = 0; q < 3; q++) N.push(0, 1, 0)
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); return g
  }

  // ── motorista: persona con uniforme rojo y gorra, scooter negra con caja ──
  function crearRepartidor() {
    const g = new THREE.Group()
    const m = (geo, mat, x, y, z, par = g) => { const ob = new THREE.Mesh(geo, mat); ob.position.set(x, y, z); ob.castShadow = true; par.add(ob); return ob }
    const negro = L(0x2b2d33), gris = L(0x8b9099), rojo = L(0xE63946), piel = L(0xf0c19a), pant = L(0x2d3a55), amar = L(0xFFC928)
    m(new THREE.BoxGeometry(1.5, 0.35, 0.55), negro, 0, 0.55, 0)
    m(new THREE.BoxGeometry(0.25, 1.0, 0.55), negro, 0.72, 0.95, 0)
    m(new THREE.BoxGeometry(0.7, 0.18, 0.5), L(0x1c1d22), -0.25, 0.82, 0)
    m(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), gris, 0.78, 1.48, 0).rotation.x = Math.PI / 2
    m(new THREE.BoxGeometry(0.06, 0.12, 0.18), L(0xfff2b0, { emissive: noche ? 0xfff2b0 : 0 }), 0.86, 1.2, 0)
    g.userData.ll = [0.68, -0.6].map(x => { const w = m(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 16), negro, x, 0.3, 0); w.rotation.x = Math.PI / 2; m(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 10), gris, 0, 0, 0, w); return w })
    m(new THREE.BoxGeometry(0.7, 0.62, 0.7), rojo, -0.72, 1.28, 0); m(new THREE.BoxGeometry(0.72, 0.12, 0.72), amar, -0.72, 1.3, 0)
    const p = new THREE.Group(); g.add(p)
    ;[-0.13, 0.13].forEach(z => { m(new THREE.BoxGeometry(0.5, 0.16, 0.16), pant, 0, 0.98, z, p); m(new THREE.BoxGeometry(0.16, 0.42, 0.16), pant, 0.22, 0.74, z, p) })
    m(new THREE.BoxGeometry(0.32, 0.62, 0.46), rojo, -0.12, 1.33, 0, p).rotation.z = -0.18
    ;[-0.27, 0.27].forEach(z => { m(new THREE.BoxGeometry(0.62, 0.12, 0.12), rojo, 0.3, 1.42, z, p).rotation.z = -0.35 })
    m(new THREE.SphereGeometry(0.19, 14, 12), piel, -0.02, 1.82, 0, p)
    m(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), rojo, -0.02, 1.86, 0, p); m(new THREE.BoxGeometry(0.2, 0.03, 0.26), rojo, 0.16, 1.87, 0, p)
    g.userData.p = p; return g
  }
  function pin(color, base) {
    const g = new THREE.Group(); const mat = L(color)
    const cono = new THREE.Mesh(new THREE.ConeGeometry(4, 9, 24), mat); cono.rotation.x = Math.PI; cono.position.y = 10.5
    const ani = new THREE.Mesh(new THREE.TorusGeometry(3.6, 1.4, 14, 28), mat); ani.position.y = 16; ani.rotation.y = Math.PI / 4
    g.add(cono, ani); if (base) { const b = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 9), L(base)); b.position.y = 2; g.add(b) }
    g.traverse(x => { x.castShadow = true }); return g
  }

  // ── ruta real por la calle ──
  async function pedirRuta(puntos) {
    try {
      const r = await fetch(URL_OSRM + puntos.map(p => p.join(',')).join(';') + '?overview=full&geometries=geojson')
      const j = await r.json(); const c = j?.routes?.[0]?.geometry?.coordinates
      if (c && c.length > 1) return c
    } catch { /* sin ruta: línea recta */ }
    return puntos
  }
  let rutaXY = [], acum = [0], largo = 1
  function ponerRuta(ll) {
    rutaXY = ll.map(([a, b]) => xy(a, b)); acum = [0]
    for (let i = 1; i < rutaXY.length; i++) acum.push(acum[i - 1] + cerca(rutaXY[i], rutaXY[i - 1]))
    largo = Math.max(1, acum[acum.length - 1])
  }
  function punto(m) {
    m = Math.max(0, Math.min(largo, m)); let i = acum.findIndex(v => v >= m); if (i <= 0) return { p: rutaXY[0], i: 1 }
    const f = (m - acum[i - 1]) / (acum[i] - acum[i - 1] || 1), a = rutaXY[i - 1], b = rutaXY[i]
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i }
  }
  // dónde cae el motorista sobre la ruta (sin retroceder más de 150 m)
  function proyectar(p, desde) {
    let best = { m: desde, d: 1e9 }
    for (let i = 0; i < rutaXY.length - 1; i++) {
      if (acum[i + 1] < desde - 150) continue
      const [ax, az] = rutaXY[i], [bx, bz] = rutaXY[i + 1]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2)); const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1])
      if (d < best.d) best = { m: acum[i] + t * Math.sqrt(l2), d }
    }
    return best
  }

  // ── teselas vectoriales: edificios, calles, parques y nombres ──
  const RAW = []; let ETQ = [], CALLES = []
  async function cargarTeselas(rutaLL) {
    const { VectorTile } = await import(/* @vite-ignore */ URL_VT); const Pbf = (await import(/* @vite-ignore */ URL_PBF)).default
    const tj = await (await fetch(URL_TILEJSON)).json(); const url = tj.tiles[0]; const z = 14
    let lo1 = 1e9, lo2 = -1e9, la1 = 1e9, la2 = -1e9
    rutaLL.forEach(([a, b]) => { lo1 = Math.min(lo1, a); lo2 = Math.max(lo2, a); la1 = Math.min(la1, b); la2 = Math.max(la2, b) })
    const mg = 0.0045; lo1 -= mg; lo2 += mg; la1 -= mg; la2 += mg
    const tx = lon => Math.floor((lon + 180) / 360 * 2 ** z)
    const ty = lat => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)
    const tiles = []; for (let x = tx(lo1); x <= tx(lo2); x++) for (let y = ty(la2); y <= ty(la1); y++) tiles.push([x, y])
    const out = []; let id = 0
    const CL = { motorway: 'trunk', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service' }
    await Promise.all(tiles.slice(0, 40).map(async ([x, y]) => {
      try {
        const buf = await (await fetch(url.replace('{z}', z).replace('{x}', x).replace('{y}', y))).arrayBuffer(); const vt = new VectorTile(new Pbf(buf))
        const capa = (n, fn) => { const ly = vt.layers[n]; if (!ly) return; for (let i = 0; i < ly.length; i++) { const ft = ly.feature(i); fn(ft.toGeoJSON(x, y, z), ft.properties) } }
        const polys = g => g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : []
        const lines = g => g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []
        const nom = p => p['name:es'] || p.name
        capa('building', (g, p) => polys(g.geometry).forEach(r => out.push({ id: ++id, t: 'b', h: p.render_height, r })))
        capa('transportation', (g, p) => { const hw = CL[p.class]; if (hw) lines(g.geometry).forEach(r => out.push({ id: ++id, t: 'c', hw, r })) })
        const verde = (g, p) => { if (/park|grass|wood|recreation|garden|pitch|meadow|forest/.test((p.class || '') + (p.subclass || ''))) polys(g.geometry).forEach(r => out.push({ id: ++id, t: 'v', r })) }
        capa('park', verde); capa('landcover', verde); capa('landuse', verde)
        capa('poi', (g, p) => { const n = nom(p); if (n && g.geometry.type === 'Point') RAW.push({ k: 'poi', n, cls: p.class, sub: p.subclass, rank: p.rank || 30, ll: g.geometry.coordinates }) })
        capa('place', (g, p) => { const n = nom(p); if (n && /suburb|neighbourhood|quarter|village|town/.test(p.class) && g.geometry.type === 'Point') RAW.push({ k: 'barrio', n, ll: g.geometry.coordinates }) })
        capa('transportation_name', (g, p) => { const n = nom(p); if (n) lines(g.geometry).forEach(r => RAW.push({ k: 'calle', n, cls: p.class, r })) })
      } catch { /* tesela perdida: seguimos */ }
    }))
    return out
  }

  // ── armar la ciudad ──
  const puntosRuta = () => [driverLL, ...paradasLL, casaLL]
  const rutaInicial = await pedirRuta([tiendaLL, ...paradasLL, casaLL])
  ponerRuta(rutaInicial)
  let osm = []; try { osm = await cargarTeselas(rutaInicial) } catch (e) { console.warn('[mapa3d] teselas', e) }

  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9
  rutaXY.forEach(([x, z]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) })
  const M = 360; minX -= M; maxX += M; minZ -= M; maxZ += M
  const losa = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 40, maxZ - minZ), [MAT.lado, MAT.lado, MAT.suelo, MAT.lado, MAT.lado, MAT.lado])
  losa.position.set((minX + maxX) / 2, -20, (minZ + maxZ) / 2); losa.receiveShadow = true; S.add(losa); basura.push(losa.geometry)
  const dentro = ([x, z]) => x > minX + 4 && x < maxX - 4 && z > minZ + 4 && z < maxZ - 4
  const calles = [], callesP = [], parques = [], eB = [], eB2 = [], eC = [[], [], [], []], arboles = []
  for (const el of osm) {
    const pts = el.r.map(([a, b]) => xy(a, b)).filter(dentro); if (pts.length < 2) continue
    if (el.t === 'c') {
      const w = { primary: 16, trunk: 18, secondary: 14, tertiary: 12, residential: 9, service: 5 }[el.hw] || 8
      ;(el.hw === 'service' ? callesP : calles).push(cinta(pts, w, 0.3))
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const l = Math.hypot(bx - ax, bz - az)
        for (let s = 8; s < l; s += 22) if (hash(el.id + 't' + i + s) < 0.45) { const f = s / l, nx = -(bz - az) / l, nz = (bx - ax) / l, of = (w / 2 + 3) * (hash(el.id + s) < 0.5 ? 1 : -1); arboles.push([ax + (bx - ax) * f + nx * of, az + (bz - az) * f + nz * of]) }
      }
    } else if (el.t === 'b' && pts.length >= 3) {
      const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))); const h0 = hash(el.id)
      const pisos = el.h ? Math.max(1, el.h / 3.2) : (h0 < 0.55 ? 1 : h0 < 0.8 ? 2 : h0 < 0.93 ? 3 : 5)
      const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(3.2, pisos * 3.2), bevelEnabled: false }); g.rotateX(-Math.PI / 2)
      ;(h0 > 0.96 ? eC[Math.floor(hash(el.id + 'c') * 4)] : h0 < 0.5 ? eB : eB2).push(g)
    } else if (el.t === 'v' && pts.length >= 3) {
      const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))); g.rotateX(-Math.PI / 2); g.translate(0, 0.15, 0); parques.push(g)
      for (let k = 0; k < pts.length; k += 2) if (hash(el.id + k) < 0.7) arboles.push(pts[k])
    }
  }
  if (!calles.length) { // sin datos: cuadrícula genérica para que nunca quede vacío
    for (let x = Math.ceil(minX / 110) * 110; x < maxX; x += 110) calles.push(cinta([[x, minZ + 5], [x, maxZ - 5]], 10, 0.3))
    for (let z = Math.ceil(minZ / 110) * 110; z < maxZ; z += 110) calles.push(cinta([[minX + 5, z], [maxX - 5, z]], 10, 0.3))
  }
  const agregar = (geos, mat, sombra) => { if (!geos.length) return; const m = new THREE.Mesh(unir(geos), mat); m.receiveShadow = true; if (sombra) m.castShadow = true; S.add(m); geos.forEach(g => g.dispose()) }
  agregar(parques, MAT.parque); agregar(callesP, MAT.calleP); agregar(calles, MAT.calle); agregar(eB, MAT.edif, 1); agregar(eB2, MAT.edif2, 1); eC.forEach((g, i) => agregar(g, MAT.edifC[i], 1))
  if (arboles.length) {
    const tr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.6, 3, 6), L(0x8a5a3c), arboles.length)
    const co = new THREE.InstancedMesh(new THREE.SphereGeometry(2.6, 8, 6), L(noche ? 0x2f6b3a : 0x4caf50), arboles.length)
    const d = new THREE.Object3D()
    arboles.forEach(([x, z], i) => { const s = 0.8 + hash(x + z) * 0.6; d.position.set(x, 1.5 * s, z); d.scale.setScalar(s); d.updateMatrix(); tr.setMatrixAt(i, d.matrix); d.position.y = 4.2 * s; d.updateMatrix(); co.setMatrixAt(i, d.matrix) })
    co.castShadow = true; S.add(tr, co)
  }

  // ruta: pendiente (amarillo suave) + recorrida (amarillo fuerte)
  const rutaG = new THREE.Mesh(new THREE.BufferGeometry(), MAT.rutaG); S.add(rutaG)
  const rutaHecha = new THREE.Mesh(new THREE.BufferGeometry(), MAT.ruta); S.add(rutaHecha)
  const pintarRutaG = () => { rutaG.geometry.dispose(); rutaG.geometry = cinta(rutaXY, 7, 0.55) }
  pintarRutaG()

  const [tx0, tz0] = xy(...tiendaLL), [cx0, cz0] = xy(...casaLL)
  const tienda = pin(0xE63946, 0xffffff); tienda.scale.setScalar(2); tienda.position.set(tx0, 0, tz0); S.add(tienda)
  const casa = pin(0x5cc33c, 0xE63946); casa.scale.setScalar(2); casa.position.set(cx0, 0, cz0); S.add(casa)
  let pinesParada = []
  const ponerParadas = () => {
    pinesParada.forEach(p => S.remove(p))
    pinesParada = paradasLL.map(ll => { const p = pin(0x334155, 0xFFC928); p.scale.setScalar(1.4); const [x, z] = xy(...ll); p.position.set(x, 0, z); S.add(p); return p })
  }
  ponerParadas()
  const moto = crearRepartidor(); moto.scale.setScalar(8); S.add(moto)

  // ── etiquetas ──
  function distRuta(x, z) { let m = 1e9; for (let i = 0; i < rutaXY.length; i += 2) { const d = Math.hypot(rutaXY[i][0] - x, rutaXY[i][1] - z); if (d < m) m = d } return m }
  function armarEtiquetas() {
    const lst = []
    for (const r of RAW) {
      if (r.k === 'calle') continue
      const [x, z] = xy(...r.ll); const d = distRuta(x, z)
      if (r.k === 'poi') {
        const key = POI[r.sub] ? r.sub : r.cls; let [ic, b] = POI[key] || ['📍', 6]
        const menor = /clinic|doctors|dentist|laborator|health|veterinary/.test((r.sub || '') + ' ' + (r.cls || '')) || MENOR.test(r.n)
        if (menor) { b = 7; ic = '🩺' }
        const fam = !menor && FAMA.test(r.n); if (d > (fam || b <= 1 ? 650 : 320)) continue
        lst.push({ n: r.n, ic, tipo: 'poi', pri: b * 10 + Math.min(r.rank, 40) / 4 + d / 120 - (fam ? 14 : 0), x, z, y: 5 })
      } else if (d < 900) lst.push({ n: r.n, tipo: 'barrio', pri: 22 + d / 150, x, z, y: 2 })
    }
    const porNom = {}
    for (const r of RAW) {
      if (r.k !== 'calle') continue; const pts = r.r.map(([a, b]) => xy(a, b)); CALLES.push({ n: r.n, pts })
      for (const [x, z] of pts) { const d = distRuta(x, z); const c = porNom[r.n]; if (!c || d < c.d) porNom[r.n] = { d, x, z, cls: r.cls } }
    }
    for (const [n, c] of Object.entries(porNom)) { if (c.d > 140) continue; const b = { motorway: 0, trunk: 0, primary: 1, secondary: 3, tertiary: 6 }[c.cls] ?? 10; lst.push({ n, tipo: 'calle', pri: 4 + b * 2 + c.d / 40, x: c.x, z: c.z, y: 1 }) }
    lst.push({ n: 'Freakie ' + (o.sucursal || ''), ic: '🌭', tipo: 'poi', top: true, pri: -100, x: tx0, z: tz0, y: 30 }, { n: 'Tu casa', ic: '🏠', tipo: 'poi', top: true, pri: -99, x: cx0, z: cz0, y: 30 })
    lst.sort((a, b) => a.pri - b.pri); const ok = []
    for (const e of lst) { if (ok.some(q => q.n === e.n && Math.hypot(q.x - e.x, q.z - e.z) < 500)) continue; ok.push(e) }
    ETQ = ok.slice(0, 160)
  }
  armarEtiquetas()
  const V3 = new THREE.Vector3()
  function elDe(e) {
    if (e.el) return e.el
    const d = document.createElement('div'); d.className = 'm3-et ' + (e.tipo === 'poi' ? (e.top ? 'top' : '') : e.tipo)
    d.textContent = (e.ic ? e.ic + ' ' : '') + (e.n.length > 26 ? e.n.slice(0, 25) + '…' : e.n)
    capaEt.appendChild(d); e.w = d.offsetWidth; e.h = d.offsetHeight; e.el = d; return d
  }
  let etF = 0
  function etiquetas() {
    if (!ETQ.length || ++etF % 2) return
    const usados = [[0, 0, W, 42], [W - 46, H - 96, W, H]] // chips arriba, botones +/− abajo
    if (modo !== 'ruta') { V3.copy(moto.position).project(C); const mx = (V3.x + 1) / 2 * W, my = (1 - V3.y) / 2 * H; usados.push([mx - 26, my - 46, mx + 26, my + 10]) }
    const max = modo === 'ruta' ? 9 : 7; let n = 0
    for (const e of ETQ) {
      let vis = false
      if (n < max && !(modo === 'ruta' && zoomU < 1.6 && (e.tipo !== 'poi' || e.pri > 30))) {
        V3.set(e.x, e.y, e.z).project(C); const sx = (V3.x + 1) / 2 * W, sy = (1 - V3.y) / 2 * H
        if (sx > 8 && sx < W - 8 && sy > 14 && sy < H - 4) {
          const el = elDe(e); const cx = Math.max(e.w / 2 + 4, Math.min(W - e.w / 2 - 4, sx))
          const b = e.tipo === 'poi' ? [cx - e.w / 2 - 4, sy - e.h - 8, cx + e.w / 2 + 4, sy + 2] : [cx - e.w / 2 - 4, sy - e.h / 2 - 4, cx + e.w / 2 + 4, sy + e.h / 2 + 4]
          if (!usados.some(u => b[0] < u[2] && b[2] > u[0] && b[1] < u[3] && b[3] > u[1])) {
            usados.push(b); n++; vis = true
            el.style.transform = e.tipo === 'poi' ? `translate(${cx - e.w / 2}px,${sy - e.h - 6}px)` : `translate(${cx - e.w / 2}px,${sy - e.h / 2}px)`
          }
        }
      }
      if (e.el) e.el.style.opacity = vis ? 1 : 0
    }
  }
  function dondeVa(p) {
    let best = null, bd = 30
    for (const c of CALLES) {
      const P = c.pts
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2)); const d = Math.hypot(ax + dx * t - p[0], az + dz * t - p[1])
        if (d < bd) { bd = d; best = c.n }
      }
    }
    let lug = null, ld = 350
    for (const e of ETQ) { if (e.tipo !== 'poi' || e.pri > 25) continue; const d = Math.hypot(e.x - p[0], e.z - p[1]); if (d < ld) { ld = d; lug = e } }
    return (best ? `🛵 ${motorista} va por ${best}` : `🛵 ${motorista} va en camino`) + (lug ? ` · cerca de ${lug.ic} ${lug.n}` : '')
  }

  // ── posición del motorista: continua entre señales ──
  let tObj = 0, tDisp = 0, vEst = 6, ultSenal = performance.now(), fueraRuta = 0, rerruteando = false
  function senal(ll) {
    driverLL = ll; const p = xy(...ll); const pr = proyectar(p, tObj)
    if (pr.d > 90 && !rerruteando) {
      if (++fueraRuta >= 2) { // se fue por otra calle: ruta nueva desde donde está
        rerruteando = true; fueraRuta = 0
        pedirRuta(puntosRuta()).then(c => { ponerRuta(c); pintarRutaG(); tObj = tDisp = 0; rutaHecha.geometry.dispose(); rutaHecha.geometry = new THREE.BufferGeometry() }).finally(() => { rerruteando = false })
      }
      return
    }
    fueraRuta = 0
    const ahora = performance.now(); const dtS = Math.max(1, (ahora - ultSenal) / 1000); ultSenal = ahora
    if (pr.m > tObj) { vEst = Math.max(3, Math.min(25, (pr.m - tDisp) / Math.max(4, dtS))); tObj = pr.m }
    if (tObj - tDisp > 600) tDisp = tObj - 40
  }
  senal(driverLL); tDisp = tObj

  // ── cámara isométrica + gestos ──
  let modo = 'seguir', zoomV = 2.2, zoomU = 1, orbit = 0, ultimo = performance.now(), ultDato = 0, vivo = true, raf = 0
  const camC = new THREE.Vector3(moto.position.x, 0, moto.position.z), libre = new THREE.Vector3()
  const zTodo = Math.min(W / ((maxX - minX + maxZ - minZ) * 0.707 * 1.04), H / ((maxX - minX + maxZ - minZ) * 0.42))
  const ptrs = new Map(); let pinch0 = 0, zoom0 = 1
  const cv = R.domElement
  const setModo = (m) => { modo = m; o.onModo?.(m) }
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture?.(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = cerca(a, b); zoom0 = zoomU } })
  cv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; if (pinch0) zoomU = Math.max(0.3, Math.min(4, zoom0 * cerca(a, b) / pinch0)); return }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; if (Math.abs(dx) + Math.abs(dy) < 1) return
    if (modo !== 'libre') { libre.copy(camC); setModo('libre') }
    // mover en el plano según el giro de la cámara
    const az = Math.PI / 4 + (modo === 'dron' ? orbit : 0), s = 1 / zoomV
    const rx = -Math.sin(az), rz = Math.cos(az), fx = -Math.cos(az), fz = -Math.sin(az)
    libre.x -= (dx * rx - dy * fx / Math.sin(0.62)) * s; libre.z -= (dx * rz - dy * fz / Math.sin(0.62)) * s
  })
  const soltar = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0 }
  cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar)
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoomU = Math.max(0.3, Math.min(4, zoomU * Math.exp(-e.deltaY * 0.0015))) }, { passive: false })

  const ro = new ResizeObserver(() => { W = cont.clientWidth || W; H = cont.clientHeight || H; R.setSize(W, H) }); ro.observe(cont)

  let angulo = 0
  function ponerMoto(t) {
    const { p } = punto(t), a = punto(t + 18).p; moto.position.set(p[0], 0, p[1])
    if (cerca(a, p) > 0.5) { const obj = Math.atan2(-(a[1] - p[1]), a[0] - p[0]); const d = ((obj - angulo + Math.PI * 3) % (Math.PI * 2)) - Math.PI; angulo += d * 0.12; moto.rotation.y = angulo }
  }
  function frame(now) {
    if (!vivo) return; raf = requestAnimationFrame(frame)
    if (document.hidden) { ultimo = now; return }
    const dt = Math.min(0.1, (now - ultimo) / 1000); ultimo = now; const tt = now / 1000
    const antes = tDisp
    if (tDisp < tObj) tDisp = Math.min(tObj, tDisp + vEst * dt)
    const mov = tDisp - antes > 0.01
    if (mov) { moto.userData.ll.forEach(w => { w.rotation.y += 0.4 }); moto.userData.p.position.y = Math.abs(Math.sin(tt * 9)) * 0.02 }
    const { p, i } = punto(tDisp)
    if (mov || !rutaHecha.geometry.attributes.position) { rutaHecha.geometry.dispose(); rutaHecha.geometry = cinta([...rutaXY.slice(0, i), p], 7, 0.6) }
    ponerMoto(tDisp)
    tienda.rotation.y += dt * 0.8; casa.rotation.y += dt * 0.8; casa.position.y = Math.sin(tt * 3) * 1.2
    if (now - ultDato > 1500) { ultDato = now; o.onDato?.(dondeVa(p)) }

    let foco = moto.position, zObj = 2.2 * zoomU, azi = Math.PI / 4
    if (modo === 'dron') { orbit += dt * 0.35; azi = Math.PI / 4 + orbit }
    if (modo === 'ruta') { foco = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2); zObj = zTodo * zoomU }
    if (modo === 'libre') { foco = libre; azi = Math.PI / 4 }
    camC.lerp(foco, modo === 'libre' ? 1 : Math.min(1, dt * 3)); zoomV += (zObj - zoomV) * Math.min(1, dt * 4)
    const D = 900, el = 0.62
    C.position.set(camC.x + D * Math.cos(el) * Math.cos(azi), D * Math.sin(el), camC.z + D * Math.cos(el) * Math.sin(azi)); C.lookAt(camC)
    C.left = -W / 2 / zoomV; C.right = W / 2 / zoomV; C.top = H / 2 / zoomV; C.bottom = -H / 2 / zoomV; C.updateProjectionMatrix()
    sol.position.set(camC.x - 180, 320, camC.z + 120); sol.target.position.copy(camC)
    R.render(S, C); etiquetas()
  }
  raf = requestAnimationFrame(frame)

  return {
    modo: (m) => { setModo(m); if (m !== 'libre') zoomU = 1 },
    zoom: (f) => { zoomU = Math.max(0.3, Math.min(4, zoomU * f)) },
    update({ driver, paradas }) {
      if (paradas && JSON.stringify(paradas) !== JSON.stringify(paradasLL)) {
        paradasLL = paradas; ponerParadas()
        pedirRuta(puntosRuta()).then(c => { ponerRuta(c); pintarRutaG(); tObj = tDisp = 0 })
      }
      if (driver && (driver[0] !== driverLL[0] || driver[1] !== driverLL[1])) senal(driver)
    },
    destroy() {
      vivo = false; cancelAnimationFrame(raf); ro.disconnect()
      S.traverse(x => { if (x.geometry) x.geometry.dispose() }); basura.forEach(g => g.dispose?.())
      R.dispose(); cv.remove(); capaEt.remove()
    },
  }
}
