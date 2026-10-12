import React from 'react'

import ReactDOM from 'react-dom/client'

import { reportError } from '@/lib/report-error'

import App from './App'
import './assets/main.css'

window.addEventListener('error', (event) => reportError(event.error))
window.addEventListener('unhandledrejection', (event) => reportError(event.reason))

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
