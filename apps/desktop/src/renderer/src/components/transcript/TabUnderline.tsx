import { prefersReducedMotion } from '@renderer/lib/transcript-follow'
import { findTranscriptTab } from '@renderer/lib/transcript-tab-scroll'
import { useCallback, useLayoutEffect, useRef } from 'react'
import './TabUnderline.css'

interface TabUnderlineProps {
  activeId: string
}

/**
 * Clip the underline to `tab` inside `list`.
 *
 * @param list Tab list element.
 * @param tab Active tab element.
 */
const clipForTab = (
  list: HTMLElement,
  tab: HTMLElement
): { left: number; right: number } | null => {
  const listRect = list.getBoundingClientRect()
  const tabRect = tab.getBoundingClientRect()
  if (listRect.width <= 0) {
    return null
  }
  return {
    left: Math.max(0, tabRect.left - listRect.left),
    right: Math.max(0, listRect.right - tabRect.right)
  }
}

/**
 * Sliding underline for underline-style tabs. Clip-path moves both edges so the
 * hairline stretches toward the next tab instead of jumping.
 *
 * @param props.activeId `data-tab-id` of the selected tab.
 */
export function TabUnderline({ activeId }: TabUnderlineProps) {
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const placedRef = useRef(false)
  const targetRef = useRef({ left: Number.NaN, right: Number.NaN })

  /**
   * Align the hairline to the active tab. Only tab changes animate; resizes snap.
   *
   * @param animate Whether this update came from a selected-tab change.
   */
  const applyClip = useCallback(
    (animate: boolean): void => {
      const indicator = indicatorRef.current
      const list = indicator?.parentElement
      if (!(list && indicator)) {
        return
      }
      const tab = findTranscriptTab(list, activeId)
      if (!tab) {
        return
      }
      const next = clipForTab(list, tab)
      if (!next) {
        return
      }
      if (
        Math.abs(targetRef.current.left - next.left) < 0.5 &&
        Math.abs(targetRef.current.right - next.right) < 0.5
      ) {
        return
      }
      targetRef.current = next
      const shouldAnimate = animate && placedRef.current && !prefersReducedMotion()
      placedRef.current = true
      if (shouldAnimate) {
        if (indicator.style.transition === 'none') {
          indicator.style.transition = ''
          void indicator.offsetWidth
        }
      } else {
        indicator.style.transition = 'none'
      }
      indicator.style.setProperty('--tab-clip-left', `${next.left}px`)
      indicator.style.setProperty('--tab-clip-right', `${next.right}px`)
    },
    [activeId]
  )

  useLayoutEffect(() => {
    applyClip(true)
    const list = indicatorRef.current?.parentElement
    if (!list) {
      return
    }
    const observer = new ResizeObserver(() => applyClip(false))
    observer.observe(list)
    const tab = findTranscriptTab(list, activeId)
    if (tab) {
      observer.observe(tab)
    }
    return () => observer.disconnect()
  }, [activeId, applyClip])

  return (
    <span
      aria-hidden
      className="tab-underline pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 bg-primary"
      data-testid="tab-underline"
      ref={indicatorRef}
    />
  )
}
