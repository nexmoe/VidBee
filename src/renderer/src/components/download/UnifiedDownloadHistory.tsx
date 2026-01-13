import { Button } from '@renderer/components/ui/button'
import { CardContent, CardHeader } from '@renderer/components/ui/card'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { cn } from '@renderer/lib/utils'
import { useAtomValue, useSetAtom } from 'jotai'
import { History as HistoryIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useHistorySync } from '../../hooks/use-history-sync'
import { ipcServices } from '../../lib/ipc'
import type { DownloadRecord } from '../../store/downloads'
import {
  downloadStatsAtom,
  downloadsArrayAtom,
  removeHistoryRecordsAtom,
  removeHistoryRecordsByPlaylistAtom
} from '../../store/downloads'
import { settingsAtom } from '../../store/settings'
import { ScrollArea } from '../ui/scroll-area'
import { DownloadDialog } from './DownloadDialog'
import { DownloadItem } from './DownloadItem'
import { PlaylistDownloadGroup } from './PlaylistDownloadGroup'

type StatusFilter = 'all' | 'active' | 'completed' | 'error'
type ConfirmAction =
  | { type: 'delete-selected'; ids: string[] }
  | { type: 'delete-playlist'; playlistId: string; title: string; ids: string[] }

const normalizeSavedFileName = (fileName?: string): string | undefined => {
  if (!fileName) {
    return undefined
  }
  const trimmed = fileName.trim()
  if (!trimmed) {
    return undefined
  }
  return trimmed.replace(/\.f\d+(?=\.[^.]+$)/i, '')
}

const generateFilePathCandidates = (
  downloadPath: string,
  title: string,
  format: string,
  savedFileName?: string
): string[] => {
  const normalizedDownloadPath = downloadPath.replace(/\\/g, '/')
  const safeTitle = title.trim() || 'Unknown'

  const savedNameCandidates: string[] = []
  const trimmedSavedFileName = savedFileName?.trim()
  if (trimmedSavedFileName) {
    const normalized = normalizeSavedFileName(trimmedSavedFileName)
    if (normalized) {
      savedNameCandidates.push(normalized)
    }
    if (!normalized || normalized !== trimmedSavedFileName) {
      savedNameCandidates.push(trimmedSavedFileName)
    }
  }

  const candidateFileNames =
    savedNameCandidates.length > 0
      ? savedNameCandidates
      : [`${safeTitle} via VidBee.${format}`, `${safeTitle}.${format}`]
  return Array.from(
    new Set(candidateFileNames.map((fileName) => `${normalizedDownloadPath}/${fileName}`))
  )
}

const tryFileOperation = async (
  paths: string[],
  operation: (filePath: string) => Promise<boolean>
): Promise<boolean> => {
  for (const filePath of paths) {
    const success = await operation(filePath)
    if (success) {
      return true
    }
  }
  return false
}

const getSavedFileExtension = (fileName?: string): string | undefined => {
  const normalized = normalizeSavedFileName(fileName)
  if (!normalized) {
    return undefined
  }
  if (!normalized.includes('.')) {
    return undefined
  }
  const ext = normalized.split('.').pop()
  return ext?.toLowerCase()
}

const resolveDownloadExtension = (download: DownloadRecord): string => {
  const savedExt = getSavedFileExtension(download.savedFileName)
  if (savedExt) {
    return savedExt
  }
  const selectedExt = download.selectedFormat?.ext?.toLowerCase()
  if (selectedExt) {
    return selectedExt
  }
  return download.type === 'audio' ? 'mp3' : 'mp4'
}

interface UnifiedDownloadHistoryProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function UnifiedDownloadHistory({
  onOpenSupportedSites,
  onOpenSettings
}: UnifiedDownloadHistoryProps) {
  const { t } = useTranslation()
  const allRecords = useAtomValue(downloadsArrayAtom)
  const downloadStats = useAtomValue(downloadStatsAtom)
  const removeHistoryRecords = useSetAtom(removeHistoryRecordsAtom)
  const removeHistoryRecordsByPlaylist = useSetAtom(removeHistoryRecordsByPlaylistAtom)
  const settings = useAtomValue(settingsAtom)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [alsoDeleteFiles, setAlsoDeleteFiles] = useState(false)
  const alsoDeleteFilesId = useId()

  useHistorySync()

  const historyRecords = useMemo(
    () => allRecords.filter((record) => record.entryType === 'history'),
    [allRecords]
  )
  const selectedCount = selectedIds.size

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

  const selectableIds = useMemo(
    () =>
      filteredRecords.filter((record) => record.entryType === 'history').map((record) => record.id),
    [filteredRecords]
  )
  const selectableCount = selectableIds.length
  const selectionSummary =
    selectableCount === 0
      ? t('history.selectedCount', { count: selectedCount })
      : t('history.selectionSummary', { selected: selectedCount, total: selectableCount })

  useEffect(() => {
    if (selectedIds.size === 0) {
      return
    }
    const historyIdSet = new Set(historyRecords.map((record) => record.id))
    setSelectedIds((prev) => {
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (historyIdSet.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [historyRecords, selectedIds.size])

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleClearSelection = () => {
    setSelectedIds(new Set())
  }

  const handleRequestDeleteSelected = () => {
    if (selectedIds.size === 0) {
      return
    }
    setConfirmAction({ type: 'delete-selected', ids: Array.from(selectedIds) })
  }

  const handleRequestDeletePlaylist = (playlistId: string, title: string, ids: string[]) => {
    if (ids.length === 0) {
      return
    }
    setConfirmAction({ type: 'delete-playlist', playlistId, title, ids })
  }

  const pruneSelectedIds = (ids: string[]) => {
    if (ids.length === 0) {
      return
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      let changed = false
      ids.forEach((id) => {
        if (next.delete(id)) {
          changed = true
        }
      })
      return changed ? next : prev
    })
  }

  const confirmContent = useMemo(() => {
    if (!confirmAction) {
      return null
    }
    switch (confirmAction.type) {
      case 'delete-selected': {
        return {
          title: t('history.confirmDeleteSelectedTitle'),
          description: t('history.confirmDeleteSelectedDescription', {
            count: confirmAction.ids.length
          }),
          actionLabel: t('history.removeAction')
        }
      }
      case 'delete-playlist': {
        return {
          title: t('history.confirmDeletePlaylistTitle'),
          description: t('history.confirmDeletePlaylistDescription', {
            count: confirmAction.ids.length,
            title: confirmAction.title
          }),
          actionLabel: t('history.removeAction')
        }
      }
      default:
        return null
    }
  }, [confirmAction, t])

  const deleteHistoryFiles = async (records: DownloadRecord[]) => {
    const failedIds: string[] = []
    for (const record of records) {
      if (!record.title) {
        continue
      }
      const downloadPath = record.downloadPath || settings.downloadPath
      if (!downloadPath) {
        continue
      }
      const formatForPath = resolveDownloadExtension(record)
      const filePaths = generateFilePathCandidates(
        downloadPath,
        record.title,
        formatForPath,
        record.savedFileName
      )
      const deleted = await tryFileOperation(filePaths, (filePath) =>
        ipcServices.fs.deleteFile(filePath)
      )
      if (!deleted) {
        failedIds.push(record.id)
      }
    }
    if (failedIds.length > 0) {
      console.warn('Failed to delete some playlist files:', failedIds)
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) {
      return
    }
    setConfirmBusy(true)
    try {
      if (confirmAction.type === 'delete-selected') {
        await ipcServices.history.removeHistoryItems(confirmAction.ids)
        removeHistoryRecords(confirmAction.ids)
        if (alsoDeleteFiles) {
          const idSet = new Set(confirmAction.ids)
          const recordsToDelete = historyRecords.filter((record) => idSet.has(record.id))
          await deleteHistoryFiles(recordsToDelete)
        }
        pruneSelectedIds(confirmAction.ids)
        toast.success(t('notifications.itemsRemoved', { count: confirmAction.ids.length }))
      }
      if (confirmAction.type === 'delete-playlist') {
        const idSet = new Set(confirmAction.ids)
        const playlistRecords = historyRecords.filter((record) => idSet.has(record.id))
        await ipcServices.history.removeHistoryByPlaylistId(confirmAction.playlistId)
        removeHistoryRecordsByPlaylist(confirmAction.playlistId)
        await deleteHistoryFiles(playlistRecords)
        pruneSelectedIds(confirmAction.ids)
        toast.success(
          t('notifications.playlistHistoryRemoved', { count: confirmAction.ids.length })
        )
      }
      setConfirmAction(null)
      setAlsoDeleteFiles(false)
    } catch (error) {
      if (confirmAction.type === 'delete-selected') {
        console.error('Failed to remove selected history items:', error)
        toast.error(t('notifications.itemsRemoveFailed'))
      }
      if (confirmAction.type === 'delete-playlist') {
        console.error('Failed to remove playlist history:', error)
        toast.error(t('notifications.playlistHistoryRemoveFailed'))
      }
    } finally {
      setConfirmBusy(false)
    }
  }

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

  return (
    <div className={cn('flex flex-col h-full')}>
      <CardHeader className="gap-4 p-0 px-6 py-4 z-50 bg-background backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
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
          <div className="flex items-center gap-2">
            <DownloadDialog
              onOpenSupportedSites={onOpenSupportedSites}
              onOpenSettings={onOpenSettings}
            />
          </div>
        </div>
      </CardHeader>
      <ScrollArea className="overflow-y-auto px-6 flex-1">
        <CardContent className="space-y-3 p-0 overflow-x-hidden w-full pb-6">
          {filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 px-6 py-10 text-center text-muted-foreground">
              <HistoryIcon className="h-10 w-10 opacity-50" />
              <p className="text-sm font-medium">{t('download.noItems')}</p>
            </div>
          ) : (
            <div className="space-y-4 w-full">
              {groupedView.order.map((item) => {
                if (item.type === 'single') {
                  return (
                    <DownloadItem
                      key={`${item.record.entryType}:${item.record.id}`}
                      download={item.record}
                      isSelected={selectedIds.has(item.record.id)}
                      onToggleSelect={handleToggleSelect}
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
                    selectedIds={selectedIds}
                    onToggleSelect={handleToggleSelect}
                    onDeletePlaylist={handleRequestDeletePlaylist}
                  />
                )
              })}
            </div>
          )}
        </CardContent>
      </ScrollArea>
      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] -translate-x-1/2 sm:left-auto sm:right-6 sm:translate-x-0 sm:w-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-border/50 bg-background/80 pl-5 pr-2 py-2 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{selectionSummary}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={handleClearSelection}
              >
                {t('history.clearSelection')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 rounded-full px-3"
                onClick={handleRequestDeleteSelected}
              >
                {t('history.deleteSelected')}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Dialog
        open={Boolean(confirmAction)}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) {
            setConfirmAction(null)
            setAlsoDeleteFiles(false)
          }
        }}
      >
        {confirmContent && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirmContent.title}</DialogTitle>
              <DialogDescription>{confirmContent.description}</DialogDescription>
            </DialogHeader>
            {confirmAction?.type === 'delete-selected' && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={alsoDeleteFilesId}
                  checked={alsoDeleteFiles}
                  onCheckedChange={(checked) => setAlsoDeleteFiles(checked === true)}
                />
                <label
                  htmlFor={alsoDeleteFilesId}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {t('history.alsoDeleteFiles')}
                </label>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmAction(null)
                  setAlsoDeleteFiles(false)
                }}
                disabled={confirmBusy}
              >
                {t('download.cancel')}
              </Button>
              <Button variant="destructive" onClick={handleConfirmAction} disabled={confirmBusy}>
                {confirmContent.actionLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
