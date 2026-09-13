/**
 * Find the tab chip whose `data-tab-id` matches `activeId`.
 *
 * @param list Tab list element.
 * @param activeId Selected tab id.
 */
export const findTranscriptTab = (list: HTMLElement, activeId: string): HTMLElement | null =>
  Array.from(list.querySelectorAll<HTMLElement>('[data-tab-id]')).find(
    (tab) => tab.getAttribute('data-tab-id') === activeId
  ) ?? null

/**
 * Horizontal delta that brings `child` fully inside `viewport`, or 0 when visible.
 *
 * @param viewport Scroll container.
 * @param child Tab chip to reveal.
 * @param padding Extra inset kept on each side.
 */
export const transcriptTabScrollDeltaX = (
  viewport: Pick<HTMLElement, 'getBoundingClientRect' | 'scrollLeft'>,
  child: Pick<HTMLElement, 'getBoundingClientRect'>,
  padding = 8
): number => {
  const view = viewport.getBoundingClientRect()
  if (view.width <= 0) {
    return 0
  }
  const node = child.getBoundingClientRect()
  const leftBound = view.left + padding
  const rightBound = view.right - padding
  if (rightBound <= leftBound) {
    return 0
  }
  if (node.left < leftBound) {
    return node.left - leftBound
  }
  if (node.right > rightBound) {
    return node.right - rightBound
  }
  return 0
}

/**
 * Scroll a tab chip into the horizontal viewport. No-ops when it is already visible.
 *
 * @param viewport Tab strip scroll container.
 * @param child Active tab chip.
 * @param behavior Instant on restore; smooth when the user changes tabs.
 */
export const scrollTranscriptTabIntoView = (
  viewport: HTMLElement,
  child: HTMLElement,
  behavior: ScrollBehavior = 'auto'
): void => {
  const delta = transcriptTabScrollDeltaX(viewport, child)
  if (delta === 0) {
    return
  }
  const left = viewport.scrollLeft + delta
  if (typeof viewport.scrollTo === 'function') {
    viewport.scrollTo({ behavior, left })
    return
  }
  viewport.scrollLeft = left
}
