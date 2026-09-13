import type { ModelStatus } from './types'

export interface ModelPrepStatus {
  downloading: boolean
  percent: number
  ready: boolean
}

/**
 * Map on-disk files plus the active download into a 0-100 prep percentage.
 *
 * @param status Model manager status for the boot (minimal) catalog slice.
 */
export const modelFillPercent = (
  status: Pick<ModelStatus, 'downloads' | 'files' | 'ready'>
): number => {
  if (status.ready) {
    return 100
  }
  const totalFiles = status.files.length
  if (totalFiles === 0) {
    return 0
  }
  const present = status.files.filter((file) => file.present).length
  const active = status.downloads[0]
  const current =
    active?.total && active.total > 0 ? Math.min(1, Math.max(0, active.received / active.total)) : 0
  return Math.min(99, Math.round(((present + current) / totalFiles) * 100))
}

/**
 * Compact prep snapshot used by the desktop banner and IPC.
 *
 * @param status Model manager status for the boot (minimal) catalog slice.
 */
export const toModelPrepStatus = (
  status: Pick<ModelStatus, 'downloads' | 'files' | 'ready'>
): ModelPrepStatus => ({
  downloading: status.downloads.length > 0,
  ready: status.ready,
  percent: modelFillPercent(status)
})
