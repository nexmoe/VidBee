import '@vitejs/plugin-react/preamble'
import './assets/main.css'
import './assets/global.css'

import { isShareCaptureHash } from '@shared/types/share-card'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ShareCapturePage } from './pages/ShareCapture'
import './i18n'
import {
  addRendererBreadcrumb,
  captureRendererException,
  initGlitchTipRenderer
} from './lib/glitchtip'
import { logger } from './lib/logger'

initGlitchTipRenderer()

// Setup global error handlers
setupGlobalErrorHandlers()
setupLongTaskObserver()

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
    captureRendererException(event.error ?? new Error(event.message || 'Unknown window error'), {
      extra: {
        colno: event.colno,
        filename: event.filename,
        lineno: event.lineno,
        url: window.location.href
      },
      tags: {
        source: 'window.error'
      }
    })

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
    captureRendererException(event.reason, {
      extra: {
        url: window.location.href
      },
      tags: {
        source: 'window.unhandledrejection'
      }
    })

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

// Sentry issue VIDBEE-H8: Electron's renderer-unresponsive events arrive without
// a JS stack, so we record long synchronous tasks (>200ms) as breadcrumbs.
// They surface in the next captured event, giving us a hint at which
// component / IPC path is blocking the main thread.
function setupLongTaskObserver(): void {
  const PerformanceObserverCtor =
    typeof window === 'undefined' ? undefined : window.PerformanceObserver
  if (!PerformanceObserverCtor) {
    return
  }

  const supportedTypes = (PerformanceObserverCtor as { supportedEntryTypes?: readonly string[] })
    .supportedEntryTypes
  if (!supportedTypes?.includes('longtask')) {
    return
  }

  const LONG_TASK_BREADCRUMB_THRESHOLD_MS = 200
  try {
    const observer = new PerformanceObserverCtor((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < LONG_TASK_BREADCRUMB_THRESHOLD_MS) {
          continue
        }
        addRendererBreadcrumb(
          'performance',
          'Long renderer task',
          {
            duration_ms: Math.round(entry.duration),
            entry_type: entry.entryType,
            name: entry.name,
            start_time_ms: Math.round(entry.startTime)
          },
          'warning'
        )
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch (error) {
    logger.warn('Failed to install longtask PerformanceObserver:', error)
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}
createRoot(rootElement).render(
  <StrictMode>
    {isShareCaptureHash(window.location.hash) ? <ShareCapturePage /> : <App />}
  </StrictMode>
)
