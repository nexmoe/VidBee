import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { useCachedThumbnail } from '@renderer/hooks/use-cached-thumbnail'
import { formatClock } from '@renderer/lib/format-clock'
import { PLAYBACK_BAR_CONTROL_CLASS, playbackSeekPercent } from '@renderer/lib/transcript-playback'
import {
  buildTranscriptPlaybackInput,
  findDownloadRecord
} from '@renderer/lib/transcript-playback-source'
import { TRANSCRIPT_PLAYLIST_DRAG_TYPE } from '@renderer/lib/transcript-playlist'
import { setPlaylistFlyTarget } from '@renderer/lib/transcript-playlist-fly'
import { cn } from '@renderer/lib/utils'
import { type DownloadRecord, downloadRecordsAtom } from '@renderer/store/downloads'
import {
  closePlaybackSessionAtom,
  playbackClockAtom,
  playbackControlsAtom,
  playbackSessionAtom,
  type TranscriptPlaybackSession,
  takePlaybackSessionAtom
} from '@renderer/store/transcript-playback'
import {
  playbackPlaylistAtom,
  playlistPlaybackProgressAtom,
  removePlaybackPlaylistItemAtom,
  reorderPlaybackPlaylistAtom
} from '@renderer/store/transcript-playlist'
import { type TranscriptSnapshotView, transcriptMapAtom } from '@renderer/store/transcripts'
import { useNavigate } from '@tanstack/react-router'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import {
  ArrowDown,
  ArrowUp,
  FileAudio,
  GripVertical,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  Trash2
} from 'lucide-react'
import { type DragEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const PLAYLIST_REORDER_ANIMATION: KeyframeAnimationOptions = {
  duration: 180,
  easing: 'cubic-bezier(0.77, 0, 0.175, 1)'
}

interface TranscriptPlaylistRowProps {
  downloadId: string
  download: DownloadRecord | null
  index: number
  itemCount: number
  nextId: string | null
  onDragEnd: (event: DragEvent<HTMLElement>) => void
  onDragEnter: (event: DragEvent<HTMLElement>, downloadId: string) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>, downloadId: string) => void
  onDrop: (event: DragEvent<HTMLElement>, downloadId: string) => void
  onOpen: (downloadId: string) => void
  onRemove: (downloadId: string) => void
  onReorder: (activeId: string, overId: string) => void
  previousId: string | null
  session: TranscriptPlaybackSession | null
  snapshot: TranscriptSnapshotView | null
}

/**
 * Draw a compact circular progress ring around a playlist play button.
 */
