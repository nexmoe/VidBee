import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { useAtomValue, useSetAtom } from 'jotai'
import { History as HistoryIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHistorySync } from '../../hooks/use-history-sync'
import { clearCompletedAtom, downloadStatsAtom, downloadsArrayAtom } from '../../store/downloads'
import { DownloadItem } from './DownloadItem'

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

  const hasCompletedActive = allRecords.some(
    (item) => item.entryType === 'active' && item.status === 'completed'
  )
  const handleClearCompleted = () => {
    clearCompleted()
  }

  return (
    <Card className="border border-border/60 bg-background max-w-full shadow-sm backdrop-blur-sm">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{t('download.downloadQueue')}</CardTitle>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {hasCompletedActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 border border-border/60 px-3"
                onClick={handleClearCompleted}
              >
                {t('download.clearCompleted')}
              </Button>
            )}
          </div>
        </div>
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
                <span className="ml-1 text-xs opacity-70">({filter.count})</span>
              </Button>
            )
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 overflow-hidden w-full">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 px-6 py-10 text-center text-muted-foreground">
            <HistoryIcon className="h-10 w-10 opacity-50" />
            <p className="text-sm font-medium">{t('download.noItems')}</p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-4 overflow-hidden w-full">
            {filteredRecords.map((record) => (
              <DownloadItem key={`${record.entryType}:${record.id}`} download={record} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
