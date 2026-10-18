import type { DownloadRecord } from '../store/downloads'
import { buildDownloadTaskTree } from './download-task-tree'

export interface DownloadListTaskRow {
  kind: 'task'
  key: string
  depth: number
  record: DownloadRecord
}

export interface DownloadListPlaylistRow {
  kind: 'playlist'
  key: string
  groupId: string
  title: string
  totalCount: number
  records: DownloadRecord[]
}

export type DownloadListRow = DownloadListTaskRow | DownloadListPlaylistRow

/** Filtered task position before playlist expansion hides any rows. */
export interface DownloadListLocation {
  groupId: string | null
  expandedRowIndex: number
}

export interface DownloadListModel {
  rows: DownloadListRow[]
  locations: Map<string, DownloadListLocation>
  rowIndexById: Map<string, number>
  matchingIds: Set<string>
  contextIds: Set<string>
}

interface PlaylistGroup {
  id: string
  title: string
  totalCount: number
  records: DownloadRecord[]
}

/**
 * Append one task and its nested descendants.
 * Locations are recorded only while building the fully expanded list.
 */
const appendTasks = (
  record: DownloadRecord,
  depth: number,
  children: Map<string, DownloadRecord[]>,
  rows: DownloadListRow[],
  locations: Map<string, DownloadListLocation> | null,
  groupId: string | null
): void => {
  if (locations && !locations.has(record.id)) {
    locations.set(record.id, { expandedRowIndex: rows.length, groupId })
  }
  rows.push({
    depth,
    key: `${record.entryType}:${record.id}`,
    kind: 'task',
    record
  })
  const nested = children.get(record.id) ?? []
  for (const child of nested) {
    appendTasks(child, depth + 1, children, rows, locations, groupId)
  }
}

/**
 * Group playlist roots the same way the history list did before virtualization.
 */
const groupRoots = (
  roots: DownloadRecord[]
): {
  groups: Map<string, PlaylistGroup>
  order: Array<{ type: 'group'; id: string } | { type: 'single'; record: DownloadRecord }>
} => {
  const groups = new Map<string, PlaylistGroup>()
  const order: Array<{ type: 'group'; id: string } | { type: 'single'; record: DownloadRecord }> =
    []
  for (const record of roots) {
    if (record.playlistId) {
      let group = groups.get(record.playlistId)
      if (!group) {
        group = {
          id: record.playlistId,
          records: [],
          title: record.playlistTitle || record.title,
          totalCount: record.playlistSize || 0
        }
        groups.set(record.playlistId, group)
        order.push({ id: record.playlistId, type: 'group' })
      }
      group.records.push(record)
      if (!group.title && record.playlistTitle) {
        group.title = record.playlistTitle
      }
      if (!group.totalCount && record.playlistSize) {
        group.totalCount = record.playlistSize
      }
    } else {
      order.push({ record, type: 'single' })
    }
  }
  for (const group of groups.values()) {
    group.records.sort((left, right) => {
      const leftIndex = left.playlistIndex ?? Number.MAX_SAFE_INTEGER
      const rightIndex = right.playlistIndex ?? Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }
      return right.createdAt - left.createdAt
    })
    if (!group.totalCount) {
      group.totalCount = group.records.length
    }
  }
  return { groups, order }
}

/**
 * Build visible rows plus a pre-expand id index.
 * Collapsed playlist members stay in `locations` so transfer can expand that one group.
 */
export const buildDownloadListModel = (input: {
  records: DownloadRecord[]
  filtered: DownloadRecord[]
  contexts: DownloadRecord[]
  isExpanded: (groupId: string) => boolean
}): DownloadListModel => {
  const tree = buildDownloadTaskTree(input.records, input.filtered, input.contexts)
  const { groups, order } = groupRoots(tree.roots)
  const locations = new Map<string, DownloadListLocation>()
  const expandedRows: DownloadListRow[] = []
  const rows: DownloadListRow[] = []

  /**
   * Walk groups once for the full index and once for the rows currently expanded.
   */
  const walk = (collectLocations: boolean, into: DownloadListRow[]): void => {
    for (const item of order) {
      if (item.type === 'single') {
        appendTasks(item.record, 0, tree.children, into, collectLocations ? locations : null, null)
        continue
      }
      const group = groups.get(item.id)
      if (!group) {
        continue
      }
      into.push({
        groupId: group.id,
        key: `group:${group.id}`,
        kind: 'playlist',
        records: group.records,
        title: group.title,
        totalCount: group.totalCount
      })
      if (!(collectLocations || input.isExpanded(group.id))) {
        continue
      }
      for (const record of group.records) {
        appendTasks(record, 0, tree.children, into, collectLocations ? locations : null, group.id)
      }
    }
  }

  walk(true, expandedRows)
  walk(false, rows)
  const rowIndexById = new Map<string, number>()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row?.kind === 'task' && !rowIndexById.has(row.record.id)) {
      rowIndexById.set(row.record.id, index)
    }
  }
  return {
    contextIds: tree.contextIds,
    locations,
    matchingIds: tree.matchingIds,
    rowIndexById,
    rows
  }
}
