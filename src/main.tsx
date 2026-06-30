import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import './style.css'
import { isMaintenanceMode } from './utils/maintenanceMode'

// Polyfill Buffer for @react-pdf/renderer (only needed when the full app loads)
;(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer

const rootEl = document.getElementById('app')
if (!rootEl) {
  throw new Error('Root element #app not found')
}

const root = createRoot(rootEl)

if (isMaintenanceMode()) {
  void import('./MaintenanceScreen').then(({ MaintenanceScreen }) => {
    root.render(
      <StrictMode>
        <MaintenanceScreen />
      </StrictMode>,
    )
  })
} else {
  void import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
}
