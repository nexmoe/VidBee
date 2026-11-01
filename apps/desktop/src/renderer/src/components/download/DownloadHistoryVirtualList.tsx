import { cn } from '@renderer/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ListMarqueeBox } from '@vidbee/ui/components/ui/list-marquee-box'
import { registerDownloadTransferLocator } from '@vidbee/ui/lib/download-transfer-target'
import { isListIgnoreTarget } from '@vidbee/ui/lib/list-marquee'
import { useListMarqueeSelection } from '@vidbee/ui/lib/use-list-marquee'
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { DownloadSelectionModifiers } from '../../hooks/use-download-selection'
import { downloadListGeometryRows, downloadListRowOffset } from '../../lib/download-list-geometry'
import type { DownloadListModel } from '../../lib/download-list-rows'
import { readDownloadListScrollMargin } from '../../lib/download-list-scroll-margin'
import { locateDownloadTransferTarget } from '../../lib/download-transfer-locate'
import { DownloadTaskTree } from './DownloadTaskTree'
import { PlaylistDownloadGroup } from './PlaylistDownloadGroup'

const TASK_ROW_ESTIMATE = 96
const PLAYLIST_ROW_ESTIMATE = 56
const VIRTUAL_OVERSCAN = 8

interface DownloadHistoryVirtualListProps {
  expandPlaylist: (groupId: string) => void
  isPlaylistExpanded: (groupId: string) => boolean
  listRef: RefObject<HTMLDivElement | null>
  model: DownloadListModel
  onContextMenuSelect?: (id: string) => void
  onDeletePlaylist?: (playlistId: string, title: string, ids: string[]) => void
  onSelectIds: (ids: string[]) => void
  onTogglePlaylist: (groupId: string) => void
  onToggleSelect: (id: string, modifiers?: DownloadSelectionModifiers) => void
  prefixRef: RefObject<HTMLDivElement | null>
  selectedIds: Set<string>
  selectionActive: boolean
  selectionContextMenu?: ReactNode
  viewport: HTMLDivElement | null
}

/**
 * Estimate a row before it has been measured.
 */
const estimateRowSize = (row: DownloadListModel['rows'][number] | undefined): number => {
  if (row?.kind === 'playlist') {
    return PLAYLIST_ROW_ESTIMATE
  }
  if (row && row.depth > 0) {
    return 72
  }
  return TASK_ROW_ESTIMATE
}

/**
 * Virtual history list. Only the window around the viewport is mounted.
 */
