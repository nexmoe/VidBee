import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ImageWithPlaceholder } from './image-with-placeholder'

interface RemoteImageProps {
  src?: string | null
  alt: string
  className?: string
  placeholderClassName?: string
  fallbackIcon?: React.ReactNode
  loadingIcon?: React.ReactNode
  onError?: () => void
  onLoadingChange?: (loading: boolean) => void
  useCache?: boolean
  cacheResolver?: (url: string) => Promise<string | null | undefined>
  localUrlPrefixes?: string[]
  cacheTimeoutMs?: number
}

const DEFAULT_CACHE_TIMEOUT_MS = 30_000
const DEFAULT_LOCAL_URL_PREFIXES = ['file://', 'data:', 'blob:']

const isHttpUrl = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://')
}

const isLocalUrl = (value: string, prefixes: readonly string[]): boolean => {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return true
    }
  }

  return false
}

export function RemoteImage({
  src,
  alt,
  className,
  placeholderClassName,
  fallbackIcon,
  loadingIcon,
  onError,
  onLoadingChange,
  useCache = true,
  cacheResolver,
  localUrlPrefixes = DEFAULT_LOCAL_URL_PREFIXES,
  cacheTimeoutMs = DEFAULT_CACHE_TIMEOUT_MS
}: RemoteImageProps) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>()
  const [isResolving, setIsResolving] = useState(false)
  const [isImageLoading, setIsImageLoading] = useState(true)

  useEffect(() => {
    let isActive = true

    const resolveSource = async () => {
      const value = src ?? undefined

      if (!value) {
        setResolvedSrc(undefined)
        setIsResolving(false)
        return
      }

      const shouldResolveFromCache =
        useCache &&
        Boolean(cacheResolver) &&
        isHttpUrl(value) &&
        !isLocalUrl(value, localUrlPrefixes)

      if (!shouldResolveFromCache || !cacheResolver) {
        setResolvedSrc(value)
        setIsResolving(false)
        return
      }

      setIsResolving(true)

      let timeoutId = -1

      try {
        const timeoutPromise = new Promise<undefined>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(undefined), cacheTimeoutMs)
        })

        const resolved = await Promise.race([
          cacheResolver(value).then((output) => output ?? undefined),
          timeoutPromise
        ])

        if (!isActive) {
          return
        }

        setResolvedSrc(resolved)
      } catch {
        if (!isActive) {
          return
        }

        setResolvedSrc(undefined)
      } finally {
        if (timeoutId >= 0) {
          window.clearTimeout(timeoutId)
        }
        if (isActive) {
          setIsResolving(false)
        }
      }
    }

    void resolveSource()

    return () => {
      isActive = false
    }
  }, [cacheResolver, cacheTimeoutMs, localUrlPrefixes, src, useCache])

  useEffect(() => {
    if (resolvedSrc) {
      setIsImageLoading(true)
      return
    }

    setIsImageLoading(false)
  }, [resolvedSrc])

  const isLoading = isResolving || isImageLoading

  useEffect(() => {
    onLoadingChange?.(isLoading)
  }, [isLoading, onLoadingChange])

  const defaultLoadingIcon = <Loader2 className="h-6 w-6 animate-spin" />
  const displayLoadingIcon = loadingIcon ?? defaultLoadingIcon

  return (
    <ImageWithPlaceholder
      alt={alt}
      className={className}
      fallbackIcon={isLoading ? displayLoadingIcon : fallbackIcon}
      onError={onError}
      onLoad={() => setIsImageLoading(false)}
      placeholderClassName={placeholderClassName}
      src={resolvedSrc}
    />
  )
}

export type { RemoteImageProps }
