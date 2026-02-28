import { ipcServices } from '@renderer/lib/ipc'
import { useEffect, useState } from 'react'

interface AppInfo {
  appVersion: string
  osVersion: string
}

const DEFAULT_APP_INFO: AppInfo = { appVersion: '', osVersion: '' }
let cachedAppInfo: AppInfo | null = null
let appInfoPromise: Promise<AppInfo> | null = null

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
      console.error('Failed to load app info for feedback links:', error)
      cachedAppInfo = DEFAULT_APP_INFO
    }
    return cachedAppInfo
  })()

  return appInfoPromise
}

export const useAppInfo = (): AppInfo => {
  const [appInfo, setAppInfo] = useState<AppInfo>(DEFAULT_APP_INFO)

  useEffect(() => {
    let isActive = true

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

  return appInfo
}
