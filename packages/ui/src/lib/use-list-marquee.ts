import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
  useState
} from 'react'
import {
  isListIgnoreTarget,
  LIST_MARQUEE_HOLD_MS,
  LIST_MARQUEE_MOVE_PX,
  type ListMarquee,
  listItemIdsInMarquee,
  listMarqueeRect
} from './list-marquee'

interface ListMarqueePointer {
  baseIds: string[]
  originX: number
  originY: number
  pointerId: number
  selecting: boolean
  startClientX: number
  startClientY: number
}

interface ListMarqueeGeometryRow {
  id: string
  rect: { bottom: number; left: number; right: number; top: number }
}

interface UseListMarqueeSelectionOptions {
  containerRef: RefObject<HTMLElement | null>
  enabled?: boolean
  /** When set, hit-testing uses these boxes instead of mounted DOM nodes. */
  geometryRows?: () => readonly ListMarqueeGeometryRow[]
  itemAttr?: string
  selectableAttr?: string
  selectedIds: ReadonlySet<string>
  onSelectIds: (ids: string[]) => void
}

/**
 * Finder-style drag rectangle over a list. Hold or move to select; a plain
 * click is left to the item (so rows can navigate instead of selecting).
 */
export const useListMarqueeSelection = ({
  containerRef,
  enabled = true,
  geometryRows,
  itemAttr = 'data-download-id',
  selectableAttr = 'data-download-selectable',
  selectedIds,
  onSelectIds
}: UseListMarqueeSelectionOptions) => {
  const [marquee, setMarquee] = useState<ListMarquee | null>(null)
  const pointerRef = useRef<ListMarqueePointer | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const selectedIdsRef = useRef(selectedIds)
  const onSelectIdsRef = useRef(onSelectIds)
  const geometryRowsRef = useRef(geometryRows)
  selectedIdsRef.current = selectedIds
  onSelectIdsRef.current = onSelectIds
  geometryRowsRef.current = geometryRows

  /**
   * Cancel a pending long-press timer.
   */
  const clearHoldTimer = useCallback((): void => {
    if (holdTimerRef.current === null) {
      return
    }
    window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = null
  }, [])

  /**
   * Collect selectable row boxes in viewport coordinates.
   */
  const measureSelectableRows = useCallback((): Array<{
    id: string
    rect: { bottom: number; left: number; right: number; top: number }
  }> => {
    const provided = geometryRowsRef.current?.()
    if (provided) {
      return [...provided]
    }
    const container = containerRef.current
    if (!container) {
      return []
    }
    return [...container.querySelectorAll(`[${selectableAttr}]`)].flatMap((node) => {
      if (!(node instanceof HTMLElement)) {
        return []
      }
      const id = node.getAttribute(itemAttr)
      if (!id) {
        return []
      }
      const rect = node.getBoundingClientRect()
      return [
        {
          id,
          rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }
        }
      ]
    })
  }, [containerRef, itemAttr, selectableAttr])

  /**
   * Highlight rows whose boxes intersect the pointer marquee.
   */
  const updateMarqueeSelection = useCallback(
    (clientX: number, clientY: number): void => {
      const pointer = pointerRef.current
      const container = containerRef.current
      if (!(pointer && container)) {
        return
      }
      const listRect = container.getBoundingClientRect()
      setMarquee({
        x1: pointer.originX,
        x2: clientX - listRect.left,
        y1: pointer.originY,
        y2: clientY - listRect.top
      })
      const box = listMarqueeRect(pointer.startClientX, pointer.startClientY, clientX, clientY)
      const hits = listItemIdsInMarquee(measureSelectableRows(), box)
      const next = new Set(pointer.baseIds)
      for (const id of hits) {
        next.add(id)
      }
      onSelectIdsRef.current(Array.from(next))
    },
    [containerRef, measureSelectableRows]
  )

  /**
   * Start the Finder-style selection rectangle.
   */
  const beginMarquee = useCallback(
    (clientX: number, clientY: number): void => {
      const pointer = pointerRef.current
      const container = containerRef.current
      if (!pointer || pointer.selecting) {
        return
      }
      pointer.selecting = true
      pointer.baseIds = Array.from(selectedIdsRef.current)
      if (container && typeof container.setPointerCapture === 'function') {
        try {
          container.setPointerCapture(pointer.pointerId)
        } catch {
          // The pointer may already have been released.
        }
      }
      updateMarqueeSelection(clientX, clientY)
    },
    [containerRef, updateMarqueeSelection]
  )

  /**
   * Commit or cancel the current list pointer gesture.
   */
  const finishPointer = useCallback((): void => {
    clearHoldTimer()
    const pointer = pointerRef.current
    const container = containerRef.current
    if (
      container &&
      pointer &&
      typeof container.hasPointerCapture === 'function' &&
      container.hasPointerCapture(pointer.pointerId)
    ) {
      container.releasePointerCapture(pointer.pointerId)
    }
    pointerRef.current = null
    setMarquee(null)
  }, [clearHoldTimer, containerRef])

  /**
   * Start a potential marquee unless the pointer landed on a control.
   */
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || event.button !== 0) {
      return
    }
    if (isListIgnoreTarget(event.target)) {
      return
    }
    const container = containerRef.current
    const listRect = container?.getBoundingClientRect()
    if (!listRect) {
      return
    }
    clearHoldTimer()
    pointerRef.current = {
      baseIds: Array.from(selectedIdsRef.current),
      originX: event.clientX - listRect.left,
      originY: event.clientY - listRect.top,
      pointerId: event.pointerId,
      selecting: false,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
    const startX = event.clientX
    const startY = event.clientY
    holdTimerRef.current = window.setTimeout(() => {
      beginMarquee(startX, startY)
    }, LIST_MARQUEE_HOLD_MS)
  }

  /**
   * Grow the selection rectangle after the pointer moves past the slop.
   */
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const pointer = pointerRef.current
    if (!(pointer && enabled)) {
      return
    }
    if (!pointer.selecting) {
      const distance = Math.hypot(
        event.clientX - pointer.startClientX,
        event.clientY - pointer.startClientY
      )
      if (distance < LIST_MARQUEE_MOVE_PX) {
        return
      }
      clearHoldTimer()
      beginMarquee(event.clientX, event.clientY)
      return
    }
    updateMarqueeSelection(event.clientX, event.clientY)
  }

  /**
   * True when the current gesture became a marquee (so the row click should not fire).
   */
  const didSelectWithMarquee = (): boolean => Boolean(pointerRef.current?.selecting)

  return {
    beginMarquee,
    didSelectWithMarquee,
    finishPointer,
    marquee,
    onPointerDown,
    onPointerMove
  }
}
