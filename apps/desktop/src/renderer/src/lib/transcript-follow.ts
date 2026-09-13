export const WHEEL_PAUSE_THRESHOLD_PX = 10
export const FOLLOW_VISIBILITY_PADDING_PX = 16
export const FOLLOW_SMOOTH_MIN_MAX_PX = 480
export const SEEK_JUMP_MS = 800

export type FollowResumeDirection = 'up' | 'down'

/**
 * Return whether the user prefers instant scrolling over motion.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * True when `node` has left the list's padded viewport.
 */
export const needsFollowScroll = (
  list: HTMLElement,
  node: HTMLElement,
  padding = FOLLOW_VISIBILITY_PADDING_PX
): boolean => {
  const listRect = list.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const top = listRect.top + padding
  const bottom = listRect.bottom - padding
  if (bottom <= top) {
    return false
  }
  return nodeRect.bottom < top || nodeRect.top > bottom
}

/**
 * Compute the list scrollTop that vertically centers `node`.
 */
export const getCenteredScrollTop = (list: HTMLElement, node: HTMLElement): number => {
  const listRect = list.getBoundingClientRect()
  const nodeRect = node.getBoundingClientRect()
  const offset = nodeRect.top - listRect.top + list.scrollTop
  const next = offset - (list.clientHeight - node.clientHeight) / 2
  const max = Math.max(0, list.scrollHeight - list.clientHeight)
  return Math.min(max, Math.max(0, next))
}

/**
 * Which way a resume jump will scroll, from current and target offsets.
 */
export const followResumeDirectionFromScroll = (
  currentTop: number,
  targetTop: number
): FollowResumeDirection | null => {
  if (targetTop < currentTop) {
    return 'up'
  }
  if (targetTop > currentTop) {
    return 'down'
  }
  return null
}

/**
 * Which way resume will scroll to center `node` in the list.
 */
export const followResumeDirection = (
  list: HTMLElement,
  node: HTMLElement
): FollowResumeDirection | null => {
  if (list.clientHeight <= 0) {
    return null
  }
  return followResumeDirectionFromScroll(list.scrollTop, getCenteredScrollTop(list, node))
}

/**
 * Which way to jump when the follow target is not mounted in the list.
 */
export const followResumeDirectionFromRange = (
  currentIndex: number,
  firstVisibleIndex: number,
  lastVisibleIndex: number
): FollowResumeDirection | null => {
  if (currentIndex < firstVisibleIndex) {
    return 'up'
  }
  if (currentIndex > lastVisibleIndex) {
    return 'down'
  }
  return null
}

/**
 * Infer jump direction from a user scroll or wheel delta.
 */
export const followResumeDirectionFromDelta = (delta: number): FollowResumeDirection | null =>
  followResumeDirectionFromScroll(delta, 0)

/**
 * How long to ignore scroll events after a programmatic follow jump.
 */
export const followScrollSuppressMs = (behavior: ScrollBehavior): number =>
  behavior === 'smooth' ? 800 : 120

/**
 * Smooth follow only for a short, already-measured hop — unless the user
 * asked (resume / search). Those keep a transition even across a long list.
 *
 * Auto-follow and enter/seek stay instant when the hop is long or estimated,
 * so opening a transcript does not ease from 0:00 to the restored playhead.
 */
export const followScrollBehavior = (input: {
  distancePx?: number
  settled: boolean
  targetMeasured: boolean
  userInitiated?: boolean
  viewportPx?: number
}): ScrollBehavior => {
  if (input.userInitiated && input.targetMeasured) {
    return 'smooth'
  }
  const maxDistance = Math.max(FOLLOW_SMOOTH_MIN_MAX_PX, (input.viewportPx ?? 0) * 2)
  if (!(input.settled && input.targetMeasured) || (input.distancePx ?? 0) > maxDistance) {
    return 'auto'
  }
  return 'smooth'
}

/**
 * True when the playhead jumped, such as a progress-bar seek.
 */
export const isSeekJump = (previousMs: number, nextMs: number, threshold = SEEK_JUMP_MS): boolean =>
  Math.abs(nextMs - previousMs) >= threshold

/**
 * Write `top` onto the captions scroller, including environments without `scrollTo`.
 */
export const scrollListToOffset = (
  list: HTMLElement,
  top: number,
  behavior: ScrollBehavior = 'auto'
): void => {
  if (typeof list.scrollTo === 'function') {
    list.scrollTo({ behavior, top })
    return
  }
  list.scrollTop = top
}

/**
 * Scroll only the transcript list so `node` sits in the vertical center.
 */
export const scrollListToCenteredNode = (
  list: HTMLElement,
  node: HTMLElement,
  behavior: ScrollBehavior = 'auto'
): void => {
  scrollListToOffset(list, getCenteredScrollTop(list, node), behavior)
}

/**
 * Accumulate wheel distance and report a deliberate user scroll.
 */
export const shouldPauseFollowFromWheel = (
  deltaY: number,
  accumulated: { value: number },
  threshold = WHEEL_PAUSE_THRESHOLD_PX
): boolean => {
  accumulated.value += Math.abs(deltaY)
  if (accumulated.value < threshold) {
    return false
  }
  accumulated.value = 0
  return true
}

/**
 * True when a pointer down lands on the list's vertical scrollbar.
 */
export const isScrollbarPointerDown = (list: HTMLElement, clientX: number): boolean => {
  const gutter = list.offsetWidth - list.clientWidth
  if (gutter <= 0) {
    return false
  }
  return clientX >= list.getBoundingClientRect().right - gutter
}
