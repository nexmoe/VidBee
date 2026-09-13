import { SpeakerAvatar } from '@renderer/components/transcript/SpeakerAvatar'
import { TranscriptProgressThinking } from '@renderer/components/transcript/TranscriptProgressThinking'
import { TranscriptShareImageDialog } from '@renderer/components/transcript/TranscriptShareImageDialog'
import { Button } from '@renderer/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useStreamingTranscript } from '@renderer/hooks/use-streaming-transcript'
import { shareImageFileName } from '@renderer/lib/capture-prompt-share'
import { formatClock } from '@renderer/lib/format-clock'
import { ipcServices } from '@renderer/lib/ipc'
import {
  buildCaptionQuoteBlocks,
  buildCaptionShareQuote,
  CAPTION_SELECT_HOLD_MS,
  CAPTION_SELECT_MOVE_PX,
  type CaptionMarquee,
  type CaptionSelection,
  type CaptionShareQuote,
  captionMarqueeRect,
  captionMarqueeStyle,
  captionSegmentIdsInMarquee,
  formatCaptionQuoteText,
  isCaptionSegmentSelected,
  mergeCaptionSelection,
  toggleCaptionSelection
} from '@renderer/lib/transcript-caption-selection'
import {
  type FollowResumeDirection,
  followResumeDirection,
  followResumeDirectionFromDelta,
  followResumeDirectionFromRange,
  followScrollBehavior,
  followScrollSuppressMs,
  getCenteredScrollTop,
  isScrollbarPointerDown,
  isSeekJump,
  needsFollowScroll,
  prefersReducedMotion,
  scrollListToCenteredNode,
  scrollListToOffset,
  shouldPauseFollowFromWheel
} from '@renderer/lib/transcript-follow'
import {
  activeWordIndex,
  endsCaptionSentence,
  seekSecondsForWord,
  wordsForSegment
} from '@renderer/lib/transcript-karaoke'
import { matchesTranscriptQuery, splitHighlightedParts } from '@renderer/lib/transcript-search'
import {
  CAPTION_LIST_ESTIMATE_WIDTH_PX,
  CAPTION_LIST_INITIAL_RECT,
  CAPTION_LIST_OVERSCAN,
  CAPTION_LIST_PADDING_PX,
  estimateCaptionListOffset,
  estimateCaptionRowHeight,
  measureCaptionRow,
  observeCaptionListRect
} from '@renderer/lib/transcript-virtual'
import { cn } from '@renderer/lib/utils'
import type { TranscriptSegmentView, TranscriptSpeakerView } from '@renderer/store/transcripts'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Share2,
  Sparkles,
  Square,
  Trash2,
  X
} from 'lucide-react'
import {
  Fragment,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const EMPTY_SPEAKERS: TranscriptSpeakerView[] = []

/**
 * True when local ASR failed because the media has no audio track.
 *
 * @param error Worker/task error text from the transcript host.
 */
const isNoAudioTranscriptError = (error: string): boolean =>
  /no audio stream|does not contain any stream/i.test(error)

/**
 * Caption row id under a pointer target, if any.
 *
 * @param target Event target from a pointer or click.
 */
const captionSegmentIdFromTarget = (target: EventTarget | null): string | null => {
  if (!(target instanceof Element)) {
    return null
  }
  const row = target.closest('[data-segment-id]')
  return row instanceof HTMLElement ? (row.dataset.segmentId ?? null) : null
}

/**
 * Find a transcript row by segment id inside the captions list.
 */
const querySegmentNode = (list: HTMLElement, segmentId: string): HTMLElement | null => {
  const node = list.querySelector(`[data-segment-id="${segmentId}"]`)
  return node instanceof HTMLElement ? node : null
}

/**
 * Prefer the spoken token in the playing row, then the row itself.
 */
const queryFollowTarget = (list: HTMLElement, segmentId: string): HTMLElement | null => {
  const row = querySegmentNode(list, segmentId)
  if (!row) {
    return null
  }
  const token = row.querySelector('[data-follow-token="true"]')
  return token instanceof HTMLElement ? token : row
}

/**
 * Ignore user-scroll pauses while a programmatic follow jump is settling.
 */
const markProgrammaticScroll = (
  list: HTMLElement,
  suppressUntilRef: { current: number },
  programmaticRef: { current: boolean },
  behavior: ScrollBehavior
): void => {
  programmaticRef.current = true
  suppressUntilRef.current = Math.max(
    suppressUntilRef.current,
    performance.now() + followScrollSuppressMs(behavior)
  )
  const finish = (): void => {
    programmaticRef.current = false
    list.removeEventListener('scrollend', finish)
  }
  list.addEventListener('scrollend', finish)
  window.setTimeout(finish, followScrollSuppressMs(behavior))
}

interface TranscriptCaptionsPaneProps {
  collapsed: boolean
  currentSegmentId: string | null
  currentTimeMs: number
  /** Download this transcript belongs to, used to remember thinking-step collapse. */
  downloadId?: string
  /** Hide the outer border and Transcript tab when hosted inside TranscriptSidePanel. */
  embedded?: boolean
  /** Worker/task error text when local ASR failed. */
  error?: string | null
  /** Local ASR ended in a failed task state. */
  failed?: boolean
  noSpeech: boolean
  noSpeechDetail: string
  /** Stop an in-flight local ASR run. */
  onCancel?: () => void
  /** Retry a failed local ASR run. */
  onRetry?: () => void
  onSeek: (seconds: number) => void
  /** Start local ASR from the idle empty state. */
  onStart?: () => void
  ready: boolean
  resolveColorIndex: (speakerId: string | null) => number | null
  resolveSpeaker: (speakerId: string | null) => string
  running: boolean
  runningLabel: string
  /** Live transcription pipeline stage from the worker. */
  stage?: string | null
  /** Persisted stage timings so the clock survives navigation and restarts. */
  stageHistory?: Array<{ stage: string; startedAt: number }>
  segments: TranscriptSegmentView[]
  /** Cached local cover URL printed on the share card. */
  sourceCover?: string | null
  /** Media duration for the share-card progress bar. */
  sourceDurationMs?: number
  /** Platform and channel printed under the share card title. */
  sourceByline?: string | null
  /** Media title printed on the share card header. */
  sourceTitle?: string
  /** Speakers used in the speaker-change context menu. */
  speakers?: TranscriptSpeakerView[]
  /** Typewriter incoming ASR lines. Off when viewing a finished caption track. */
  streamLive?: boolean
}

/**
 * Render the searchable transcript sidebar with word-level playback sync.
 */
export function TranscriptCaptionsPane({
  collapsed,
  currentSegmentId,
  currentTimeMs,
  downloadId,
  embedded = false,
  error = null,
  failed = false,
  noSpeech,
  noSpeechDetail,
  onCancel,
  onRetry,
  onSeek,
  onStart,
  ready,
  resolveColorIndex,
  resolveSpeaker,
  running,
  runningLabel,
  stage = null,
  stageHistory = [],
  segments,
  sourceCover,
  sourceDurationMs = 0,
  sourceByline,
  sourceTitle,
  speakers = EMPTY_SPEAKERS,
  streamLive = running
}: TranscriptCaptionsPaneProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement | null>(null)
  const wheelAccumulatedRef = useRef({ value: 0 })
  const lastFollowedSegmentRef = useRef<string | null>(null)
  const lastFollowedTimeRef = useRef<number | null>(null)
  const programmaticScrollRef = useRef(false)
  const wasSearchingRef = useRef(false)
  const pendingCaptionJumpRef = useRef<string | null>(null)
  const suppressFollowPauseUntilRef = useRef(0)
  const [query, setQuery] = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [focusedSegmentId, setFocusedSegmentId] = useState<string | null>(null)
  const [followPaused, setFollowPaused] = useState(false)
  const followPausedRef = useRef(false)
  const [resumeDirection, setResumeDirection] = useState<FollowResumeDirection>('up')
  const [selection, setSelection] = useState<CaptionSelection | null>(null)
  const [marquee, setMarquee] = useState<CaptionMarquee | null>(null)
  const [shareDraft, setShareDraft] = useState<CaptionShareQuote | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const editingIdRef = useRef<string | null>(null)
  editingIdRef.current = editingId
  const lastScrollTopRef = useRef(0)
  const followSettledRef = useRef(false)
  const followWindowReadyRef = useRef(false)
  const pendingCenterIdRef = useRef<string | null>(null)
  const pendingCenterBehaviorRef = useRef<ScrollBehavior>('auto')
  const listWidthRef = useRef(CAPTION_LIST_ESTIMATE_WIDTH_PX)
  const suppressSeekRef = useRef(false)
  const selectPointerRef = useRef<{
    baseIds: string[]
    originX: number
    originY: number
    pointerId: number
    segmentId: string | null
    selecting: boolean
    startClientX: number
    startClientY: number
    x: number
    y: number
  } | null>(null)
  const selectHoldTimerRef = useRef<number | null>(null)
  const selectionRef = useRef<CaptionSelection | null>(null)
  selectionRef.current = selection
  const streamed = useStreamingTranscript(segments, streamLive)
  const displaySegments = streamed.segments
  const segmentIds = useMemo(() => displaySegments.map((segment) => segment.id), [displaySegments])
  const segmentIdsRef = useRef(segmentIds)
  segmentIdsRef.current = segmentIds
  const matches = useMemo(
    () =>
      displaySegments.filter((segment) =>
        matchesTranscriptQuery(query, segment.text, resolveSpeaker(segment.speakerId))
      ),
    [displaySegments, query, resolveSpeaker]
  )
  const hasQuery = query.trim().length > 0
  const visibleSegments = hasQuery ? matches : displaySegments
  const matchesRef = useRef(matches)
  matchesRef.current = matches
  const showSearch = ready && !running
  const showLines = ready || running || displaySegments.length > 0
  const showAsrIdle =
    Boolean(onStart) && !ready && !running && !failed && !noSpeech && displaySegments.length === 0
  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    for (const [index, segment] of visibleSegments.entries()) {
      map.set(segment.id, index)
    }
    return map
  }, [visibleSegments])
  const rowTextLengths = useMemo(
    () => visibleSegments.map((segment) => segment.text.length),
    [visibleSegments]
  )
  /**
   * Keep the row-height guess in sync with the actual captions pane width.
   */
  const observeListRect = useCallback(
    (
      instance: Parameters<typeof observeCaptionListRect>[0],
      cb: (rect: { height: number; width: number }) => void
    ) =>
      observeCaptionListRect(instance, (rect) => {
        if (rect.width > 0) {
          listWidthRef.current = rect.width
        }
        cb(rect)
      }),
    []
  )

  const rowVirtualizer = useVirtualizer({
    count: visibleSegments.length,
    estimateSize: (index) =>
      estimateCaptionRowHeight(visibleSegments[index]?.text.length ?? 0, listWidthRef.current),
    getItemKey: (index) => visibleSegments[index]?.id ?? index,
    getScrollElement: () => listRef.current,
    initialOffset: () => {
      if (!currentSegmentId) {
        return 0
      }
      const index = indexById.get(currentSegmentId)
      if (index === undefined) {
        return 0
      }
      return estimateCaptionListOffset(
        rowTextLengths,
        index,
        CAPTION_LIST_INITIAL_RECT.height,
        listWidthRef.current
      )
    },
    initialRect: CAPTION_LIST_INITIAL_RECT,
    measureElement: measureCaptionRow,
    observeElementRect: observeListRect,
    overscan: CAPTION_LIST_OVERSCAN,
    paddingEnd: CAPTION_LIST_PADDING_PX,
    paddingStart: CAPTION_LIST_PADDING_PX,
    // React 19 warns if flushSync runs from measureElement refs during commit.
    useFlushSync: false
  })

  const playingIndex = currentSegmentId ? indexById.get(currentSegmentId) : undefined
  // Hide estimated rows until the playing line is in the virtual window so
  // enter does not paint the top or bottom while the first jump is settling.
  if (!followWindowReadyRef.current) {
    if (playingIndex === undefined) {
      if (!currentSegmentId || visibleSegments.length > 0) {
        followWindowReadyRef.current = true
      }
    } else if (rowVirtualizer.getVirtualItems().some((item) => item.index === playingIndex)) {
      followWindowReadyRef.current = true
    }
  }

  /**
   * Jump to a caption index when the row is not measured yet.
   *
   * Always instant: smooth `scrollToIndex` on estimated sizes overshoots to
   * the bottom, then snaps after DOM measure — the hitch when opening captions.
   */
  const jumpToUnmeasuredIndex = useCallback(
    (index: number): void => {
      const list = listRef.current
      if (!list) {
        return
      }
      if (list.clientHeight <= 0) {
        scrollListToOffset(
          list,
          estimateCaptionListOffset(
            rowTextLengths,
            index,
            CAPTION_LIST_INITIAL_RECT.height,
            listWidthRef.current
          )
        )
        return
      }
      rowVirtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' })
    },
    [rowTextLengths, rowVirtualizer]
  )

  /**
   * Scroll the captions list to a segment, used by search match navigation.
   */
  const scrollToSegment = useCallback(
    (segmentId: string, behavior: ScrollBehavior): void => {
      const list = listRef.current
      if (!list) {
        return
      }
      const node = querySegmentNode(list, segmentId)
      const index = indexById.get(segmentId)
      const nextBehavior =
        node && list.clientHeight > 0 && behavior === 'smooth' && !prefersReducedMotion()
          ? 'smooth'
          : 'auto'
      markProgrammaticScroll(list, suppressFollowPauseUntilRef, programmaticScrollRef, nextBehavior)
      if (node && list.clientHeight > 0) {
        scrollListToCenteredNode(list, node, nextBehavior)
        pendingCenterIdRef.current = null
        return
      }
      if (index === undefined) {
        return
      }
      pendingCenterIdRef.current = segmentId
      pendingCenterBehaviorRef.current =
        behavior === 'smooth' && !prefersReducedMotion() ? 'smooth' : 'auto'
      jumpToUnmeasuredIndex(index)
    },
    [indexById, jumpToUnmeasuredIndex]
  )

  /**
   * Keep the spoken token (or its segment) in view while follow is active.
   *
   * Estimated and long auto-follow jumps stay instant. Resume / search buttons
   * still ease to a measured row so the click has a visible transition.
   */
  const scrollToFollowTarget = useCallback(
    (segmentId: string, timeMs: number, force: boolean, userInitiated = false): void => {
      const list = listRef.current
      if (!(list && Number.isFinite(timeMs))) {
        return
      }
      const index = indexById.get(segmentId)
      if (index === undefined) {
        return
      }
      const target = queryFollowTarget(list, segmentId)
      const segmentChanged = lastFollowedSegmentRef.current !== segmentId
      lastFollowedSegmentRef.current = segmentId
      if (!(force || segmentChanged || !target || needsFollowScroll(list, target))) {
        if (list.clientHeight > 0) {
          followSettledRef.current = true
        }
        return
      }
      const measured = Boolean(target && list.clientHeight > 0)
      const distancePx =
        measured && target ? Math.abs(getCenteredScrollTop(list, target) - list.scrollTop) : 0
      const behavior = prefersReducedMotion()
        ? 'auto'
        : followScrollBehavior({
            distancePx,
            settled: followSettledRef.current,
            targetMeasured: measured,
            userInitiated,
            viewportPx: list.clientHeight
          })
      markProgrammaticScroll(list, suppressFollowPauseUntilRef, programmaticScrollRef, behavior)
      if (measured && target) {
        scrollListToCenteredNode(list, target, behavior)
        followSettledRef.current = true
        pendingCenterIdRef.current = null
        return
      }
      pendingCenterIdRef.current = segmentId
      pendingCenterBehaviorRef.current =
        userInitiated && !prefersReducedMotion() ? 'smooth' : 'auto'
      jumpToUnmeasuredIndex(index)
    },
    [indexById, jumpToUnmeasuredIndex]
  )

  useLayoutEffect(() => {
    if (!(hasQuery && matches[activeMatch])) {
      return
    }
    scrollToSegment(matches[activeMatch].id, prefersReducedMotion() ? 'auto' : 'smooth')
  }, [activeMatch, hasQuery, matches, scrollToSegment])

  useLayoutEffect(() => {
    const segmentId = pendingCaptionJumpRef.current
    if (!segmentId || hasQuery) {
      return
    }
    pendingCaptionJumpRef.current = null
    scrollToSegment(segmentId, 'auto')
  }, [hasQuery, scrollToSegment])

  useEffect(() => {
    if (hasQuery) {
      wasSearchingRef.current = true
      return
    }
    if (wasSearchingRef.current) {
      wasSearchingRef.current = false
      lastFollowedSegmentRef.current = null
    }
  }, [hasQuery])

  const followJumpRef = useRef({
    currentSegmentId,
    currentTimeMs,
    followPaused,
    hasQuery,
    ready,
    running,
    scrollToFollowTarget
  })
  followJumpRef.current = {
    currentSegmentId,
    currentTimeMs,
    followPaused,
    hasQuery,
    ready,
    running,
    scrollToFollowTarget
  }

  /**
   * Retry the enter jump once the scroller has a real height so we do not
   * clamp `scrollToIndex` to the bottom while clientHeight is still 0.
   */
  useLayoutEffect(() => {
    if (collapsed) {
      return
    }
    const list = listRef.current
    if (!list) {
      return
    }
    let hadLayout = list.clientHeight > 0
    const observer = new ResizeObserver(() => {
      const hasLayout = list.clientHeight > 0
      const gainedLayout = hasLayout && !hadLayout
      hadLayout = hasLayout
      if (!gainedLayout) {
        return
      }
      const jump = followJumpRef.current
      if (
        jump.hasQuery ||
        jump.followPaused ||
        !jump.currentSegmentId ||
        !(jump.ready || jump.running)
      ) {
        return
      }
      jump.scrollToFollowTarget(jump.currentSegmentId, jump.currentTimeMs, true)
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [collapsed])

  useLayoutEffect(() => {
    const wasPaused = followPausedRef.current
    followPausedRef.current = followPaused
    if (hasQuery || !currentSegmentId || !(ready || running)) {
      lastFollowedTimeRef.current = currentTimeMs
      return
    }
    const previousTime = lastFollowedTimeRef.current
    lastFollowedTimeRef.current = currentTimeMs
    const jumped = previousTime !== null && isSeekJump(previousTime, currentTimeMs)
    if (jumped) {
      if (followPaused) {
        setFollowPaused(false)
      }
      scrollToFollowTarget(currentSegmentId, currentTimeMs, true)
      return
    }
    if (followPaused) {
      return
    }
    // Resume already animated to the playing line; do not snap over that motion.
    if (wasPaused) {
      return
    }
    scrollToFollowTarget(currentSegmentId, currentTimeMs, false)
  }, [
    currentSegmentId,
    currentTimeMs,
    followPaused,
    hasQuery,
    ready,
    running,
    scrollToFollowTarget
  ])

  /**
   * After an estimated jump, center the row once it is actually mounted.
   */
  useLayoutEffect(() => {
    const segmentId = pendingCenterIdRef.current
    const list = listRef.current
    if (!(segmentId && list) || list.clientHeight <= 0) {
      return
    }
    const node = queryFollowTarget(list, segmentId) ?? querySegmentNode(list, segmentId)
    if (!node) {
      return
    }
    pendingCenterIdRef.current = null
    const behavior = prefersReducedMotion() ? 'auto' : pendingCenterBehaviorRef.current
    pendingCenterBehaviorRef.current = 'auto'
    markProgrammaticScroll(list, suppressFollowPauseUntilRef, programmaticScrollRef, behavior)
    scrollListToCenteredNode(list, node, behavior)
    followSettledRef.current = true
  })

  /**
   * Point the resume control the way the jump will scroll.
   */
  const syncResumeDirection = useCallback(
    (fallback?: FollowResumeDirection): void => {
      const list = listRef.current
      if (list && currentSegmentId) {
        const target = queryFollowTarget(list, currentSegmentId)
        if (target && list.clientHeight > 0) {
          const fromJump = followResumeDirection(list, target)
          if (fromJump) {
            setResumeDirection(fromJump)
          }
          return
        }
        const index = indexById.get(currentSegmentId)
        const items = rowVirtualizer.getVirtualItems()
        const first = items[0]?.index
        const last = items.at(-1)?.index
        if (index !== undefined && first !== undefined && last !== undefined) {
          const fromRange = followResumeDirectionFromRange(index, first, last)
          if (fromRange) {
            setResumeDirection(fromRange)
            return
          }
        }
      }
      if (fallback) {
        setResumeDirection(fallback)
      }
    },
    [currentSegmentId, indexById, rowVirtualizer]
  )

  /**
   * Stop auto-follow after a deliberate user scroll.
   */
  const pauseFollow = (fallback?: FollowResumeDirection): void => {
    if (!followPaused) {
      setFollowPaused(true)
    }
    syncResumeDirection(fallback)
  }

  /**
   * Jump back to the playing line and resume auto-follow.
   */
  const resumeFollow = (): void => {
    setFocusedSegmentId(null)
    setFollowPaused(false)
    lastFollowedSegmentRef.current = null
    if (currentSegmentId) {
      scrollToFollowTarget(currentSegmentId, currentTimeMs, true, true)
    }
  }

  /**
   * Pause follow after a real wheel flick, ignoring trackpad noise.
   */
  const onListWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (hasQuery) {
      return
    }
    const fallback = followResumeDirectionFromDelta(event.deltaY) ?? undefined
    if (followPaused) {
      syncResumeDirection(fallback)
      return
    }
    if (shouldPauseFollowFromWheel(event.deltaY, wheelAccumulatedRef.current)) {
      pauseFollow(fallback)
    }
  }

  /**
   * Pause follow for keyboard and touch scrolls that are not ours.
   */
  const onListScroll = (): void => {
    const list = listRef.current
    const scrollTop = list?.scrollTop ?? 0
    const fallback =
      followResumeDirectionFromDelta(scrollTop - lastScrollTopRef.current) ?? undefined
    lastScrollTopRef.current = scrollTop
    if (hasQuery) {
      return
    }
    if (followPaused) {
      syncResumeDirection(fallback)
      return
    }
    if (programmaticScrollRef.current || performance.now() < suppressFollowPauseUntilRef.current) {
      return
    }
    pauseFollow(fallback)
  }

  /**
   * Keep the resume arrow pointed the way the jump will scroll.
   */
  useLayoutEffect(() => {
    if (!followPaused || hasQuery || !currentSegmentId) {
      return
    }
    syncResumeDirection()
  }, [currentSegmentId, followPaused, hasQuery, syncResumeDirection])

  /**
   * Move the search highlight to the next or previous match.
   */
  const jumpMatch = (delta: number): void => {
    if (matches.length === 0) {
      return
    }
    setActiveMatch((current) => (current + delta + matches.length) % matches.length)
  }

  /**
   * Leave search and scroll the full transcript to this caption without seeking playback.
   */
  const jumpToSearchMatch = useCallback((segmentId: string): void => {
    pendingCaptionJumpRef.current = segmentId
    setFocusedSegmentId(segmentId)
    setFollowPaused(true)
    setActiveMatch(0)
    setQuery('')
  }, [])

  const canSelectCaptions = showLines && !hasQuery && !streamLive && !editingId
  const canEditCaptions = Boolean(downloadId) && ready && !running && !streamLive && !hasQuery
  const quoteBlocks = useMemo(
    () => (selection ? buildCaptionQuoteBlocks(displaySegments, selection, resolveSpeaker) : []),
    [displaySegments, resolveSpeaker, selection]
  )
  const shareQuote = useMemo(
    () => (selection ? buildCaptionShareQuote(displaySegments, selection) : null),
    [displaySegments, selection]
  )

  /**
   * Drop the caption selection.
   */
  const clearSelection = useCallback((): void => {
    setSelection(null)
    setMarquee(null)
  }, [])

  /**
   * Cancel a pending long-press timer.
   */
  const clearSelectHoldTimer = (): void => {
    if (selectHoldTimerRef.current !== null) {
      window.clearTimeout(selectHoldTimerRef.current)
      selectHoldTimerRef.current = null
    }
  }

  /**
   * Highlight caption lines whose rows intersect the pointer marquee.
   *
   * @param clientX Pointer x in viewport coordinates.
   * @param clientY Pointer y in viewport coordinates.
   */
  const updateMarqueeSelection = (clientX: number, clientY: number): void => {
    const pointer = selectPointerRef.current
    const list = listRef.current
    if (!(pointer && list)) {
      return
    }
    const listRect = list.getBoundingClientRect()
    setMarquee({
      x1: pointer.originX,
      x2: clientX - listRect.left,
      y1: pointer.originY,
      y2: clientY - listRect.top
    })
    const box = captionMarqueeRect(pointer.startClientX, pointer.startClientY, clientX, clientY)
    const rows = [...list.querySelectorAll('[data-segment-id]')].flatMap((node) => {
      if (!(node instanceof HTMLElement && node.dataset.segmentId)) {
        return []
      }
      const rect = node.getBoundingClientRect()
      return [
        {
          id: node.dataset.segmentId,
          rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }
        }
      ]
    })
    setSelection(
      mergeCaptionSelection(
        pointer.baseIds.length > 0 ? { ids: pointer.baseIds } : null,
        captionSegmentIdsInMarquee(rows, box),
        segmentIdsRef.current
      )
    )
  }

  /**
   * Start the Finder-style selection rectangle.
   *
   * @param clientX Pointer x in viewport coordinates.
   * @param clientY Pointer y in viewport coordinates.
   */
  const beginMarquee = (clientX: number, clientY: number): void => {
    const pointer = selectPointerRef.current
    const list = listRef.current
    if (!pointer || pointer.selecting) {
      return
    }
    pointer.selecting = true
    pointer.baseIds = selectionRef.current?.ids ?? []
    suppressSeekRef.current = true
    setFollowPaused(true)
    if (list && typeof list.setPointerCapture === 'function') {
      try {
        list.setPointerCapture(pointer.pointerId)
      } catch {
        // The pointer may already have been released.
      }
    }
    updateMarqueeSelection(clientX, clientY)
  }

  /**
   * Commit or cancel the current caption pointer gesture.
   */
  const finishSelectPointer = useCallback((): void => {
    if (selectHoldTimerRef.current !== null) {
      window.clearTimeout(selectHoldTimerRef.current)
      selectHoldTimerRef.current = null
    }
    const pointer = selectPointerRef.current
    const list = listRef.current
    if (
      list &&
      pointer &&
      typeof list.hasPointerCapture === 'function' &&
      list.hasPointerCapture(pointer.pointerId)
    ) {
      list.releasePointerCapture(pointer.pointerId)
    }
    selectPointerRef.current = null
    setMarquee(null)
    if (pointer?.selecting) {
      suppressSeekRef.current = true
      return
    }
    if (pointer?.segmentId && selectionRef.current) {
      setSelection(
        toggleCaptionSelection(selectionRef.current, pointer.segmentId, segmentIdsRef.current)
      )
      suppressSeekRef.current = true
    }
  }, [])

  /**
   * Persist a caption mutation and toast on failure.
   *
   * @param work IPC call that writes the current transcript.
   */
  const persistCaptionEdit = async (work: () => Promise<unknown>): Promise<boolean> => {
    try {
      await work()
      return true
    } catch {
      toast.error(t('transcript.captionSaveFailed'))
      return false
    }
  }

  /**
   * Open the inline editor for one caption line.
   *
   * @param segmentId Line to edit.
   */
  const beginEditCaption = useCallback(
    (segmentId: string): void => {
      if (!canEditCaptions) {
        return
      }
      setSelection(null)
      setFollowPaused(true)
      setEditingId(segmentId)
    },
    [canEditCaptions]
  )

  /**
   * Save caption text, deleting the line when the draft is empty.
   *
   * @param segmentId Line being edited.
   * @param text Draft text.
   */
  const commitEditCaption = async (segmentId: string, text: string): Promise<void> => {
    if (!downloadId) {
      return
    }
    const trimmed = text.trim()
    const current = displaySegments.find((segment) => segment.id === segmentId)
    setEditingId(null)
    if (!current) {
      return
    }
    if (trimmed === current.text.trim()) {
      if (trimmed === '') {
        await persistCaptionEdit(() =>
          ipcServices.transcript.deleteSegments({ downloadId, segmentIds: [segmentId] })
        )
      }
      return
    }
    if (trimmed === '') {
      await persistCaptionEdit(() =>
        ipcServices.transcript.deleteSegments({ downloadId, segmentIds: [segmentId] })
      )
      return
    }
    await persistCaptionEdit(() =>
      ipcServices.transcript.updateSegment({ downloadId, segmentId, text: trimmed })
    )
  }

  /**
   * Insert a caption next to a neighbor or at the playhead, then edit it.
   *
   * @param input Neighbor or playhead placement.
   */
  const insertCaption = async (input: {
    afterId?: string | null
    beforeId?: string | null
  }): Promise<void> => {
    if (!(downloadId && canEditCaptions)) {
      return
    }
    const result = await persistCaptionEdit(async () => {
      const next = await ipcServices.transcript.insertSegment({
        afterId: input.afterId,
        atMs: input.afterId || input.beforeId ? undefined : currentTimeMs,
        beforeId: input.beforeId,
        downloadId
      })
      beginEditCaption(next.segmentId)
      return next
    })
    if (result) {
      setSelection(null)
    }
  }

  /**
   * Delete one caption or the current selection.
   *
   * @param segmentIds Lines to drop.
   */
  const deleteCaptions = async (segmentIds: string[]): Promise<void> => {
    if (!(downloadId && canEditCaptions) || segmentIds.length === 0) {
      return
    }
    if (editingId && segmentIds.includes(editingId)) {
      setEditingId(null)
    }
    const ok = await persistCaptionEdit(() =>
      ipcServices.transcript.deleteSegments({ downloadId, segmentIds })
    )
    if (!ok) {
      return
    }
    setSelection(null)
    toast.success(t('transcript.captionDeleted', { count: segmentIds.length }))
  }

  /**
   * Ask before removing captions from the toolbar, menu, or Delete key.
   *
   * @param segmentIds Lines the user asked to drop.
   */
  const requestDeleteCaptions = (segmentIds: string[]): void => {
    if (segmentIds.length === 0) {
      return
    }
    setPendingDeleteIds(segmentIds)
  }

  /**
   * Confirm the pending caption delete.
   */
  const confirmDeleteCaptions = (): void => {
    if (!pendingDeleteIds) {
      return
    }
    const ids = pendingDeleteIds
    setPendingDeleteIds(null)
    void deleteCaptions(ids)
  }

  /**
   * Change the speaker on one caption.
   *
   * @param segmentId Line to relabel.
   * @param speakerId Stored speaker id, or empty to clear.
   */
  const changeCaptionSpeaker = async (segmentId: string, speakerId: string): Promise<void> => {
    if (!downloadId) {
      return
    }
    await persistCaptionEdit(() =>
      ipcServices.transcript.updateSegment({
        downloadId,
        segmentId,
        speakerId: speakerId === '' ? null : speakerId
      })
    )
  }

  /**
   * Copy the selected caption quotes as plain text.
   */
  const handleCopySelection = async (): Promise<void> => {
    if (quoteBlocks.length === 0) {
      return
    }
    try {
      await navigator.clipboard.writeText(formatCaptionQuoteText(quoteBlocks))
      toast.success(t('transcript.promptCopied'))
    } catch {
      toast.error(t('transcript.copyFailed'))
    }
  }

  /**
   * Open the share-image preview for the current caption selection.
   */
  const handleShareSelection = (): void => {
    if (!(shareQuote && quoteBlocks.length > 0)) {
      return
    }
    setShareDraft(shareQuote)
    setShareOpen(true)
  }

  /**
   * Toggle the share preview. Keep the last card mounted so close can animate.
   *
   * @param next Next dialog open state.
   */
  const handleShareDialogOpenChange = (next: boolean): void => {
    setShareOpen(next)
  }

  useEffect(() => {
    if (hasQuery || streamLive) {
      setSelection(null)
      setMarquee(null)
    }
  }, [hasQuery, streamLive])

  useEffect(() => {
    window.addEventListener('pointerup', finishSelectPointer)
    window.addEventListener('pointercancel', finishSelectPointer)
    return () => {
      window.removeEventListener('pointerup', finishSelectPointer)
      window.removeEventListener('pointercancel', finishSelectPointer)
    }
  }, [finishSelectPointer])

  useEffect(() => {
    /**
     * Escape clears an in-progress caption selection; Delete removes it.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea, [contenteditable="true"]') ||
          target.closest('[data-caption-editor]'))
      ) {
        return
      }
      if (pendingDeleteIds) {
        return
      }
      if (event.key === 'Escape') {
        if (editingIdRef.current) {
          setEditingId(null)
          return
        }
        if (selection) {
          setSelection(null)
        }
        return
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selection &&
        canEditCaptions &&
        !editingIdRef.current
      ) {
        event.preventDefault()
        requestDeleteCaptions(selection.ids)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [canEditCaptions, pendingDeleteIds, requestDeleteCaptions, selection])

  /**
   * Start a potential Finder-style marquee on the caption list.
   */
  const onListPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const list = listRef.current
    if (list && !followPaused && !hasQuery && isScrollbarPointerDown(list, event.clientX)) {
      pauseFollow()
    }
    if (
      !canSelectCaptions ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('[data-caption-select-toolbar]'))
    ) {
      return
    }
    const listRect = list?.getBoundingClientRect()
    if (!listRect) {
      return
    }
    clearSelectHoldTimer()
    selectPointerRef.current = {
      baseIds: selectionRef.current?.ids ?? [],
      originX: event.clientX - listRect.left,
      originY: event.clientY - listRect.top,
      pointerId: event.pointerId,
      segmentId: captionSegmentIdFromTarget(event.target),
      selecting: false,
      startClientX: event.clientX,
      startClientY: event.clientY,
      x: event.clientX,
      y: event.clientY
    }
    const onCaptionControl =
      event.target instanceof Element &&
      Boolean(
        event.target.closest('button, textarea, input, [data-caption-editor], [data-caption-menu]')
      )
    if (onCaptionControl) {
      return
    }
    const startX = event.clientX
    const startY = event.clientY
    selectHoldTimerRef.current = window.setTimeout(() => {
      beginMarquee(startX, startY)
    }, CAPTION_SELECT_HOLD_MS)
  }

  /**
   * Grow the selection rectangle while the pointer stays down.
   */
  const onListPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const pointer = selectPointerRef.current
    if (!(pointer && canSelectCaptions)) {
      return
    }
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (!pointer.selecting) {
      const distance = Math.hypot(
        event.clientX - pointer.startClientX,
        event.clientY - pointer.startClientY
      )
      if (distance < CAPTION_SELECT_MOVE_PX) {
        return
      }
      clearSelectHoldTimer()
      beginMarquee(event.clientX, event.clientY)
      return
    }
    updateMarqueeSelection(event.clientX, event.clientY)
  }

  /**
   * Seek a karaoke token unless this pointer gesture was a marquee or a
   * selection-mode click that toggles a caption line.
   *
   * @param seconds Playback time to seek to.
   * @param segmentId Caption line that was clicked.
   */
  const onSeekToken = (seconds: number, segmentId: string): void => {
    if (suppressSeekRef.current) {
      suppressSeekRef.current = false
      return
    }
    if (selectPointerRef.current?.selecting) {
      return
    }
    if (selection) {
      setSelection(toggleCaptionSelection(selection, segmentId, segmentIdsRef.current))
      return
    }
    if (focusedSegmentId) {
      setFocusedSegmentId(null)
    }
    onSeek(seconds)
  }

  if (collapsed) {
    return null
  }

  return (
    <div
      className={
        embedded
          ? 'flex h-full min-h-0 flex-col bg-background'
          : 'flex h-full min-h-0 flex-col border-border/60 border-t bg-background lg:border-t-0 lg:border-l'
      }
    >
      {showAsrIdle ? null : (
        <div className={embedded ? 'px-4' : 'border-border/60 border-b px-4'}>
          {embedded ? null : (
            <div className="flex items-end">
              <p className="border-primary border-b-2 py-3 font-medium text-sm">
                {t('transcript.title')}
              </p>
            </div>
          )}
          {running ? (
            <div className="flex items-center gap-1.5 py-3">
              <div
                aria-live="polite"
                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm"
                data-testid="transcript-header-status"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate">{runningLabel}</span>
              </div>
              {onCancel ? (
                <Button
                  aria-label={t('transcript.stop')}
                  className="h-9 shrink-0"
                  data-testid="transcript-cancel"
                  onClick={onCancel}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Square />
                  {t('transcript.stop')}
                </Button>
              ) : null}
            </div>
          ) : showSearch ? (
            <div className="flex items-center gap-1.5 py-3">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  aria-label={t('transcript.searchPlaceholder')}
                  className="h-9 pl-8"
                  data-testid="transcript-search"
                  onChange={(event) => {
                    setQuery(event.currentTarget.value)
                    setActiveMatch(0)
                    setFocusedSegmentId(null)
                  }}
                  placeholder={t('transcript.searchPlaceholder')}
                  value={query}
                />
              </div>
              {canEditCaptions && !hasQuery ? (
                <Button
                  aria-label={t('transcript.captionAdd')}
                  className="h-9 w-9 shrink-0"
                  data-testid="transcript-caption-add"
                  onClick={() =>
                    void insertCaption({ afterId: displaySegments.at(-1)?.id ?? null })
                  }
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <Plus />
                </Button>
              ) : null}
              {hasQuery ? (
                <>
                  <p className="shrink-0 text-muted-foreground text-xs">
                    {matches.length === 0
                      ? t('transcript.searchNoMatches')
                      : t('transcript.searchMatches', { count: matches.length })}
                  </p>
                  <Button
                    aria-label={t('transcript.searchPrevious')}
                    className="h-8 w-8"
                    disabled={matches.length === 0}
                    onClick={() => jumpMatch(-1)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronUp />
                  </Button>
                  <Button
                    aria-label={t('transcript.searchNext')}
                    className="h-8 w-8"
                    disabled={matches.length === 0}
                    onClick={() => jumpMatch(1)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronDown />
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div
          className="h-full select-none overflow-y-auto contain-strict"
          data-testid="transcript-captions-list"
          onPointerDown={onListPointerDown}
          onPointerMove={onListPointerMove}
          onPointerUp={finishSelectPointer}
          onScroll={onListScroll}
          onWheel={onListWheel}
          ref={listRef}
        >
          {running ? (
            <TranscriptProgressThinking
              downloadId={downloadId}
              running={running}
              runningLabel={runningLabel}
              stage={stage}
              stageHistory={stageHistory}
            />
          ) : null}
          {showAsrIdle ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center"
              data-testid="transcript-asr-idle"
            >
              <p className="max-w-sm text-muted-foreground text-sm">{t('transcript.asrIdle')}</p>
              <Button data-testid="transcript-asr-start" onClick={onStart} size="sm" type="button">
                <Sparkles />
                {t('transcript.transcribe')}
              </Button>
            </div>
          ) : null}
          {noSpeech ? (
            <p className="px-4 pt-4 text-muted-foreground text-sm">{noSpeechDetail}</p>
          ) : null}
          {failed && !running ? (
            <div
              className="flex flex-col items-start gap-3 px-4 pt-4 pb-4"
              data-testid="transcript-error"
            >
              <p className="font-medium text-destructive text-sm">{t('transcript.error')}</p>
              {isNoAudioTranscriptError(error ?? '') ? (
                <p className="text-muted-foreground text-sm" data-testid="transcript-error-detail">
                  {t('transcript.errorNoAudio')}
                </p>
              ) : error?.trim() ? (
                <div className="w-full min-w-0">
                  <p className="mb-1 font-medium text-muted-foreground text-xs">
                    {t('transcript.promptErrorDetails')}
                  </p>
                  <pre
                    className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-muted-foreground text-xs"
                    data-testid="transcript-error-detail"
                  >
                    {error.trim()}
                  </pre>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">{t('transcript.errorHint')}</p>
              )}
              {onRetry ? (
                <Button
                  data-testid="transcript-error-retry"
                  onClick={onRetry}
                  size="sm"
                  type="button"
                >
                  <RotateCw />
                  {t('transcript.retry')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {showLines && displaySegments.length === 0 && canEditCaptions && !failed && !noSpeech ? (
            <div
              className="flex flex-col items-start gap-3 px-4 pt-4"
              data-testid="transcript-caption-empty"
            >
              <p className="text-muted-foreground text-sm">{t('transcript.captionEmpty')}</p>
              <Button
                onClick={() => void insertCaption({})}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus />
                {t('transcript.captionAdd')}
              </Button>
            </div>
          ) : null}
          {showLines ? (
            <div
              className="relative w-full"
              data-testid="transcript-captions-virtual"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                visibility: followWindowReadyRef.current ? 'visible' : 'hidden'
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const segment = visibleSegments[virtualRow.index]
                if (!segment) {
                  return null
                }
                const streamingLine = streamLive && streamed.streamingId === segment.id
                const active = currentSegmentId === segment.id
                const selected = isCaptionSegmentSelected(selection, segment.id)
                return (
                  <div
                    className={cn('px-4', selected ? 'bg-primary/20' : '')}
                    data-index={virtualRow.index}
                    key={virtualRow.key}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                      width: '100%'
                    }}
                  >
                    <CaptionRow
                      active={active}
                      canEdit={canEditCaptions}
                      currentTimeMs={active ? currentTimeMs : 0}
                      editing={editingId === segment.id}
                      hasQuery={hasQuery}
                      isSearchHit={
                        hasQuery
                          ? matches[activeMatch]?.id === segment.id
                          : focusedSegmentId === segment.id
                      }
                      onChangeSpeaker={(speakerId) =>
                        void changeCaptionSpeaker(segment.id, speakerId)
                      }
                      onCommitEdit={(text) => void commitEditCaption(segment.id, text)}
                      onDelete={() =>
                        requestDeleteCaptions(selected && selection ? selection.ids : [segment.id])
                      }
                      onEdit={() => beginEditCaption(segment.id)}
                      onInsertAfter={() => void insertCaption({ afterId: segment.id })}
                      onInsertBefore={() => void insertCaption({ beforeId: segment.id })}
                      onSeek={(seconds) => onSeekToken(seconds, segment.id)}
                      onSelectMatch={jumpToSearchMatch}
                      query={query}
                      resolveColorIndex={resolveColorIndex}
                      resolveSpeaker={resolveSpeaker}
                      segment={segment}
                      selected={selected}
                      speakers={speakers}
                      streaming={streamed.streaming}
                      streamingLine={streamingLine}
                    />
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
        {marquee ? <CaptionMarqueeBox marquee={marquee} /> : null}
        {followPaused && !hasQuery && currentSegmentId && !selection ? (
          <div className="absolute right-3 bottom-6 z-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('transcript.followResume')}
                  className="h-10 w-10 rounded-full bg-background shadow-md"
                  data-direction={resumeDirection}
                  data-testid="transcript-follow-resume"
                  onClick={resumeFollow}
                  size="icon"
                  type="button"
                  variant="outline"
                >
                  <ChevronUp
                    className={cn(
                      'transition-transform duration-200',
                      resumeDirection === 'down' && 'rotate-180'
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{t('transcript.followResume')}</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
        <div className="pointer-events-none absolute inset-x-3 bottom-4 z-20 flex justify-center">
          <CaptionSelectToolbar
            canDelete={canEditCaptions}
            onClear={clearSelection}
            onCopy={() => void handleCopySelection()}
            onDelete={() => selection && requestDeleteCaptions(selection.ids)}
            onShare={handleShareSelection}
            open={Boolean(selection)}
          />
        </div>
      </div>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteIds(null)
          }
        }}
        open={Boolean(pendingDeleteIds)}
      >
        <DialogContent data-testid="transcript-caption-delete-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t('transcript.captionDeleteConfirmTitle', { count: pendingDeleteIds?.length ?? 0 })}
            </DialogTitle>
            <DialogDescription>
              {t('transcript.captionDeleteConfirmDescription', {
                count: pendingDeleteIds?.length ?? 0
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              data-testid="transcript-caption-delete-cancel"
              onClick={() => setPendingDeleteIds(null)}
              type="button"
              variant="outline"
            >
              {t('transcript.captionDeleteConfirmCancel')}
            </Button>
            <Button
              data-testid="transcript-caption-delete-confirm"
              onClick={confirmDeleteCaptions}
              type="button"
              variant="destructive"
            >
              {t('transcript.captionDelete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {shareDraft ? (
        <TranscriptShareImageDialog
          fileName={shareImageFileName(sourceTitle)}
          onOpenChange={handleShareDialogOpenChange}
          open={shareOpen}
          payload={{
            coverSrc: sourceCover,
            durationMs: sourceDurationMs,
            kind: 'caption',
            quote: shareDraft,
            sourceByline,
            sourceTitle,
            tagline: t('transcript.promptShareTagline')
          }}
        />
      ) : null}
    </div>
  )
}

interface CaptionMarqueeBoxProps {
  marquee: CaptionMarquee
}

/**
 * Finder-style selection rectangle over the caption list.
 *
 * @param props.marquee Pointer corners in list-local coordinates.
 */
function CaptionMarqueeBox({ marquee }: CaptionMarqueeBoxProps) {
  const box = captionMarqueeStyle(marquee)
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 rounded-sm border border-primary/70 bg-primary/15"
      data-testid="transcript-caption-marquee"
      style={{ height: box.height, left: box.left, top: box.top, width: box.width }}
    />
  )
}

interface CaptionSelectIconButtonProps {
  children: ReactNode
  className?: string
  label: string
  onClick: () => void
  testId: string
}

/**
 * Icon-only selection action with a hover label.
 *
 * @param props.children Button icon.
 * @param props.className Extra button classes.
 * @param props.label Accessible name and tooltip.
 * @param props.onClick Action to run.
 * @param props.testId Stable test id.
 */
function CaptionSelectIconButton({
  children,
  className,
  label,
  onClick,
  testId
}: CaptionSelectIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn('h-8 w-8 rounded-full', className)}
          data-testid={testId}
          onClick={onClick}
          size="icon"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

interface CaptionSelectToolbarProps {
  canDelete: boolean
  onClear: () => void
  onCopy: () => void
  onDelete: () => void
  onShare: () => void
  open: boolean
}

/**
 * Floating actions for the current caption selection.
 *
 * @param props.canDelete Whether selected lines can be removed.
 * @param props.onClear Drop the selection.
 * @param props.onCopy Copy selected quotes as text.
 * @param props.onDelete Remove the selected lines.
 * @param props.onShare Open the branded share-image preview.
 * @param props.open Whether the selection toolbar is expanded.
 */
function CaptionSelectToolbar({
  canDelete,
  onClear,
  onCopy,
  onDelete,
  onShare,
  open
}: CaptionSelectToolbarProps) {
  const { t } = useTranslation()
  return (
    <div
      aria-hidden={!open}
      aria-label={t('transcript.captionSelect')}
      className={cn(
        'flex items-center gap-1 rounded-full border border-border/80 bg-background/95 p-1 shadow-lg backdrop-blur-sm',
        'transition-[opacity,translate] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
        'motion-reduce:transition-[opacity] motion-reduce:duration-150',
        open
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-2 opacity-0 motion-reduce:translate-y-0'
      )}
      data-caption-select-toolbar="true"
      data-state={open ? 'open' : 'closed'}
      data-testid="transcript-caption-select-toolbar"
      inert={!open || undefined}
      role="toolbar"
    >
      <Button
        className="rounded-full"
        data-testid="transcript-caption-select-share"
        onClick={onShare}
        size="sm"
        type="button"
        variant="ghost"
      >
        <Share2 />
        {t('transcript.promptShareNative')}
      </Button>
      <CaptionSelectIconButton
        label={t('transcript.promptCopy')}
        onClick={onCopy}
        testId="transcript-caption-select-copy"
      >
        <Copy />
      </CaptionSelectIconButton>
      {canDelete ? (
        <CaptionSelectIconButton
          className="text-destructive hover:text-destructive"
          label={t('transcript.captionDeleteSelected')}
          onClick={onDelete}
          testId="transcript-caption-select-delete"
        >
          <Trash2 />
        </CaptionSelectIconButton>
      ) : null}
      <CaptionSelectIconButton
        label={t('transcript.captionSelectClear')}
        onClick={onClear}
        testId="transcript-caption-select-clear"
      >
        <X />
      </CaptionSelectIconButton>
    </div>
  )
}

interface CaptionRowProps {
  active: boolean
  canEdit: boolean
  currentTimeMs: number
  editing: boolean
  hasQuery: boolean
  isSearchHit: boolean
  onChangeSpeaker: (speakerId: string) => void
  onCommitEdit: (text: string) => void
  onDelete: () => void
  onEdit: () => void
  onInsertAfter: () => void
  onInsertBefore: () => void
  onSeek: (seconds: number) => void
  onSelectMatch: (segmentId: string) => void
  query: string
  resolveColorIndex: (speakerId: string | null) => number | null
  resolveSpeaker: (speakerId: string | null) => string
  segment: TranscriptSegmentView
  selected: boolean
  speakers: TranscriptSpeakerView[]
  streaming: boolean
  streamingLine: boolean
}

/**
 * Render one caption line with speaker, clock, and playback-synced text.
 */
const CaptionRow = memo(function CaptionRow({
  active,
  canEdit,
  currentTimeMs,
  editing,
  hasQuery,
  isSearchHit,
  onChangeSpeaker,
  onCommitEdit,
  onDelete,
  onEdit,
  onInsertAfter,
  onInsertBefore,
  onSeek,
  onSelectMatch,
  query,
  resolveColorIndex,
  resolveSpeaker,
  segment,
  selected,
  speakers,
  streaming,
  streamingLine
}: CaptionRowProps) {
  const { t } = useTranslation()
  const speakerName = resolveSpeaker(segment.speakerId)
  const words = wordsForSegment(segment)
  /**
   * From search, jump to this caption in the transcript. Otherwise seek playback.
   */
  const openCaption = (): void => {
    if (hasQuery) {
      onSelectMatch(segment.id)
      return
    }
    onSeek(segment.startMs / 1000)
  }
  const body = (
    <article
      aria-current={active ? 'true' : undefined}
      aria-live={streamingLine ? 'polite' : undefined}
      className={cn(
        'grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 py-2 text-left',
        hasQuery ? 'rounded-md hover:bg-muted/50' : '',
        isSearchHit ? 'bg-primary/10' : ''
      )}
      data-caption-selected={selected ? 'true' : undefined}
      data-jump-focus={isSearchHit && !hasQuery ? 'true' : undefined}
      data-segment-id={segment.id}
      data-streaming={streamingLine ? 'true' : undefined}
    >
      <button
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 leading-none"
        onClick={openCaption}
        title={hasQuery ? t('transcript.searchJumpTo') : undefined}
        type="button"
      >
        <SpeakerAvatar
          current={active}
          name={speakerName}
          size="xs"
          sortIndex={resolveColorIndex(segment.speakerId)}
        />
      </button>
      <div className="flex h-5 min-w-0 items-center gap-2">
        <button
          className="cursor-pointer truncate border-0 bg-transparent p-0 font-medium text-foreground text-sm leading-none hover:underline"
          onClick={openCaption}
          title={hasQuery ? t('transcript.searchJumpTo') : undefined}
          type="button"
        >
          <HighlightedText query={query} text={speakerName} />
        </button>
        <button
          className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-muted-foreground text-xs tabular-nums leading-none hover:underline"
          onClick={openCaption}
          title={hasQuery ? t('transcript.searchJumpTo') : undefined}
          type="button"
        >
          {formatClock(segment.startMs / 1000)}
        </button>
      </div>
      <p className="col-start-2 text-left text-sm leading-relaxed [overflow-wrap:anywhere]">
        {editing ? (
          <CaptionTextEditor
            initialText={segment.text}
            onCancel={() => onCommitEdit(segment.text)}
            onCommit={onCommitEdit}
          />
        ) : streamingLine ? (
          <>
            {segment.text}
            {streaming ? (
              <span
                className="ml-0.5 inline-block h-[0.9em] w-px translate-y-[0.1em] animate-pulse bg-primary align-middle"
                data-testid="transcript-stream-caret"
              />
            ) : null}
          </>
        ) : hasQuery ? (
          <button
            className="w-full cursor-pointer text-left"
            data-testid="transcript-search-jump"
            onClick={openCaption}
            title={t('transcript.searchJumpTo')}
            type="button"
          >
            <HighlightedText query={query} text={segment.text} />
          </button>
        ) : (
          <FollowText
            active={active}
            currentTimeMs={currentTimeMs}
            onDoubleClick={canEdit ? onEdit : undefined}
            onSeek={onSeek}
            segment={segment}
            words={words}
          />
        )}
      </p>
    </article>
  )
  if (!canEdit) {
    return body
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
      <ContextMenuContent data-caption-menu="true">
        <ContextMenuItem onClick={onEdit}>
          <Pencil />
          {t('transcript.captionEdit')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onInsertBefore}>
          {t('transcript.captionInsertBefore')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onInsertAfter}>
          {t('transcript.captionInsertAfter')}
        </ContextMenuItem>
        {speakers.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('transcript.captionSpeaker')}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                onValueChange={onChangeSpeaker}
                value={segment.speakerId ?? ''}
              >
                <ContextMenuRadioItem value="">
                  {t('transcript.unknownSpeaker')}
                </ContextMenuRadioItem>
                {speakers.map((speaker) => (
                  <ContextMenuRadioItem key={speaker.id} value={speaker.id}>
                    {speaker.displayName}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} variant="destructive">
          <Trash2 />
          {t('transcript.captionDelete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

interface CaptionTextEditorProps {
  initialText: string
  onCancel: () => void
  onCommit: (text: string) => void
}

/**
 * Inline caption editor. Enter saves, Shift+Enter inserts a newline, Escape cancels.
 *
 * @param props.initialText Text shown when editing starts.
 * @param props.onCancel Leave without changing the stored text.
 * @param props.onCommit Persist the draft.
 */
function CaptionTextEditor({ initialText, onCancel, onCommit }: CaptionTextEditorProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialText)
  const committedRef = useRef(false)
  /**
   * Save once, ignoring later blur after Enter already committed.
   *
   * @param text Draft to persist.
   */
  const finish = (text: string): void => {
    if (committedRef.current) {
      return
    }
    committedRef.current = true
    onCommit(text)
  }
  return (
    <textarea
      aria-label={t('transcript.captionEdit')}
      autoFocus
      className="field-sizing-content w-full resize-none rounded-sm bg-background/80 p-1 text-sm leading-relaxed outline-none ring-1 ring-primary/40"
      data-caption-editor="true"
      data-testid="transcript-caption-editor"
      onBlur={() => finish(value)}
      onChange={(event) => setValue(event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          committedRef.current = true
          onCancel()
          return
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          finish(value)
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      placeholder={t('transcript.captionPlaceholder')}
      rows={2}
      value={value}
    />
  )
}

interface FollowTextProps {
  active: boolean
  currentTimeMs: number
  onDoubleClick?: () => void
  onSeek: (seconds: number) => void
  segment: TranscriptSegmentView
  words: ReturnType<typeof wordsForSegment>
}

/**
 * Move a leading karaoke gap out of the word button.
 *
 * Browsers collapse whitespace at the start of an inline `<button>`, so English
 * words jam together unless the space is a sibling text node.
 */
const splitKaraokeGap = (text: string): { gap: boolean; label: string } => {
  const label = text.trimStart()
  return { gap: label.length < text.length, label }
}

/**
 * Highlight the spoken token and seek when a word is clicked.
 */
function FollowText({
  active,
  currentTimeMs,
  onDoubleClick,
  onSeek,
  segment,
  words
}: FollowTextProps) {
  const { t } = useTranslation()
  const currentIndex = active ? activeWordIndex(words, currentTimeMs) : null
  if (words.length === 0) {
    return (
      <button
        className="w-full cursor-text border-0 bg-transparent p-0 text-left font-[inherit] text-[length:inherit] leading-[inherit]"
        data-follow-token={active ? 'true' : undefined}
        data-testid={active ? 'transcript-follow-token' : undefined}
        onClick={() => onSeek(segment.startMs / 1000)}
        onDoubleClick={onDoubleClick}
        type="button"
      >
        {segment.text}
      </button>
    )
  }

  return words.map((word, index) => {
    const current = index === currentIndex
    const { gap, label } = splitKaraokeGap(word.text)
    const previousEnded = index > 0 && endsCaptionSentence(words[index - 1]?.text ?? '')
    return (
      <Fragment key={`${word.startMs}-${word.endMs}-${word.text}`}>
        {gap && !previousEnded ? ' ' : null}
        <button
          className={cn(
            'inline cursor-pointer whitespace-normal border-0 bg-transparent p-0 text-left align-baseline font-[inherit] text-[length:inherit] leading-[inherit]',
            current
              ? '-mx-0.5 rounded-sm bg-primary px-0.5 text-primary-foreground'
              : 'hover:rounded-sm hover:bg-muted'
          )}
          data-caption-token="true"
          data-follow-token={current ? 'true' : undefined}
          data-testid={current ? 'transcript-follow-token' : undefined}
          onClick={() => onSeek(seekSecondsForWord(word))}
          onDoubleClick={onDoubleClick}
          title={t('transcript.seekAt', { time: formatClock(word.startMs / 1000) })}
          type="button"
        >
          {label}
        </button>
        {index < words.length - 1 && endsCaptionSentence(label) ? <br /> : null}
      </Fragment>
    )
  })
}

interface HighlightedTextProps {
  query: string
  text: string
}

/**
 * Highlight search hits inside a line of transcript text.
 */
function HighlightedText({ query, text }: HighlightedTextProps) {
  if (!query.trim()) {
    return text
  }
  return splitHighlightedParts(text, query).map((part) =>
    part.match ? (
      <mark className="rounded-sm bg-primary/25 px-0.5 text-inherit" key={`m-${part.start}`}>
        {part.text}
      </mark>
    ) : (
      <span key={`t-${part.start}`}>{part.text}</span>
    )
  )
}