export function DownloadHistoryVirtualList({
  expandPlaylist,
  isPlaylistExpanded,
  listRef,
  model,
  onContextMenuSelect,
  onDeletePlaylist,
  onSelectIds,
  onTogglePlaylist,
  onToggleSelect,
  prefixRef,
  selectedIds,
  selectionActive,
  selectionContextMenu,
  viewport
}: DownloadHistoryVirtualListProps) {
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const pendingFocusRef = useRef<string | null>(null)
  const { contextIds, locations, matchingIds, rowIndexById, rows } = model
  const locationsRef = useRef(locations)
  const rowIndexRef = useRef(rowIndexById)
  const expandRef = useRef(expandPlaylist)
  const expandedRef = useRef(isPlaylistExpanded)
  locationsRef.current = locations
  rowIndexRef.current = rowIndexById
  expandRef.current = expandPlaylist
  expandedRef.current = isPlaylistExpanded

  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => estimateRowSize(rows[index]),
    getItemKey: (index) => rows[index]?.key ?? index,
    followOnAppend: false,
    getScrollElement: () => viewport,
    overscan: VIRTUAL_OVERSCAN,
    scrollMargin,
    useFlushSync: false
  })
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  useLayoutEffect(() => {
    const list = listRef.current
    if (!(list && viewport)) {
      return
    }
    /**
     * Keep scrollMargin aligned with content above the virtual rows.
     */
    const measure = () => {
      const next = Math.round(readDownloadListScrollMargin(list, viewport))
      setScrollMargin((current) => (current === next ? current : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(list)
    const prefix = prefixRef.current
    if (prefix) {
      observer.observe(prefix)
    }
    return () => observer.disconnect()
  }, [listRef, prefixRef, viewport])

  useEffect(() => {
    return registerDownloadTransferLocator((downloadId, session) =>
      locateDownloadTransferTarget({
        downloadId,
        expandGroup: (groupId) => expandRef.current(groupId),
        getLocation: (id) => locationsRef.current.get(id),
        getRowIndex: (id) => rowIndexRef.current.get(id),
        isGroupExpanded: (groupId) => expandedRef.current(groupId),
        isRowMounted: (id) =>
          Boolean(listRef.current?.querySelector(`[data-download-id="${CSS.escape(id)}"]`)),
        scrollToIndex: (index) => {
          virtualizerRef.current.scrollToIndex(index, { align: 'auto' })
        },
        session
      })
    )
  }, [listRef])

  const geometryRows = useCallback(() => {
    const list = listRef.current
    if (!list) {
      return []
    }
    virtualizer.getTotalSize()
    const rect = list.getBoundingClientRect()
    return downloadListGeometryRows({
      listRect: { left: rect.left, right: rect.right, top: rect.top },
      matchingIds,
      measurements: virtualizer.measurementsCache,
      rows,
      scrollMargin
    })
  }, [listRef, matchingIds, rows, scrollMargin, virtualizer])

  const {
    finishPointer,
    marquee,
    onClickCapture,
    onContextMenuCapture: handleMarqueeContextMenu,
    onPointerDown,
    onPointerMove
  } = useListMarqueeSelection({
    containerRef: listRef,
    geometryRows,
    onSelectIds,
    selectedIds,
    scrollElement: viewport
  })
  const virtualRows = virtualizer.getVirtualItems()
  const navigationIds = useMemo(
    () =>
      rows.flatMap((row) =>
        row.kind === 'task' && row.record.entryType === 'history' && matchingIds.has(row.record.id)
          ? [row.record.id]
          : []
      ),
    [matchingIds, rows]
  )
  const mountedIds = virtualRows.flatMap(({ index }) => {
    const row = rows[index]
    return row?.kind === 'task' && navigationIds.includes(row.record.id) ? [row.record.id] : []
  })
  const tabStopId =
    focusedId && mountedIds.includes(focusedId)
      ? focusedId
      : (mountedIds.find((id) => selectedIds.has(id)) ?? mountedIds[0])

  useLayoutEffect(() => {
    const id = pendingFocusRef.current
    if (!id) {
      return
    }
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-download-id="${CSS.escape(id)}"]`
    )
    if (row) {
      row.focus({ preventScroll: true })
      pendingFocusRef.current = null
    }
  })

  /** Navigate the visual row order and extend selection without entering nested controls. */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.altKey || !(event.target instanceof HTMLElement)) {
      return
    }
    if (event.key === 'Escape') {
      finishPointer()
      return
    }
    const row = event.target.closest<HTMLElement>('[data-download-id]')
    if (event.target !== row && event.target !== event.currentTarget) {
      return
    }
    const id = row?.dataset.downloadId ?? tabStopId
    if (!id || navigationIds.length === 0) {
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      onToggleSelect(id, {
        range: event.shiftKey,
        toggle: !event.shiftKey || event.metaKey || event.ctrlKey
      })
      return
    }
    const currentIndex = navigationIds.indexOf(id)
    let index: number
    switch (event.key) {
      case 'ArrowDown':
        index = Math.min(currentIndex + 1, navigationIds.length - 1)
        break
      case 'ArrowUp':
        index = Math.max(currentIndex - 1, 0)
        break
      case 'Home':
        index = 0
        break
      case 'End':
        index = navigationIds.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const nextId = navigationIds[index]
    setFocusedId(nextId)
    pendingFocusRef.current = nextId
    const rowIndex = rowIndexById.get(nextId)
    if (rowIndex !== undefined) {
      virtualizer.scrollToIndex(rowIndex, { align: 'auto' })
    }
    if (event.shiftKey || !(event.metaKey || event.ctrlKey)) {
      onToggleSelect(nextId, {
        anchorId: id,
        range: event.shiftKey,
        toggle: event.metaKey || event.ctrlKey
      })
    }
  }

  /** Update the selection before a row opens its right-click or overflow menu. */
  const handleContextMenuCapture = (event: MouseEvent<HTMLDivElement>): void => {
    handleMarqueeContextMenu(event)
    if (event.defaultPrevented) {
      return
    }
    if (!(event.target instanceof Element)) {
      return
    }
    const row = event.target.closest<HTMLElement>('[data-download-id]')
    const id = row?.dataset.downloadId
    if (id) {
      onContextMenuSelect?.(id)
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: virtual list group contains rows and independent controls, not form fields
    <div
      className={cn('relative w-full select-none pb-4 outline-none')}
      data-download-scroll-margin={scrollMargin}
      onClickCapture={onClickCapture}
      onContextMenuCapture={handleContextMenuCapture}
      onDragStartCapture={(event) => {
        if (!isListIgnoreTarget(event.target)) {
          event.preventDefault()
        }
      }}
      onFocusCapture={(event) => {
        if (event.target instanceof Element) {
          const id = event.target.closest<HTMLElement>('[data-download-id]')?.dataset.downloadId
          if (id && navigationIds.includes(id)) {
            setFocusedId(id)
          }
        }
      }}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      ref={listRef}
      role="group"
      style={{ height: virtualizer.getTotalSize() }}
      tabIndex={-1}
    >
      {marquee ? <ListMarqueeBox marquee={marquee} /> : null}
      {virtualRows.map((virtualRow) => {
        const row = rows[virtualRow.index]
        if (!row) {
          return null
        }
        return (
          <div
            data-index={virtualRow.index}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            style={{
              left: 0,
              position: 'absolute',
              top: 0,
              transform: `translateY(${downloadListRowOffset(virtualRow.start, scrollMargin)}px)`,
              width: '100%'
            }}
          >
            {row.kind === 'playlist' ? (
              <PlaylistDownloadGroup
                expanded={isPlaylistExpanded(row.groupId)}
                groupId={row.groupId}
                onDeletePlaylist={onDeletePlaylist}
                onToggle={() => onTogglePlaylist(row.groupId)}
                records={row.records}
                title={row.title}
                totalCount={row.totalCount}
              />
            ) : (
              <DownloadTaskTree
                contextIds={contextIds}
                depth={row.depth}
                download={row.record}
                isTabStop={row.record.id === tabStopId}
                matchingIds={matchingIds}
                onToggleSelect={onToggleSelect}
                selectedIds={selectedIds}
                selectionActive={selectionActive}
                selectionContextMenu={selectionContextMenu}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
