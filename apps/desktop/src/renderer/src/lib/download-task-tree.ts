import type { DownloadRecord } from '../store/downloads'

/** Include source ancestors as context while keeping only matching records selectable. */
export function buildDownloadTaskTree(
  records: DownloadRecord[],
  matches: DownloadRecord[],
  contexts: DownloadRecord[] = []
) {
  const byId = new Map(records.map((record) => [record.id, record]))
  const matchingIds = new Set(matches.map((record) => record.id))
  const included = new Map<string, DownloadRecord>()
  const contextIds = new Set(contexts.map((record) => record.id))
  for (const match of [...matches, ...contexts]) {
    let record: DownloadRecord | undefined = match
    while (record && !included.has(record.id)) {
      included.set(record.id, record)
      record = record.parentId ? byId.get(record.parentId) : undefined
    }
  }
  const children = new Map<string, DownloadRecord[]>()
  const roots: DownloadRecord[] = []
  for (const record of included.values()) {
    if (record.parentId && included.has(record.parentId)) {
      const siblings = children.get(record.parentId) ?? []
      siblings.push(record)
      children.set(record.parentId, siblings)
    } else {
      roots.push(record)
    }
  }
  return { roots, children, matchingIds, contextIds }
}
