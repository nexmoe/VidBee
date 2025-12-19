import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DownloadRecord } from '../../store/downloads'
import { DownloadItem } from './DownloadItem'
import { Progress } from '../ui/progress'

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
  const [isExpanded, setIsExpanded] = useState(true)

  const completedCount = records.filter((record) => record.status === 'completed').length
  const errorCount = records.filter((record) => record.status === 'error').length
  const activeCount = records.filter((record) =>
    ['downloading', 'processing', 'pending'].includes(record.status)
  ).length

  const displayTitle = title || t('playlist.untitled')
  const toggleLabel = isExpanded ? t('playlist.groupCollapse') : t('playlist.groupExpand')
  const totalProgress = records.reduce((acc, record) => {
    if (record.status === 'completed') {
      return acc + 1
    }
    if (record.progress?.percent && record.progress.percent > 0) {
      return acc + Math.min(record.progress.percent, 100) / 100
    }
    return acc
  }, 0)
  const aggregatePercent =
    totalCount > 0 ? Math.min((totalProgress / totalCount) * 100, 100) : 0

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
          <button
            type="button"
            className="rounded-sm px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
          >
            {toggleLabel}
          </button>
        </div>
      </div>

      {!isExpanded && totalCount > 0 && (
        <div className="space-y-2">
          <Progress value={aggregatePercent} className="h-1.5 w-full" />
          <p className="text-xs text-muted-foreground">
            {t('playlist.collapsedProgress', { completed: completedCount, total: totalCount })}
          </p>
        </div>
      )}

      {isExpanded && (
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
      )}
    </div>
  )
}
