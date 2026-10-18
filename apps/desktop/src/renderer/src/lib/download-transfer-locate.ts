import type { DownloadTransferLocateSession } from '@vidbee/ui/lib/download-transfer-target'
import type { DownloadListLocation } from './download-list-rows'

/**
 * Wait one frame, and cancel that frame when the locate session is aborted.
 */
export const waitForLocateFrame = (session: DownloadTransferLocateSession): Promise<void> =>
  new Promise((resolve) => {
    if (session.signal.aborted || Date.now() >= session.deadline) {
      resolve()
      return
    }
    const onAbort = () => {
      window.cancelAnimationFrame(frame)
      resolve()
    }
    const frame = window.requestAnimationFrame(() => {
      session.signal.removeEventListener('abort', onAbort)
      resolve()
    })
    session.signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * Reveal one filtered download. A missing visible row is not treated as filtered out.
 * The pre-expand location decides that, then a collapsed group is expanded before scrolling.
 */
export const locateDownloadTransferTarget = async (input: {
  downloadId: string | undefined
  expandGroup: (groupId: string) => void
  getLocation: (downloadId: string) => DownloadListLocation | undefined
  getRowIndex: (downloadId: string) => number | undefined
  isGroupExpanded: (groupId: string) => boolean
  isRowMounted: (downloadId: string) => boolean
  scrollToIndex: (index: number) => void
  session: DownloadTransferLocateSession
  waitForFrame?: (session: DownloadTransferLocateSession) => Promise<void>
}): Promise<void> => {
  const downloadId = input.downloadId
  if (!downloadId) {
    return
  }
  const wait = input.waitForFrame ?? waitForLocateFrame
  let expandRequested = false
  while (!input.session.signal.aborted && Date.now() < input.session.deadline) {
    const location = input.getLocation(downloadId)
    if (!location) {
      return
    }
    if (location.groupId && !input.isGroupExpanded(location.groupId)) {
      if (!expandRequested) {
        input.expandGroup(location.groupId)
        expandRequested = true
      }
      await wait(input.session)
      continue
    }
    const rowIndex = input.getRowIndex(downloadId)
    if (rowIndex === undefined) {
      await wait(input.session)
      continue
    }
    input.scrollToIndex(rowIndex)
    if (input.isRowMounted(downloadId)) {
      return
    }
    await wait(input.session)
  }
}
