import React from 'react'
import ReactDOM from 'react-dom/client'
import PantallaDeError from '../components/ui/PantallaDeError'
import POSApp from './POSApp'
import { ConfirmHost } from './confirmDialog'
import '../styles/global.css'
import './pos.css'

ReactDOM.createRoot(document.getElementById('pos-root')).render(
  <React.StrictMode>
    <PantallaDeError>
      <POSApp />
    </PantallaDeError>
    <ConfirmHost />
  </React.StrictMode>
)
