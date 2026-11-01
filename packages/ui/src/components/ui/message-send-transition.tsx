import { animate, useReducedMotion } from 'framer-motion'
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { getMessageSendPose, messageSendMotion } from '../../lib/message-send-motion'
import { spring } from '../../lib/springs'

const MESSAGE_SELECTOR = '[data-slot="message"][data-message-id]'

interface PreviousMessage {
  id: string | undefined
  top: number
  visible: boolean
}

interface SendTransition {
  scope: { identity: string }
  startedAt: number
  onComplete?: () => void
  viewport: HTMLDivElement
  composer: HTMLFormElement
  previous: PreviousMessage[]
  source: {
    left: number
    top: number
    width: number
    height: number
    textCenter: number
    fontSize: number
  }
  media: boolean
}

/** Anchor the flight to the text itself rather than the editor's full padded height. */
function textBounds(element: HTMLElement): DOMRect {
  const range = document.createRange()
  range.selectNodeContents(element)
  const bounds = range.getBoundingClientRect()
  return bounds.height ? bounds : element.getBoundingClientRect()
}

/** Build a noninteractive visual copy in the conversation's layer behind the composer. */
function createFlight(target: HTMLElement, layer: HTMLElement) {
  const rect = target.getBoundingClientRect()
  const computed = getComputedStyle(target)
  const clone = target.cloneNode(true) as HTMLElement
  clone.inert = true
  clone.setAttribute('aria-hidden', 'true')
  for (const element of [clone, ...clone.querySelectorAll('[id]')]) {
    element.removeAttribute('id')
  }
  Object.assign(clone.style, {
    position: 'absolute',
    inset: '0 auto auto 0',
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    maxWidth: 'none',
    margin: '0',
    display: computed.display,
    font: computed.font,
    color: computed.color,
    opacity: '1',
    pointerEvents: 'none',
    transformOrigin: 'top right',
    willChange: 'transform'
  })
  const body = target.matches('[data-slot="bubble"]')
    ? target.querySelector<HTMLElement>('[data-slot="bubble-content"]')
    : null
  const glyphs = body ? clone.querySelector<HTMLElement>('[data-slot="bubble-content"]') : null
  const bodyStyle = body ? getComputedStyle(body) : null
  const text = body ? textBounds(body) : rect
  const surface = body?.cloneNode(false) as HTMLElement | undefined
  if (surface && glyphs && bodyStyle) {
    Object.assign(surface.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      maxWidth: 'none',
      padding: '0',
      border: '0',
      overflow: 'hidden',
      background: bodyStyle.backgroundColor,
      transformOrigin: 'top right',
      willChange: 'transform'
    })
    Object.assign(glyphs.style, {
      position: 'absolute',
      inset: '0 auto auto 0',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      maxWidth: 'none',
      margin: '0',
      padding: bodyStyle.padding,
      font: bodyStyle.font,
      color: bodyStyle.color,
      borderRadius: bodyStyle.borderRadius,
      background: 'transparent',
      boxShadow: 'none',
      transformOrigin: 'top left',
      willChange: 'transform'
    })
    // Counter-scale the contents so widening the surface never stretches letters or badges.
    surface.append(glyphs)
    clone.replaceChildren(surface)
  }
  const metrics = bodyStyle
    ? {
        left:
          Number.parseFloat(bodyStyle.paddingLeft) + Number.parseFloat(bodyStyle.borderLeftWidth),
        top: Number.parseFloat(bodyStyle.paddingTop) + Number.parseFloat(bodyStyle.borderTopWidth),
        bottom:
          Number.parseFloat(bodyStyle.paddingBottom) +
          Number.parseFloat(bodyStyle.borderBottomWidth),
        radius: Number.parseFloat(bodyStyle.borderTopRightRadius),
        textCenter: text.top + text.height / 2 - rect.top,
        fontSize: Number.parseFloat(bodyStyle.fontSize)
      }
    : null
  layer.append(clone)
  return { clone, surface, glyphs, metrics, rect }
}

