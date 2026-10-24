import { useVirtualizer } from '@tanstack/react-virtual'
import type { SubscriptionFeedEntry } from '@vidbee/subscriptions-core/feed-items'
import type { SubscriptionFeedItem } from '@vidbee/subscriptions-core/types'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const GRID_GAP = 16
const TITLE_HEIGHT_ESTIMATE = 64
const OVERSCAN_ROWS = 3

interface SubscriptionSource {
  id: string
  items?: SubscriptionFeedItem[]
}

interface SubscriptionVisibleRange {
  startIndex: number
  endIndex: number
}

interface SubscriptionVirtualGridProps<TSubscription extends SubscriptionSource> {
  entries: SubscriptionFeedEntry<TSubscription>[]
  viewport: HTMLDivElement | null
  renderEntry: (entry: SubscriptionFeedEntry<TSubscription>) => ReactNode
  onVisibleRangeChange?: (range: SubscriptionVisibleRange) => void
}

/** Render measured responsive rows while mounting only the viewport and nearby cards. */
export function SubscriptionVirtualGrid<TSubscription extends SubscriptionSource>({
  entries,
  viewport,
  renderEntry,
  onVisibleRangeChange
}: SubscriptionVirtualGridProps<TSubscription>) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState({ columns: 1, width: 0, scrollMargin: 0 })
  const { columns, width, scrollMargin } = geometry
  /** Keep measurements stable across scroll renders and distinguish repeated GUIDs by source. */
  const getRowKey = useCallback(
    (index: number) => {
      const entry = entries[index * columns]
      return JSON.stringify([columns, entry?.subscription.id, entry?.item.id])
    },
    [columns, entries]
  )
  const virtualizer = useVirtualizer({
    count: Math.ceil(entries.length / columns),
    getScrollElement: () => viewport,
    getItemKey: getRowKey,
    estimateSize: () =>
      ((width - GRID_GAP * (columns - 1)) / columns) * (9 / 16) + TITLE_HEIGHT_ESTIMATE,
    gap: GRID_GAP,
    overscan: OVERSCAN_ROWS,
    scrollMargin,
    useFlushSync: false
  })

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!(grid && viewport)) {
      return
    }
    /** Read the CSS breakpoint and content offset from this grid's own scroll viewport. */
    const measure = () => {
      const rect = grid.getBoundingClientRect()
      const next = {
        columns: Number.parseInt(getComputedStyle(grid).getPropertyValue('--rss-columns'), 10) || 1,
        width: rect.width,
        scrollMargin: rect.top - viewport.getBoundingClientRect().top + viewport.scrollTop
      }
      setGeometry((current) =>
        current.columns === next.columns &&
        current.width === next.width &&
        current.scrollMargin === next.scrollMargin
          ? current
          : next
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [viewport])

  useLayoutEffect(() => {
    // A channel change remounts this grid; feed refreshes keep the current position.
    viewport?.scrollTo({ top: 0 })
  }, [viewport])

  useLayoutEffect(() => {
    // Previously measured title heights belong to the previous card width.
    if (width > 0 && columns > 0) {
      virtualizer.measure()
    }
  }, [columns, width, virtualizer])

  const rows = virtualizer.getVirtualItems()
  const startIndex = (rows[0]?.index ?? 0) * columns
  const endIndex = Math.min(entries.length, ((rows.at(-1)?.index ?? -1) + 1) * columns)
  useEffect(() => {
    onVisibleRangeChange?.({ startIndex, endIndex })
  }, [endIndex, onVisibleRangeChange, startIndex])

  return (
    <div
      className="relative w-full [--rss-columns:1] md:[--rss-columns:2] lg:[--rss-columns:3] xl:[--rss-columns:4]"
      data-subscription-grid=""
      ref={gridRef}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => (
        <div
          data-index={row.index}
          key={row.key}
          ref={virtualizer.measureElement}
          style={{
            display: 'grid',
            gap: GRID_GAP,
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            left: 0,
            position: 'absolute',
            top: 0,
            transform: `translateY(${row.start - scrollMargin}px)`,
            width: '100%'
          }}
        >
          {entries.slice(row.index * columns, (row.index + 1) * columns).map(renderEntry)}
        </div>
      ))}
    </div>
  )
}
