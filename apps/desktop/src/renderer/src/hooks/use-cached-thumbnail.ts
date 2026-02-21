import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import { useEffect, useState } from 'react'
import { ipcServices } from '../lib/ipc'

export const useCachedThumbnail = (url?: string | null): string | undefined => {
  const [cachedUrl, setCachedUrl] = useState<string | undefined>()

  useEffect(() => {
    let isActive = true

    const loadThumbnail = async () => {
      if (!url) {
        setCachedUrl(undefined)
        return
      }

      if (
        url.startsWith(APP_PROTOCOL_SCHEME) ||
        url.startsWith('file://') ||
        url.startsWith('data:')
      ) {
        setCachedUrl(url)
        return
      }

      try {
        const localUrl = await ipcServices.thumbnail.getThumbnailPath(url)
        if (!isActive) {
          return
        }
        setCachedUrl(localUrl ?? undefined)
      } catch (error) {
        console.error('Failed to load cached thumbnail:', error)
        if (!isActive) {
          return
        }
        setCachedUrl(undefined)
      }
    }

    void loadThumbnail()

    return () => {
      isActive = false
    }
  }, [url])

  return cachedUrl
}
