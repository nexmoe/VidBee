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
}

export function ImageWithPlaceholder({
  src,
  alt,
  className,
  placeholderClassName,
  fallbackIcon,
  onError
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
    <div className={cn('relative', className)}>
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
        src={src}
        alt={alt}
        className={cn('w-full h-full object-cover', isLoading && 'opacity-0')}
        onError={handleError}
        onLoad={handleLoad}
      />
    </div>
  )
}
