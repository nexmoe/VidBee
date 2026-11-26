import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import { useEffect, useState } from 'react'
import { ipcEvents, ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'

/** True when the renderer can load this URL without fetching a remote host. */
const isLocalThumbnailUrl = (url: string): boolean => {
  return url.startsWith(APP_PROTOCOL_SCHEME) || url.startsWith('file://') || url.startsWith('data:')
}

/**
 * Resolve a thumbnail to a renderer-safe local URL via the main-process cache.
 */
export const useCachedThumbnail = (url?: string | null): string | undefined => {
  const [cachedUrl, setCachedUrl] = useState<string | undefined>()

  useEffect(() => {
    let isActive = true
    let requestSequence = 0

    if (!url) {
      setCachedUrl(undefined)
      return
    }

    if (url.startsWith('blob:')) {
      setCachedUrl(undefined)
      return
    }

    if (isLocalThumbnailUrl(url)) {
      setCachedUrl(url)
      return
    }

    const loadThumbnail = async () => {
      const request = ++requestSequence
      setCachedUrl(undefined)
      try {
        const localUrl = await ipcServices.thumbnail.getThumbnailPath(url)
        if (!isActive || request !== requestSequence) {
          return
        }
        setCachedUrl(localUrl ?? undefined)
      } catch (error) {
        logger.error('Failed to load cached thumbnail:', error)
        if (!isActive || request !== requestSequence) {
          return
        }
        setCachedUrl(undefined)
      }
    }

    void loadThumbnail()
    const listener = ipcEvents.on('settings:changed', () => void loadThumbnail())

    return () => {
      isActive = false
      ipcEvents.removeListener('settings:changed', listener)
    }
  }, [url])

  return cachedUrl
}
