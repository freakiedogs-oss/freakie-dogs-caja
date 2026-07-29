// ────────────────────────────────────────────────────────────────────
// Catálogo Menú Público — Freakie Dogs
//
// Réplica EXACTA del menú de BuhoPay al 30-jul-2026 (fuente de verdad
// mientras hacemos el cutover). Fotos y modificadores se cargan aparte
// una vez que Cesar mande las capturas por producto.
//
// NO cambiar orden ni textos sin autorización — clientes llevan años
// viendo este menú, cambios abruptos = mala experiencia.
// ────────────────────────────────────────────────────────────────────

export const CATEGORIAS = [
  { id: 'combos_temporada', nombre: 'COMBOS DE TEMPORADA', emoji: '🌟' },
  { id: 'freakie_burger',   nombre: 'FREAKIE BURGER',      emoji: '🍔' },
  { id: 'individuales',     nombre: 'INDIVIDUALES',        emoji: '🌭' },
  { id: 'combos',           nombre: 'COMBOS',              emoji: '🌭🍟🥤' },
  { id: 'bebidas',          nombre: 'BEBIDAS',             emoji: '🥤' },
]

// Cada producto:
//   id           slug único
//   nombre       nombre visible
//   descripcion  texto gris pequeño bajo el nombre (2 líneas, se trunca con "...")
//   precio       USD
//   categoria    id de CATEGORIAS
//   destacado    ⭐ estrella amarilla (BuhoPay lo usa como "popular")
//   like         👍 pulgar verde ("like")
//   imagen       URL absoluta (null por ahora, se llena con storage propio)
//   modificadores  [] (se completa cuando Cesar mande capturas)
// Base de las imágenes BuhoPay (sirven directo sin auth)
const IMG = 'https://admin.buhopay.com/media/'

