import { useTranslation } from 'react-i18next'
import type { DownloadRecord } from '../../store/downloads'
import { DownloadItem } from './DownloadItem'

interface PlaylistDownloadGroupProps {
  groupId: string
  title: string
  records: DownloadRecord[]
  totalCount: number
}

export function PlaylistDownloadGroup({
  groupId,
  title,
  records,
  totalCount
}: PlaylistDownloadGroupProps) {
  const { t } = useTranslation()

  const completedCount = records.filter((record) => record.status === 'completed').length
  const errorCount = records.filter((record) => record.status === 'error').length
  const activeCount = records.filter((record) =>
    ['downloading', 'processing', 'pending'].includes(record.status)
  ).length

  const displayTitle = title || t('playlist.untitled')

  return (
    <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{displayTitle}</p>
          <p className="text-xs text-muted-foreground">
            {t('playlist.groupSummary', { completed: completedCount, total: totalCount })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {activeCount > 0 && <span>{t('playlist.groupActive', { count: activeCount })}</span>}
          {errorCount > 0 && (
            <span className="text-destructive">
              {t('playlist.groupErrors', { count: errorCount })}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {records.map((record) => (
          <div
            key={`${groupId}:${record.entryType}:${record.id}`}
            className="border-l border-border/50 pl-3"
          >
            <DownloadItem download={record} />
          </div>
        ))}
      </div>
    </div>
  )
}
