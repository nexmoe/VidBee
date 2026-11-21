import { useCallback, useRef, useState } from 'react'
import { logger } from '../../lib/logger'

const STORAGE_KEY_PREFIX = 'playlist_expanded_'

/**
 * Read the saved expanded flag. Missing or unreadable storage stays collapsed.
 */
export const loadPlaylistExpanded = (groupId: string): boolean => {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${groupId}`) === 'true'
  } catch (error) {
    logger.error('Failed to load playlist expanded state:', error)
    return false
  }
}

/**
 * Persist one playlist group's expanded flag.
 */
export const savePlaylistExpanded = (groupId: string, isExpanded: boolean): void => {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${groupId}`, String(isExpanded))
  } catch (error) {
    logger.error('Failed to save playlist expanded state:', error)
  }
}

/**
 * Remember playlist expansion for the history list. Reads localStorage once per group.
 */
export const usePlaylistExpanded = (): {
  expand: (groupId: string) => void
  isExpanded: (groupId: string) => boolean
  toggle: (groupId: string) => void
} => {
  const cacheRef = useRef(new Map<string, boolean>())
  const [overrides, setOverrides] = useState(new Map<string, boolean>())

  const isExpanded = useCallback(
    (groupId: string): boolean => {
      const override = overrides.get(groupId)
      if (override !== undefined) {
        return override
      }
      const cached = cacheRef.current.get(groupId)
      if (cached !== undefined) {
        return cached
      }
      const stored = loadPlaylistExpanded(groupId)
      cacheRef.current.set(groupId, stored)
      return stored
    },
    [overrides]
  )

  const expand = useCallback(
    (groupId: string): void => {
      if (isExpanded(groupId)) {
        return
      }
      cacheRef.current.set(groupId, true)
      savePlaylistExpanded(groupId, true)
      setOverrides((previous) => new Map(previous).set(groupId, true))
    },
    [isExpanded]
  )

  const toggle = useCallback(
    (groupId: string): void => {
      const next = !isExpanded(groupId)
      cacheRef.current.set(groupId, next)
      savePlaylistExpanded(groupId, next)
      setOverrides((previous) => new Map(previous).set(groupId, next))
    },
    [isExpanded]
  )

  return { expand, isExpanded, toggle }
}
