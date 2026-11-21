import { matchesDownloadPlatformFilter } from '@vidbee/ui/lib/download-platform'
import { useStore } from 'jotai'
import { useEffect, useState } from 'react'
import type { DownloadRecord } from '../store/downloads'
import { transcriptMapAtom } from '../store/transcripts'

const EMPTY_CONTEXTS: DownloadRecord[] = []

/**
 * True when both lists hold the same record objects in order.
 * Structural updates replace the record object; unrelated transcript updates do not.
 */
const sameContextRecords = (
  left: readonly DownloadRecord[],
  right: readonly DownloadRecord[]
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

/**
 * Context rows for the origin filter. Subscribes only while a specific origin is selected.
 * Reads `creation.origin` from the transcript map and ignores every other transcript field.
 */
export const useDownloadOriginContexts = (
  records: DownloadRecord[],
  originFilter: string,
  platformFilter: string
): DownloadRecord[] => {
  const store = useStore()
  const [contexts, setContexts] = useState<DownloadRecord[]>(EMPTY_CONTEXTS)

  useEffect(() => {
    if (originFilter === 'all') {
      setContexts((current) => (current.length === 0 ? current : EMPTY_CONTEXTS))
      return
    }
    /**
     * Keep the previous list while every context row is still the same object.
     */
    const publish = () => {
      const map = store.get(transcriptMapAtom)
      const next = records.filter(
        (record) =>
          matchesDownloadPlatformFilter(record.url, platformFilter) &&
          map[record.id]?.creation?.origin === originFilter
      )
      setContexts((current) => (sameContextRecords(current, next) ? current : next))
    }
    publish()
    return store.sub(transcriptMapAtom, publish)
  }, [originFilter, platformFilter, records, store])

  return originFilter === 'all' ? EMPTY_CONTEXTS : contexts
}
