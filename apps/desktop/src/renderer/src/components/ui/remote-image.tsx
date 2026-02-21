import { APP_PROTOCOL_SCHEME } from '@shared/constants'
import {
  RemoteImage as SharedRemoteImage,
  type RemoteImageProps as SharedRemoteImageProps
} from '@vidbee/ui/components/ui/remote-image'
import { useCallback } from 'react'
import { ipcServices } from '../../lib/ipc'

type RemoteImageProps = Omit<SharedRemoteImageProps, 'cacheResolver' | 'localUrlPrefixes'>

const desktopLocalPrefixes = [APP_PROTOCOL_SCHEME, 'file://', 'data:', 'blob:']

export function RemoteImage(props: RemoteImageProps) {
  const cacheResolver = useCallback(async (url: string): Promise<string | undefined> => {
    try {
      const localPath = await ipcServices.thumbnail.getThumbnailPath(url)
      return localPath ?? undefined
    } catch {
      return undefined
    }
  }, [])

  return (
    <SharedRemoteImage
      cacheResolver={cacheResolver}
      localUrlPrefixes={desktopLocalPrefixes}
      {...props}
    />
  )
}
