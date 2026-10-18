import { ipcServices } from '@renderer/lib/ipc'
import { settingsAtom } from '@renderer/store/settings'
import { ytdlpKernelStatusAtom } from '@renderer/store/ytdlp-kernel'
import type { FeedbackAppInfo } from '@vidbee/ui/components/ui/feedback-link-buttons'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { logger } from '../../lib/logger'

interface AppInfo extends FeedbackAppInfo {
  appVersion: string
  osVersion: string
}

const DEFAULT_APP_INFO: AppInfo = { appVersion: '', osVersion: '' }
let cachedAppInfo: AppInfo | null = null
let appInfoPromise: Promise<AppInfo> | null = null

/** Cache the stable application and operating system versions. */
const loadAppInfo = async (): Promise<AppInfo> => {
  if (cachedAppInfo) {
    return cachedAppInfo
  }
  if (appInfoPromise) {
    return appInfoPromise
  }

  appInfoPromise = (async () => {
    try {
      const [version, osRelease] = await Promise.all([
        ipcServices.app.getVersion(),
        ipcServices.app.getOsVersion()
      ])
      cachedAppInfo = { appVersion: version, osVersion: osRelease }
    } catch (error) {
      logger.error('Failed to load app info for feedback links:', error)
      cachedAppInfo = DEFAULT_APP_INFO
    }
    return cachedAppInfo
  })()

  return appInfoPromise
}

/** Add current kernel versions and non-secret download settings to feedback diagnostics. */
export const useAppInfo = (): AppInfo => {
  const [appInfo, setAppInfo] = useState<AppInfo>(DEFAULT_APP_INFO)
  const settings = useAtomValue(settingsAtom)
  const kernel = useAtomValue(ytdlpKernelStatusAtom)

  useEffect(() => {
    let isActive = true

    /** Load stable metadata without updating an unmounted feedback surface. */
    const loadInfo = async () => {
      const info = await loadAppInfo()
      if (isActive) {
        setAppInfo(info)
      }
    }

    void loadInfo()

    return () => {
      isActive = false
    }
  }, [])

  return useMemo(
    () => ({
      ...appInfo,
      diagnostics: {
        platform: window.electron?.process?.platform,
        electronVersion: window.electron?.process?.versions?.electron,
        chromiumVersion: window.electron?.process?.versions?.chrome,
        nodeVersion: window.electron?.process?.versions?.node,
        ytDlpVersion: kernel.ytDlpVersion,
        jsRuntimeVersion: kernel.nodeVersion,
        kernelState: kernel.state,
        kernelSource: kernel.source,
        kernelReady: kernel.ready,
        cookieBrowser: settings.browserForCookies,
        customCookiesFileConfigured: Boolean(settings.cookiesPath),
        proxyConfigured: Boolean(settings.proxy),
        customConfigConfigured: Boolean(settings.configPath),
        maxConcurrentDownloads: settings.maxConcurrentDownloads,
        oneClickQuality: settings.oneClickQuality,
        oneClickContainer: settings.oneClickContainer,
        downloadSubtitles: settings.downloadSubtitles,
        subtitleLanguages: settings.subtitleLanguages?.join(', '),
        embedSubs: settings.embedSubs,
        writeAutoSubs: settings.writeAutoSubs,
        embedThumbnail: settings.embedThumbnail,
        embedMetadata: settings.embedMetadata,
        embedChapters: settings.embedChapters
      }
    }),
    [appInfo, kernel, settings]
  )
}