export const PRODUCTOS = [
  // ═══ COMBOS DE TEMPORADA 🌟 ═══
  {
    id: 'combo-gol-oso',
    nombre: 'Combo GOL-OSO',
    descripcion: 'Dos Double Cheeseburger; Blend de Puyazo, Queso Americano, pepinillos y nuestra deliciosa Salsa Mil Islas versión Freakie.',
    precio: 24.99,
    categoria: 'combos_temporada',
    destacado: true,
    imagen: IMG + '6a36c35a27d0b048557980.jpg',
  },
  {
    id: 'chile-bombazo',
    nombre: 'Chile Bombazo',
    descripcion: 'Nuestro Nuevo Chile que esta Bombaaaa🌶️🌶️',
    precio: 4.99,
    categoria: 'combos_temporada',
    imagen: IMG + '6a2baae85ed32520751633.jpg',
  },
  {
    id: 'sticker-sorpresa',
    nombre: 'Sticker Sorpresa',
    descripcion: 'Un Sticker sorpresa de nuestros mas de 15 estilos diferentes 🔥😏',
    precio: 0.50,
    categoria: 'combos_temporada',
    imagen: IMG + '699ce08434b6e761543850.png',
    artwork: true,  // artwork/sticker: mostrar completo sin recortar
  },
  {
    id: 'adivina-la-marca',
    nombre: 'Adivina la Marca🔥🔥',
    descripcion: 'Un paquete de nuestras 4 Ediciones con 20 tarjetitas cada una, 2 Stickers y te enviamos las reglas del juego.',
    precio: 3.99,
    categoria: 'combos_temporada',
    imagen: IMG + '69a78b849e242912426003.png',
    artwork: true,
  },
  {
    id: 'la-clasica-burger-temporada',
    nombre: 'La Clasica Burger',
    descripcion: 'Nuestra famosaFreakie Burger llevada a otro nivel de frescura con todos los vegetales 🍔 (Lechuga, Tomate y Cebolla).',
    precio: 7.99,
    categoria: 'combos_temporada',
    destacado: true,
    imagen: IMG + '6a1fd74354861490080768.jpg',
  },
  {
    id: 'pilsener-freakie-burger',
    nombre: 'Pilsener Freakie Burger',
    descripcion: 'Double Cheeseburger; Blend de Puyazo, Queso Americano, pepinillos y nuestra deliciosa Salsa Mil Islas.',
    precio: 8.99,
    categoria: 'combos_temporada',
    imagen: IMG + '6a2a59e5c1a62965268417.png',
  },
  {
    id: 'pilsener-freakie-combo',
    nombre: 'Pilsener Freakie Combo',
    descripcion: '1 Freakie Dog 🌭+ 1 Freakie Fries 🍟+ 1 Cerveza de 360 ml🍺',
    precio: 4.99,
    categoria: 'combos_temporada',
    imagen: IMG + '6a2a58dcd816b799184049.png',
  },
  {
    id: 'combpleto',
    nombre: 'Combpleto',
    descripcion: '2 Freakie Burgers 🍔🍔, 2 Freakie Dogs🌭🌭 (1 con costra de queso), 2 Papas fritas, 1 Queso Frito, 1 Dip de Queso y 1 Postre.',
    precio: 31.99,
    categoria: 'combos_temporada',
    destacado: true,
    imagen: IMG + '690fb4f9c3116629878330.jpg',
  },
  {
    id: 'burger-box',
    nombre: 'Burger Box',
    descripcion: 'Ese combo le trae dos Smashburgers 🍔🍔, dos hot dogs con 8 complementos 🌭🌭(uno lleva costra de queso), dos papas.',
    precio: 19.99,
    categoria: 'combos_temporada',
    like: true,
    imagen: IMG + '690fb55cc2ac0756101394.jpg',
  },
  {
    id: 'pilsener-burger-box',
    nombre: 'Pilsener Burger Box',
    descripcion: 'Ese combo le trae dos Smashburgers 🍔🍔, dos hot dogs con 8 complementos 🌭🌭(uno lleva costra de queso), dos papas y una cerveza.',
    precio: 20.99,
    categoria: 'combos_temporada',
    like: true,
    imagen: IMG + '6a2a5ba9281ed075647494.png',
  },
  {
    id: 'freakie-burger-duo-temporada',
    nombre: 'Freakie Burger Dúo',
    descripcion: 'Dos Double Cheeseburger; Blend de Puyazo, Queso Americano, pepinillos y nuestra deliciosa Salsa Mil Islas.',
    precio: 14.99,
    categoria: 'combos_temporada',
    imagen: IMG + '690fb5aab171e253383289.jpg',
  },
  {
    id: 'el-combig',
    nombre: 'El ComBig',
    descripcion: '2 Freakie Burgers + 2 Frekie Dogs + 1 Queso Frito + 2 Papas Sazonadas + 1 Papa Wafle + 1 Papa Blanca.',
    precio: 25.99,
    categoria: 'combos_temporada',
    imagen: IMG + '690fb630e9836428909887.jpg',
  },
  {
    id: 'combo-individual-temporada',
    nombre: 'Combo Individual',
    descripcion: '1 Freakie Dog + 1 Freakie Fries + 1 Soda en lata',
    precio: 3.99,
    categoria: 'combos_temporada',
    imagen: IMG + '690fac058a596040745956.jpeg',
  },
  {
    id: 'duo-picossini',
    nombre: 'Duo Picossini',
    descripcion: 'Dos Freakie Burgers (con 4 pepperonccinis), dos ordenes de papas fritas medianas, una orden de queso frito.',
    precio: 17.99,
    categoria: 'combos_temporada',
    imagen: IMG + '690fb4e378a1c210250486.jpg',
  },
  {
    id: 'combo-chilli-dog',
    nombre: 'Combo Chilli Dog',
    descripcion: 'Delicioso Hot Dog con pan Brioche, Chilli a base del corte New York Gold, Queso Cheddar, salchicha polaca.',
    precio: 5.99,
    categoria: 'combos_temporada',
    destacado: true,
    imagen: IMG + '65fe0bacbc365790065063.jpg',
  },
  {
    id: 'pilsener-royal-truffle-combo',
    nombre: 'Pilsener Royal Truffle Combo',
    descripcion: 'Dos Smashburgers a base de puyazo, nuestra bandeja de papas con parmesano, su aderezo a base de trufa y una cerveza.',
    precio: 20.99,
    categoria: 'combos_temporada',
    imagen: IMG + '6a2a5c225e5fb305590291.png',
  },
  {
    id: 'royal-truffle-combo',
    nombre: 'Royal Truffle Combo',
    descripcion: 'Dos Smashburgers a base de puyazo, nuestra bandeja de papas con parmesano, su aderezo a base de trufa.',
    precio: 19.99,
    categoria: 'combos_temporada',
    imagen: IMG + '690fab0e08ee6088149935.jpeg',
  },
  {
    id: 'sweet-burger-duo',
    nombre: 'Sweet Burger duo',
    descripcion: 'Dos Smashburgers, con dos ordenes de papas fritas medianas, dos sodas y nuestro delicioso postre de brownie.',
    precio: 17.99,
    categoria: 'combos_temporada',
    destacado: true,
    imagen: IMG + '690faa5931aaa212744773.jpeg',
  },

  // ═══ FREAKIE BURGER 🍔 ═══
  {
    id: 'la-clasica-burger',
    nombre: 'La Clasica Burger',
    descripcion: 'Nuestra famosaFreakie Burger llevada a otro nivel de frescura con todos los vegetales 🍔 (Lechuga, Tomate y Cebolla).',
    precio: 7.99,
    categoria: 'freakie_burger',
    destacado: true,
    imagen: IMG + '6a1fd74354861490080768.jpg',
  },
  {
    id: 'la-freakie-burger',
    nombre: 'La Freakie Burger',
    descripcion: 'Double Cheeseburger; Blend de Puyazo, Queso Americano, pepinillos y nuestra deliciosa Salsa Mil Islas.',
    precio: 7.99,
    categoria: 'freakie_burger',
    imagen: IMG + '690fae9468c38798132032.jpeg',
  },
  {
    id: 'freakie-burger-duo',
    nombre: 'Freakie Burger Dúo',
    descripcion: 'Dos Double Cheeseburger; Blend de Puyazo, Queso Americano, pepinillos y nuestra deliciosa Salsa Mil Islas.',
    precio: 14.99,
    categoria: 'freakie_burger',
    imagen: IMG + '690fb5aab171e253383289.jpg',
  },

  // ═══ INDIVIDUALES 🌭 ═══
  {
    id: 'freakie-chilli',
    nombre: 'Freakie Chilli',
    descripcion: 'Delicioso Chilli a base del famoso corte New York, con una mezcla de Frijoles negros, frijoles rojos.',
    precio: 4.99,
    categoria: 'individuales',
    imagen: IMG + '65f09b1a9b88b849258326.jpg',
  },
  {
    id: 'freakie-fries',
    nombre: 'Freakie Fries',
    descripcion: '',
    precio: 1.99,
    categoria: 'individuales',
    imagen: IMG + '62316010c5c02786154265.PNG',
  },
  {
    id: 'mini-fancys',
    nombre: 'Mini Fancy’s',
    descripcion: 'Tus ya favoritas "Fancy Fries" ahora en un nuevo tamaño más pequeño pero siempre delicioso.',
    precio: 4.99,
    categoria: 'individuales',
    imagen: IMG + '646d5721d9874633844774.jpg',
  },
  {
    id: 'freakie-dog',
    nombre: 'Freakie Dog',
    descripcion: '1 Hot Dog individual preparado con ingredientes frescos, pan artesanal y el embutido de la mejor calidad.',
    precio: 1.99,
    categoria: 'individuales',
    imagen: IMG + '622b9f1c24346446680972.PNG',
  },
  {
    id: 'super-freak',
    nombre: 'Super Freak',
    descripcion: 'Un delicioso pan Brioche a base de mantequilla, acompañado de una salchicha polaca, cubierta por queso.',
    precio: 2.99,
    categoria: 'individuales',
    imagen: IMG + '646d56f617367376832992.jpg',
  },
  {
    id: 'fancy-fries',
    nombre: 'Fancy Fries',
    descripcion: 'Cuatro tipos de papitas, una capa de queso cheddar, seguida de una salsa mil islas versión Freakie.',
    precio: 8.99,
    categoria: 'individuales',
    imagen: IMG + '622ba06fa0a3c307390661.PNG',
  },
  {
    id: 'aros-de-cebolla',
    nombre: 'Aros de Cebolla',
    descripcion: 'Orden de Aros de cebolla acompañada de cualquiera de nuestras 5 deliciosas Salsas!',
    precio: 3.99,
    categoria: 'individuales',
    imagen: IMG + '622ba0ac79908227430507.PNG',
  },
  {
    id: 'queso-frito',
    nombre: 'Queso Frito',
    descripcion: '',
    precio: 3.99,
    categoria: 'individuales',
    imagen: IMG + '63c9a5dfe183c359725756.jpeg',
  },

  // ═══ COMBOS 🌭🍟🥤 ═══
  {
    id: 'chilidu',
    nombre: 'ChiliDúo',
    descripcion: '2 ChiliDogs (1 de ellos con cebolla y jalapeños) + 2 Freakie Fries + 1 Orden de Aros de Cebolla',
    precio: 14.99,
    categoria: 'combos',
    imagen: IMG + '663686bf08364667568248.jpg',
  },
  {
    id: 'fancy-fries-combo',
    nombre: 'Fancy Fries Combo',
    descripcion: '4 Hot Dogs + Bandeja de 4 tipos de Papas fritas (para 4 personas) + 4 sodas',
    precio: 18.99,
    categoria: 'combos',
    imagen: IMG + '690fb66a902ef268171841.jpg',
  },
  {
    id: 'freakie-family',
    nombre: 'Freakie Family',
    descripcion: '4 Freakie Dogs + 4 Freakie Fries + 4 Sodas en lata',
    precio: 15.99,
    categoria: 'combos',
    imagen: IMG + '690fab3b8ae31420196853.jpeg',
  },
  {
    id: 'freakie-box',
    nombre: 'Freakie Box',
    descripcion: '3 Freakie Dogs + 3 Ordenes de Papas fritas + 1 Orden de aros de cebolla',
    precio: 14.99,
    categoria: 'combos',
    imagen: IMG + '622ba40981ef5551764078.PNG',
  },
  {
    id: 'combros',
    nombre: 'ComBROS! 🔥',
    descripcion: '4 Freakie Dogs + 2 Freakie Fries + 1 Aros de Cebolla + 2 Sodas',
    precio: 14.99,
    categoria: 'combos',
    imagen: IMG + '690fb68a5e4ea189216463.jpg',
  },
  {
    id: 'combo-trio',
    nombre: 'Combo Trío',
    descripcion: '3 Freakie Dogs 3 Freakie Fries 3 Sodas en lata',
    precio: 11.99,
    categoria: 'combos',
    imagen: IMG + '690fb69a66289682705720.jpg',
  },
  {
    id: 'combo-fancy-duo',
    nombre: 'Combo Fancy Dúo',
    descripcion: '2 FreakieDogs + 2 Bebidas + 1 bandeja de Fancys Mini',
    precio: 10.99,
    categoria: 'combos',
    imagen: IMG + '690fb6eb14027065273719.jpg',
  },
  {
    id: 'combo-duo',
    nombre: 'Combo Dúo',
    descripcion: '2 Freakie Dogs + 2 Freakie Fries + 2 Sodas',
    precio: 7.99,
    categoria: 'combos',
    imagen: IMG + '690fb6a625bd5463986536.jpg',
  },
  {
    id: 'combo-individual',
    nombre: 'Combo Individual',
    descripcion: '1 Freakie Dog + 1 Freakie Fries + 1 Soda en lata',
    precio: 3.99,
    categoria: 'combos',
    imagen: IMG + '690fabcc47938019040179.jpeg',
  },
  {
    id: 'combo-super-freak',
    nombre: 'Combo Super Freak',
    descripcion: '1 Súper Freak + 1 Freakie Fries + 1 Soda',
    precio: 5.99,
    categoria: 'combos',
    imagen: IMG + '690fb701ddfaf018221731.jpg',
  },

  // ═══ BEBIDAS 🥤 ═══
  { id: 'coca-cola',       nombre: 'Coca Cola',       descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'uva',             nombre: 'Uva',             descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'fresca',          nombre: 'Fresca',          descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'fanta',           nombre: 'Fanta',           descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'sprite',          nombre: 'Sprite',          descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'te-de-limon',     nombre: 'Té de Limón',     descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'te-de-frambuesa', nombre: 'Té de Frambuesa', descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'te-de-durazno',   nombre: 'Té de Durazno',   descripcion: '', precio: 1.50, categoria: 'bebidas' },
  { id: 'botella-con-agua', nombre: 'Botella con agua', descripcion: '', precio: 1.50, categoria: 'bebidas' },
]

