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
import { DownloadEmptyState } from '@vidbee/ui/components/ui/download-empty-state'
import {
  DownloadFilterBar,
  type DownloadFilterItem
} from '@vidbee/ui/components/ui/download-filter-bar'
import { DownloadSelectionToolbar } from '@vidbee/ui/components/ui/download-selection-toolbar'
import { ListMarqueeBox } from '@vidbee/ui/components/ui/list-marquee-box'
import {
  ALL_DOWNLOAD_PLATFORM_FILTER,
  downloadPlatformDisplayLabel,
  listDownloadPlatformCounts,
  matchesDownloadPlatformFilter
} from '@vidbee/ui/lib/download-platform'
import { useListMarqueeSelection } from '@vidbee/ui/lib/use-list-marquee'
import { useAtomValue, useSetAtom } from 'jotai'
import { Layers } from 'lucide-react'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  buildFilePathCandidates,
  normalizeSavedFileName
} from '../../../../shared/utils/download-file'
import { ipcServices } from '../../lib/ipc'
import { logger } from '../../lib/logger'
import { buildTranscriptPlaybackInput } from '../../lib/transcript-playback-source'
import { flyCoverToPlaylistButton } from '../../lib/transcript-playlist-fly'
import type { DownloadRecord } from '../../store/downloads'
import {
  downloadsArrayAtom,
  removeHistoryRecordsAtom,
  removeHistoryRecordsByPlaylistAtom
} from '../../store/downloads'
import { settingsAtom } from '../../store/settings'
import { takePlaybackSessionAtom } from '../../store/transcript-playback'
import { addPlaybackPlaylistItemsAtom } from '../../store/transcript-playlist'
import { transcriptMapAtom } from '../../store/transcripts'
import { ScrollArea } from '../ui/scroll-area'
import { DownloadDialog } from './DownloadDialog'
import { DownloadItem } from './DownloadItem'
import { PlaylistDownloadGroup } from './PlaylistDownloadGroup'

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
  topContent?: ReactNode
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
  onOpenCookiesSettings?: () => void
}

