import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DownloadRecord } from '../../store/downloads'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'
import { DownloadItem } from './DownloadItem'

interface PlaylistDownloadGroupProps {
  groupId: string
  title: string
  records: DownloadRecord[]
  totalCount: number
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  onDeletePlaylist?: (playlistId: string, title: string, ids: string[]) => void
}

export function PlaylistDownloadGroup({
  groupId,
  title,
  records,
  totalCount,
  selectedIds,
  onToggleSelect,
  onDeletePlaylist
}: PlaylistDownloadGroupProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(true)

  const completedCount = records.filter((record) => record.status === 'completed').length
  const errorCount = records.filter((record) => record.status === 'error').length
  const activeCount = records.filter((record) =>
    ['downloading', 'processing', 'pending'].includes(record.status)
  ).length

  const displayTitle = title || t('playlist.untitled')
  const historyRecords = records.filter((record) => record.entryType === 'history')
  const canDeletePlaylist = historyRecords.length > 0 && Boolean(onDeletePlaylist)
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
  const aggregatePercent = totalCount > 0 ? Math.min((totalProgress / totalCount) * 100, 100) : 0

  return (
    <div className="space-y-3 rounded-md border border-border/50 bg-background/60 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{displayTitle}</p>
          {isExpanded ? (
            <p className="text-xs text-muted-foreground">
              {t('playlist.groupSummary', { completed: completedCount, total: totalCount })}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('playlist.collapsedProgress', { completed: completedCount, total: totalCount })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {activeCount > 0 && <span>{t('playlist.groupActive', { count: activeCount })}</span>}
          {errorCount > 0 && (
            <span className="text-destructive">
              {t('playlist.groupErrors', { count: errorCount })}
            </span>
          )}
          {canDeletePlaylist && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() =>
                onDeletePlaylist?.(
                  groupId,
                  displayTitle,
                  historyRecords.map((record) => record.id)
                )
              }
              aria-label={t('history.deletePlaylist')}
              title={t('history.deletePlaylist')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <button
            type="button"
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground/70 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {!isExpanded && totalCount > 0 && (
        <div className="space-y-1.5">
          <Progress value={aggregatePercent} className="h-1 w-full" />
        </div>
      )}

      {isExpanded && (
        <div className="space-y-2">
          {records.map((record) => (
            <div key={`${groupId}:${record.entryType}:${record.id}`}>
              <DownloadItem
                download={record}
                isSelected={selectedIds?.has(record.id) ?? false}
                onToggleSelect={onToggleSelect}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
