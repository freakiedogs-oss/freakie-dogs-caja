import React from 'react'
import ReactDOM from 'react-dom/client'
import POSApp from './POSApp'
import '../styles/global.css'
import './pos.css'

ReactDOM.createRoot(document.getElementById('pos-root')).render(
  <React.StrictMode>
    <POSApp />
  </React.StrictMode>
)
