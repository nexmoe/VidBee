import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import {
  isListIgnoreTarget,
  LIST_MARQUEE_MOVE_PX,
  type ListMarquee,
  listItemIdsInMarquee,
  listMarqueeRect
} from './list-marquee'

interface ListMarqueePointer {
  baseIds: string[]
  originX: number
  originY: number
  lastClientX: number
  lastClientY: number
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
  scrollElement?: HTMLElement | null
}

/** Drag list rows or background to replace selection, or hold Cmd/Ctrl to add to it. */
export const useListMarqueeSelection = ({
  containerRef,
  enabled = true,
  geometryRows,
  itemAttr = 'data-download-id',
  selectableAttr = 'data-download-selectable',
  selectedIds,
  onSelectIds,
  scrollElement
}: UseListMarqueeSelectionOptions) => {
  const [marquee, setMarquee] = useState<ListMarquee | null>(null)
  const pointerRef = useRef<ListMarqueePointer | null>(null)
  const suppressClickRef = useRef(false)
  const controlPointerRef = useRef(false)
  const onSelectIdsRef = useRef(onSelectIds)
  const geometryRowsRef = useRef(geometryRows)
  onSelectIdsRef.current = onSelectIds
  geometryRowsRef.current = geometryRows

  /** Collect selectable row boxes in viewport coordinates. */
  const measureSelectableRows = useCallback((): ListMarqueeGeometryRow[] => {
    const provided = geometryRowsRef.current?.()
    if (provided) {
      return [...provided]
    }
    const container = containerRef.current
    if (!container) {
      return []
    }
    return [...container.querySelectorAll(`[${selectableAttr}="true"]`)].flatMap((node) => {
      if (!(node instanceof HTMLElement)) {
        return []
      }
      const id = node.getAttribute(itemAttr)
      if (!id) {
        return []
      }
      const rect = node.getBoundingClientRect()
      return [
        { id, rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top } }
      ]
    })
  }, [containerRef, itemAttr, selectableAttr])

  /** Keep the rectangle and hit-testing anchored to the same content position while scrolling. */
  const updateMarqueeSelection = useCallback(
    (clientX: number, clientY: number): void => {
      const pointer = pointerRef.current
      const container = containerRef.current
      if (!(pointer && container)) {
        return
      }
      pointer.lastClientX = clientX
      pointer.lastClientY = clientY
      const listRect = container.getBoundingClientRect()
      setMarquee({
        x1: pointer.originX,
        x2: clientX - listRect.left,
        y1: pointer.originY,
        y2: clientY - listRect.top
      })
      const box = listMarqueeRect(
        listRect.left + pointer.originX,
        listRect.top + pointer.originY,
        clientX,
        clientY
      )
      const hits = listItemIdsInMarquee(measureSelectableRows(), box)
      onSelectIdsRef.current([...new Set([...pointer.baseIds, ...hits])])
    },
    [containerRef, measureSelectableRows]
  )

  /** Capture an actual drag; holding the mouse still never starts selection. */
  const beginMarquee = useCallback(
    (clientX: number, clientY: number): void => {
      const pointer = pointerRef.current
      const container = containerRef.current
      if (!(pointer && container) || pointer.selecting) {
        return
      }
      pointer.selecting = true
      suppressClickRef.current = true
      container.focus({ preventScroll: true })
      if (typeof container.setPointerCapture === 'function') {
        try {
          container.setPointerCapture(pointer.pointerId)
        } catch {
          // Window listeners still clean up when pointer capture is unavailable.
        }
      }
      updateMarqueeSelection(clientX, clientY)
    },
    [containerRef, updateMarqueeSelection]
  )

  /** Finish a drag while retaining its click guard until the synthesized click is consumed. */
  const finishPointer = useCallback((): void => {
    const pointer = pointerRef.current
    const container = containerRef.current
    if (!pointer) {
      return
    }
    pointerRef.current = null
    if (pointer && container?.hasPointerCapture?.(pointer.pointerId)) {
      container.releasePointerCapture(pointer.pointerId)
    }
    setMarquee(null)
  }, [containerRef])

  useEffect(() => {
    /** A fresh pointer gesture must not inherit an unconsumed release click guard. */
    const resetClickGuard = (): void => {
      suppressClickRef.current = false
      controlPointerRef.current = false
    }
    window.addEventListener('pointerdown', resetClickGuard, true)
    window.addEventListener('pointerup', finishPointer)
    window.addEventListener('pointercancel', finishPointer)
    window.addEventListener('blur', finishPointer)
    return () => {
      window.removeEventListener('pointerdown', resetClickGuard, true)
      window.removeEventListener('pointerup', finishPointer)
      window.removeEventListener('pointercancel', finishPointer)
      window.removeEventListener('blur', finishPointer)
      finishPointer()
    }
  }, [finishPointer])

  useEffect(() => {
    if (!scrollElement) {
      return
    }
    /** Recompute the hit area when the user scrolls during a drag. */
    const handleScroll = (): void => {
      const pointer = pointerRef.current
      if (pointer?.selecting) {
        updateMarqueeSelection(pointer.lastClientX, pointer.lastClientY)
      }
    }
    scrollElement.addEventListener('scroll', handleScroll)
    return () => scrollElement.removeEventListener('scroll', handleScroll)
  }, [scrollElement, updateMarqueeSelection])

  /** Prepare a mouse drag over rows or background without hijacking controls or touch scrolling. */
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (
      !enabled ||
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      isListIgnoreTarget(event.target)
    ) {
      return
    }
    const listRect = containerRef.current?.getBoundingClientRect()
    if (!listRect) {
      return
    }
    controlPointerRef.current = event.ctrlKey
    pointerRef.current = {
      baseIds: event.metaKey || event.ctrlKey ? Array.from(selectedIds) : [],
      originX: event.clientX - listRect.left,
      originY: event.clientY - listRect.top,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      pointerId: event.pointerId,
      selecting: false,
      startClientX: event.clientX,
      startClientY: event.clientY
    }
  }

  /** Grow the selection after deliberate movement and prevent native text dragging. */
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const pointer = pointerRef.current
    if (!(pointer && enabled) || event.pointerId !== pointer.pointerId) {
      return
    }
    if (pointer.selecting) {
      updateMarqueeSelection(event.clientX, event.clientY)
    } else {
      const distance = Math.hypot(
        event.clientX - pointer.startClientX,
        event.clientY - pointer.startClientY
      )
      if (distance < LIST_MARQUEE_MOVE_PX) {
        return
      }
      beginMarquee(event.clientX, event.clientY)
    }
    event.preventDefault()
  }

  /** Prevent the release click from navigating a row or clearing the completed selection. */
  const onClickCapture = (event: ReactMouseEvent<HTMLElement>): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
  }

  /** Keep native Control-click menus from taking over a primary-button selection gesture. */
  const onContextMenuCapture = (event: ReactMouseEvent<HTMLElement>): void => {
    if ((event.ctrlKey && controlPointerRef.current) || pointerRef.current?.selecting) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  /** Report a completed drag independently of pointerup cleanup. */
  const didSelectWithMarquee = (): boolean => suppressClickRef.current

  return {
    beginMarquee,
    didSelectWithMarquee,
    finishPointer,
    marquee,
    onClickCapture,
    onContextMenuCapture,
    onPointerDown,
    onPointerMove
  }
}
