import type { CSSProperties } from 'react'

export const DEFAULT_VIDEO_ASPECT_RATIO = 16 / 9

/**
 * Read a media element's intrinsic width÷height, or null before metadata is ready.
 */
export const readVideoAspectRatio = (media: unknown): number | null => {
  if (!media || typeof media !== 'object') {
    return null
  }
  const node = media as { videoHeight?: unknown; videoWidth?: unknown }
  const width = typeof node.videoWidth === 'number' ? node.videoWidth : 0
  const height = typeof node.videoHeight === 'number' ? node.videoHeight : 0
  if (width <= 0 || height <= 0) {
    return null
  }
  return width / height
}

/**
 * Read an image element's intrinsic width÷height, or null before it has loaded.
 */
export const readImageAspectRatio = (image: unknown): number | null => {
  if (!image || typeof image !== 'object') {
    return null
  }
  const node = image as { naturalHeight?: unknown; naturalWidth?: unknown }
  const width = typeof node.naturalWidth === 'number' ? node.naturalWidth : 0
  const height = typeof node.naturalHeight === 'number' ? node.naturalHeight : 0
  if (width <= 0 || height <= 0) {
    return null
  }
  return width / height
}

/**
 * Apply a width÷height ratio to the transcript video window via CSS custom property.
 */
export const transcriptPlayerAspectStyle = (ratio: number): CSSProperties => {
  const aspect = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_VIDEO_ASPECT_RATIO
  return {
    '--transcript-video-aspect': String(aspect)
  } as CSSProperties
}
