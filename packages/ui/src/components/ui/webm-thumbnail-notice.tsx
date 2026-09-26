import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

interface WebmThumbnailNoticeProps {
  container?: string | null
  className?: string
}

/**
 * Explain that an explicit WebM container cannot embed cover art.
 * VidBee writes a separate thumbnail file instead; MP4 and MKV can embed it.
 */
export function WebmThumbnailNotice({ container, className }: WebmThumbnailNoticeProps) {
  const { t } = useTranslation()
  if (container !== 'webm') {
    return null
  }

  return (
    <p className={cn('text-muted-foreground text-xs', className)} role="status">
      {t('settings.embedThumbnailWebmUnsupported')}
    </p>
  )
}
