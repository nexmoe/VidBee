import { RemoteImageProvider } from '@renderer/components/ui/remote-image'
import { TitleBar } from '@renderer/components/ui/title-bar'
import { RouterProvider } from '@tanstack/react-router'
import { ShapeProvider } from '@vidbee/ui/lib/shape-context'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState } from 'react'
import { ErrorBoundary } from './components/error/ErrorBoundary'
import { KernelPreparationScreen } from './components/kernel/KernelPreparationScreen'
import { ipcServices } from './lib/ipc'
import { logger } from './lib/logger'
import { desktopRouter } from './router'
import { useYtDlpKernelStatus } from './store/ytdlp-kernel'

/**
 * Keep download features unmounted until the managed kernel is usable.
 */
function KernelGate() {
  const [platform, setPlatform] = useState('')
  const { retry, status } = useYtDlpKernelStatus()

  useEffect(() => {
    window.api?.send('app:renderer-ready')
  }, [])

  useEffect(() => {
    void ipcServices.app
      .getPlatform()
      .then(setPlatform)
      .catch((error) => {
        logger.error('Failed to get platform:', error)
        setPlatform('unknown')
      })
  }, [])

  if (!status.ready) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <TitleBar platform={platform} />
        <KernelPreparationScreen onRetry={retry} status={status} />
      </div>
    )
  }

  return <RouterProvider context={{ platform }} router={desktopRouter} />
}

/**
 * Provide global renderer boundaries and theme state.
 */
function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ShapeProvider defaultShape="rounded">
          <RemoteImageProvider>
            <KernelGate />
          </RemoteImageProvider>
        </ShapeProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
