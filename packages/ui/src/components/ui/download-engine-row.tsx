'use client'

import { LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from './badge'

export interface DownloadEngineStatus {
  ffmpegVersion?: string | null
  nodeVersion?: string | null
  state: string
  ytDlpVersion?: string | null
}

export function DownloadEngineRow({
  actions,
  status,
  versionsKey = 'about.downloadEngine.versions'
}: {
  actions?: ReactNode
  status: DownloadEngineStatus
  versionsKey?: string
}) {
  const { t } = useTranslation()
  const isActive = status.state === 'checking' || status.state === 'installing'
  const statusClassName =
    status.state === 'unavailable'
      ? 'text-destructive'
      : status.state === 'update-available' ||
          status.state === 'bundled-fallback' ||
          status.state === 'retry-scheduled'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-muted-foreground'
  const statusLabelKey = `about.downloadEngine.status.${status.state}`

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-3">
      <div className="space-y-1">
        <p className="font-medium leading-none">{t('about.downloadEngine.title')}</p>
        <p className="text-muted-foreground text-sm">
          {t(versionsKey, {
            ffmpegVersion: status.ffmpegVersion ?? '—',
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
          {t(statusLabelKey, { defaultValue: status.state })}
        </Badge>
        {actions}
      </div>
    </div>
  )
}
