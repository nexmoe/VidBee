import './agent-chat-composer.css'
import './agent-skill-badge.css'

import * as PopoverPrimitive from '@radix-ui/react-popover'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, Plus, Square, X } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { useFluidHover } from '../hooks/use-fluid-hover'
import { type AgentVideoReference, agentVideoToken } from '../lib/agent-video-text'
import { cn } from '../lib/cn'
import {
  composerEditorSelection,
  composerEditorValue,
  deleteComposerEditorSkill,
  insertComposerEditorText,
  setComposerEditorSelection,
  syncComposerEditor
} from './agent-composer-editor'
import {
  type AgentComposerMention,
  type AgentComposerSkill,
  AgentMentionMenu,
  skillMentionAt
} from './agent-skill-mentions'

const COMPOSER_MIN_HEIGHT = 28
const COMPOSER_MAX_HEIGHT = 320
const COMPOSER_MAX_LENGTH = 20_000
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
  skills?: readonly AgentComposerSkill[]
  videos?: readonly AgentVideoReference[]
  skillsLabel?: string
  noSkillsLabel?: string
  /** Refresh the managed library when the user asks to browse it. */
  onSkillsOpen?: () => void
  /** Let a workflow suggestion focus the editable draft without submitting it. */
  inputRef?: Ref<HTMLDivElement>
  reasoningControl?: ReactNode
  attachments?: { id: string; name: string; src: string }[]
  onAttachImages?: () => void
  onPasteImages?: (files: File[]) => void
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
function shouldSubmitComposer(event: KeyboardEvent<HTMLDivElement>): boolean {
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
  draft: string | HTMLElement,
  reservedWidth: number
): number {
  const style = getComputedStyle(frame)
  const padding =
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
  if (typeof draft === 'string') {
    sizer.textContent = draft || ' '
  } else {
    sizer.replaceChildren(...[...draft.childNodes].map((node) => node.cloneNode(true)))
    if (composerEditorValue(draft).endsWith('\n') && !sizer.querySelector('[data-composer-tail]')) {
      sizer.append(document.createElement('br'))
    }
  }
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
  draft: string | HTMLElement,
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
  skills = [],
  videos = [],
  skillsLabel = '',
  noSkillsLabel = '',
  onSkillsOpen,
  inputRef,
  reasoningControl,
  attachments = [],
  onAttachImages,
  onPasteImages,
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
  const editorRef = useRef<HTMLDivElement>(null)
  const skillListRef = useRef<HTMLDivElement>(null)
  const skillListId = useId()
  const skillHover = useFluidHover(skillListRef, { axis: 'y' })
  const refreshSkills = useRef(onSkillsOpen)
  refreshSkills.current = onSkillsOpen
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const composingRef = useRef(false)
  const [dismissedMention, setDismissedMention] = useState<string | null>(null)
  const mention = skillMentionAt(value, selection.start, selection.end)
  const mentionKey = mention ? `${mention.start}:${selection.start}:${mention.query}` : null
  const skillsOpen =
    !disabled && focused && !composing && mentionKey !== null && mentionKey !== dismissedMention
  const query = mention?.query.toLowerCase() ?? ''
  const matchingItems = [...skills, ...videos].filter((item) => {
    const text =
      'id' in item
        ? `${item.title} ${item.id}`
        : `${item.name} ${item.label ?? ''} ${item.description ?? ''}`
    return text.toLowerCase().includes(query)
  })
  const activeSkillIndex = Math.min(skillHover.activeIndex ?? 0, matchingItems.length - 1)
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

  useEffect(() => {
    if (skillsOpen) {
      refreshSkills.current?.()
    }
  }, [skillsOpen])

  useEffect(() => {
    if (skillsOpen) {
      skillHover.setActiveIndex(0)
    }
  }, [skillsOpen, skillHover.setActiveIndex])

  useEffect(() => {
    if (skillsOpen) {
      document
        .getElementById(`${skillListId}-${activeSkillIndex}`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  }, [skillsOpen, skillListId, activeSkillIndex])

  /** Track canonical offsets so localized badge labels do not shift mention replacement. */
  function syncSelection(input: HTMLDivElement): void {
    const next = composerEditorSelection(input)
    if (!next) {
      return
    }
    const text = composerEditorValue(input)
    if (text !== value || next.start !== selection.start || next.end !== selection.end) {
      setDismissedMention(null)
    }
    if (skillMentionAt(text, next.start, next.end)?.query !== mention?.query) {
      skillHover.setActiveIndex(0)
    }
    setSelection(next)
  }

  /** Keep the controlled draft in sync while letting the browser own in-progress IME composition. */
  function syncDraft(input: HTMLDivElement): void {
    const text = composerEditorValue(input)
    if (!composingRef.current && text.length > COMPOSER_MAX_LENGTH) {
      const limited = text.slice(0, COMPOSER_MAX_LENGTH)
      syncComposerEditor(input, limited, skills)
      syncSelection(input)
      onChange(limited)
      return
    }
    syncSelection(input)
    onChange(text)
  }

  /** Replace only the active mention, keeping the badge at its original position in the text. */
  function selectMention(item: AgentComposerMention): void {
    const input = editorRef.current
    if (!(mention && input)) {
      return
    }
    const prefix = value.slice(0, mention.start)
    const suffix = value.slice(mention.end)
    const space = prefix && !/[\s(]$/.test(prefix) ? ' ' : ''
    const reference = 'id' in item ? agentVideoToken(item) : `$${item.name}`
    const token = `${space}${reference}${/^\s/.test(suffix) ? '' : ' '}`
    if (value.length - (mention.end - mention.start) + token.length > COMPOSER_MAX_LENGTH) {
      return
    }
    insertComposerEditorText(input, token, skills, mention)
    syncDraft(input)
    setDismissedMention(mentionKey)
  }

  useLayoutEffect(() => {
    if (editorRef.current && !composing) {
      syncComposerEditor(editorRef.current, value, skills)
    }
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
        editorRef.current ?? value,
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
  }, [controlWidth, value, skills, composing])

  /** Let composition and multiline editing finish before treating Enter as submission. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (composing || event.nativeEvent.isComposing || event.keyCode === 229) {
      return
    }
    if (skillsOpen && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (matchingItems.length) {
          const step = event.key === 'ArrowDown' ? 1 : -1
          skillHover.setActiveIndex(
            (activeSkillIndex + step + matchingItems.length) % matchingItems.length
          )
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissedMention(mentionKey)
        return
      }
      if (event.key === 'Enter' || (event.key === 'Tab' && matchingItems.length)) {
        event.preventDefault()
        const skill = matchingItems[activeSkillIndex]
        if (skill) {
          selectMention(skill)
        } else {
          setDismissedMention(mentionKey)
        }
        return
      }
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      insertComposerEditorText(event.currentTarget, '\n', skills)
      syncDraft(event.currentTarget)
      return
    }
    if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      return
    }
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      deleteComposerEditorSkill(event.currentTarget, event.key === 'Backspace')
    ) {
      event.preventDefault()
      syncDraft(event.currentTarget)
      return
    }
    if (!shouldSubmitComposer(event)) {
      return
    }
    event.preventDefault()
    if (canSend) {
      onSend()
    }
  }

  return (
    <PopoverPrimitive.Root
      onOpenChange={(open) => {
        if (!open) {
          setDismissedMention(mentionKey)
        }
      }}
      open={skillsOpen}
    >
      <PopoverPrimitive.Anchor asChild>
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
              data-slot="composer-attachments"
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
                <div
                  aria-activedescendant={
                    skillsOpen && activeSkillIndex >= 0
                      ? `${skillListId}-${activeSkillIndex}`
                      : undefined
                  }
                  aria-autocomplete="list"
                  aria-controls={skillsOpen ? skillListId : undefined}
                  aria-disabled={disabled}
                  aria-expanded={skillsOpen}
                  aria-label={placeholder}
                  className="clipii-capture-input text-foreground"
                  contentEditable={!disabled}
                  data-empty={!value}
                  data-placeholder={placeholder}
                  onBeforeInput={(event) => {
                    const native = event.nativeEvent as InputEvent
                    if (native.inputType?.startsWith('format')) {
                      event.preventDefault()
                      return
                    }
                    const range = composerEditorSelection(event.currentTarget)
                    if (
                      !(composingRef.current || native.isComposing) &&
                      native.data &&
                      range &&
                      composerEditorValue(event.currentTarget).length -
                        (range.end - range.start) +
                        native.data.length >
                        COMPOSER_MAX_LENGTH
                    ) {
                      event.preventDefault()
                    }
                  }}
                  onBlur={() => setFocused(false)}
                  onCompositionEnd={(event) => {
                    composingRef.current = false
                    setComposing(false)
                    syncDraft(event.currentTarget)
                  }}
                  onCompositionStart={() => {
                    composingRef.current = true
                    setComposing(true)
                  }}
                  onCopy={(event) => {
                    const range = composerEditorSelection(event.currentTarget)
                    if (range && range.start !== range.end) {
                      event.preventDefault()
                      event.clipboardData.setData(
                        'text/plain',
                        composerEditorValue(event.currentTarget).slice(range.start, range.end)
                      )
                    }
                  }}
                  onCut={(event) => {
                    const range = composerEditorSelection(event.currentTarget)
                    if (range && range.start !== range.end) {
                      event.preventDefault()
                      event.clipboardData.setData(
                        'text/plain',
                        composerEditorValue(event.currentTarget).slice(range.start, range.end)
                      )
                      insertComposerEditorText(event.currentTarget, '', skills, range)
                      syncDraft(event.currentTarget)
                    }
                  }}
                  onDrop={(event) => event.preventDefault()}
                  onFocus={(event) => {
                    setFocused(true)
                    setDismissedMention(null)
                    if (!composerEditorSelection(event.currentTarget)) {
                      setComposerEditorSelection(event.currentTarget, value.length)
                    }
                    syncSelection(event.currentTarget)
                  }}
                  onInput={(event) => syncDraft(event.currentTarget)}
                  onKeyDown={handleKeyDown}
                  onPaste={(event) => {
                    event.preventDefault()
                    if (disabled) {
                      return
                    }
                    const images = Array.from(event.clipboardData.files).filter((file) =>
                      file.type.startsWith('image/')
                    )
                    if (images.length && onPasteImages) {
                      onPasteImages(images)
                      return
                    }
                    const range = composerEditorSelection(event.currentTarget)
                    const available =
                      COMPOSER_MAX_LENGTH -
                      composerEditorValue(event.currentTarget).length +
                      (range ? range.end - range.start : 0)
                    const text = event.clipboardData
                      .getData('text/plain')
                      .replace(/\r\n?/g, '\n')
                      .slice(0, Math.max(0, available))
                    if (text) {
                      insertComposerEditorText(event.currentTarget, text, skills)
                      syncDraft(event.currentTarget)
                    }
                  }}
                  onSelect={(event) => syncSelection(event.currentTarget)}
                  ref={(input) => {
                    editorRef.current = input
                    if (typeof inputRef === 'function') {
                      return inputRef(input)
                    }
                    if (inputRef) {
                      inputRef.current = input
                    }
                  }}
                  role="combobox"
                  suppressContentEditableWarning
                  tabIndex={0}
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
      </PopoverPrimitive.Anchor>
      <AgentMentionMenu
        activeIndex={activeSkillIndex}
        emptyLabel={noSkillsLabel}
        hover={skillHover}
        inputRef={editorRef}
        items={matchingItems}
        label={skillsLabel}
        listId={skillListId}
        listRef={skillListRef}
        onSelect={selectMention}
      />
    </PopoverPrimitive.Root>
  )
}
