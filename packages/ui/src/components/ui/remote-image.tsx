import { Loader2 } from 'lucide-react'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { ImageWithPlaceholder } from './image-with-placeholder'

interface RemoteImageProps {
  src?: string | null
  alt: string
  className?: string
  imgClassName?: string
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

interface RemoteImageDefaults {
  cacheResolver?: RemoteImageProps['cacheResolver']
  localUrlPrefixes?: string[]
  cacheTimeoutMs?: number
}

interface RemoteImageProviderProps extends RemoteImageDefaults {
  children: ReactNode
}

const DEFAULT_CACHE_TIMEOUT_MS = 30_000
const DEFAULT_LOCAL_URL_PREFIXES = ['file://', 'data:']
const RemoteImageContext = createContext<RemoteImageDefaults>({})

/**
 * Provide default cache resolution for RemoteImage and shared consumers such as
 * DownloadPlatformIcon.
 */
export function RemoteImageProvider({
  children,
  cacheResolver,
  localUrlPrefixes,
  cacheTimeoutMs
}: RemoteImageProviderProps) {
  const value = useMemo(
    () => ({ cacheResolver, localUrlPrefixes, cacheTimeoutMs }),
    [cacheResolver, cacheTimeoutMs, localUrlPrefixes]
  )
  return <RemoteImageContext.Provider value={value}>{children}</RemoteImageContext.Provider>
}

/** True when the URL must be fetched from a remote HTTP(S) host. */
const isHttpUrl = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://')
}

/** True when the renderer can load this URL without a remote fetch. */
const isLocalUrl = (value: string, prefixes: readonly string[]): boolean => {
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) {
      return true
    }
  }

  return false
}

/**
 * Render an image, optionally resolving HTTP URLs through a cache so CSP-limited
 * hosts (Electron) never load the original remote src.
 */
export function RemoteImage({
  src,
  alt,
  className,
  imgClassName,
  placeholderClassName,
  fallbackIcon,
  loadingIcon,
  onError,
  onLoadingChange,
  useCache = true,
  cacheResolver,
  localUrlPrefixes,
  cacheTimeoutMs
}: RemoteImageProps) {
  const defaults = useContext(RemoteImageContext)
  const resolvedCacheResolver = cacheResolver ?? defaults.cacheResolver
  const resolvedLocalUrlPrefixes =
    localUrlPrefixes ?? defaults.localUrlPrefixes ?? DEFAULT_LOCAL_URL_PREFIXES
  const resolvedCacheTimeoutMs =
    cacheTimeoutMs ?? defaults.cacheTimeoutMs ?? DEFAULT_CACHE_TIMEOUT_MS
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

      if (value.startsWith('blob:')) {
        setResolvedSrc(undefined)
        setIsResolving(false)
        return
      }

      const shouldResolveFromCache =
        useCache &&
        Boolean(resolvedCacheResolver) &&
        isHttpUrl(value) &&
        !isLocalUrl(value, resolvedLocalUrlPrefixes)

      if (!(shouldResolveFromCache && resolvedCacheResolver)) {
        setResolvedSrc(value)
        setIsResolving(false)
        return
      }

      setIsResolving(true)

      let timeoutId = -1

      try {
        const timeoutPromise = new Promise<undefined>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(undefined), resolvedCacheTimeoutMs)
        })

        const resolved = await Promise.race([
          resolvedCacheResolver(value).then((output) => output ?? undefined),
          timeoutPromise
        ])

        if (!isActive) {
          return
        }

        if (!resolved) {
          setResolvedSrc(undefined)
          onError?.()
          return
        }

        setResolvedSrc(resolved)
      } catch {
        if (!isActive) {
          return
        }

        setResolvedSrc(undefined)
        onError?.()
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
  }, [
    onError,
    resolvedCacheResolver,
    resolvedCacheTimeoutMs,
    resolvedLocalUrlPrefixes,
    src,
    useCache
  ])

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
    <div data-remote-image={isLoading ? 'pending' : 'ready'} style={{ display: 'contents' }}>
      <ImageWithPlaceholder
        alt={alt}
        className={className}
        fallbackIcon={isLoading ? displayLoadingIcon : fallbackIcon}
        imgClassName={imgClassName}
        onError={onError}
        onLoad={() => setIsImageLoading(false)}
        placeholderClassName={placeholderClassName}
        src={resolvedSrc}
      />
    </div>
  )
}

export type { RemoteImageProps }
