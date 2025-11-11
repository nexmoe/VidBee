import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCachedThumbnail } from '../../hooks/use-cached-thumbnail'
import { ImageWithPlaceholder } from './image-with-placeholder'

interface RemoteImageProps {
  /**
   * Remote image URL or local file path
   * If it's a remote URL (http/https), it will be cached automatically
   * If it's a local path (file:// or data:), it will be used directly
   */
  src?: string | null
  alt: string
  className?: string
  placeholderClassName?: string
  fallbackIcon?: React.ReactNode
  /**
   * Custom loading icon/indicator
   * @default Loader2 spinner
   */
  loadingIcon?: React.ReactNode
  onError?: () => void
  /**
   * Callback when loading state changes
   */
  onLoadingChange?: (loading: boolean) => void
  /**
   * Whether to use thumbnail cache for remote URLs
   * @default true
   */
  useCache?: boolean
}

/**
 * Unified remote image component with automatic caching support
 *
 * This component automatically handles:
 * - Remote URL caching via thumbnail cache service
 * - Local file paths (file://, data:)
 * - Loading states and error handling
 * - Placeholder display with loading indicator
 *
 * @example
 * ```tsx
 * // Remote URL with automatic caching
 * <RemoteImage src="https://example.com/image.jpg" alt="Example" />
 *
 * // Local file path (no caching)
 * <RemoteImage src="file:///path/to/image.jpg" alt="Local" />
 *
 * // Without cache (direct load)
 * <RemoteImage src="https://example.com/image.jpg" alt="Example" useCache={false} />
 *
 * // Custom loading icon
 * <RemoteImage
 *   src="https://example.com/image.jpg"
 *   alt="Example"
 *   loadingIcon={<CustomSpinner />}
 * />
 *
 * // Track loading state
 * <RemoteImage
 *   src="https://example.com/image.jpg"
 *   alt="Example"
 *   onLoadingChange={(loading) => console.log('Loading:', loading)}
 * />
 * ```
 */
export function RemoteImage({
  src,
  alt,
  className,
  placeholderClassName,
  fallbackIcon,
  loadingIcon,
  onError,
  onLoadingChange,
  useCache = true
}: RemoteImageProps) {
  const shouldUseCache =
    useCache &&
    src &&
    !src.startsWith('file://') &&
    !src.startsWith('data:') &&
    (src.startsWith('http://') || src.startsWith('https://'))

  const cachedSrc = useCachedThumbnail(shouldUseCache ? src : undefined)

  const imageSrc = shouldUseCache ? cachedSrc : (src ?? undefined)

  const [isImageLoading, setIsImageLoading] = useState(true)
  const isCacheLoading = shouldUseCache && src && cachedSrc === undefined
  const isLoading = isCacheLoading || isImageLoading

  useEffect(() => {
    if (imageSrc) {
      setIsImageLoading(true)
    } else {
      setIsImageLoading(false)
    }
  }, [imageSrc])

  useEffect(() => {
    onLoadingChange?.(isLoading)
  }, [isLoading, onLoadingChange])

  const defaultLoadingIcon = <Loader2 className="h-6 w-6 animate-spin" />
  const displayLoadingIcon = loadingIcon ?? defaultLoadingIcon

  return (
    <ImageWithPlaceholder
      src={imageSrc}
      alt={alt}
      className={className}
      placeholderClassName={placeholderClassName}
      fallbackIcon={isLoading ? displayLoadingIcon : fallbackIcon}
      onError={onError}
      onLoad={() => setIsImageLoading(false)}
    />
  )
}
