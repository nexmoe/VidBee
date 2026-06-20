import { atom } from 'jotai'
import type { VideoInfo } from '../../../shared/types'
import { ipcServices } from '../lib/ipc'
import { createVideoInfoRequestCoordinator } from './video-request-coordinator'

// Current video info being prepared for download
export const currentVideoInfoAtom = atom<VideoInfo | null>(null)

// Original URL used to fetch the current video info (#379)
export const currentVideoInfoSourceUrlAtom = atom<string | null>(null)

// Loading state for video info
export const videoInfoLoadingAtom = atom<boolean>(false)

// Error state for video info
export const videoInfoErrorAtom = atom<string | null>(null)

// Last yt-dlp command used for video info
export const videoInfoCommandAtom = atom<string | null>(null)
const videoInfoRequestCoordinator = createVideoInfoRequestCoordinator()

// Fetch video info
export const fetchVideoInfoAtom = atom(null, async (_get, set, url: string) => {
  const requestId = videoInfoRequestCoordinator.beginRequest()
  set(videoInfoLoadingAtom, true)
  set(videoInfoErrorAtom, null)
  set(videoInfoCommandAtom, null)
  set(currentVideoInfoAtom, null)
  set(currentVideoInfoSourceUrlAtom, null)

  try {
    const result = await ipcServices.download.getVideoInfoWithCommand(url)
    if (!videoInfoRequestCoordinator.isCurrentRequest(requestId)) {
      return
    }
    set(videoInfoCommandAtom, result.ytDlpCommand)
    if (result.info) {
      set(currentVideoInfoAtom, result.info)
      set(currentVideoInfoSourceUrlAtom, url)
      return
    }
    set(videoInfoErrorAtom, result.error || 'Failed to fetch video info')
  } catch (error) {
    if (!videoInfoRequestCoordinator.isCurrentRequest(requestId)) {
      return
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch video info'
    set(videoInfoErrorAtom, errorMessage)
  } finally {
    if (videoInfoRequestCoordinator.isCurrentRequest(requestId)) {
      set(videoInfoLoadingAtom, false)
    }
  }
})

// Clear video info
export const clearVideoInfoAtom = atom(null, (_get, set) => {
  videoInfoRequestCoordinator.invalidate()
  set(currentVideoInfoAtom, null)
  set(currentVideoInfoSourceUrlAtom, null)
  set(videoInfoLoadingAtom, false)
  set(videoInfoErrorAtom, null)
  set(videoInfoCommandAtom, null)
})
