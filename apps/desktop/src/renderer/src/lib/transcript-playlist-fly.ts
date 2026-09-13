export const PLAYLIST_FLY_DURATION_MS = 250
export const PLAYLIST_FLY_EASING = 'cubic-bezier(0.77, 0, 0.175, 1)'
export const PLAYLIST_FLY_LAND_RATIO = 0.62
export const PLAYLIST_FLY_CLIP_SELECTOR = '.transcript-playback-bar-slot-clip'

export interface PlaylistFlyBox {
  height: number
  left: number
  top: number
  width: number
}

export interface PlaylistFlyRequest {
  from: PlaylistFlyBox | null
  src: string | null
}

export interface PlaylistFlyTransform {
  scale: number
  translateX: number
  translateY: number
}

const PLAYLIST_FLY_CLASS = 'transcript-playlist-fly'
const PLAYLIST_FLY_PULSE_MS = 160
const PLAYLIST_FLY_PULSE_EASING = 'cubic-bezier(0.23, 1, 0.32, 1)'

let targetEl: HTMLElement | null = null
let pending: PlaylistFlyRequest | null = null
let activeAnimation: Animation | null = null
let activeNode: HTMLElement | null = null

/**
 * Map a cover rect onto the playlist button so the clone shrinks into it.
 */
export function playlistFlyTransform(
  from: PlaylistFlyBox,
  to: PlaylistFlyBox
): PlaylistFlyTransform {
  const fromWidth = Math.max(from.width, 1)
  const fromHeight = Math.max(from.height, 1)
  const land = Math.min(to.width, to.height) * PLAYLIST_FLY_LAND_RATIO
  return {
    scale: land / Math.min(fromWidth, fromHeight),
    translateX: to.left + to.width / 2 - (from.left + fromWidth / 2),
    translateY: to.top + to.height / 2 - (from.top + fromHeight / 2)
  }
}

/**
 * Resolve the playlist button's resting box, ignoring the bar's slide-in transform.
 */
export function playlistFlyDestination(
  targetRect: PlaylistFlyBox,
  clipRect: PlaylistFlyBox | null,
  slotRect: PlaylistFlyBox | null
): PlaylistFlyBox {
  if (!(clipRect && slotRect && slotRect.height > 0)) {
    return targetRect
  }
  return {
    height: targetRect.height,
    left: slotRect.left + (targetRect.left - clipRect.left),
    top: slotRect.top + (targetRect.top - clipRect.top),
    width: targetRect.width
  }
}

/**
 * Register the playback-bar playlist button that incoming covers should land on.
 */
export function setPlaylistFlyTarget(el: HTMLElement | null): void {
  targetEl = el
  if (!(el && pending)) {
    return
  }
  const request = pending
  pending = null
  runPlaylistFly(request, el)
}

/**
 * Fly a download cover from its list rect onto the playlist button.
 */
export function flyCoverToPlaylistButton(request: PlaylistFlyRequest): void {
  if (!isPlaylistFlyBoxReady(request.from)) {
    return
  }
  if (!targetEl) {
    pending = request
    return
  }
  runPlaylistFly(request, targetEl)
}

/**
 * Clear fly-to-playlist module state. Tests only.
 */
export function resetPlaylistFlyForTests(): void {
  pending = null
  targetEl = null
  teardownPlaylistFlyNode()
}

/**
 * True when a cover rect is large enough to fly from.
 */
function isPlaylistFlyBoxReady(box: PlaylistFlyBox | null): box is PlaylistFlyBox {
  return Boolean(box && box.width > 0 && box.height > 0)
}

/**
 * Read the playlist button's on-screen box after undoing the bar slide.
 */
function readPlaylistFlyDestination(target: HTMLElement): PlaylistFlyBox {
  const targetRect = target.getBoundingClientRect()
  const clip = target.closest(PLAYLIST_FLY_CLIP_SELECTOR)
  const slot = clip?.parentElement ?? null
  return playlistFlyDestination(
    targetRect,
    clip?.getBoundingClientRect() ?? null,
    slot?.getBoundingClientRect() ?? null
  )
}

/**
 * Run or replace the in-flight cover clone.
 */
function runPlaylistFly(request: PlaylistFlyRequest, target: HTMLElement): void {
  if (prefersPlaylistFlyReducedMotion()) {
    pulsePlaylistFlyTarget(target)
    return
  }
  const from = request.from
  if (!isPlaylistFlyBoxReady(from)) {
    return
  }
  const to = readPlaylistFlyDestination(target)
  if (to.width <= 0 || to.height <= 0) {
    pending = request
    return
  }
  const node = mountPlaylistFlyNode(from, request.src)
  const { scale, translateX, translateY } = playlistFlyTransform(from, to)
  const endTransform = `translate(${translateX}px, ${translateY}px) scale(${scale})`
  if (typeof node.animate !== 'function') {
    node.remove()
    pulsePlaylistFlyTarget(target)
    return
  }
  teardownPlaylistFlyNode()
  activeNode = node
  const animation = node.animate(
    [
      { offset: 0, opacity: 1, transform: 'translate(0px, 0px) scale(1)' },
      { offset: 0.78, opacity: 1, transform: endTransform },
      { offset: 1, opacity: 0, transform: endTransform }
    ],
    { duration: PLAYLIST_FLY_DURATION_MS, easing: PLAYLIST_FLY_EASING, fill: 'forwards' }
  )
  activeAnimation = animation
  void animation.finished.then(
    () => {
      if (activeNode === node) {
        teardownPlaylistFlyNode()
        pulsePlaylistFlyTarget(target)
      }
    },
    () => {
      if (activeNode === node) {
        teardownPlaylistFlyNode()
      }
    }
  )
}

/**
 * Build the fixed cover clone that WAAPI will move.
 */
function mountPlaylistFlyNode(from: PlaylistFlyBox, src: string | null): HTMLElement {
  const node = document.createElement('div')
  node.setAttribute('aria-hidden', 'true')
  node.className = PLAYLIST_FLY_CLASS
  node.style.left = `${from.left}px`
  node.style.top = `${from.top}px`
  node.style.width = `${from.width}px`
  node.style.height = `${from.height}px`
  if (src) {
    const image = document.createElement('img')
    image.alt = ''
    image.draggable = false
    image.src = src
    node.appendChild(image)
  }
  document.body.appendChild(node)
  return node
}

/**
 * Drop the current cover clone and cancel its animation.
 */
function teardownPlaylistFlyNode(): void {
  activeAnimation?.cancel()
  activeAnimation = null
  activeNode?.remove()
  activeNode = null
}

/**
 * Confirm the landing with a short pulse on the playlist button.
 */
function pulsePlaylistFlyTarget(target: HTMLElement): void {
  if (typeof target.animate !== 'function') {
    return
  }
  if (prefersPlaylistFlyReducedMotion()) {
    target.animate(
      [
        { backgroundColor: 'transparent' },
        { backgroundColor: 'color-mix(in oklch, var(--primary) 22%, transparent)' },
        { backgroundColor: 'transparent' }
      ],
      { duration: PLAYLIST_FLY_PULSE_MS, easing: PLAYLIST_FLY_PULSE_EASING }
    )
    return
  }
  target.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }],
    { duration: PLAYLIST_FLY_PULSE_MS, easing: PLAYLIST_FLY_PULSE_EASING }
  )
}

/**
 * Skip travel when the user prefers reduced motion.
 */
function prefersPlaylistFlyReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
