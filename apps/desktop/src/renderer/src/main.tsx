import './assets/main.css'
import './assets/global.css'
import 'flag-icons/css/flag-icons.min.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'
import { logger } from './lib/logger'

// Setup global error handlers
setupGlobalErrorHandlers()

// Get app version asynchronously
let appVersion: string | undefined
if (window?.api && window.electron?.ipcRenderer) {
  import('./lib/ipc')
    .then(({ ipcServices }) => ipcServices.app.getVersion())
    .then((version) => {
      appVersion = version
    })
    .catch((err) => {
      logger.warn('Failed to get app version for error reporting:', err)
    })
}

function setupGlobalErrorHandlers(): void {
  // Handle uncaught JavaScript errors
  window.addEventListener('error', (event) => {
    logger.error('Uncaught error:', event.error)

    if (window?.api) {
      try {
        window.api.send('error:renderer', {
          error: {
            name: event.error?.name || 'Error',
            message: event.error?.message || event.message || 'Unknown error',
            stack: event.error?.stack || event.filename
          },
          timestamp: Date.now(),
          context: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            version: appVersion,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
          }
        })
      } catch (err) {
        logger.error('Failed to send error to main process:', err)
      }
    }
  })

  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled promise rejection:', event.reason)

    if (window?.api) {
      try {
        const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))

        window.api.send('error:renderer', {
          error: {
            name: error.name || 'UnhandledPromiseRejection',
            message: error.message || String(event.reason),
            stack: error.stack
          },
          timestamp: Date.now(),
          context: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            version: appVersion
          }
        })
      } catch (err) {
        logger.error('Failed to send error to main process:', err)
      }
    }
  })
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
