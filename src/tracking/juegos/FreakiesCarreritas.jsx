// ────────────────────────────────────────────────────────────────────
// Freakies Carreritas — corredor de un botón, tema carnaval.
// El cliente elige con qué corre: hot dog, hamburguesa o papas. Esquiva
// obstáculos y la velocidad sube con el puntaje.
// Controles: tap / click / espacio (saltar). Canvas puro, sin librerías.
// ────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'

export const PERSONAJES = [
  { id: 'hotdog', nombre: 'Hot dog',    emoji: '🌭' },
  { id: 'burger', nombre: 'Hamburguesa', emoji: '🍔' },
  { id: 'papas',  nombre: 'Papas',       emoji: '🍟' },
]

// Coleccionables con fotos reales del menú (sprites de ~4 KB c/u)
const SPRITES = [
  'https://btboxlwfqcbrdfrlnwln.supabase.co/storage/v1/object/public/menu/sprites/freakie-fries.jpg',
  'https://btboxlwfqcbrdfrlnwln.supabase.co/storage/v1/object/public/menu/sprites/aros-de-cebolla.jpg',
  'https://btboxlwfqcbrdfrlnwln.supabase.co/storage/v1/object/public/menu/sprites/queso-frito.jpg',
]
const PUNTOS_COMBO = 25

const SUELO = 0.78          // altura del piso (proporción del alto)
const GRAV = 0.65
const SALTO = -11.6
const V0 = 5.2              // velocidad inicial
const VMAX = 12

