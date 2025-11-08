import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { cn } from '@renderer/lib/utils'
import { useAtomValue, useSetAtom } from 'jotai'
import { History as HistoryIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHistorySync } from '../../hooks/use-history-sync'
import type { DownloadRecord } from '../../store/downloads'
import { clearCompletedAtom, downloadStatsAtom, downloadsArrayAtom } from '../../store/downloads'
import { DownloadItem } from './DownloadItem'
import { PlaylistDownloadGroup } from './PlaylistDownloadGroup'

type StatusFilter = 'all' | 'active' | 'completed' | 'error'

export function UnifiedDownloadHistory() {
  const { t } = useTranslation()
  const allRecords = useAtomValue(downloadsArrayAtom)
  const downloadStats = useAtomValue(downloadStatsAtom)
  const clearCompleted = useSetAtom(clearCompletedAtom)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useHistorySync()

  const filteredRecords = useMemo(() => {
    return allRecords.filter((record) => {
      switch (statusFilter) {
        case 'all':
          return true
        case 'active':
          return (
            record.status === 'downloading' ||
            record.status === 'processing' ||
            record.status === 'pending'
          )
        case 'completed':
        case 'error':
          return record.status === statusFilter
        default:
          return true
      }
    })
  }, [allRecords, statusFilter])

  const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: t('download.all'), count: downloadStats.total },
    { key: 'active', label: t('download.active'), count: downloadStats.active },
    { key: 'completed', label: t('download.completed'), count: downloadStats.completed },
    { key: 'error', label: t('download.error'), count: downloadStats.error }
  ]

  const groupedView = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; title: string; totalCount: number; records: DownloadRecord[] }
    >()
    const order: Array<{ type: 'group'; id: string } | { type: 'single'; record: DownloadRecord }> =
      []

    for (const record of filteredRecords) {
      if (record.playlistId) {
        let group = groups.get(record.playlistId)
        if (!group) {
          group = {
            id: record.playlistId,
            title: record.playlistTitle || record.title,
            totalCount: record.playlistSize || 0,
            records: []
          }
          groups.set(record.playlistId, group)
          order.push({ type: 'group', id: record.playlistId })
        }
        group.records.push(record)
        if (!group.title && record.playlistTitle) {
          group.title = record.playlistTitle
        }
        if (!group.totalCount && record.playlistSize) {
          group.totalCount = record.playlistSize
        }
      } else {
        order.push({ type: 'single', record })
      }
    }

    for (const group of groups.values()) {
      group.records.sort((a, b) => {
        const aIndex = a.playlistIndex ?? Number.MAX_SAFE_INTEGER
        const bIndex = b.playlistIndex ?? Number.MAX_SAFE_INTEGER
        if (aIndex !== bIndex) {
          return aIndex - bIndex
        }
        return b.createdAt - a.createdAt
      })
      if (!group.totalCount) {
        group.totalCount = group.records.length
      }
    }

    return { order, groups }
  }, [filteredRecords])

  const hasCompletedActive = allRecords.some(
    (item) => item.entryType === 'active' && item.status === 'completed'
  )
  const handleClearCompleted = () => {
    clearCompleted()
  }

  return (
    <div className="space-y-4">
      <CardHeader className="gap-4 p-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {filters.map((filter) => {
            const isActive = statusFilter === filter.key
            return (
              <Button
                key={filter.key}
                variant={isActive ? 'secondary' : 'ghost'}
                size="sm"
                className={
                  isActive
                    ? 'h-8 rounded-full px-3 shadow-sm'
                    : 'h-8 rounded-full border border-border/60 px-3'
                }
                onClick={() => setStatusFilter(filter.key)}
              >
                <span>{filter.label}</span>
                <span
                  className={cn(
                    'ml-1 min-w-5 rounded-full px-1 text-xs font-medium text-neutral-900',
                    isActive ? ' bg-neutral-100' : ' bg-neutral-200'
                  )}
                >
                  {filter.count}
                </span>
              </Button>
            )
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-0 overflow-hidden w-full">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-muted-foreground">
            <HistoryIcon className="h-10 w-10 opacity-50" />
            <p className="text-sm font-medium">{t('download.noItems')}</p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4 overflow-hidden w-full">
            {groupedView.order.map((item) => {
              if (item.type === 'single') {
                return (
                  <DownloadItem
                    key={`${item.record.entryType}:${item.record.id}`}
                    download={item.record}
                  />
                )
              }

              const group = groupedView.groups.get(item.id)
              if (!group) {
                return null
              }

              return (
                <PlaylistDownloadGroup
                  key={`group:${group.id}`}
                  groupId={group.id}
                  title={group.title}
                  totalCount={group.totalCount}
                  records={group.records}
                />
              )
            })}
          </div>
        )}
      </CardContent>
    </div>
  )
}
