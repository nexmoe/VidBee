import { atom } from 'jotai'
import type { DownloadItem, DownloadProgress } from '../../../shared/types'

/** High-frequency fields kept off the structural download map. */
export interface DownloadLivePatch {
  progress?: DownloadProgress
  speed?: string
  ytDlpLog?: string
}

export const downloadLivePatchesAtom = atom<Map<string, DownloadLivePatch>>(new Map())

/**
 * Split a download update into live overlay fields and structural fields.
 * Undefined values are omitted. Empty strings stay, because they are real values.
 */
export const splitDownloadChanges = (
  changes: Partial<DownloadItem>
): { live: DownloadLivePatch; structural: Partial<DownloadItem> } => {
  const live: DownloadLivePatch = {}
  const structural: Partial<DownloadItem> = {}
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      continue
    }
    if (key === 'progress') {
      live.progress = value as DownloadProgress
    } else if (key === 'speed') {
      live.speed = value as string
    } else if (key === 'ytDlpLog') {
      live.ytDlpLog = value as string
    } else {
      ;(structural as Record<string, unknown>)[key] = value
    }
  }
  return { live, structural }
}

/**
 * True when the patch carries at least one defined live field.
 */
export const livePatchHasFields = (patch: DownloadLivePatch): boolean =>
  patch.progress !== undefined || patch.speed !== undefined || patch.ytDlpLog !== undefined

/**
 * Merge progress field by field. Undefined incoming fields keep the previous value.
 */
const mergeProgress = (
  current: DownloadProgress | undefined,
  incoming: DownloadProgress | undefined
): DownloadProgress | undefined => {
  if (incoming === undefined) {
    return current
  }
  const next: DownloadProgress = {
    percent: current?.percent ?? 0
  }
  if (current?.currentSpeed !== undefined) {
    next.currentSpeed = current.currentSpeed
  }
  if (current?.eta !== undefined) {
    next.eta = current.eta
  }
  if (current?.downloaded !== undefined) {
    next.downloaded = current.downloaded
  }
  if (current?.total !== undefined) {
    next.total = current.total
  }
  if (incoming.percent !== undefined) {
    next.percent = incoming.percent
  }
  if (incoming.currentSpeed !== undefined) {
    next.currentSpeed = incoming.currentSpeed
  }
  if (incoming.eta !== undefined) {
    next.eta = incoming.eta
  }
  if (incoming.downloaded !== undefined) {
    next.downloaded = incoming.downloaded
  }
  if (incoming.total !== undefined) {
    next.total = incoming.total
  }
  return next
}

/**
 * Compare the known progress fields by value. Empty strings are not treated as missing.
 */
export const sameDownloadProgress = (
  left: DownloadProgress | undefined,
  right: DownloadProgress | undefined
): boolean => {
  if (left === right) {
    return true
  }
  if (!(left && right)) {
    return !(left || right)
  }
  return (
    left.percent === right.percent &&
    left.currentSpeed === right.currentSpeed &&
    left.eta === right.eta &&
    left.downloaded === right.downloaded &&
    left.total === right.total
  )
}

/**
 * Compare a merged live patch against the previous patch by known fields.
 */
const sameLivePatch = (left: DownloadLivePatch | undefined, right: DownloadLivePatch): boolean => {
  if (!left) {
    return false
  }
  return (
    sameDownloadProgress(left.progress, right.progress) &&
    left.speed === right.speed &&
    left.ytDlpLog === right.ytDlpLog
  )
}

/**
 * Merge live fields onto the previous patch. Returns null when every known field is unchanged.
 */
export const mergeLivePatch = (
  current: DownloadLivePatch | undefined,
  incoming: DownloadLivePatch
): DownloadLivePatch | null => {
  const next: DownloadLivePatch = {}
  if (current?.speed !== undefined) {
    next.speed = current.speed
  }
  if (current?.ytDlpLog !== undefined) {
    next.ytDlpLog = current.ytDlpLog
  }
  if (incoming.speed !== undefined) {
    next.speed = incoming.speed
  }
  if (incoming.ytDlpLog !== undefined) {
    next.ytDlpLog = incoming.ytDlpLog
  }
  const progress = mergeProgress(current?.progress, incoming.progress)
  if (progress !== undefined) {
    next.progress = progress
  }
  if (sameLivePatch(current, next)) {
    return null
  }
  return next
}

/**
 * True when each defined structural change already matches the record field.
 * Nested objects are compared by reference, not walked recursively.
 */
export const sameChangedFields = (existing: object, changes: Partial<DownloadItem>): boolean => {
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) {
      continue
    }
    if (!Object.is((existing as Record<string, unknown>)[key], value)) {
      return false
    }
  }
  return true
}

/**
 * Copy the live-patch map with one id replaced. Returns null when the patch is unchanged.
 */
export const withLivePatch = (
  patches: ReadonlyMap<string, DownloadLivePatch>,
  id: string,
  incoming: DownloadLivePatch
): Map<string, DownloadLivePatch> | null => {
  const nextPatch = mergeLivePatch(patches.get(id), incoming)
  if (!nextPatch) {
    return null
  }
  const next = new Map(patches)
  next.set(id, nextPatch)
  return next
}

/**
 * Copy the live-patch map without the given ids. Returns null when none of them were present.
 */
export const withoutLivePatches = (
  patches: ReadonlyMap<string, DownloadLivePatch>,
  ids: Iterable<string>
): Map<string, DownloadLivePatch> | null => {
  let changed = false
  const next = new Map(patches)
  for (const id of ids) {
    if (next.delete(id)) {
      changed = true
    }
  }
  return changed ? next : null
}
