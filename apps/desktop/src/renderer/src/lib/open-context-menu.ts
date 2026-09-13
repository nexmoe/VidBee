import type { MouseEvent } from 'react'

/**
 * Open the nearest Radix context menu from a left click, as if the user right-clicked.
 */
export const openContextMenuFromClick = (event: MouseEvent<HTMLElement>): void => {
  event.preventDefault()
  event.stopPropagation()
  const rect = event.currentTarget.getBoundingClientRect()
  event.currentTarget.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.bottom)
    })
  )
}
