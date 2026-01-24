import { Sidebar } from '@renderer/components/ui/sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { TitleBar } from '@renderer/components/ui/title-bar'
import type { SubscriptionRule } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { ThemeProvider } from 'next-themes'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ErrorBoundary } from './components/error/ErrorBoundary'
import { useDownloadEvents } from './hooks/use-download-events'
import { ipcEvents, ipcServices } from './lib/ipc'
import { About } from './pages/About'
import { Cookies } from './pages/Cookies'
import { Home } from './pages/Home'
import { Settings } from './pages/Settings'
import { Subscriptions } from './pages/Subscriptions'
import { loadSettingsAtom, settingsAtom } from './store/settings'
import { loadSubscriptionsAtom, setSubscriptionsAtom } from './store/subscriptions'
import { updateAvailableAtom, updateReadyAtom } from './store/update'

type Page = 'home' | 'subscriptions' | 'cookies' | 'settings' | 'about'

const pageToPath: Record<Page, string> = {
  home: '/',
  subscriptions: '/subscriptions',
  cookies: '/cookies',
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
    case '/cookies':
      return 'cookies'
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
  const setUpdateReady = useSetAtom(updateReadyAtom)
  const setUpdateAvailable = useSetAtom(updateAvailableAtom)
  const { i18n } = useTranslation()
  const updateDownloadInProgressRef = useRef(false)
  const analyticsScriptRef = useRef<HTMLScriptElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const currentPage = pathToPage(location.pathname)
  const supportedSitesUrl = 'https://vidbee.org/supported-sites/'

  useDownloadEvents()

  const handlePageChange = useCallback(
    (page: Page) => {
      const targetPath = pageToPath[page] ?? '/'
      if (normalizePathname(location.pathname) !== targetPath) {
        navigate(targetPath)
      }
    },
    [location.pathname, navigate]
  )

  const handleOpenCookiesSettings = useCallback(() => {
    navigate('/settings?tab=cookies')
  }, [navigate])

  const handleOpenSupportedSites = () => {
    window.open(supportedSitesUrl, '_blank')
  }

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    const handleDeepLink = (rawUrl: unknown) => {
      const url = typeof rawUrl === 'string' ? rawUrl.trim() : ''
      if (!url) {
        return
      }
      // Switch to home page to show download dialog
      handlePageChange('home')
      // The DownloadDialog component will handle opening the dialog and parsing the video
    }

    ipcEvents.on('download:deeplink', handleDeepLink)
    return () => {
      ipcEvents.removeListener('download:deeplink', handleDeepLink)
    }
  }, [handlePageChange])

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

    const resetDownloadState = () => {
      if (updateDownloadInProgressRef.current) {
        updateDownloadInProgressRef.current = false
      }
    }

    const handleUpdateAvailable = (rawInfo: unknown) => {
      const info = (rawInfo ?? {}) as { version?: string }
      setUpdateAvailable({
        available: true,
        version: info.version
      })
    }

    const handleUpdateDownloaded = (rawInfo: unknown) => {
      const info = (rawInfo ?? {}) as { version?: string }
      resetDownloadState()
      setUpdateReady({
        ready: true,
        version: info.version
      })
      setUpdateAvailable({
        available: true,
        version: info.version
      })

      const versionLabel = info?.version ?? ''
      const downloadedMessage = versionLabel
        ? i18n.t('about.notifications.updateDownloadedVersion', { version: versionLabel })
        : i18n.t('about.notifications.updateDownloaded')
      toast.info(downloadedMessage, {
        action: {
          label: i18n.t('about.notifications.restartNowAction'),
          onClick: () => {
            void ipcServices.update.quitAndInstall()
          }
        }
      })
    }

    const handleUpdateError = (rawMessage: unknown) => {
      const message = typeof rawMessage === 'string' ? rawMessage : ''
      resetDownloadState()

      const errorMessage = message || i18n.t('about.notifications.unknownErrorFallback')
      toast.error(i18n.t('about.notifications.updateError', { error: errorMessage }))
    }

    const handleDownloadProgress = (rawProgress: unknown) => {
      const progress = (rawProgress ?? {}) as { percent?: number }
      if (typeof progress?.percent === 'number') {
        console.info('Update download progress:', progress.percent.toFixed(2))
      }
    }

    // Only listen to update events that should be shown globally
    // update:available shows a visual indicator in the sidebar
    ipcEvents.on('update:available', handleUpdateAvailable)
    ipcEvents.on('update:downloaded', handleUpdateDownloaded)
    ipcEvents.on('update:error', handleUpdateError)
    ipcEvents.on('update:download-progress', handleDownloadProgress)

    return () => {
      ipcEvents.removeListener('update:available', handleUpdateAvailable)
      ipcEvents.removeListener('update:downloaded', handleUpdateDownloaded)
      ipcEvents.removeListener('update:error', handleUpdateError)
      ipcEvents.removeListener('update:download-progress', handleDownloadProgress)
    }
  }, [i18n, setUpdateAvailable, setUpdateReady])

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

        <div className="flex-1 h-full overflow-y-auto overflow-x-hidden">
          <Routes>
            <Route
              path="/"
              element={
                <Home
                  onOpenSupportedSites={handleOpenSupportedSites}
                  onOpenSettings={() => handlePageChange('settings')}
                  onOpenCookiesSettings={handleOpenCookiesSettings}
                />
              }
            />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/cookies" element={<Cookies />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      <Toaster richColors={true} />
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <HashRouter>
          <AppContent />
        </HashRouter>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
