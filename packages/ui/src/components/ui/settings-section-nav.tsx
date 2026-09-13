'use client'

import type { LucideIcon } from 'lucide-react'
import { type KeyboardEvent, type RefObject, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useProximityHover, useRegisterProximityItem } from '../../hooks/use-proximity-hover'
import { cn } from '../../lib/cn'
import { useShape } from '../../lib/shape-context'
import { TravelingHighlight } from './traveling-highlight'

export interface SettingsSectionNavItem {
  icon: LucideIcon
  labelKey: string
  value: string
}

export interface SettingsSectionNavGroup {
  id: string
  labelKey: string
  values: readonly string[]
}

function rowToneClass(isActive: boolean, isHovered: boolean): string {
  if (isActive) {
    return 'font-medium text-primary'
  }
  if (isHovered) {
    return 'text-foreground'
  }
  return 'text-muted-foreground'
}

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
  item: SettingsSectionNavItem
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

export function SettingsSectionNav({
  activeTab,
  groups,
  items,
  onChange,
  titleKey = 'settings.title'
}: {
  activeTab: string
  groups: readonly SettingsSectionNavGroup[]
  items: readonly SettingsSectionNavItem[]
  onChange: (tab: string) => void
  titleKey?: string
}) {
  const { t } = useTranslation()
  const shape = useShape()
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = items.findIndex((item) => item.value === activeTab)
  const {
    activeIndex: hoveredIndex,
    setActiveIndex: setHoveredIndex,
    itemRects,
    isMeasured,
    sessionRef,
    handlers,
    registerItem
  } = useProximityHover(containerRef)

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
      nextIndex = (index + 1) % items.length
    } else if (event.key === 'ArrowUp') {
      nextIndex = (index - 1 + items.length) % items.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else {
      nextIndex = items.length - 1
    }

    const nextItem = items[nextIndex]
    if (!nextItem) {
      return
    }

    onChange(nextItem.value)
    itemRefs.current[nextIndex]?.focus()
  }

  return (
    <div
      aria-label={t(titleKey)}
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
      {groups.map((group) => (
        <div className="flex flex-col gap-1" key={group.id}>
          <p className="pl-3 font-semibold text-muted-foreground text-xs">{t(group.labelKey)}</p>
          {group.values.map((value) => {
            const item = items.find((entry) => entry.value === value)
            if (!item) {
              return null
            }
            const index = items.findIndex((entry) => entry.value === item.value)
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
