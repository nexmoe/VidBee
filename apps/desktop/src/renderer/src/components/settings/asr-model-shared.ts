import type { AsrTierId } from '@vidbee/transcription/asr'

export interface AsrTierRow {
  bytes: number
  id: AsrTierId
  ready: boolean
}

export interface AsrDownloadView {
  received: number
  tier?: AsrTierId
  total: number | null
}

export interface AsrMachineView {
  class: 'low' | 'mid' | 'high'
  cpuCount: number
  gpu?: 'amd' | 'apple' | 'intel' | 'nvidia' | 'unknown'
  gpuName?: string | null
  os?: 'linux' | 'macos' | 'other' | 'windows'
  ramBytes: number
}

export interface AsrModelStatusView {
  pendingTiers: AsrTierId[]
  bytes: number
  downloads: AsrDownloadView[]
  language?: string
  machine?: AsrMachineView
  ready: boolean
  recommended: AsrTierId[]
  tiers: AsrTierRow[]
}

/**
 * Format a byte count for the settings model list.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value.toFixed(1)} ${units[index]}`
}

/**
 * Format RAM without a trailing .0, e.g. 64 GB.
 */
export const formatRam = (bytes: number): string => {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) {
    return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`
  }
  return formatBytes(bytes)
}

/**
 * Show a short GPU label, never the raw ANGLE string.
 */
export const displayGpuName = (
  gpuName: string | null | undefined,
  gpu: 'amd' | 'apple' | 'intel' | 'nvidia' | 'unknown' | undefined,
  fallback: (kind: string) => string
): string => {
  const raw = gpuName?.trim() ?? ''
  const apple = raw.match(/Apple\s+M\d+(?:\s+(?:Pro|Max|Ultra|Plus))?/i)
  if (apple?.[0]) {
    return apple[0].replace(/\s+/g, ' ')
  }
  if (raw && !/angle/i.test(raw)) {
    return raw
  }
  return fallback(gpu ?? 'unknown')
}

/**
 * Normalize IPC download progress into the picker view model.
 */
export const toDownloadViews = (
  downloads: Array<{ received: number; tier?: AsrTierId; total: number | null }> | undefined,
  fallback: { received: number; tier?: AsrTierId; total: number | null } | null | undefined
): AsrDownloadView[] => {
  const source = downloads?.length ? downloads : fallback ? [fallback] : []
  return source.map((item) => ({
    received: item.received,
    total: item.total,
    tier: item.tier
  }))
}

/**
 * Map IPC model status into the picker/dialog view model.
 */
export const toModelStatusView = (next: {
  pendingTiers?: AsrTierId[]
  bytes: number
  downloads?: Array<{ received: number; tier?: AsrTierId; total: number | null }>
  downloading?: { received: number; tier?: AsrTierId; total: number | null } | null
  language?: string
  machine?: AsrMachineView
  ready: boolean
  recommended?: AsrTierId[]
  tiers?: Array<{ bytes: number; id: AsrTierId; ready: boolean }>
}): AsrModelStatusView => ({
  pendingTiers: next.pendingTiers ?? [],
  bytes: next.bytes,
  ready: next.ready,
  downloads: toDownloadViews(next.downloads, next.downloading),
  language: next.language,
  machine: next.machine,
  recommended: next.recommended ?? [],
  tiers: (next.tiers ?? []).map((tier) => ({
    id: tier.id,
    ready: tier.ready,
    bytes: tier.bytes
  }))
})

/**
 * True when a download stopped because the user cancelled it.
 */
export const isCancelledDownload = (error: unknown): boolean => {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  return name === 'AbortError' || /download cancelled|operation was aborted/i.test(message)
}
