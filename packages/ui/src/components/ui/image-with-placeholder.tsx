import { ImageIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

interface ImageWithPlaceholderProps {
  src?: string
  alt: string
  className?: string
  imgClassName?: string
  placeholderClassName?: string
  fallbackIcon?: React.ReactNode
  onError?: () => void
  onLoad?: () => void
}

export function ImageWithPlaceholder({
  src,
  alt,
  className,
  imgClassName,
  placeholderClassName,
  fallbackIcon,
  onError,
  onLoad
}: ImageWithPlaceholderProps) {
  const imageRef = useRef<HTMLImageElement>(null)
  const onLoadRef = useRef(onLoad)
  const onErrorRef = useRef(onError)
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  onLoadRef.current = onLoad
  onErrorRef.current = onError

  const handleError = () => {
    setHasError(true)
    setIsLoading(false)
    onErrorRef.current?.()
  }

  const handleLoad = () => {
    setIsLoading(false)
    onLoadRef.current?.()
  }

  useLayoutEffect(() => {
    setHasError(false)
    if (!src) {
      setIsLoading(false)
      return
    }
    const node = imageRef.current
    if (node?.complete && node.naturalWidth > 0) {
      setIsLoading(false)
      onLoadRef.current?.()
      return
    }
    setIsLoading(true)
  }, [src])

  // Show placeholder if no src, error occurred, or still loading
  if (!src || hasError) {
    return (
      <div
        className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}
      >
        {fallbackIcon || <ImageIcon className="h-6 w-6" />}
      </div>
    )
  }

  return (
    <div className={cn('relative h-full w-full overflow-hidden', className)}>
      {isLoading && (
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground',
            placeholderClassName
          )}
        >
          {fallbackIcon || <ImageIcon className="h-6 w-6" />}
        </div>
      )}
      <img
        alt={alt}
        className={cn('h-full w-full object-cover', imgClassName, isLoading && 'opacity-0')}
        onError={handleError}
        onLoad={handleLoad}
        ref={imageRef}
        src={src}
      />
    </div>
  )
}
