export interface VideoInfoRequestCoordinator {
  beginRequest: () => number
  invalidate: () => void
  isCurrentRequest: (requestId: number) => boolean
}

/**
 * Create a request coordinator that ignores stale video-info responses.
 *
 * Issue refs: #354, #379.
 */
export const createVideoInfoRequestCoordinator = (): VideoInfoRequestCoordinator => {
  let currentRequestId = 0

  return {
    beginRequest: () => {
      currentRequestId += 1
      return currentRequestId
    },
    // Bump the id so any in-flight response is treated as stale (#379).
    invalidate: () => {
      currentRequestId += 1
    },
    isCurrentRequest: (requestId: number) => requestId === currentRequestId
  }
}
