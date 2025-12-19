import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Sidebar } from '@renderer/components/ui/sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { TitleBar } from '@renderer/components/ui/title-bar'
import type { SubscriptionRule } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { ThemeProvider } from 'next-themes'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ipcEvents, ipcServices } from './lib/ipc'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { Settings } from './pages/Settings'
import { Subscriptions } from './pages/Subscriptions'
import { loadSettingsAtom, settingsAtom } from './store/settings'
import { loadSubscriptionsAtom, setSubscriptionsAtom } from './store/subscriptions'

type Page = 'home' | 'subscriptions' | 'settings' | 'about'

const pageToPath: Record<Page, string> = {
  home: '/',
  subscriptions: '/subscriptions',
  settings: '/settings',
  about: '/about'
}

const normalizePathname = (pathname: string): string => {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

const pathToPage = (pathname: string): Page => {
  const normalized = normalizePathname(pathname)
  switch (normalized) {
    case '/subscriptions':
      return 'subscriptions'
    case '/settings':
      return 'settings'
    case '/about':
      return 'about'
    default:
      return 'home'
  }
}

function AppContent() {
  const [platform, setPlatform] = useState<string>('')
  const loadSubscriptions = useSetAtom(loadSubscriptionsAtom)
  const setSubscriptions = useSetAtom(setSubscriptionsAtom)
  const [settings] = useAtom(settingsAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const { t } = useTranslation()
  const updateDownloadInProgressRef = useRef(false)
  const analyticsScriptRef = useRef<HTMLScriptElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const currentPage = pathToPage(location.pathname)
  const supportedSitesUrl = 'https://vidbee.org/supported-sites/'

  const handlePageChange = (page: Page) => {
    const targetPath = pageToPath[page] ?? '/'
    if (normalizePathname(location.pathname) !== targetPath) {
      navigate(targetPath)
    }
  }

  const handleOpenSupportedSites = () => {
    window.open(supportedSitesUrl, '_blank')
  }

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    loadSubscriptions()

    const handleSubscriptions = (...args: unknown[]) => {
      const list = args[0]
      if (Array.isArray(list)) {
        setSubscriptions(list as SubscriptionRule[])
      }
    }

    ipcEvents.on('subscriptions:updated', handleSubscriptions)

    return () => {
      ipcEvents.removeListener('subscriptions:updated', handleSubscriptions)
    }
  }, [loadSubscriptions, setSubscriptions])

  // Load or remove analytics script based on settings
  useEffect(() => {
    const scriptId = 'analytics-script'
    const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null

    if (settings.enableAnalytics) {
      // Remove existing script if it exists
      if (existingScript) {
        existingScript.remove()
      }

      // Create and append new script
      const script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://rybbit.102417.xyz/api/script.js'
      script.setAttribute('data-site-id', '7bc6f6d625a4')
      script.defer = true
      script.async = true
      document.head.appendChild(script)
      analyticsScriptRef.current = script
    } else {
      // Remove script if analytics is disabled
      if (existingScript) {
        existingScript.remove()
        analyticsScriptRef.current = null
      }
    }

    return () => {
      // Cleanup on unmount
      const script = document.getElementById(scriptId)
      if (script) {
        script.remove()
      }
    }
  }, [settings.enableAnalytics])

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

    // Only listen to update events that should be shown globally
    // update:available is handled in About page only
    ipcEvents.on('update:downloaded', handleUpdateDownloaded)
    ipcEvents.on('update:error', handleUpdateError)
    ipcEvents.on('update:download-progress', handleDownloadProgress)
    ipcEvents.on('update:show-notification', handleUpdateNotification)

    return () => {
      ipcEvents.removeListener('update:downloaded', handleUpdateDownloaded)
      ipcEvents.removeListener('update:error', handleUpdateError)
      ipcEvents.removeListener('update:download-progress', handleDownloadProgress)
      ipcEvents.removeListener('update:show-notification', handleUpdateNotification)
    }
  }, [t])

  return (
    <div className="flex flex-row h-screen">
      {/* Sidebar Navigation */}
      <Sidebar
        currentPage={currentPage}
        onPageChange={handlePageChange}
        onOpenSupportedSites={handleOpenSupportedSites}
      />

      {/* Main Content */}
      <main className="flex flex-col flex-1 min-h-0 overflow-hidden bg-background">
        {/* Custom Title Bar */}
        <TitleBar platform={platform} />

        <ScrollArea
          className="flex-1 w-full overflow-y-auto overflow-x-hidden"
          style={{ maxWidth: '100%' }}
        >
          <div className="w-full overflow-hidden" style={{ maxWidth: '100%' }}>
            <Routes>
              <Route
                path="/"
                element={
                  <Home
                    onOpenSupportedSites={handleOpenSupportedSites}
                    onOpenSettings={() => handlePageChange('settings')}
                  />
                }
              />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
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
      <HashRouter>
        <AppContent />
      </HashRouter>
    </ThemeProvider>
  )
}

export default App
