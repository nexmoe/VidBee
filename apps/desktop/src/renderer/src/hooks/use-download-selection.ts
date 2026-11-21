import { useCallback, useEffect, useRef, useState } from 'react'

export interface DownloadSelectionModifiers {
  anchorId?: string
  range?: boolean
  toggle?: boolean
}

/** Keep row, checkbox, keyboard and marquee selection on the same ordered set. */
export const useDownloadSelection = (orderedIds: string[], rangeIds: string[]) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => selectedIds.has(id))

  useEffect(() => {
    const allowed = new Set(orderedIds)
    if (anchorRef.current && !allowed.has(anchorRef.current)) {
      anchorRef.current = null
    }
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => allowed.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [orderedIds])

  /** Clear both the selection and its range anchor. */
  const clearSelection = useCallback((): void => {
    anchorRef.current = null
    setSelectedIds(new Set())
  }, [])

  /** Replace a marquee selection and use its first row as the next range anchor. */
  const selectIds = useCallback(
    (ids: string[]): void => {
      const allowed = new Set(orderedIds)
      const next = ids.filter((id) => allowed.has(id))
      anchorRef.current = next[0] ?? null
      setSelectedIds(new Set(next))
    },
    [orderedIds]
  )

  /** Replace, toggle or extend a selection without including collapsed or unrelated rows. */
  const selectItem = (
    id: string,
    { anchorId, range = false, toggle = true }: DownloadSelectionModifiers = {}
  ): void => {
    if (!orderedIds.includes(id)) {
      return
    }
    if (range) {
      const anchor =
        anchorRef.current && rangeIds.includes(anchorRef.current)
          ? anchorRef.current
          : (anchorId ?? id)
      anchorRef.current = anchor
      const anchorIndex = anchor ? rangeIds.indexOf(anchor) : -1
      const targetIndex = rangeIds.indexOf(id)
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const ids = rangeIds.slice(
          Math.min(anchorIndex, targetIndex),
          Math.max(anchorIndex, targetIndex) + 1
        )
        setSelectedIds((previous) => new Set([...(toggle ? previous : []), ...ids]))
        return
      }
    }
    anchorRef.current = id
    setSelectedIds((previous) => {
      if (!toggle) {
        return new Set([id])
      }
      const next = new Set(previous)
      if (!next.delete(id)) {
        next.add(id)
      }
      return next
    })
  }

  /** Select all filtered results, including collapsed playlist members. */
  const selectAll = (): void => {
    anchorRef.current = rangeIds[0] ?? orderedIds[0] ?? null
    setSelectedIds(new Set(orderedIds))
  }

  /** Toggle the toolbar master checkbox without changing the current filter. */
  const toggleSelectAll = (): void => {
    if (allSelected) {
      clearSelection()
    } else {
      selectAll()
    }
  }

  return {
    allSelected,
    clearSelection,
    selectAll,
    selectedIds,
    selectIds,
    selectItem,
    setSelectedIds,
    toggleSelectAll
  }
}
