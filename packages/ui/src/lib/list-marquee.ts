export const LIST_MARQUEE_MOVE_PX = 8
export const LIST_MARQUEE_IGNORE_SELECTOR =
  'a, button, input, textarea, select, [role="checkbox"], [data-marquee-ignore]'

/**
 * True when a pointer target is a nested control that should not start a marquee
 * or activate the row.
 */
export const isListIgnoreTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(target.closest(LIST_MARQUEE_IGNORE_SELECTOR))
}

export interface ListRect {
  bottom: number
  left: number
  right: number
  top: number
}

export interface ListMarquee {
  x1: number
  x2: number
  y1: number
  y2: number
}

/**
 * Axis-aligned box from two pointer corners.
 */
export const listMarqueeRect = (x1: number, y1: number, x2: number, y2: number): ListRect => ({
  bottom: Math.max(y1, y2),
  left: Math.min(x1, x2),
  right: Math.max(x1, x2),
  top: Math.min(y1, y2)
})

/**
 * Overlay style for a Finder-style selection rectangle.
 */
export const listMarqueeStyle = (
  marquee: ListMarquee
): ListRect & { height: number; width: number } => {
  const box = listMarqueeRect(marquee.x1, marquee.y1, marquee.x2, marquee.y2)
  return {
    ...box,
    height: Math.max(1, box.bottom - box.top),
    width: Math.max(1, box.right - box.left)
  }
}

/**
 * True when two axis-aligned boxes overlap.
 */
export const listRectsOverlap = (left: ListRect, right: ListRect): boolean =>
  left.left < right.right &&
  left.right > right.left &&
  left.top < right.bottom &&
  left.bottom > right.top

/**
 * Item ids whose rows intersect the marquee, in any order.
 */
export const listItemIdsInMarquee = (
  rows: Array<{ id: string; rect: ListRect }>,
  marquee: ListRect
): string[] => rows.filter((row) => listRectsOverlap(row.rect, marquee)).map((row) => row.id)