export function UnifiedDownloadHistory({
  topContent,
  onOpenSupportedSites,
  onOpenSettings,
  onOpenCookiesSettings
}: UnifiedDownloadHistoryProps) {
  const { t } = useTranslation()
  const allRecords = useAtomValue(downloadsArrayAtom)
  const removeHistoryRecords = useSetAtom(removeHistoryRecordsAtom)
  const removeHistoryRecordsByPlaylist = useSetAtom(removeHistoryRecordsByPlaylistAtom)
  const addPlaylistItems = useSetAtom(addPlaybackPlaylistItemsAtom)
  const takePlaybackSession = useSetAtom(takePlaybackSessionAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const settings = useAtomValue(settingsAtom)
  const [platformFilter, setPlatformFilter] = useState(ALL_DOWNLOAD_PLATFORM_FILTER)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const { finishPointer, marquee, onPointerDown, onPointerMove } = useListMarqueeSelection({
    containerRef: listRef,
    onSelectIds: (ids) => {
      setSelectedIds(new Set(ids))
    },
    selectedIds
  })
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

  const historyRecords = useMemo(
    () => allRecords.filter((record) => record.entryType === 'history'),
    [allRecords]
  )
  const selectedCount = selectedIds.size

  const platformCounts = useMemo(
    () => listDownloadPlatformCounts(allRecords.map((record) => record.url)),
    [allRecords]
  )

  const filteredRecords = useMemo(() => {
    return allRecords.filter((record) => matchesDownloadPlatformFilter(record.url, platformFilter))
  }, [allRecords, platformFilter])

  const visibleHistoryIds = useMemo(
    () =>
      filteredRecords.filter((record) => record.entryType === 'history').map((record) => record.id),
    [filteredRecords]
  )

  const filters = useMemo((): DownloadFilterItem<string>[] => {
    const items: DownloadFilterItem<string>[] = [
      {
        key: ALL_DOWNLOAD_PLATFORM_FILTER,
        label: t('download.all'),
        count: allRecords.length,
        icon: <Layers className="size-3.5" />
      }
    ]
    for (const platform of platformCounts) {
      items.push({
        key: platform.key,
        label: downloadPlatformDisplayLabel(platform, {
          local: t('download.localSource'),
          other: t('download.otherSource')
        }),
        count: platform.count,
        domain: platform.domain
      })
    }
    return items
  }, [allRecords.length, platformCounts, t])

  useEffect(() => {
    if (platformFilter === ALL_DOWNLOAD_PLATFORM_FILTER) {
      return
    }
    if (platformCounts.some((platform) => platform.key === platformFilter)) {
      return
    }
    setPlatformFilter(ALL_DOWNLOAD_PLATFORM_FILTER)
  }, [platformCounts, platformFilter])

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
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const selectionSummary = t('history.selectedCount', { count: selectedCount })

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

  /**
   * Select every selectable row, or clear the selection when already complete.
   */
  const handleToggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
      return
    }
    if (selectableIds.length === 0) {
      return
    }
    setSelectedIds(new Set(selectableIds))
  }

  const handleRequestDeleteSelected = () => {
    if (selectedIds.size === 0) {
      return
    }
    setConfirmAction({ type: 'delete-selected', ids: Array.from(selectedIds) })
  }

  /**
   * Queue the selected downloads and start the first playable item.
   */
  const handleAddSelectedToPlaylist = (): void => {
    const selectedInOrder = selectableIds.filter((id) => selectedIds.has(id))
    if (selectedInOrder.length === 0) {
      return
    }
    addPlaylistItems(selectedInOrder)
    const recordsById = new Map(historyRecords.map((record) => [record.id, record]))
    const firstPlayable = selectedInOrder
      .map((id) => recordsById.get(id) ?? null)
      .find((record) => {
        if (!record) {
          return false
        }
        return Boolean(
          buildTranscriptPlaybackInput({
            download: record,
            downloadId: record.id,
            fallbackTitle: record.title,
            snapshot: transcriptMap[record.id] ?? null
          }).filePath
        )
      })
    if (firstPlayable) {
      const playbackInput = buildTranscriptPlaybackInput({
        download: firstPlayable,
        downloadId: firstPlayable.id,
        fallbackTitle: firstPlayable.title,
        snapshot: transcriptMap[firstPlayable.id] ?? null
      })
      takePlaybackSession(playbackInput)
      const row = listRef.current?.querySelector(`[data-download-id="${firstPlayable.id}"]`)
      const image = row?.querySelector('img')
      flyCoverToPlaylistButton({
        from: row?.querySelector('.aspect-video')?.getBoundingClientRect() ?? null,
        src: image?.currentSrc || image?.src || firstPlayable.thumbnail || null
      })
    }
    toast.success(t('transcript.player.playlist.addedCount', { count: selectedInOrder.length }))
    setSelectedIds(new Set())
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
      logger.warn('Failed to delete some playlist files:', failedIds)
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
        logger.error('Failed to remove selected history items:', error)
        toast.error(t('notifications.itemsRemoveFailed'))
      }
      if (confirmAction.type === 'delete-playlist') {
        logger.error('Failed to remove playlist history:', error)
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
        <DownloadFilterBar
          actions={
            <DownloadDialog
              onOpenSettings={onOpenSettings}
              onOpenSupportedSites={onOpenSupportedSites}
            />
          }
          activeFilter={platformFilter}
          filters={filters}
          onFilterChange={setPlatformFilter}
          overflowLabel={t('download.morePlatforms')}
        />
      </CardHeader>
      <ScrollArea className="flex-1 overflow-y-auto">
        <CardContent className="w-full space-y-3 overflow-x-hidden p-0">
          {topContent}
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
            <DownloadEmptyState
              className="mx-6 mb-4"
              hint={t('download.ingestEmptyHint')}
              message={t('download.noItems')}
            />
          ) : (
            <div
              className={cn('relative w-full pb-4', marquee && 'select-none')}
              onPointerCancel={finishPointer}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              ref={listRef}
            >
              {marquee ? <ListMarqueeBox marquee={marquee} /> : null}
              {groupedView.order.map((item) => {
                if (item.type === 'single') {
                  return (
                    <DownloadItem
                      download={item.record}
                      isSelected={selectedIds.has(item.record.id)}
                      key={`${item.record.entryType}:${item.record.id}`}
                      onToggleSelect={handleToggleSelect}
                      selectionActive={selectedCount > 0}
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
                    selectionActive={selectedCount > 0}
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
        <div className="fixed bottom-[calc(1rem+var(--playback-bar-height,0px))] left-1/2 z-40 -translate-x-1/2 sm:right-6 sm:left-auto sm:translate-x-0">
          <DownloadSelectionToolbar
            addToPlaylistLabel={t('transcript.player.playlist.add')}
            allSelected={allSelected}
            clearLabel={t('history.clearSelection')}
            countLabel={selectionSummary}
            deleteLabel={t('history.deleteSelected')}
            onAddToPlaylist={handleAddSelectedToPlaylist}
            onDelete={handleRequestDeleteSelected}
            onToggleSelectAll={handleToggleSelectAll}
            selectAllLabel={t('history.selectAll')}
          />
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
