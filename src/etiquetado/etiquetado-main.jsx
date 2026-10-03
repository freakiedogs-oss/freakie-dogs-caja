/* ═══════════════════════════════════════════════════════════════════════
   Entrada de la tablet de pesaje y etiquetado
   freakie-dogs-caja.vercel.app/etiquetado.html

   La tablet está dedicada, cableada a la báscula y a la impresora, y bajo
   control de Casa Matriz. Ya no se pregunta un nombre por día: cada tanda de
   pesaje empieza con el PIN de quien la hace (ver PinModal / EtiquetadoApp), y
   la etiqueta sale a su nombre. Así nadie imprime a nombre de otro por dejar
   una sesión abierta.
   ═══════════════════════════════════════════════════════════════════════ */

import { createRoot } from 'react-dom/client'
import EtiquetadoApp from './EtiquetadoApp'
import '../styles/global.css'

createRoot(document.getElementById('etiquetado-root')).render(<EtiquetadoApp />)
