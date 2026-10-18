import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { type DownloadLivePatch, downloadLivePatchesAtom } from '../../store/download-live-patch'
import type { DownloadRecord } from '../../store/downloads'
import { Button } from '../ui/button'
import { Progress } from '../ui/progress'

interface PlaylistDownloadGroupProps {
  expanded: boolean
  groupId: string
  onDeletePlaylist?: (playlistId: string, title: string, ids: string[]) => void
  onToggle: () => void
  records: DownloadRecord[]
  title: string
  totalCount: number
}

/**
 * Sum structural completion with live percents.
 * A finished row counts as 1 and is not also counted from its percent.
 * Overlay percent wins. A restored row with no overlay uses record.progress.
 */
export const aggregatePercent = (
  records: readonly DownloadRecord[],
  patches: ReadonlyMap<string, DownloadLivePatch>,
  totalCount: number
): number => {
  const totalProgress = records.reduce((sum, record) => {
    if (record.status === 'completed') {
      return sum + 1
    }
    const patch = patches.get(record.id)
    const percent = patch?.progress?.percent ?? record.progress?.percent
    if (percent && percent > 0) {
      return sum + Math.min(percent, 100) / 100
    }
    return sum
  }, 0)
  return totalCount > 0 ? Math.min((totalProgress / totalCount) * 100, 100) : 0
}

/**
 * Playlist header. Child rows are rendered by the virtual list, not inside this component.
 */
export function PlaylistDownloadGroup({
  expanded,
  groupId,
  onDeletePlaylist,
  onToggle,
  records,
  title,
  totalCount
}: PlaylistDownloadGroupProps) {
  const { t } = useTranslation()
  const percentAtom = useMemo(
    () =>
      selectAtom(downloadLivePatchesAtom, (patches) =>
        aggregatePercent(records, patches, totalCount)
      ),
    [records, totalCount]
  )
  const percent = useAtomValue(percentAtom)
  const completedCount = records.filter((record) => record.status === 'completed').length
  const errorCount = records.filter((record) => record.status === 'error').length
  const activeCount = records.filter((record) =>
    ['downloading', 'processing', 'pending'].includes(record.status)
  ).length
  const displayTitle = title || t('playlist.untitled')
  const historyRecords = records.filter((record) => record.entryType === 'history')
  const canDeletePlaylist = historyRecords.length > 0 && Boolean(onDeletePlaylist)
  const toggleLabel = expanded ? t('playlist.groupCollapse') : t('playlist.groupExpand')

  return (
    <div className="mx-6 rounded-md bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <button
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 px-3 transition-colors hover:bg-muted/40 active:bg-muted/60"
          onClick={onToggle}
          title={toggleLabel}
          type="button"
        >
          <div className="flex shrink-0 items-center justify-center text-muted-foreground">
            {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate font-medium text-foreground text-sm">{displayTitle}</p>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>
                {t('playlist.collapsedProgress', { completed: completedCount, total: totalCount })}
              </span>
              {activeCount > 0 && (
                <>
                  <span className="text-muted-foreground/50">•</span>
                  <span>{t('playlist.groupActive', { count: activeCount })}</span>
                </>
              )}
              {errorCount > 0 && (
                <>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="text-destructive">
                    {t('playlist.groupErrors', { count: errorCount })}
                  </span>
                </>
              )}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1 pr-3">
          {canDeletePlaylist && (
            <Button
              aria-label={t('history.deletePlaylist')}
              className="h-6 w-6 rounded-full"
              onClick={(event) => {
                event.stopPropagation()
                onDeletePlaylist?.(
                  groupId,
                  displayTitle,
                  historyRecords.map((record) => record.id)
                )
              }}
              size="icon"
              title={t('history.deletePlaylist')}
              type="button"
              variant="ghost"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {!expanded && totalCount > 0 && <Progress className="h-0.5 w-full" value={percent} />}
    </div>
  )
}
