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
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  buildFilePathCandidates,
  normalizeSavedFileName
} from '../../../../shared/utils/download-file'
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

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target && target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tagName = target.tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

interface UnifiedDownloadHistoryProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
  onOpenCookiesSettings?: () => void
}

export function UnifiedDownloadHistory({
  onOpenSupportedSites,
  onOpenSettings,
  onOpenCookiesSettings
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
  const hasCookieConfig = useMemo(() => {
    const cookiesPath = settings.cookiesPath?.trim()
    if (cookiesPath) {
      return true
    }
    const browserSetting = settings.browserForCookies?.trim()
    return Boolean(browserSetting && browserSetting !== 'none')
  }, [settings.browserForCookies, settings.cookiesPath])
  const showCookiesTip = !hasCookieConfig
  const canOpenCookiesSettings = Boolean(onOpenCookiesSettings ?? onOpenSettings)

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

  const visibleHistoryIds = useMemo(
    () =>
      filteredRecords.filter((record) => record.entryType === 'history').map((record) => record.id),
    [filteredRecords]
  )

  const filters: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: t('download.all'), count: downloadStats.total },
    { key: 'active', label: t('download.active'), count: downloadStats.active },
    { key: 'completed', label: t('download.completed'), count: downloadStats.completed },
    { key: 'error', label: t('download.error'), count: downloadStats.error }
  ]

  const selectableIds = useMemo(() => {
    if (visibleHistoryIds.length === 0) {
      return []
    }
    const ids = new Set(visibleHistoryIds)
    const playlistIds = new Set(
      filteredRecords
        .filter((record) => record.entryType === 'history' && record.playlistId)
        .map((record) => record.playlistId as string)
    )
    if (playlistIds.size === 0) {
      return Array.from(ids)
    }
    for (const record of historyRecords) {
      if (record.playlistId && playlistIds.has(record.playlistId)) {
        ids.add(record.id)
      }
    }
    return Array.from(ids)
  }, [filteredRecords, historyRecords, visibleHistoryIds])
  const selectableCount = selectableIds.length
  const visibleSelectableCount = visibleHistoryIds.length
  const selectionSummary =
    selectableCount === 0
      ? t('history.selectedCount', { count: selectedCount })
      : selectableCount > visibleSelectableCount
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
      const filePaths = buildFilePathCandidates(
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }
      if (isEditableTarget(event.target)) {
        return
      }
      if (event.key === 'Escape') {
        if (confirmAction) {
          return
        }
        if (selectedIds.size === 0) {
          return
        }
        setSelectedIds(new Set())
        return
      }
      if (!(event.metaKey || event.ctrlKey)) {
        return
      }
      if (event.key.toLowerCase() !== 'a') {
        return
      }
      if (selectableIds.length === 0) {
        return
      }
      event.preventDefault()
      setSelectedIds(new Set(selectableIds))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmAction, selectableIds, selectedIds])

  return (
    <div className={cn('flex h-full flex-col')}>
      <CardHeader className="z-50 gap-4 bg-background p-0 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {filters.map((filter) => {
              const isActive = statusFilter === filter.key
              return (
                <Button
                  className={
                    isActive
                      ? 'h-8 rounded-full px-3 shadow-sm'
                      : 'h-8 rounded-full border border-border/60 px-3'
                  }
                  key={filter.key}
                  onClick={() => setStatusFilter(filter.key)}
                  size="sm"
                  variant={isActive ? 'secondary' : 'ghost'}
                >
                  <span>{filter.label}</span>
                  <span
                    className={cn(
                      'ml-1 min-w-5 rounded-full px-1 font-medium text-neutral-900 text-xs',
                      isActive ? 'bg-neutral-100' : 'bg-neutral-200'
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
              onOpenSettings={onOpenSettings}
              onOpenSupportedSites={onOpenSupportedSites}
            />
          </div>
        </div>
      </CardHeader>
      <ScrollArea className="flex-1 overflow-y-auto">
        <CardContent className="w-full space-y-3 overflow-x-hidden p-0">
          {showCookiesTip && (
            <div className="mx-6 mt-4 rounded-xl bg-muted/40 px-6 py-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col items-start gap-2.5">
                  <div className="space-y-1">
                    <p className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
                      {t('history.cookiesTipTitle')}
                    </p>
                    <p className="max-w-[540px] text-foreground/85 text-sm leading-relaxed">
                      <Trans
                        components={{
                          strong: <strong className="font-semibold text-foreground" />
                        }}
                        i18nKey="history.cookiesTipDescription"
                      />
                    </p>
                  </div>
                  <Button
                    className="h-8 rounded-lg px-4 font-medium text-xs"
                    disabled={!canOpenCookiesSettings}
                    onClick={() => {
                      if (onOpenCookiesSettings) {
                        onOpenCookiesSettings()
                        return
                      }
                      onOpenSettings?.()
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    {t('history.cookiesTipCta')}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {filteredRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border/60 border-dashed px-6 py-10 text-center text-muted-foreground">
              <HistoryIcon className="h-10 w-10 opacity-50" />
              <p className="font-medium text-sm">{t('download.noItems')}</p>
            </div>
          ) : (
            <div className="w-full pb-4">
              {groupedView.order.map((item) => {
                if (item.type === 'single') {
                  return (
                    <DownloadItem
                      download={item.record}
                      isSelected={selectedIds.has(item.record.id)}
                      key={`${item.record.entryType}:${item.record.id}`}
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
                    groupId={group.id}
                    key={`group:${group.id}`}
                    onDeletePlaylist={handleRequestDeletePlaylist}
                    onToggleSelect={handleToggleSelect}
                    records={group.records}
                    selectedIds={selectedIds}
                    title={group.title}
                    totalCount={group.totalCount}
                  />
                )
              })}
            </div>
          )}
        </CardContent>
      </ScrollArea>
      {selectedCount > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] -translate-x-1/2 sm:right-6 sm:left-auto sm:w-auto sm:translate-x-0">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-border/50 bg-background/80 py-2 pr-2 pl-5 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">{selectionSummary}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="h-8 rounded-full px-3"
                onClick={handleClearSelection}
                size="sm"
                variant="ghost"
              >
                {t('history.clearSelection')}
              </Button>
              <Button
                className="h-8 rounded-full px-3"
                onClick={handleRequestDeleteSelected}
                size="sm"
                variant="destructive"
              >
                {t('history.deleteSelected')}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!(open || confirmBusy)) {
            setConfirmAction(null)
            setAlsoDeleteFiles(false)
          }
        }}
        open={Boolean(confirmAction)}
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
                  checked={alsoDeleteFiles}
                  id={alsoDeleteFilesId}
                  onCheckedChange={(checked) => setAlsoDeleteFiles(checked === true)}
                />
                <label
                  className="cursor-pointer font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  htmlFor={alsoDeleteFilesId}
                >
                  {t('history.alsoDeleteFiles')}
                </label>
              </div>
            )}
            <DialogFooter>
              <Button
                disabled={confirmBusy}
                onClick={() => {
                  setConfirmAction(null)
                  setAlsoDeleteFiles(false)
                }}
                variant="outline"
              >
                {t('download.cancel')}
              </Button>
              <Button disabled={confirmBusy} onClick={handleConfirmAction} variant="destructive">
                {confirmContent.actionLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
