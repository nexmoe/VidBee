'use client'

import { Globe } from 'lucide-react'
import { useCallback, useState } from 'react'
import { cn } from '../../lib/cn'
import { RemoteImage } from './remote-image'

interface DownloadPlatformIconProps {
  className?: string
  domain?: string | null
}

/**
 * Host only: drop paths and keep a lowercase DNS name.
 */
const normalizePlatformDomain = (domain: string): string => {
  const trimmed = domain.trim().toLowerCase()
  const host = trimmed.split('/')[0]?.trim()
  return host || trimmed
}

/**
 * Origin favicon for a download platform (`https://example.com/favicon.ico`).
 */
export const buildPlatformIconUrl = (domain: string): string => {
  return `https://${normalizePlatformDomain(domain)}/favicon.ico`
}

/**
 * Third-party lookup used only when the origin favicon cannot be loaded.
 */
export const buildPlatformIconFallbackUrl = (domain: string): string => {
  return `https://favicon.im/${encodeURIComponent(normalizePlatformDomain(domain))}`
}

/**
 * Favicon for a download platform; origin `/favicon.ico` first, then favicon.im.
 * Remote hosts go through RemoteImage so Electron CSP can serve a cached copy.
 */
export const DownloadPlatformIcon = ({ className, domain }: DownloadPlatformIconProps) => {
  const [failedDomain, setFailedDomain] = useState<string | null>(null)
  const useFallback = Boolean(domain) && failedDomain === domain

  const handleError = useCallback(() => {
    if (domain) {
      setFailedDomain(domain)
    }
  }, [domain])

  if (!domain) {
    return <Globe aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />
  }
  const globeIcon = <Globe aria-hidden className="size-full text-muted-foreground" />
  return (
    <RemoteImage
      alt=""
      className={cn('size-4 shrink-0 overflow-hidden rounded-[3px] bg-transparent', className)}
      fallbackIcon={globeIcon}
      loadingIcon={globeIcon}
      onError={handleError}
      placeholderClassName="bg-transparent"
      src={useFallback ? buildPlatformIconFallbackUrl(domain) : buildPlatformIconUrl(domain)}
    />
  )
}
