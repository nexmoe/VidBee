import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import {
  RemoteImage as SharedRemoteImage,
  type RemoteImageProps as SharedRemoteImageProps,
  RemoteImageProvider as SharedRemoteImageProvider
} from '@vidbee/ui/components/ui/remote-image'
import { type ReactNode, useCallback } from 'react'
import { ipcServices } from '../../lib/ipc'

type RemoteImageProps = Omit<SharedRemoteImageProps, 'cacheResolver' | 'localUrlPrefixes'>

const desktopLocalPrefixes = [APP_PROTOCOL_SCHEME, 'file://', 'data:']

/**
 * Resolve a remote image URL to a CSP-safe local thumbnail path.
 */
function useDesktopImageCache() {
  return useCallback(async (url: string): Promise<string | undefined> => {
    try {
      const localPath = await ipcServices.thumbnail.getThumbnailPath(url)
      return localPath ?? undefined
    } catch {
      return undefined
    }
  }, [])
}

/**
 * Provide the desktop thumbnail cache to shared RemoteImage consumers.
 */
export function RemoteImageProvider({ children }: { children: ReactNode }) {
  const cacheResolver = useDesktopImageCache()
  return (
    <SharedRemoteImageProvider
      cacheResolver={cacheResolver}
      localUrlPrefixes={desktopLocalPrefixes}
    >
      {children}
    </SharedRemoteImageProvider>
  )
}

/**
 * Desktop image that caches HTTP URLs through the main-process thumbnail service.
 */
export function RemoteImage(props: RemoteImageProps) {
  const cacheResolver = useDesktopImageCache()

  return (
    <SharedRemoteImage
      cacheResolver={cacheResolver}
      localUrlPrefixes={desktopLocalPrefixes}
      {...props}
    />
  )
}
