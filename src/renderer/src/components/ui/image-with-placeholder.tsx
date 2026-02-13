import { cn } from '@renderer/lib/utils'
import { ImageIcon } from 'lucide-react'
import { useState } from 'react'

interface ImageWithPlaceholderProps {
  src?: string
  alt: string
  className?: string
  placeholderClassName?: string
  fallbackIcon?: React.ReactNode
  onError?: () => void
  onLoad?: () => void
}

export function ImageWithPlaceholder({
  src,
  alt,
  className,
  placeholderClassName,
  fallbackIcon,
  onError,
  onLoad
}: ImageWithPlaceholderProps) {
  const [hasError, setHasError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const handleError = () => {
    setHasError(true)
    setIsLoading(false)
    onError?.()
  }

  const handleLoad = () => {
    setIsLoading(false)
    onLoad?.()
  }

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
    <div className={cn('relative h-full w-full', className)}>
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
        className={cn('h-full w-full object-cover', isLoading && 'opacity-0')}
        onError={handleError}
        onLoad={handleLoad}
        src={src}
      />
    </div>
  )
}