function PlaylistPlayButton({
  currentTime,
  duration,
  disabled,
  onClick,
  playing
}: {
  currentTime: number
  duration: number
  disabled: boolean
  onClick: () => void
  playing: boolean
}): ReactNode {
  const { t } = useTranslation()
  const percent = playbackSeekPercent(currentTime, duration)
  const label = playing ? t('transcript.player.pause') : t('transcript.player.play')
  return (
    <Button
      aria-label={label}
      className="relative size-9 shrink-0 rounded-full"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 -rotate-90"
        style={{ height: '100%', width: '100%' }}
        viewBox="0 0 36 36"
      >
        <circle
          className="stroke-muted"
          cx="18"
          cy="18"
          fill="none"
          pathLength="100"
          r="16"
          strokeWidth="2"
        />
        <circle
          className="stroke-primary"
          cx="18"
          cy="18"
          fill="none"
          pathLength="100"
          r="16"
          strokeDasharray={`${percent} 100`}
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
      {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
    </Button>
  )
}

/**
 * Render one sortable playlist row with play and removal controls.
 */
function TranscriptPlaylistRow({
  download,
  downloadId,
  index,
  itemCount,
  nextId,
  onDragEnd,
  onDragEnter,
  onDragOver,
  onDragStart,
  onDrop,
  onOpen,
  onRemove,
  onReorder,
  previousId,
  session,
  snapshot
}: TranscriptPlaylistRowProps): ReactNode {
  const { t } = useTranslation()
  const controls = useAtomValue(playbackControlsAtom)
  const clock = useAtomValue(playbackClockAtom)
  const progressMap = useAtomValue(playlistPlaybackProgressAtom)
  const takeSession = useSetAtom(takePlaybackSessionAtom)
  const cachedThumbnail = useCachedThumbnail(download?.thumbnail ?? session?.thumbnail)
  const playbackInput = buildTranscriptPlaybackInput({
    cachedThumbnail,
    download,
    downloadId,
    fallbackTitle: session?.title ?? t('transcript.title'),
    snapshot
  })
  const isCurrent = session?.downloadId === downloadId
  const storedProgress = progressMap[downloadId]
  const currentTime = isCurrent ? clock.currentTime : (storedProgress?.currentTime ?? 0)
  const duration = isCurrent
    ? clock.duration
    : (storedProgress?.duration ?? download?.duration ?? 0)
  const playing = Boolean(isCurrent && clock.playing)
  const mediaLabel = t(playbackInput.isAudio ? 'download.audio' : 'download.video')
  const subtitle = playbackInput.subtitle ?? mediaLabel
  const canPlay = Boolean(playbackInput.filePath)

  /**
   * Play this row immediately, or pause it when it is already current and playing.
   */
  const handlePlay = (): void => {
    if (isCurrent && playing && controls) {
      controls.pause()
      return
    }
    if (isCurrent && controls) {
      controls.play()
    }
    if (canPlay) {
      takeSession(playbackInput)
    }
  }

  /**
   * Move this row one position while preserving the shared reorder logic.
   */
  const moveBy = (offset: number): void => {
    const targetId = offset < 0 ? previousId : nextId
    if (targetId) {
      onReorder(downloadId, targetId)
    }
  }

  return (
    <li
      className={cn(
        'group flex items-center gap-2 px-2 py-2 transition-colors hover:bg-accent/60',
        isCurrent && 'bg-primary/8'
      )}
      data-playlist-id={downloadId}
      onDragEnter={(event) => onDragEnter(event, downloadId)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, downloadId)}
    >
      <span
        aria-label={t('transcript.player.playlist.drag')}
        className="cursor-grab text-muted-foreground/55 active:cursor-grabbing"
        data-playlist-drag-id={downloadId}
        draggable
        onDragEnd={onDragEnd}
        onDragStart={(event) => onDragStart(event, downloadId)}
        role="img"
      >
        <GripVertical className="size-4" />
      </span>
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpen(downloadId)}
        type="button"
      >
        <span className="relative aspect-square size-12 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted">
          <RemoteImage
            alt=""
            className="size-full object-cover"
            fallbackIcon={<FileAudio className="size-4 text-muted-foreground" />}
            src={download?.thumbnail ?? session?.thumbnail ?? undefined}
          />
          {currentTime > 0 && duration > 0 ? (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
              style={{ width: `${playbackSeekPercent(currentTime, duration)}%` }}
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate font-medium text-sm', isCurrent && 'text-primary')}>
            {playbackInput.title}
          </span>
          <span
            className={cn(
              'mt-1 flex min-w-0 items-center gap-1.5 text-xs',
              isCurrent ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <span className="truncate">{subtitle}</span>
            {duration > 0 ? (
              <>
                <span
                  aria-hidden="true"
                  className={cn(
                    'shrink-0',
                    isCurrent ? 'text-primary/45' : 'text-muted-foreground/45'
                  )}
                >
                  ·
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatClock(currentTime)} / {formatClock(duration)}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </button>
      <PlaylistPlayButton
        currentTime={currentTime}
        disabled={!(canPlay || isCurrent)}
        duration={duration}
        onClick={handlePlay}
        playing={playing}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t('transcript.player.playlist.more')}
            className="size-8 shrink-0 rounded-full"
            onClick={(event) => event.stopPropagation()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={index === 0} onSelect={() => moveBy(-1)}>
            <ArrowUp />
            {t('transcript.player.playlist.moveUp')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === itemCount - 1} onSelect={() => moveBy(1)}>
            <ArrowDown />
            {t('transcript.player.playlist.moveDown')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onRemove(downloadId)} variant="destructive">
            <Trash2 />
            {t('transcript.player.playlist.remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/**
 * Open the persisted, sortable playlist from the desktop playback bar.
 */
export function TranscriptPlaylistPopover(): ReactNode {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const playlistIds = useAtomValue(playbackPlaylistAtom)
  const records = useAtomValue(downloadRecordsAtom)
  const transcriptMap = useAtomValue(transcriptMapAtom)
  const session = useAtomValue(playbackSessionAtom)
  const playlistStore = useStore()
  const closeSession = useSetAtom(closePlaybackSessionAtom)
  const removeItem = useSetAtom(removePlaybackPlaylistItemAtom)
  const reorder = useSetAtom(reorderPlaybackPlaylistAtom)
  const takeSession = useSetAtom(takePlaybackSessionAtom)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  const lastOverIdRef = useRef<string | null>(null)
  const listRef = useRef<HTMLOListElement | null>(null)
  const previousRowTopsRef = useRef(new Map<string, number>())
  const rowAnimationsRef = useRef(new Map<string, Animation>())
  useLayoutEffect(() => {
    setPlaylistFlyTarget(triggerRef.current)
    return () => setPlaylistFlyTarget(null)
  }, [])

  const rows = useMemo(
    () =>
      playlistIds.map((downloadId) => ({
        download: findDownloadRecord(records, downloadId),
        downloadId,
        snapshot: transcriptMap[downloadId] ?? null
      })),
    [playlistIds, records, transcriptMap]
  )

  /** Start the requested playlist item when its local media is available. */
  const playPlaylistItem = (downloadId: string): void => {
    const row = rows.find((candidate) => candidate.downloadId === downloadId)
    if (!row) {
      return
    }
    const playbackInput = buildTranscriptPlaybackInput({
      cachedThumbnail: row.download?.thumbnail ?? null,
      download: row.download,
      downloadId,
      fallbackTitle: t('transcript.title'),
      snapshot: row.snapshot
    })
    if (playbackInput.filePath) {
      takeSession(playbackInput)
    }
  }

  /** Keep the first playlist item synchronized with the active player session. */
  const activateFirstPlaylistItem = (firstId: string | null): void => {
    if (firstId && firstId !== session?.downloadId) {
      playPlaylistItem(firstId)
    }
  }

  /** Apply a completed reorder and make its first item the active player session. */
  const handleReorder = (activeId: string, overId: string): void => {
    const firstId = reorder({ activeId, overId })
    activateFirstPlaylistItem(firstId)
  }

  /** Remove an item and keep the new first item synchronized with playback. */
  const handleRemove = (downloadId: string): void => {
    const firstId = removeItem(downloadId)
    if (session?.downloadId !== downloadId) {
      return
    }
    if (firstId) {
      playPlaylistItem(firstId)
      return
    }
    closeSession()
  }

  /** Animate playlist rows from their displayed positions into their new order. */
  useLayoutEffect(() => {
    const list = listRef.current
    if (!(open && list)) {
      for (const animation of rowAnimationsRef.current.values()) {
        animation.cancel()
      }
      rowAnimationsRef.current.clear()
      previousRowTopsRef.current.clear()
      return
    }

    const playlistIdSet = new Set(playlistIds)
    const rowElements = new Map<string, HTMLElement>()
    for (const row of list.querySelectorAll<HTMLElement>('[data-playlist-id]')) {
      const downloadId = row.dataset.playlistId
      if (downloadId && playlistIdSet.has(downloadId)) {
        rowElements.set(downloadId, row)
      }
    }

    const displayedTops = new Map(previousRowTopsRef.current)
    for (const [downloadId, animation] of rowAnimationsRef.current) {
      const row = rowElements.get(downloadId)
      if (row) {
        displayedTops.set(downloadId, row.getBoundingClientRect().top)
      }
      animation.cancel()
    }
    rowAnimationsRef.current.clear()

    const nextTops = new Map<string, number>()
    for (const [downloadId, row] of rowElements) {
      nextTops.set(downloadId, row.getBoundingClientRect().top)
    }
    previousRowTopsRef.current = nextTops

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    for (const [downloadId, row] of rowElements) {
      const displayedTop = displayedTops.get(downloadId)
      const nextTop = nextTops.get(downloadId)
      if (displayedTop == null || nextTop == null) {
        continue
      }
      const offset = displayedTop - nextTop
      if (Math.abs(offset) < 0.5 || typeof row.animate !== 'function') {
        continue
      }
      const animation = row.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
        PLAYLIST_REORDER_ANIMATION
      )
      rowAnimationsRef.current.set(downloadId, animation)
      animation.onfinish = () => {
        if (rowAnimationsRef.current.get(downloadId) === animation) {
          rowAnimationsRef.current.delete(downloadId)
          animation.cancel()
        }
      }
    }
  }, [open, playlistIds])

  /** Cancel row animations when the playlist popover unmounts. */
  useLayoutEffect(
    () => () => {
      for (const animation of rowAnimationsRef.current.values()) {
        animation.cancel()
      }
      rowAnimationsRef.current.clear()
    },
    []
  )

  /**
   * Start a native desktop drag operation from one playlist row.
   */
  const handleDragStart = (event: DragEvent<HTMLElement>, downloadId: string): void => {
    event.stopPropagation()
    draggedIdRef.current = downloadId
    lastOverIdRef.current = downloadId
    const list = listRef.current
    if (list) {
      const rowTops = new Map<string, number>()
      for (const row of list.querySelectorAll<HTMLElement>('[data-playlist-id]')) {
        const rowDownloadId = row.dataset.playlistId
        if (rowDownloadId) {
          rowTops.set(rowDownloadId, row.getBoundingClientRect().top)
        }
      }
      previousRowTopsRef.current = rowTops
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TRANSCRIPT_PLAYLIST_DRAG_TYPE, downloadId)
  }

  /**
   * Resolve the active playlist id from the live drag operation.
   */
  const getDraggedId = (event: DragEvent<HTMLElement>): string =>
    draggedIdRef.current ?? event.dataTransfer.getData(TRANSCRIPT_PLAYLIST_DRAG_TYPE)

  /**
   * Keep a playlist drag inside the popover and advertise a move operation.
   */
  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
  }

  /**
   * Reorder immediately when the pointer enters another playlist row.
   */
  const handleDragEnter = (event: DragEvent<HTMLElement>, overId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const activeId = getDraggedId(event)
    if (!(activeId && activeId !== overId && lastOverIdRef.current !== overId)) {
      return
    }
    lastOverIdRef.current = overId
    reorder({ activeId, overId })
  }

  /**
   * Clear the transient drag state without changing the final ordering.
   */
  const handleDragEnd = (event: DragEvent<HTMLElement>): void => {
    event.stopPropagation()
    draggedIdRef.current = null
    lastOverIdRef.current = null
  }

  /**
   * Finalize a row drop and keep it away from the home ingest handler.
   */
  const handleDrop = (event: DragEvent<HTMLElement>, overId: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const activeId = getDraggedId(event)
    if (activeId && activeId !== overId && lastOverIdRef.current !== overId) {
      reorder({ activeId, overId })
    }
    activateFirstPlaylistItem(playlistStore.get(playbackPlaylistAtom)[0] ?? null)
    draggedIdRef.current = null
    lastOverIdRef.current = null
  }

  /**
   * Close the playlist and navigate to the selected transcript detail.
   */
  const handleOpenItem = (downloadId: string): void => {
    setOpen(false)
    void navigate({
      params: { downloadId },
      search: (prev) => prev,
      to: '/downloads/$downloadId/transcript'
    })
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-label={t('transcript.player.playlist.open')}
          className={cn('relative', PLAYBACK_BAR_CONTROL_CLASS)}
          ref={triggerRef}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ListMusic />
          {playlistIds.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[10px] text-primary-foreground leading-4">
              {playlistIds.length > 99 ? '99+' : playlistIds.length}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0"
        side="top"
        sideOffset={12}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-semibold text-sm">{t('transcript.player.playlist.title')}</h2>
            <p className="text-muted-foreground text-xs">
              {t('transcript.player.playlist.count', { count: playlistIds.length })}
            </p>
          </div>
          <ListMusic className="size-4 text-primary" />
        </div>
        {rows.length > 0 ? (
          <ol className="max-h-[min(65vh,30rem)] overflow-y-auto py-1" ref={listRef}>
            {rows.map(({ download, downloadId, snapshot }, index) => (
              <TranscriptPlaylistRow
                download={download}
                downloadId={downloadId}
                index={index}
                itemCount={rows.length}
                key={downloadId}
                nextId={playlistIds[index + 1] ?? null}
                onDragEnd={handleDragEnd}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onOpen={handleOpenItem}
                onRemove={handleRemove}
                onReorder={handleReorder}
                previousId={playlistIds[index - 1] ?? null}
                session={session?.downloadId === downloadId ? session : null}
                snapshot={snapshot}
              />
            ))}
          </ol>
        ) : (
          <div className="px-6 py-10 text-center">
            <ListMusic className="mx-auto size-8 text-muted-foreground/45" />
            <p className="mt-3 font-medium text-sm">{t('transcript.player.playlist.empty')}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {t('transcript.player.playlist.emptyHint')}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
