import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Puzzle, Video } from 'lucide-react'
import { type RefObject, useRef } from 'react'
import { type UseFluidHoverReturn, useRegisterFluidHoverItem } from '../hooks/use-fluid-hover'
import type { AgentVideoReference } from '../lib/agent-video-text'
import { Elevated } from '../lib/elevated'
import { useTypeScale } from '../lib/size-context'
import { FluidHoverHighlight } from './ui/fluid-hover-highlight'

export interface AgentComposerSkill {
  name: string
  /** A derived, localized label; the standard name remains the inserted command. */
  label?: string
  description?: string
}

export type AgentComposerMention = AgentComposerSkill | AgentVideoReference

interface SkillMention {
  start: number
  end: number
  query: string
}

const EMAIL_PREFIX = /[\w.%+/@\\-]/
const SKILL_QUERY = /^[\p{L}\p{N}\p{M} ._-]*$/u
const SKILL_SUFFIX = /^[\p{L}\p{N}\p{M}._-]*/u
/** Find the mention query at a collapsed caret without matching email addresses or escaped mentions. */
export function skillMentionAt(value: string, start: number, end: number): SkillMention | null {
  if (start !== end) {
    return null
  }
  const prefix = value.slice(0, start)
  const at = prefix.lastIndexOf('@')
  if (at < 0 || (at > 0 && EMAIL_PREFIX.test(prefix.charAt(at - 1)))) {
    return null
  }
  const query = prefix.slice(at + 1)
  if (!SKILL_QUERY.test(query)) {
    return null
  }
  return {
    start: at,
    end: start + (value.slice(start).match(SKILL_SUFFIX)?.[0].length ?? 0),
    query
  }
}

/** Keep each option registered with the shared moving hover highlight. */
function MentionOption({
  item,
  index,
  active,
  listId,
  registerItem,
  onSelect
}: {
  item: AgentComposerMention
  index: number
  active: boolean
  listId: string
  registerItem: UseFluidHoverReturn['registerItem']
  onSelect: (item: AgentComposerMention) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useRegisterFluidHoverItem(registerItem, index, ref)
  const type = useTypeScale()
  return (
    <button
      aria-selected={active}
      className="relative z-10 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left outline-none"
      id={`${listId}-${index}`}
      onClick={() => onSelect(item)}
      onMouseDown={(event) => event.preventDefault()}
      ref={ref}
      role="option"
      style={{ fontSize: type.body }}
      tabIndex={-1}
      type="button"
    >
      {'id' in item ? (
        <Video aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Puzzle aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {'id' in item ? item.title : (item.label ?? item.name)}
      </span>
    </button>
  )
}

/** Float suggestions above the composer while all editing and keyboard focus stay in the editor. */
export function AgentMentionMenu({
  items,
  activeIndex,
  hover,
  listRef,
  inputRef,
  listId,
  label,
  emptyLabel,
  onSelect
}: {
  items: readonly AgentComposerMention[]
  activeIndex: number
  hover: UseFluidHoverReturn
  listRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLDivElement | null>
  listId: string
  label: string
  emptyLabel: string
  onSelect: (item: AgentComposerMention) => void
}) {
  const type = useTypeScale()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align="start"
        aria-label={label}
        asChild
        id={listId}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && inputRef.current?.contains(event.target)) {
            event.preventDefault()
          }
        }}
        onOpenAutoFocus={(event) => event.preventDefault()}
        role="listbox"
        side="top"
        sideOffset={8}
      >
        <Elevated
          className="z-50 w-[min(24rem,var(--radix-popover-trigger-width))] overflow-hidden rounded-xl p-1.5 outline-none"
          offset={2}
          shadowLevel={3}
        >
          <div
            className="relative max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto"
            ref={listRef}
            {...hover.handlers}
          >
            <FluidHoverHighlight className="rounded-lg" hover={hover} />
            {items.length ? (
              items.map((item, index) => (
                <MentionOption
                  active={activeIndex === index}
                  index={index}
                  item={item}
                  key={'id' in item ? `video:${item.id}` : `skill:${item.name}`}
                  listId={listId}
                  onSelect={onSelect}
                  registerItem={hover.registerItem}
                />
              ))
            ) : (
              <p
                className="px-3 py-4 text-muted-foreground"
                role="status"
                style={{ fontSize: type.body }}
              >
                {emptyLabel}
              </p>
            )}
          </div>
        </Elevated>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}
