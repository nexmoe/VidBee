import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { type ContentSearchResults, emptyContentSearchResults } from '@shared/content-search'
import { useEffect, useState } from 'react'

const SEARCH_DEBOUNCE_MS = 200

interface SearchState {
  query: string
  results: ContentSearchResults
  loading: boolean
  failed: boolean
}

/** Debounce full-text IPC, cancel obsolete scans, and never publish a previous query's results. */
export function useContentSearch(query: string, enabled = true) {
  const normalized = query.trim()
  const [state, setState] = useState<SearchState>({
    query: '',
    results: emptyContentSearchResults(),
    loading: false,
    failed: false
  })

  useEffect(() => {
    if (!(normalized && enabled)) {
      return
    }
    let cancelled = false
    let started = false
    const timer = window.setTimeout(() => {
      started = true
      setState({
        query: normalized,
        results: emptyContentSearchResults(),
        loading: true,
        failed: false
      })
      void ipcServices.search
        .content(normalized)
        .then((results) => {
          if (!cancelled) {
            setState({ query: normalized, results, loading: false, failed: false })
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            logger.error('Failed to search local content:', error)
            setState({
              query: normalized,
              results: emptyContentSearchResults(),
              loading: false,
              failed: true
            })
          }
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (started) {
        // Cleanup also runs after the palette closes; its native scan must stop.
        void ipcServices.search.content('').catch(() => undefined)
      }
    }
  }, [enabled, normalized])

  const current = normalized !== '' && state.query === normalized
  return {
    results: current ? state.results : emptyContentSearchResults(),
    loading: normalized !== '' && (!current || state.loading),
    failed: current && state.failed
  }
}
