import { cn } from '@renderer/lib/utils'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ListMarqueeBox } from '@vidbee/ui/components/ui/list-marquee-box'
import { registerDownloadTransferLocator } from '@vidbee/ui/lib/download-transfer-target'
import { useListMarqueeSelection } from '@vidbee/ui/lib/use-list-marquee'
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  onDeletePlaylist?: (playlistId: string, title: string, ids: string[]) => void
  onSelectIds: (ids: string[]) => void
  onTogglePlaylist: (groupId: string) => void
  onToggleSelect: (id: string) => void
  prefixRef: RefObject<HTMLDivElement | null>
  selectedIds: Set<string>
  selectionActive: boolean
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
  onDeletePlaylist,
  onSelectIds,
  onTogglePlaylist,
  onToggleSelect,
  prefixRef,
  selectedIds,
  selectionActive,
  viewport
}: DownloadHistoryVirtualListProps) {
  const [scrollMargin, setScrollMargin] = useState(0)
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

  const { finishPointer, marquee, onPointerDown, onPointerMove } = useListMarqueeSelection({
    containerRef: listRef,
    geometryRows,
    onSelectIds,
    selectedIds
  })
  const virtualRows = virtualizer.getVirtualItems()

  return (
    <div
      className={cn('relative w-full pb-4', marquee && 'select-none')}
      data-download-scroll-margin={scrollMargin}
      onPointerCancel={finishPointer}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPointer}
      ref={listRef}
      style={{ height: virtualizer.getTotalSize() }}
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
                matchingIds={matchingIds}
                onToggleSelect={onToggleSelect}
                selectedIds={selectedIds}
                selectionActive={selectionActive}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
