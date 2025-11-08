import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Sidebar } from '@renderer/components/ui/sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { TitleBar } from '@renderer/components/ui/title-bar'
import { useAtom } from 'jotai'
import { ThemeProvider } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcEvents, ipcServices } from './lib/ipc'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { Settings } from './pages/Settings'
import { SupportedSites } from './pages/SupportedSites'
import { settingsAtom } from './store/settings'

type Page = 'home' | 'settings' | 'about' | 'sites'

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('home')
  const [platform, setPlatform] = useState<string>('')
  const [settings] = useAtom(settingsAtom)
  const { t } = useTranslation()
  const autoUpdateEnabled = settings.autoUpdate
  const updateDownloadInProgressRef = useRef(false)

  useEffect(() => {
    // Get platform info to determine if we should show title bar
    const getPlatform = async () => {
      try {
        const platformInfo = await ipcServices.app.getPlatform()
        setPlatform(platformInfo)
      } catch (error) {
        console.error('Failed to get platform info:', error)
        // Default to showing title bar if platform detection fails
        setPlatform('unknown')
      }
    }
    getPlatform()
  }, [])

  useEffect(() => {
    if (!window?.api) {
      return
    }

    const showRestartPrompt = () => {
      toast.info(t('about.notifications.restartToUpdate'), {
        action: {
          label: t('about.notifications.restartNowAction'),
          onClick: () => {
            void ipcServices.update.quitAndInstall()
          }
        }
      })
    }

    const resetDownloadState = () => {
      if (updateDownloadInProgressRef.current) {
        updateDownloadInProgressRef.current = false
      }
    }

    const handleGoToDownloadPage = () => {
      if (typeof window !== 'undefined') {
        window.open('https://vidbee.org/download/', '_blank', 'noopener,noreferrer')
      }
    }

    const handleUpdateAvailable = (rawInfo: unknown) => {
      const info = (rawInfo ?? {}) as { version?: string }
      const versionLabel = info.version ?? ''

      if (autoUpdateEnabled) {
        // Update will be downloaded automatically because autoDownload is enabled in main process
        toast.success(t('about.notifications.updateAvailable', { version: versionLabel }), {
          action: {
            label: t('about.actions.goToDownload'),
            onClick: handleGoToDownloadPage
          }
        })
        // No need to manually call downloadUpdate() because autoDownload is true
      } else {
        toast.success(t('about.notifications.updateAvailable', { version: versionLabel }), {
          action: {
            label: t('about.actions.goToDownload'),
            onClick: handleGoToDownloadPage
          }
        })
      }
    }

    const handleUpdateDownloaded = (rawInfo: unknown) => {
      const info = (rawInfo ?? {}) as { version?: string }
      resetDownloadState()

      const versionLabel = info?.version ?? ''
      const downloadedMessage = versionLabel
        ? t('about.notifications.updateDownloadedVersion', { version: versionLabel })
        : t('about.notifications.updateDownloaded')
      toast.success(downloadedMessage)

      showRestartPrompt()
    }

    const handleUpdateError = (rawMessage: unknown) => {
      const message = typeof rawMessage === 'string' ? rawMessage : ''
      resetDownloadState()

      const errorMessage = message || t('about.notifications.unknownErrorFallback')
      toast.error(t('about.notifications.updateError', { error: errorMessage }))
    }

    const handleDownloadProgress = (rawProgress: unknown) => {
      const progress = (rawProgress ?? {}) as { percent?: number }
      if (typeof progress?.percent === 'number') {
        console.info('Update download progress:', progress.percent.toFixed(2))
      }
    }

    const handleUpdateNotification = (rawPayload: unknown) => {
      const payload = (rawPayload ?? {}) as { body?: string; version?: string }
      const versionLabel = payload.version ?? ''
      const downloadedMessage = versionLabel
        ? t('about.notifications.updateDownloadedVersion', { version: versionLabel })
        : t('about.notifications.updateDownloaded')

      toast.info(payload?.body ?? downloadedMessage, {
        action: {
          label: t('about.notifications.restartNowAction'),
          onClick: () => {
            void ipcServices.update.quitAndInstall()
          }
        }
      })
    }

    ipcEvents.on('update:available', handleUpdateAvailable)
    ipcEvents.on('update:downloaded', handleUpdateDownloaded)
    ipcEvents.on('update:error', handleUpdateError)
    ipcEvents.on('update:download-progress', handleDownloadProgress)
    ipcEvents.on('update:show-notification', handleUpdateNotification)

    return () => {
      ipcEvents.removeListener('update:available', handleUpdateAvailable)
      ipcEvents.removeListener('update:downloaded', handleUpdateDownloaded)
      ipcEvents.removeListener('update:error', handleUpdateError)
      ipcEvents.removeListener('update:download-progress', handleDownloadProgress)
      ipcEvents.removeListener('update:show-notification', handleUpdateNotification)
    }
  }, [autoUpdateEnabled, t])

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return (
          <Home
            onOpenSupportedSites={() => setCurrentPage('sites')}
            onOpenSettings={() => setCurrentPage('settings')}
          />
        )
      case 'settings':
        return <Settings />
      case 'about':
        return <About />
      case 'sites':
        return <SupportedSites />
      default:
        return (
          <Home
            onOpenSupportedSites={() => setCurrentPage('sites')}
            onOpenSettings={() => setCurrentPage('settings')}
          />
        )
    }
  }

  return (
    <div className="flex flex-row h-screen">
      {/* Sidebar Navigation */}
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      {/* Main Content */}
      <main className="flex flex-col flex-1 min-h-0 overflow-hidden bg-background">
        {/* Custom Title Bar */}
        <TitleBar platform={platform} />

        <ScrollArea
          className="flex-1 w-full overflow-y-auto overflow-x-hidden"
          style={{ maxWidth: '100%' }}
        >
          <div className="w-full overflow-hidden" style={{ maxWidth: '100%' }}>
            {renderPage()}
          </div>
        </ScrollArea>
      </main>

      <Toaster richColors={true} />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AppContent />
    </ThemeProvider>
  )
}

export default App