/** Animate a locally presented composer message on the submission clock, independent of IPC latency. */
export function useMessageSendTransition({
  identity,
  inputRef,
  viewportRef
}: {
  identity: string
  inputRef: RefObject<HTMLDivElement | null>
  viewportRef: RefObject<HTMLDivElement | null>
}) {
  const reducedMotion = useReducedMotion()
  const scopeRef = useRef<SendTransition['scope'] | null>(null)
  const [pending, setPending] = useState<SendTransition | null>(null)

  useLayoutEffect(() => {
    const scope = { identity }
    scopeRef.current = scope
    setPending(null)
    return () => {
      scopeRef.current = null
    }
  }, [identity])

  useLayoutEffect(() => {
    if (!pending) {
      return
    }
    const { viewport, composer, source, previous, media, startedAt, onComplete } = pending
    const previousIds = new Set(previous.map((message) => message.id))
    const layer = viewport
      .closest('[data-slot="agent-conversation"]')
      ?.querySelector<HTMLElement>('[data-slot="message-send-layer"]')
    if (
      !layer ||
      pending.scope.identity !== identity ||
      pending.scope !== scopeRef.current ||
      document.hidden
    ) {
      onComplete?.()
      setPending((current) => (current === pending ? null : current))
      return
    }
    const flightLayer = layer
    let frame = 0
    let finished = false
    let restore = (): void => {}
    let stop: (() => void) | undefined
    const observer = new MutationObserver(start)
    const fallback = setTimeout(finish, messageSendMotion.duration * 1000 + 250)

    /** Restore every owned style when finished, interrupted, navigated away, or unmounted. */
    function cleanup(): void {
      if (finished) {
        return
      }
      finished = true
      cancelAnimationFrame(frame)
      clearTimeout(fallback)
      observer.disconnect()
      stop?.()
      restore()
      document.removeEventListener('visibilitychange', finish)
      window.removeEventListener('resize', finish)
      viewport.removeEventListener('wheel', finish)
      viewport.removeEventListener('touchstart', finish)
      viewport.removeEventListener('pointerdown', finish)
      viewport.removeEventListener('keydown', finish)
      onComplete?.()
    }

    /** Hand off to the real message without retaining the previous conversation. */
    function finish(): void {
      if (finished) {
        return
      }
      cleanup()
      setPending((current) => (current === pending ? null : current))
    }

    /** Pick the local outgoing row without animating history, automatic runs, or card answers. */
    function start(): void {
      const rows = [...viewport.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)]
      const incoming = rows.filter(
        (row) => row.dataset.align === 'end' && !previousIds.has(row.dataset.messageId)
      )
      const row = incoming.length === 1 ? incoming[0] : undefined
      const target =
        row?.querySelector<HTMLElement>('[data-slot="message-media-group"]') ??
        row?.querySelector<HTMLElement>('[data-slot="bubble"]')
      if (!target) {
        return
      }
      observer.disconnect()
      const opacity = target.style.opacity
      target.style.opacity = '0'
      restore = () => {
        target.style.opacity = opacity
      }
      if (reducedMotion) {
        const animation = animate(
          target,
          { opacity: [0, 1] },
          { ...spring.fast, onComplete: finish }
        )
        stop = () => animation.stop()
        return
      }
      const flight = createFlight(target, flightLayer)
      const rowsById = new Map(rows.map((message) => [message.dataset.messageId, message]))
      const history = previous
        .filter((message) => message.visible)
        .flatMap((message) => {
          const element = rowsById.get(message.id)
          return element
            ? [
                {
                  element,
                  top: message.top,
                  offset: 0,
                  layoutTop: 0,
                  transform: element.style.transform,
                  willChange: element.style.willChange
                }
              ]
            : []
        })
      let historyDirty = true
      let historyFinished = false

      /** Remeasure historical rows only when their layout changes, not for their own transforms. */
      function invalidateHistory(): void {
        historyDirty = true
      }

      const historyObserver =
        typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(invalidateHistory)
      const content = viewport.querySelector('[data-slot="message-scroller-content"]')
      if (content) {
        historyObserver?.observe(content)
      }
      for (const item of history) {
        historyObserver?.observe(item.element)
        item.element.style.willChange = 'transform'
      }
      const sending = composer.getAttribute('data-message-sending')
      restore = () => {
        historyObserver?.disconnect()
        target.style.opacity = opacity
        flight.clone.remove()
        for (const item of history) {
          item.element.style.transform = item.transform
          item.element.style.willChange = item.willChange
        }
        if (sending === null) {
          composer.removeAttribute('data-message-sending')
        } else {
          composer.setAttribute('data-message-sending', sending)
        }
      }
      /** Read the live destination so scrolling and the collapsing composer cannot leave a stale endpoint. */
      function render(now: number): void {
        if (!(target?.isConnected && flightLayer.isConnected) || document.hidden) {
          finish()
          return
        }
        const time = (now - startedAt) / 1000
        const pose = getMessageSendPose(time)
        const to = target.getBoundingClientRect()
        const host = flightLayer.getBoundingClientRect()
        const composerBounds = composer.getBoundingClientRect()
        const scrollTop = viewport.scrollTop
        if (!historyFinished && pose.history < 1 && (historyDirty || !historyObserver)) {
          for (const item of history) {
            item.layoutTop = item.element.getBoundingClientRect().top - item.offset + scrollTop
          }
          historyDirty = false
        }
        if (
          !(to.width && to.height) ||
          Math.abs(to.width - flight.rect.width) > 1 ||
          Math.abs(to.height - flight.rect.height) > 1
        ) {
          finish()
          return
        }
        // FLIP existing rows against their live resting positions, including native follow-to-end scrolling.
        if (!historyFinished) {
          for (const item of history) {
            item.offset = (item.top - item.layoutTop + scrollTop) * (1 - pose.history)
            item.element.style.transform = `translate3d(0, ${item.offset}px, 0) ${item.transform}`
          }
          if (pose.history === 1) {
            historyFinished = true
            historyObserver?.disconnect()
          }
        }
        const { rect, metrics, surface, glyphs, clone } = flight
        clone.style.transform = `translate3d(${to.left - host.left}px, ${to.top - host.top}px, 0)`
        let bottom: number
        if (surface && glyphs && metrics && !media) {
          const sourceFontScale = source.fontSize / metrics.fontSize
          const sourceWidth = Math.max(1, to.right - source.left + metrics.left * sourceFontScale)
          const sourceHeight = source.height + metrics.top + metrics.bottom
          const width =
            sourceWidth * (1 - pose.contraction) + rect.width * pose.scale * pose.contraction
          const height =
            sourceHeight * (1 - pose.contraction) + rect.height * pose.scale * pose.contraction
          const textScale = pose.scale * (1 + (sourceFontScale - 1) * (1 - pose.contraction))
          const center =
            source.textCenter + (to.top + metrics.textCenter - source.textCenter) * pose.rise
          const top = center - metrics.textCenter * textScale
          const scaleX = width / rect.width
          const scaleY = height / rect.height
          const radius = Math.min(metrics.radius, width / 2, height / 2)
          surface.style.transform = `translate3d(0, ${top - to.top}px, 0) scale(${scaleX}, ${scaleY})`
          surface.style.borderRadius = `${radius / scaleX}px / ${radius / scaleY}px`
          glyphs.style.transform = `scale(${textScale / scaleX}, ${textScale / scaleY})`
          bottom = top + height
        } else {
          // Media stays uniformly scaled so photographs retain their original aspect ratio.
          const sourceScale = Math.min(1, source.width / rect.width, source.height / rect.height)
          const scale = sourceScale * (1 - pose.contraction) + pose.scale * pose.contraction
          const right =
            source.left + source.width + (to.right - source.left - source.width) * pose.contraction
          const top = source.top + (to.top - source.top) * pose.rise
          clone.style.transform = `translate3d(${right - rect.width - host.left}px, ${top - host.top}px, 0) scale(${scale})`
          bottom = top + rect.height * scale
        }
        // Keep the placeholder and controls in front while the outgoing surface passes behind the input.
        const overlapping = bottom > composerBounds.top
        composer.toggleAttribute('data-message-sending', overlapping)
        if (time >= messageSendMotion.duration) {
          finish()
          return
        }
        frame = requestAnimationFrame(render)
      }
      render(performance.now())
    }

    document.addEventListener('visibilitychange', finish)
    window.addEventListener('resize', finish)
    viewport.addEventListener('wheel', finish, { passive: true })
    viewport.addEventListener('touchstart', finish, { passive: true })
    viewport.addEventListener('pointerdown', finish, { passive: true })
    viewport.addEventListener('keydown', finish)
    observer.observe(viewport, { childList: true, subtree: true })
    start()
    return cleanup
  }, [pending, reducedMotion, identity])

  /** Capture the submit instant; start alongside the optimistic row and finish on every cleanup path. */
  const prepare = useCallback(
    (onComplete?: () => void) => {
      const startedAt = performance.now()
      const input = inputRef.current
      const viewport = viewportRef.current
      const scope = scopeRef.current
      const composer = input?.closest('form')
      if (!(input && viewport && scope && composer) || document.hidden) {
        return () => onComplete?.()
      }
      const attachment = composer.querySelector<HTMLElement>(
        '[data-slot="composer-attachments"] > div'
      )
      const rect = (attachment ?? input).getBoundingClientRect()
      if (!(rect.width && rect.height)) {
        return () => onComplete?.()
      }
      const view = viewport.getBoundingClientRect()
      const padding = getComputedStyle(input)
      const text = textBounds(input)
      const left = attachment ? rect.left : rect.left + Number.parseFloat(padding.paddingLeft)
      const top = attachment ? rect.top : rect.top + Number.parseFloat(padding.paddingTop)
      const height = attachment
        ? rect.height
        : rect.height -
          Number.parseFloat(padding.paddingTop) -
          Number.parseFloat(padding.paddingBottom)
      const transition: SendTransition = {
        scope,
        startedAt,
        onComplete,
        viewport,
        composer,
        media: Boolean(attachment),
        previous: [...viewport.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)].map((row) => {
          const bounds = row.getBoundingClientRect()
          return {
            id: row.dataset.messageId,
            top: bounds.top,
            visible: bounds.bottom > view.top && bounds.top < view.bottom
          }
        }),
        source: {
          left,
          top,
          width: rect.width,
          height,
          textCenter: text.top + text.height / 2,
          fontSize: Number.parseFloat(padding.fontSize)
        }
      }
      return () => {
        if (scopeRef.current === scope && input.isConnected && viewport.isConnected) {
          setPending(transition)
        } else {
          onComplete?.()
        }
      }
    },
    [inputRef, viewportRef]
  )

  return prepare
}
