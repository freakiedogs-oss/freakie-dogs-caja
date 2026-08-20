import { createRoot } from 'react-dom/client'
import PorcionadorApp from './PorcionadorApp'
import '../styles/global.css'

const root = document.getElementById('porcionador-root')
createRoot(root).render(<PorcionadorApp />)
