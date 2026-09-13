import { cn } from '@renderer/lib/utils'
import {
  TravelingHighlight,
  useProximityHover,
  useRegisterProximityItem
} from '@vidbee/ui/components/ui/traveling-highlight'
import { useShape } from '@vidbee/ui/lib/shape-context'
import {
  Captions,
  Cookie,
  FileText,
  KeyRound,
  MessageSquareText,
  Settings2,
  SlidersHorizontal,
  UserRound
} from 'lucide-react'
import { type KeyboardEvent, type RefObject, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** Settings sections shown in the left-hand settings menu. */
export const SETTINGS_NAV_ITEMS = [
  ...(import.meta.env.DEV
    ? [{ icon: UserRound, labelKey: 'settings.account.tab', value: 'account' } as const]
    : []),
  { icon: Settings2, labelKey: 'settings.general', value: 'general' },
  { icon: FileText, labelKey: 'settings.metadataTab', value: 'metadata' },
  { icon: Cookie, labelKey: 'settings.cookiesTab', value: 'cookies' },
  { icon: KeyRound, labelKey: 'settings.providersTab', value: 'providers' },
  { icon: MessageSquareText, labelKey: 'settings.promptsTab', value: 'prompts' },
  { icon: Captions, labelKey: 'settings.transcriptionTab', value: 'transcribe' },
  { icon: SlidersHorizontal, labelKey: 'settings.advanced', value: 'advanced' }
] as const

export type SettingsNavTab = (typeof SETTINGS_NAV_ITEMS)[number]['value']

type SettingsNavItem = (typeof SETTINGS_NAV_ITEMS)[number]

const SETTINGS_NAV_GROUPS = [
  { id: 'app', labelKey: 'settings.navGroup.app', values: ['account', 'general'] },
  { id: 'download', labelKey: 'settings.navGroup.download', values: ['metadata', 'cookies'] },
  { id: 'ai', labelKey: 'settings.navGroup.ai', values: ['providers', 'prompts', 'transcribe'] },
  { id: 'system', labelKey: 'settings.navGroup.system', values: ['advanced'] }
] as const

/**
 * Resolve the settings row text tone from selection and hover.
 *
 * @param isActive Whether this row is the current section.
 * @param isHovered Whether the pointer or keyboard focus is on this row.
 * @returns Tailwind classes for the row label and icon color.
 */
function rowToneClass(isActive: boolean, isHovered: boolean): string {
  if (isActive) {
    return 'font-medium text-primary'
  }
  if (isHovered) {
    return 'text-foreground'
  }
  return 'text-muted-foreground'
}

/**
 * Render one settings section row and register it with the traveling highlight.
 *
 * @param props.item Section descriptor from SETTINGS_NAV_ITEMS.
 * @param props.index Index of the section in the flat nav list.
 * @param props.isActive Whether this section is selected.
 * @param props.isHovered Whether this section is nearest the pointer.
 * @param props.label Translated section label.
 * @param props.registerItem Proximity-hover registration callback.
 * @param props.onButtonRef Stores the button for keyboard focus movement.
 * @param props.onChange Called when the user selects this section.
 * @param props.onKeyDown Keyboard handler for arrow / Home / End.
 */
function SettingsNavButton({
  item,
  index,
  isActive,
  isHovered,
  label,
  registerItem,
  onButtonRef,
  onChange,
  onKeyDown
}: {
  item: SettingsNavItem
  index: number
  isActive: boolean
  isHovered: boolean
  label: string
  registerItem: (index: number, element: HTMLElement | null) => void
  onButtonRef: (index: number, element: HTMLButtonElement | null) => void
  onChange: (tab: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const Icon = item.icon

  useRegisterProximityItem(registerItem, index, buttonRef as RefObject<HTMLElement | null>)

  return (
    <button
      aria-selected={isActive}
      className={cn(
        'relative z-10 flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-sm transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        rowToneClass(isActive, isHovered)
      )}
      data-active={isActive ? '' : undefined}
      data-proximity-index={index}
      onClick={() => onChange(item.value)}
      onKeyDown={(event) => onKeyDown(event, index)}
      ref={(element) => {
        buttonRef.current = element
        onButtonRef(index, element)
      }}
      role="tab"
      tabIndex={isActive ? 0 : -1}
      type="button"
    >
      <Icon
        aria-hidden
        className="size-4 shrink-0 transition-[stroke-width] duration-80"
        strokeWidth={isActive || isHovered ? 2 : 1.5}
      />
      <span>{label}</span>
    </button>
  )
}

/**
 * Render the vertical settings section list.
 *
 * @param props.activeTab Currently selected section id.
 * @param props.onChange Called when the user selects another section.
 */
export function SettingsSectionNav({
  activeTab,
  onChange
}: {
  activeTab: string
  onChange: (tab: string) => void
}) {
  const { t } = useTranslation()
  const shape = useShape()
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = SETTINGS_NAV_ITEMS.findIndex((item) => item.value === activeTab)
  const {
    activeIndex: hoveredIndex,
    setActiveIndex: setHoveredIndex,
    itemRects,
    isMeasured,
    sessionRef,
    handlers,
    registerItem
  } = useProximityHover(containerRef)

  /**
   * Move focus and selection with arrow, Home, and End keys.
   *
   * @param event Keyboard event from a section button.
   * @param index Index of the focused section in the nav list.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (
      event.key !== 'ArrowDown' &&
      event.key !== 'ArrowUp' &&
      event.key !== 'End' &&
      event.key !== 'Home'
    ) {
      return
    }

    event.preventDefault()
    let nextIndex = index
    if (event.key === 'ArrowDown') {
      nextIndex = (index + 1) % SETTINGS_NAV_ITEMS.length
    } else if (event.key === 'ArrowUp') {
      nextIndex = (index - 1 + SETTINGS_NAV_ITEMS.length) % SETTINGS_NAV_ITEMS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else {
      nextIndex = SETTINGS_NAV_ITEMS.length - 1
    }

    const nextItem = SETTINGS_NAV_ITEMS[nextIndex]
    if (!nextItem) {
      return
    }

    onChange(nextItem.value)
    itemRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      aria-label={t('settings.title')}
      aria-orientation="vertical"
      className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4"
      onBlur={(event) => {
        if (containerRef.current?.contains(event.relatedTarget as Node)) {
          return
        }
        handlers.onMouseLeave()
      }}
      onFocus={(event) => {
        const trigger = (event.target as HTMLElement).closest('[role="tab"]')
        const indexAttr = trigger?.getAttribute('data-proximity-index')
        if (indexAttr == null) {
          return
        }
        setHoveredIndex(Number(indexAttr))
      }}
      onMouseEnter={handlers.onMouseEnter}
      onMouseLeave={handlers.onMouseLeave}
      onMouseMove={handlers.onMouseMove}
      ref={containerRef}
      role="tablist"
    >
      <TravelingHighlight
        hoveredIndex={hoveredIndex}
        isMeasured={isMeasured}
        itemRects={itemRects}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
        sessionRef={sessionRef}
        shapeClassName={shape.bg}
      />
      {SETTINGS_NAV_GROUPS.map((group) => (
        <div className="flex flex-col gap-1" key={group.id}>
          <p className="pl-3 font-semibold text-muted-foreground text-xs">{t(group.labelKey)}</p>
          {group.values.map((value) => {
            const item = SETTINGS_NAV_ITEMS.find((entry) => entry.value === value)
            if (!item) {
              return null
            }

            const index = SETTINGS_NAV_ITEMS.findIndex((entry) => entry.value === item.value)
            return (
              <SettingsNavButton
                index={index}
                isActive={activeTab === item.value}
                isHovered={hoveredIndex === index}
                item={item}
                key={item.value}
                label={t(item.labelKey)}
                onButtonRef={(buttonIndex, element) => {
                  itemRefs.current[buttonIndex] = element
                }}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                registerItem={registerItem}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
