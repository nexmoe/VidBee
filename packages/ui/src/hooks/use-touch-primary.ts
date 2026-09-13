'use client'

import { useEffect, useState } from 'react'

/**
 * Detect touch-primary devices (coarse pointer + touch points).
 * Returns false on the server and the first client render so the non-touch
 * branch is the hydration-stable default. Adapted from Lina / Fluid Functionalism.
 */
export function useTouchPrimary(): boolean {
  const [isTouchPrimary, setIsTouchPrimary] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }

    const controller = new AbortController()
    const { signal } = controller

    /** Prefer native overflow when the pointer is coarse and the device has touch. */
    const handleTouch = (): void => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const prefersTouch = window.matchMedia('(pointer: coarse)').matches
      setIsTouchPrimary(hasTouch && prefersTouch)
    }

    const mq = window.matchMedia('(pointer: coarse)')
    mq.addEventListener('change', handleTouch, { signal })
    window.addEventListener('pointerdown', handleTouch, { signal })
    handleTouch()

    return () => controller.abort()
  }, [])

  return isTouchPrimary
}
