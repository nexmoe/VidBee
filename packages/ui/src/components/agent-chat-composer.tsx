import './agent-chat-composer.css'

import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, Plus, Square, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../lib/cn'

const COMPOSER_MIN_HEIGHT = 28
const COMPOSER_MAX_HEIGHT = 320
const COMPOSER_KIND_SPACE = 32
const COMPOSER_SEND_SPACE = 32
const COMPOSER_CONTROL_GAP = 4
const COMPOSER_FOOTER_HEIGHT = 36
const COMPOSER_CONTROL_FOOTER_OFFSET = 8
const COMPOSER_COLLAPSED_RADIUS = 28
const COMPOSER_EXPANDED_RADIUS = 20
const COMPOSER_EXPAND_THRESHOLD = 6
const COMPOSER_INSTANT_TRANSITION = { duration: 0 } as const
const COMPOSER_SHAPE_TRANSITION = {
  bounce: 0,
  duration: 0.28,
  type: 'spring'
} as const

interface AgentChatComposerProps {
  reasoningControl?: ReactNode
  attachments?: { id: string; name: string; src: string }[]
  onAttachImages?: () => void
  onRemoveImage?: (id: string) => void
  attachImagesLabel?: string
  removeImageLabel?: (name: string) => string
  sendDisabled?: boolean
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  running: boolean
  disabled: boolean
  placeholder: string
  sendLabel: string
  stopLabel: string
}

/** IME-safe Enter submits; Shift+Enter stays a newline. */
function shouldSubmitComposer(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  )
}

/**
 * Decide expand from the collapsed-width measurement only.
 * Hysteresis avoids flipping when wrap is within a few pixels of one line.
 */
export function composerShouldExpand(
  value: string,
  collapsedHeight: number,
  expanded: boolean
): boolean {
  if (value.includes('\n')) {
    return true
  }
  if (expanded) {
    return collapsedHeight > COMPOSER_MIN_HEIGHT
  }
  return collapsedHeight > COMPOSER_MIN_HEIGHT + COMPOSER_EXPAND_THRESHOLD
}

/** Measure wrap at a reserved side-cluster width (0 = full expanded editor). */
function measureDraftHeight(
  frame: HTMLElement,
  sizer: HTMLDivElement,
  draft: string,
  reservedWidth: number
): number {
  const style = getComputedStyle(frame)
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  sizer.textContent = draft || ' '
  sizer.style.width = `${Math.max(0, frame.clientWidth - padding - reservedWidth)}px`
  return Math.max(COMPOSER_MIN_HEIGHT, sizer.offsetHeight)
}

/**
 * Collapsed wrap decides expand; expanded wrap sizes the open editor.
 * Using the narrow measurement for both leaves a tall empty box once buttons drop to the footer.
 */
export function measureComposerDraftHeights(
  frame: HTMLElement,
  sizer: HTMLDivElement,
  draft: string,
  reservedWidth: number
): { collapsed: number; expanded: number } {
  const collapsed = measureDraftHeight(frame, sizer, draft, reservedWidth)
  const expanded = reservedWidth === 0 ? collapsed : measureDraftHeight(frame, sizer, draft, 0)
  return { collapsed, expanded }
}

/** Clamp the editor to Clipii's compact chat range. */
export function composerEditorHeight(expanded: boolean, contentHeight: number): number {
  if (!expanded) {
    return COMPOSER_MIN_HEIGHT
  }
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, contentHeight))
}

/** Match Clipii's duration/bounce=0 shape spring, or skip motion when requested. */
function composerShapeTransition(reducedMotion: boolean | null) {
  return reducedMotion ? COMPOSER_INSTANT_TRANSITION : COMPOSER_SHAPE_TRANSITION
}

