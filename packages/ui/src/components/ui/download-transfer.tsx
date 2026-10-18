import { useCallback, useEffect, useRef } from 'react'
import {
  cancelDownloadTransferLocate,
  hasDownloadTransferLocator,
  prepareDownloadTransferTarget
} from '../../lib/download-transfer-target'
import { spring } from '../../lib/springs'

// A long-distance throw needs time to read; ordinary feedback uses the shared springs.
export const DOWNLOAD_TRANSFER_DURATION_MS = 620
const TRANSFER_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)'
const FRAME_COUNT = 40

/** Build one continuous cubic arc, with scale and tilt following the same progress. */
export function downloadTransferKeyframes(from: DOMRect, to: DOMRect): Keyframe[] {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const scale = Math.min(to.width / from.width, to.height / from.height, 1)
  const lift = Math.min(160, Math.max(64, Math.hypot(dx, dy) * 0.24))
  const direction = dx < 0 ? -1 : 1

  return Array.from({ length: FRAME_COUNT + 1 }, (_, index) => {
    const progress = index / FRAME_COUNT
    const remaining = 1 - progress
    const x =
      3 * remaining ** 2 * progress * dx * 0.12 +
      3 * remaining * progress ** 2 * dx * 0.82 +
      progress ** 3 * dx
    const y =
      3 * remaining ** 2 * progress * -lift +
      3 * remaining * progress ** 2 * (dy - lift * 0.45) +
      progress ** 3 * dy
    const shrink = progress * progress * (3 - 2 * progress)
    const tilt = direction * Math.sin(progress * Math.PI) * 7

    return {
      offset: progress,
      opacity: progress < 0.8 ? 1 : (1 - progress) / 0.2,
      transform: `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg) scale(${1 + (scale - 1) * shrink})`
    }
  })
}

/** Find the new task, or the list head when a filter hides that task. */
function findDestination(downloadId?: string): HTMLElement | null {
  const list = document.querySelector<HTMLElement>('[data-download-transfer-list]')
  if (!list) {
    return null
  }
  const row = downloadId
    ? list.querySelector<HTMLElement>(`[data-download-id="${CSS.escape(downloadId)}"]`)
    : list.querySelector<HTMLElement>('[data-download-id]')
  if (row) {
    row.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    return row
  }
  return list
}

/** A small settle makes the incoming task's landing legible without moving the list. */
function acknowledgeLanding(target: HTMLElement, reducedMotion: boolean): Animation | undefined {
  if (!target.isConnected || typeof target.animate !== 'function') {
    return undefined
  }
  return target.animate(
    reducedMotion
      ? [{ opacity: 0.65 }, { opacity: 1 }]
      : [
          { transform: 'translateY(0) scale(1)', opacity: 0.65 },
          { transform: 'translateY(3px) scale(0.995)', opacity: 1, offset: 0.35 },
          { transform: 'translateY(0) scale(1)', opacity: 1 }
        ],
    { duration: spring.slow.duration * 1000, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
  )
}

/** Transfer a successful download dialog or URL popover into the list. */
export function useDownloadTransfer() {
  const contentRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => () => cleanupRef.current?.(), [])

  const transferToList = useCallback(
    (downloadId?: string, source = contentRef.current ?? popoverRef.current) => {
      if (
        !source?.isConnected ||
        source.style.visibility === 'hidden' ||
        source.getAttribute('data-state') === 'closed' ||
        source.hasAttribute('data-ending-style')
      ) {
        return
      }
      cleanupRef.current?.()
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const from = source.getBoundingClientRect()
      if (from.width <= 0 || from.height <= 0) {
        return
      }

      const clone = source.cloneNode(true) as HTMLDivElement
      clone.removeAttribute('id')
      clone.removeAttribute('role')
      clone.removeAttribute('data-slot')
      clone.removeAttribute('aria-labelledby')
      clone.removeAttribute('aria-describedby')
      clone.setAttribute('aria-hidden', 'true')
      clone.setAttribute('data-download-transfer', '')
      clone.inert = true
      for (const element of clone.querySelectorAll('[id]')) {
        element.removeAttribute('id')
      }
      Object.assign(clone.style, {
        position: 'fixed',
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        minHeight: '0',
        maxHeight: 'none',
        margin: '0',
        transform: 'none',
        translate: 'none',
        transition: 'none',
        animation: 'none',
        pointerEvents: 'none',
        transformOrigin: 'center',
        zIndex: '100',
        willChange: 'transform, opacity'
      })

      let flight: Animation | undefined
      let landing: Animation | undefined
      let fallback: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const originalVisibility = source.style.visibility
      /** Remove temporary presentation and cancel scheduled work on replacement or unmount. */
      const cleanup = () => {
        settled = true
        cancelDownloadTransferLocate()
        cancelAnimationFrame(frame)
        clearTimeout(fallback)
        flight?.cancel()
        landing?.cancel()
        clone.remove()
        source.style.visibility = originalVisibility
      }
      cleanupRef.current = cleanup

      if (!reducedMotion && typeof clone.animate === 'function') {
        document.body.appendChild(clone)
        source.style.visibility = 'hidden'
      }

      // React commits the new row before the next frame; measure its actual resting position.
      const frame = requestAnimationFrame(() => {
        const begin = () => {
          if (settled) {
            return
          }
          const target = findDestination(downloadId)
          if (!target) {
            cleanup()
            return
          }
          if (reducedMotion || !clone.isConnected) {
            landing = acknowledgeLanding(target, true)
            return
          }
          const cover = target.querySelector<HTMLElement>('[data-download-transfer-cover]')
          const rect = (cover ?? target).getBoundingClientRect()
          const to = cover ? rect : new DOMRect(rect.left + 24, rect.top, 100, 56)
          flight = clone.animate(downloadTransferKeyframes(from, to), {
            duration: DOWNLOAD_TRANSFER_DURATION_MS,
            easing: TRANSFER_EASING,
            fill: 'forwards'
          })
          /** Hand off the final flight frame to the real task, including background-tab cleanup. */
          const finish = () => {
            if (settled) {
              return
            }
            settled = true
            clearTimeout(fallback)
            flight?.cancel()
            clone.remove()
            source.style.visibility = originalVisibility
            landing = acknowledgeLanding(findDestination(downloadId) ?? target, false)
          }
          void flight.finished.then(finish, () => clone.remove())
          fallback = setTimeout(finish, DOWNLOAD_TRANSFER_DURATION_MS + 150)
        }
        if (!hasDownloadTransferLocator()) {
          begin()
          return
        }
        void prepareDownloadTransferTarget(downloadId).then(begin, begin)
      })
    },
    []
  )

  return { contentRef, popoverRef, transferToList }
}
