import { Badge } from '@renderer/components/ui/badge'
import type { YtDlpKernelStatus } from '@shared/types'
import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface DownloadEngineRowProps {
  status: YtDlpKernelStatus
  actions?: ReactNode
}

/**
 * Display the active yt-dlp and Node bundle without exposing update controls.
 * @param props.status Current download-engine readiness and versions
 * @param props.actions Optional trailing actions, such as release notes
 */
export function DownloadEngineRow({ status, actions }: DownloadEngineRowProps) {
  const { t } = useTranslation()
  const isActive = status.state === 'checking' || status.state === 'installing'
  const statusClassName =
    status.state === 'unavailable'
      ? 'text-destructive'
      : status.state === 'bundled-fallback' || status.state === 'retry-scheduled'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-muted-foreground'

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3">
      <div className="space-y-1">
        <p className="font-medium leading-none">{t('about.downloadEngine.title')}</p>
        <p className="text-muted-foreground text-sm">
          {t('about.downloadEngine.versions', {
            nodeVersion: status.nodeVersion ?? '—',
            ytDlpVersion: status.ytDlpVersion ?? '—'
          })}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge
          aria-live="polite"
          className={`gap-1.5 ${statusClassName}`}
          role={isActive ? 'status' : undefined}
          variant="outline"
        >
          {isActive ? (
            <LoaderCircle
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {t(`about.downloadEngine.status.${status.state}`)}
        </Badge>
        {actions}
      </div>
    </div>
  )
}
