import { atom } from 'jotai'
import type { VideoInfo } from '../../../shared/types'
import { ipcServices } from '../lib/ipc'

// Current video info being prepared for download
export const currentVideoInfoAtom = atom<VideoInfo | null>(null)

// Loading state for video info
export const videoInfoLoadingAtom = atom<boolean>(false)

// Error state for video info
export const videoInfoErrorAtom = atom<string | null>(null)

// Fetch video info
export const fetchVideoInfoAtom = atom(null, async (_get, set, url: string) => {
  set(videoInfoLoadingAtom, true)
  set(videoInfoErrorAtom, null)
  set(currentVideoInfoAtom, null)

  try {
    const info = await ipcServices.download.getVideoInfo(url)
    set(currentVideoInfoAtom, info)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch video info'
    set(videoInfoErrorAtom, errorMessage)
  } finally {
    set(videoInfoLoadingAtom, false)
  }
})

// Clear video info
export const clearVideoInfoAtom = atom(null, (_get, set) => {
  set(currentVideoInfoAtom, null)
  set(videoInfoErrorAtom, null)
})