// ── Info del negocio (sticky header) ──
export const NEGOCIO = {
  nombre: 'Freakie Dogs',
  descripcion: 'Freakie Dogs - Ese extra extraordinario 🌭🔥🌭',
  moneda: 'USD',
  consumoMinimo: 3.98,
  horarios: {
    domingo:   '10:00 - 21:00',
    lunes:     'Cerrado',
    martes:    '10:00 - 21:00',
    miercoles: '10:00 - 21:00',
    jueves:    '10:00 - 21:00',
    viernes:   '10:00 - 22:00',
    sabado:    '10:00 - 22:00',
  },
  // Zonas de cobertura del delivery propio
  zonasDelivery: ['Usulután', 'Soyapango', 'Lourdes', 'Santa Tecla', 'San Salvador'],
}

// ── Banner hero (slider superior) — imágenes reales BuhoPay ──
const BANNER_IMG = 'https://admin.buhopay.com/media/'
export const BANNERS = [
  { id: 'banner-1', imagen: BANNER_IMG + '690fa882d99cf967162707.jpeg' },
  { id: 'banner-2', imagen: BANNER_IMG + '690fa88c23aa0765573933.jpeg' },
  { id: 'banner-3', imagen: BANNER_IMG + '690fa89539d09414957364.jpeg' },
  { id: 'banner-4', imagen: BANNER_IMG + '690fbbcf0eb65891895239.jpg' },
]
