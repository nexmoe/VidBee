import type { DownloadListRow } from './download-list-rows'

export interface DownloadListMeasurement {
  start: number
  size: number
}

/**
 * Position inside the list element. TanStack `start` already includes scrollMargin,
 * and this list element is already placed after that prefix.
 */
export const downloadListRowOffset = (start: number, scrollMargin: number): number =>
  start - scrollMargin

/**
 * Client rects for every selectable history row, including rows that are not mounted.
 */
export const downloadListGeometryRows = (input: {
  listRect: { left: number; right: number; top: number }
  matchingIds: ReadonlySet<string>
  measurements: ReadonlyArray<DownloadListMeasurement | undefined>
  rows: readonly DownloadListRow[]
  scrollMargin: number
}): Array<{ id: string; rect: { bottom: number; left: number; right: number; top: number } }> => {
  const rects: Array<{
    id: string
    rect: { bottom: number; left: number; right: number; top: number }
  }> = []
  for (let index = 0; index < input.rows.length; index += 1) {
    const row = input.rows[index]
    const measurement = input.measurements[index]
    if (row?.kind !== 'task' || !measurement) {
      continue
    }
    if (row.record.entryType !== 'history' || !input.matchingIds.has(row.record.id)) {
      continue
    }
    const top = input.listRect.top + downloadListRowOffset(measurement.start, input.scrollMargin)
    rects.push({
      id: row.record.id,
      rect: {
        bottom: top + measurement.size,
        left: input.listRect.left,
        right: input.listRect.right,
        top
      }
    })
  }
  return rects
}