export default function FreakiesCarreritas({ onGameOver, onScore, personaje = 'hotdog' }) {
  const cv = useRef(null)
  const api = useRef({})

  useEffect(() => {
    const canvas = cv.current
    const ctx = canvas.getContext('2d')
    let raf, W, H, piso
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      W = r.width; H = r.height
      canvas.width = W * dpr; canvas.height = H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      piso = H * SUELO
    }
    resize()
    window.addEventListener('resize', resize)

    // Precarga de sprites (si falla la red, el juego sigue sin coleccionables)
    const imgs = SPRITES.map(src => { const i = new Image(); i.crossOrigin = 'anonymous'; i.src = src; return i })
    const listo = (i) => i.complete && i.naturalWidth > 0

    // Estado
    let dog, obs, score, vel, t, corriendo, fin, chispas, premios, flotantes
    const reset = () => {
      dog = { x: W * 0.16, y: piso, vy: 0, w: 46, h: 26, enSuelo: true }
      obs = []; score = 0; vel = V0; t = 0; corriendo = true; fin = false; chispas = []
      premios = []; flotantes = []
      onScore?.(0)
    }
    reset()

    const saltar = () => {
      if (fin) return
      if (dog.enSuelo) { dog.vy = SALTO; dog.enSuelo = false }
    }
    api.current = { saltar, reset: () => { reset(); loop() } }

    const nuevoObs = () => {
      const tipo = Math.random() < 0.62 ? 'cono' : 'botella'
      const h = tipo === 'cono' ? 30 + Math.random() * 16 : 34 + Math.random() * 10
      obs.push({ x: W + 20, w: tipo === 'cono' ? 24 : 20, h, tipo })
    }
    let prox = 60
    let proxPremio = 150
    const nuevoPremio = () => {
      const alto = piso - (34 + Math.random() * 58)   // a veces obliga a saltar
      premios.push({ x: W + 24, y: alto, r: 15, img: Math.floor(Math.random() * imgs.length), tomado: false })
    }

    // ── Dibujo ───────────────────────────────────────────────────
    const fondo = () => {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#2b1055'); g.addColorStop(0.55, '#7b2d8e'); g.addColorStop(1, '#e0563f')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)

      // luces de feria (parpadeo suave)
      for (let i = 0; i < 14; i++) {
        const x = ((i * 47 + t * 0.35) % (W + 40)) - 20
        const y = 16 + Math.sin(i * 1.7) * 8
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 0.06 + i)
        ctx.fillStyle = ['#ffd54a', '#ff6b74', '#7ee3c1'][i % 3]
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 7); ctx.fill()
      }
      ctx.globalAlpha = 1

      // banderines
      for (let i = 0; i < 16; i++) {
        const x = ((i * 42 - t * 0.35) % (W + 42)) - 21
        ctx.fillStyle = ['#ffd54a', '#ff6b74', '#7ee3c1', '#fff'][i % 4]
        ctx.beginPath(); ctx.moveTo(x, 26); ctx.lineTo(x + 20, 26); ctx.lineTo(x + 10, 46); ctx.closePath(); ctx.fill()
      }

      // carpa de fondo
      ctx.globalAlpha = 0.22
      const cx = W * 0.72, cy = piso
      ctx.fillStyle = '#fff'
      ctx.beginPath(); ctx.moveTo(cx - 70, cy); ctx.lineTo(cx, cy - 86); ctx.lineTo(cx + 70, cy); ctx.closePath(); ctx.fill()
      ctx.globalAlpha = 1
    }

    const dibujarPiso = () => {
      ctx.fillStyle = '#3b1a2e'; ctx.fillRect(0, piso, W, H - piso)
      const paso = 34
      for (let i = -1; i < W / paso + 2; i++) {
        const x = i * paso - (t * vel * 0.9) % paso
        ctx.fillStyle = i % 2 ? '#e63946' : '#f7f2ea'
        ctx.beginPath(); ctx.moveTo(x, piso); ctx.lineTo(x + paso / 2, piso); ctx.lineTo(x + paso / 2 - 8, piso + 9); ctx.lineTo(x - 8, piso + 9); ctx.closePath(); ctx.fill()
      }
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, piso + 9, W, H - piso - 9)
    }

    // ── Personajes ─────────────────────────────────────────────
    const patitas = (w, h, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 3.4; ctx.lineCap = 'round'
      const fase = dog.enSuelo ? Math.sin(t * 0.55) * 7 : 4
      ctx.beginPath(); ctx.moveTo(w * 0.32, h - 2); ctx.lineTo(w * 0.32 - fase, h + 8)
      ctx.moveTo(w * 0.62, h - 2); ctx.lineTo(w * 0.62 + fase, h + 8); ctx.stroke()
    }
    const carita = (w, ojoX, ojoY) => {
      ctx.fillStyle = '#22140f'
      ctx.beginPath(); ctx.arc(ojoX, ojoY, 2.1, 0, 7); ctx.fill()
      ctx.strokeStyle = '#22140f'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(ojoX - 2, ojoY + 3, 3.4, 0.15, Math.PI - 0.3); ctx.stroke()
    }

    const dibujarHotDog = (w, h) => {
      patitas(w, h, '#f0b27a')
      ctx.fillStyle = '#e8b06b'; redondo(-2, 4, w + 4, h - 4, 11); ctx.fill()
      ctx.fillStyle = '#d1503f'; redondo(1, 0, w - 2, h - 11, 8); ctx.fill()
      ctx.strokeStyle = '#ffd54a'; ctx.lineWidth = 2.6; ctx.beginPath()
      for (let i = 0; i <= 5; i++) {
        const px = 6 + i * ((w - 12) / 5), py = 4 + (i % 2 ? 4 : 0)
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.stroke()
      carita(w, w - 11, 6)
    }

    const dibujarBurger = (w, h) => {
      patitas(w, h, '#e8b06b')
      // pan de abajo
      ctx.fillStyle = '#d99a52'; redondo(0, h - 9, w, 9, 4); ctx.fill()
      // carne
      ctx.fillStyle = '#7b4322'; redondo(1, h - 15, w - 2, 7, 3); ctx.fill()
      // queso asomando
      ctx.fillStyle = '#f6c445'
      ctx.beginPath(); ctx.moveTo(2, h - 15); ctx.lineTo(w - 2, h - 15)
      ctx.lineTo(w - 6, h - 10); ctx.lineTo(w - 11, h - 15); ctx.lineTo(w - 15, h - 10)
      ctx.lineTo(w - 20, h - 15); ctx.closePath(); ctx.fill()
      // lechuga
      ctx.fillStyle = '#5fb85f'
      ctx.beginPath(); ctx.moveTo(1, h - 17)
      for (let i = 0; i < 5; i++) ctx.arc(4 + i * ((w - 8) / 4), h - 18, 3.6, Math.PI, 0)
      ctx.lineTo(w - 1, h - 15); ctx.lineTo(1, h - 15); ctx.closePath(); ctx.fill()
      // pan de arriba + ajonjolí
      ctx.fillStyle = '#e8b06b'
      ctx.beginPath(); ctx.moveTo(0, h - 18); ctx.quadraticCurveTo(w / 2, -3, w, h - 18); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#fff5dc'
      ;[[w * .3, h - 24], [w * .5, h - 27], [w * .68, h - 23]].forEach(([sx, sy]) => {
        ctx.beginPath(); ctx.ellipse(sx, sy, 1.7, 1.1, .4, 0, 7); ctx.fill()
      })
      carita(w, w - 12, h - 21)
    }

    const dibujarPapas = (w, h) => {
      patitas(w, h, '#e8b06b')
      // papas asomando
      ctx.fillStyle = '#f6c445'
      ;[0, 1, 2, 3, 4].forEach(i => {
        const px = 5 + i * ((w - 14) / 4), alto = 13 + (i % 2 ? 6 : 0)
        redondo(px, -alto + 8, 5, alto, 2); ctx.fill()
      })
      // caja a rayas
      ctx.fillStyle = '#e63946'
      ctx.beginPath(); ctx.moveTo(2, 6); ctx.lineTo(w - 2, 6)
      ctx.lineTo(w - 6, h + 2); ctx.lineTo(6, h + 2); ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#f7f2ea'
      for (let i = 0; i < 3; i++) { ctx.fillRect(6 + i * ((w - 12) / 3), 8, 4, h - 6) }
      carita(w, w - 13, 15)
    }

    const dibujarDog = () => {
      const { x, y, w, h } = dog
      const bob = dog.enSuelo ? Math.sin(t * 0.5) * 1.4 : 0
      ctx.save(); ctx.translate(x, y - h + bob)
      if (personaje === 'burger') dibujarBurger(w, h)
      else if (personaje === 'papas') dibujarPapas(w, h)
      else dibujarHotDog(w, h)
      ctx.restore()
    }

    const redondo = (x, y, w, h, r) => {
      ctx.beginPath()
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
    }

    const dibujarObs = (o) => {
      const y = piso - o.h
      if (o.tipo === 'cono') {
        ctx.fillStyle = '#ff6b3d'
        ctx.beginPath(); ctx.moveTo(o.x + o.w / 2, y); ctx.lineTo(o.x + o.w, piso); ctx.lineTo(o.x, piso); ctx.closePath(); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.fillRect(o.x + 3, y + o.h * 0.45, o.w - 6, 5)
      } else {
        ctx.fillStyle = '#ffd54a'
        redondo(o.x, y + 8, o.w, o.h - 8, 5); ctx.fill()
        ctx.fillStyle = '#e8c33a'; ctx.fillRect(o.x + o.w / 2 - 3, y, 6, 9)
      }
    }

    const dibujarPremio = (p) => {
      const im = imgs[p.img]
      ctx.save()
      // aro brillante
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, 7)
      ctx.fillStyle = 'rgba(255,213,74,' + (0.55 + 0.35 * Math.sin(t * 0.15)) + ')'; ctx.fill()
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.closePath(); ctx.clip()
      if (listo(im)) ctx.drawImage(im, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2)
      else { ctx.fillStyle = '#ffd54a'; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2) }
      ctx.restore()
    }

    // ── Loop ─────────────────────────────────────────────────────
    const loop = () => {
      t++
      fondo(); dibujarPiso()

      if (corriendo) {
        // física
        dog.vy += GRAV; dog.y += dog.vy
        if (dog.y >= piso) { dog.y = piso; dog.vy = 0; dog.enSuelo = true }

        // obstáculos
        if (--prox <= 0) { nuevoObs(); prox = Math.max(38, 105 - vel * 4 + Math.random() * 45) }
        obs.forEach(o => { o.x -= vel })
        obs = obs.filter(o => o.x + o.w > -10)

        // colisión (caja del perro un poco perdonadora)
        const dx = dog.x + 5, dy = dog.y - dog.h + 4, dw = dog.w - 10, dh = dog.h - 6
        for (const o of obs) {
          if (dx < o.x + o.w && dx + dw > o.x && dy + dh > piso - o.h + 5) {
            corriendo = false; fin = true
            for (let i = 0; i < 14; i++) chispas.push({ x: dog.x + 20, y: dog.y - 14, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5, c: ['#ffd54a','#ff6b74','#fff'][i % 3] })
            onGameOver?.(Math.floor(score))
            break
          }
        }
        // coleccionables del menú: +25 pts
        if (--proxPremio <= 0) { nuevoPremio(); proxPremio = 190 + Math.random() * 170 }
        premios.forEach(p => { p.x -= vel })
        premios = premios.filter(p => p.x > -30 && !p.tomado)
        const cx = dog.x + dog.w / 2, cy = dog.y - dog.h / 2
        for (const p of premios) {
          if (Math.hypot(cx - p.x, cy - p.y) < p.r + 18) {
            p.tomado = true; score += PUNTOS_COMBO
            flotantes.push({ x: p.x, y: p.y, vida: 40 })
          }
        }
        flotantes.forEach(f2 => { f2.y -= 1.1; f2.vida-- })
        flotantes = flotantes.filter(f2 => f2.vida > 0)

        score += 0.14 * (vel / V0)
        vel = Math.min(VMAX, V0 + score * 0.012)
        if (t % 6 === 0) onScore?.(Math.floor(score))
      }

      obs.forEach(dibujarObs)
      premios.forEach(dibujarPremio)
      dibujarDog()

      // "+25" al agarrar un producto
      ctx.textAlign = 'center'; ctx.font = '800 14px system-ui, sans-serif'
      flotantes.forEach(f2 => {
        ctx.fillStyle = 'rgba(255,213,74,' + Math.min(1, f2.vida / 25) + ')'
        ctx.fillText('+' + PUNTOS_COMBO, f2.x, f2.y)
      })

      // chispas del choque
      chispas.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.35; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 3, 3) })

      // score
      ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = '800 17px system-ui, sans-serif'
      ctx.textAlign = 'right'; ctx.fillText(String(Math.floor(score)).padStart(5, '0'), W - 12, 30)

      if (fin) {
        ctx.fillStyle = 'rgba(20,10,18,.62)'; ctx.fillRect(0, 0, W, H)
        ctx.textAlign = 'center'; ctx.fillStyle = '#fff'
        ctx.font = '900 26px system-ui, sans-serif'; ctx.fillText('¡Chocaste!', W / 2, H / 2 - 8)
        ctx.font = '600 14px system-ui, sans-serif'; ctx.fillStyle = '#ffd54a'
        ctx.fillText(`Marca: ${Math.floor(score)}`, W / 2, H / 2 + 16)
      }
      raf = requestAnimationFrame(loop)
    }
    loop()

    // Controles
    const tap = (e) => { e.preventDefault(); saltar() }
    canvas.addEventListener('pointerdown', tap)
    const tecla = (e) => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); saltar() } }
    window.addEventListener('keydown', tecla)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', tecla)
      canvas.removeEventListener('pointerdown', tap)
    }
  }, [personaje]) // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={cv} className="jg-canvas" onContextMenu={e => e.preventDefault()} />
}


