import { useEffect } from 'react'
import { logger } from '../lib/logger'
import {
  getNextDayDelayMs,
  getOrCreateRybbitDeviceUserId,
  trackDailyClientVersion
} from '../lib/rybbit-client'

interface UseRybbitDailyClientVersionOptions {
  appName: string
  enabled: boolean
  isReady: boolean
  platform: string
  version: string
}

export const useRybbitDailyClientVersion = ({
  appName,
  enabled,
  isReady,
  platform,
  version
}: UseRybbitDailyClientVersionOptions): void => {
  useEffect(() => {
    if (!(enabled && isReady && platform && version)) {
      return
    }

    let timeoutId: number | null = null

    const trackVersionSnapshot = (): void => {
      try {
        const userId = getOrCreateRybbitDeviceUserId()
        trackDailyClientVersion({
          appName,
          platform,
          userId,
          version
        })
      } catch (error) {
        logger.error('[renderer] Failed to track daily client version:', error)
      }

      timeoutId = window.setTimeout(trackVersionSnapshot, getNextDayDelayMs())
    }

    trackVersionSnapshot()

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [appName, enabled, isReady, platform, version])
}