/** Compose a persistent chat input with IME-safe keyboard submission and interruptible runs. */
export function AgentChatComposer({
  reasoningControl,
  attachments = [],
  onAttachImages,
  onRemoveImage,
  attachImagesLabel,
  removeImageLabel,
  sendDisabled = false,
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabled,
  placeholder,
  sendLabel,
  stopLabel
}: AgentChatComposerProps) {
  const reducedMotion = useReducedMotion()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sizerRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const expandedRef = useRef(false)
  const [collapsedHeight, setCollapsedHeight] = useState(COMPOSER_MIN_HEIGHT)
  const [expandedHeight, setExpandedHeight] = useState(COMPOSER_MIN_HEIGHT)
  const [actionsWidth, setActionsWidth] = useState(COMPOSER_SEND_SPACE)
  const expanded =
    attachments.length > 0 || composerShouldExpand(value, collapsedHeight, expandedRef.current)
  expandedRef.current = expanded
  const editorHeight = composerEditorHeight(expanded, expandedHeight)
  const shapeTransition = composerShapeTransition(reducedMotion)
  const canSend =
    !(running || disabled || sendDisabled) && Boolean(value.trim() || attachments.length)
  const controlWidth = onAttachImages ? COMPOSER_KIND_SPACE : 0
  const controlOffset = expanded ? editorHeight + COMPOSER_CONTROL_FOOTER_OFFSET : 0

  useLayoutEffect(() => {
    const frame = frameRef.current
    const sizer = sizerRef.current
    const actions = actionsRef.current
    if (!(frame && sizer)) {
      return
    }
    const sync = (): void => {
      const nextActionsWidth = Math.max(
        COMPOSER_SEND_SPACE,
        (actions?.offsetWidth ?? 0) + COMPOSER_CONTROL_GAP
      )
      setActionsWidth((current) => (current === nextActionsWidth ? current : nextActionsWidth))
      const heights = measureComposerDraftHeights(
        frame,
        sizer,
        value,
        controlWidth + nextActionsWidth
      )
      setCollapsedHeight((current) => (current === heights.collapsed ? current : heights.collapsed))
      setExpandedHeight((current) => (current === heights.expanded ? current : heights.expanded))
    }
    sync()
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(sync)
    observer.observe(frame)
    if (actions) {
      observer.observe(actions)
    }
    return () => observer.disconnect()
  }, [controlWidth, value])

  /** Let composition and multiline editing finish before treating Enter as submission. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!shouldSubmitComposer(event)) {
      return
    }
    event.preventDefault()
    if (canSend) {
      onSend()
    }
  }

  return (
    <motion.form
      animate={{
        borderRadius: expanded ? COMPOSER_EXPANDED_RADIUS : COMPOSER_COLLAPSED_RADIUS
      }}
      className="clipii-quick-capture pointer-events-auto relative z-10 min-h-11 overflow-hidden rounded-[28px]"
      data-expanded={expanded ? 'true' : 'false'}
      data-testid="agent-chat-composer"
      initial={false}
      onSubmit={(event) => {
        event.preventDefault()
        if (running) {
          onStop()
        } else if (canSend) {
          onSend()
        }
      }}
      transition={shapeTransition}
    >
      {attachments.length ? (
        <div
          className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1"
          data-testid="agent-chat-image-previews"
        >
          {attachments.map((attachment) => (
            <div
              className="group relative size-16 shrink-0 overflow-hidden rounded-xl border bg-muted"
              key={attachment.id}
            >
              <img
                alt={attachment.name}
                className="h-full w-full object-cover"
                src={attachment.src}
              />
              <button
                aria-label={removeImageLabel?.(attachment.name)}
                className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                disabled={disabled}
                onClick={() => onRemoveImage?.(attachment.id)}
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative">
        {onAttachImages ? (
          <motion.div
            animate={{ y: controlOffset }}
            className="clipii-capture-kind absolute top-2 left-2 z-10 flex items-center will-change-transform"
            initial={false}
            transition={shapeTransition}
          >
            <button
              aria-label={attachImagesLabel}
              className="clipii-capture-kind-button disabled:opacity-40"
              disabled={disabled}
              onClick={onAttachImages}
              title={attachImagesLabel}
              type="button"
            >
              <Plus className="size-4" strokeWidth={1.7} />
            </button>
          </motion.div>
        ) : null}
        <motion.div
          animate={{ y: controlOffset }}
          className="clipii-capture-actions absolute top-2 right-2 z-10 flex items-center will-change-transform"
          initial={false}
          ref={actionsRef}
          transition={shapeTransition}
        >
          {reasoningControl}
          <button
            aria-label={running ? stopLabel : sendLabel}
            className="clipii-capture-submit"
            disabled={!(running || canSend)}
            type="submit"
          >
            {running ? <Square /> : <ArrowUp />}
          </button>
        </motion.div>
        <div
          className={cn(
            'clipii-capture-editor-frame flex p-2',
            expanded ? 'items-end' : 'items-center'
          )}
          ref={frameRef}
        >
          <div
            aria-hidden="true"
            className="clipii-capture-sizer pointer-events-none invisible absolute"
            ref={sizerRef}
          />
          <motion.div
            animate={{
              height: editorHeight,
              marginLeft: expanded ? 0 : controlWidth,
              marginRight: expanded ? 0 : actionsWidth
            }}
            className="min-w-0 flex-1 overflow-hidden"
            initial={false}
            transition={shapeTransition}
          >
            <textarea
              aria-label={placeholder}
              className="clipii-capture-input text-foreground"
              maxLength={20_000}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              ref={textareaRef}
              rows={1}
              value={value}
            />
          </motion.div>
        </div>
        <motion.div
          animate={{
            height: expanded ? COMPOSER_FOOTER_HEIGHT : 0,
            opacity: expanded ? 1 : 0
          }}
          aria-hidden={!expanded}
          className={cn('overflow-hidden', !expanded && 'pointer-events-none')}
          initial={false}
          transition={shapeTransition}
        >
          <div className="min-h-9" />
        </motion.div>
      </div>
    </motion.form>
  )
}
