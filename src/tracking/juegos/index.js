// Registro de juegos de la pantalla de espera.
// Para sumar uno nuevo (p.ej. Flappy Dog): creá el componente con la misma
// interfaz ({ onGameOver, onScore }) y agregalo acá. El leaderboard ya
// separa las marcas por `id`, así que cada juego tiene su propia tabla.
import { lazy } from 'react'

export const JUEGOS = [
  {
    id: 'hotdog_dash',
    nombre: 'HotDog Dash',
    emoji: '🌭',
    tagline: 'Saltá los conos de la feria',
    Comp: lazy(() => import('./HotDogDash')),
  },
  // { id: 'flappy_dog', nombre: 'Flappy Dog', emoji: '🪽', Comp: lazy(() => import('./FlappyDog')) },
]

export const juegoPorId = (id) => JUEGOS.find(j => j.id === id) || JUEGOS[0]
