import fs from 'node:fs/promises'
import path from 'node:path'
import type { ShareImageLayout } from '@shared/types/share-card'
import { nativeImage } from 'electron'

/** Target a maximum page height of two widths, including continuation padding. */
export const SHARE_IMAGE_MAX_ASPECT_RATIO = 2

/** Balance a requested count across safe gaps, reserving enough gaps for later pages. */
const countedBoundaries = (height: number, safe: number[], imageCount: number): number[] => {
  if (!Number.isSafeInteger(imageCount) || imageCount < 1) {
    throw new Error('Share image count must be a positive integer')
  }
  const gaps = [...new Set(safe)].filter((y) => y > 0 && y < height).sort((a, b) => a - b)
  const count = Math.min(imageCount, gaps.length + 1)
  const boundaries = [0]
  let start = 0
  for (let page = 1; page < count; page += 1) {
    const offset = boundaries.at(-1) ?? 0
    const target = offset + (height - offset) / (count - page + 1)
    const last = gaps.length - (count - page)
    let selected = start
    for (let index = start + 1; index <= last; index += 1) {
      if (Math.abs(gaps[index] - target) < Math.abs(gaps[selected] - target)) {
        selected = index
      }
    }
    boundaries.push(gaps[selected])
    start = selected + 1
  }
  return [...boundaries, height]
}

/** Choose balanced page boundaries in measured gaps, never through painted content. */
export const shareImageSlices = (
  width: number,
  height: number,
  layout: ShareImageLayout,
  imageCount?: number
) => {
  if (!(width > 0 && height > 0 && layout.width > 0 && layout.height > 0)) {
    throw new Error('Share image dimensions must be positive')
  }
  const scale = width / layout.width
  const padding = Math.ceil(layout.padding * scale)
  const maxContent = Math.floor(width * SHARE_IMAGE_MAX_ASPECT_RATIO) - 2 * padding
  const safe = layout.safeBreaks.map((y) => Math.round(y * scale))
  const preferred = layout.preferredBreaks.map((y) => Math.round(y * scale))
  const boundaries = imageCount === undefined ? [0] : countedBoundaries(height, safe, imageCount)
  let offset = boundaries.at(-1) ?? 0
  while (height - offset > width * SHARE_IMAGE_MAX_ASPECT_RATIO - (offset > 0 ? padding : 0)) {
    const remaining = height - offset
    const target = offset + remaining / Math.ceil(remaining / maxContent)
    const lower = offset + maxContent * 0.45
    const upper = Math.min(offset + maxContent, height - padding)
    /** Pick the nearest eligible gap while keeping each page reasonably substantial. */
    const nearest = (values: number[], min: number, max: number): number | undefined =>
      values
        .filter((y) => y >= min && y <= max)
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]
    const end =
      nearest(
        preferred,
        Math.max(lower, target - maxContent * 0.2),
        Math.min(upper, target + maxContent * 0.2)
      ) ??
      nearest(preferred, lower, upper) ??
      nearest(safe, lower, upper) ??
      nearest(safe, offset + 1, upper) ??
      // An indivisible oversized image or table row is kept whole instead of clipped.
      safe.find((y) => y > upper && y < height) ??
      height
    boundaries.push(end)
    offset = end
  }
  if (boundaries.at(-1) !== height) {
    boundaries.push(height)
  }
  return boundaries.slice(0, -1).map((y, index) => ({
    x: 0,
    y,
    width,
    height: boundaries[index + 1] - y,
    paddingTop: index === 0 ? 0 : padding,
    paddingBottom: index === boundaries.length - 2 ? 0 : padding
  }))
}

/** Fill an empty continuation margin from the background at both sides of its seam. */
const marginRow = (bitmap: Buffer, width: number, y: number): Buffer => {
  const row = Buffer.alloc(width * 4)
  const left = y * width * 4
  const right = left + (width - 1) * 4
  for (let x = 0; x < width; x += 1) {
    const ratio = width > 1 ? x / (width - 1) : 0
    for (let channel = 0; channel < 4; channel += 1) {
      row[x * 4 + channel] = Math.round(
        bitmap[left + channel] * (1 - ratio) + bitmap[right + channel] * ratio
      )
    }
  }
  return row
}

/** Preserve every source pixel and add clean top/bottom margins at safe page breaks. */
export const splitShareImage = (
  png: Buffer,
  layout: ShareImageLayout,
  imageCount?: number
): Buffer[] => {
  const image = nativeImage.createFromBuffer(png)
  if (image.isEmpty()) {
    throw new Error('Share image is empty')
  }
  const { width, height } = image.getSize()
  const slices = shareImageSlices(width, height, layout, imageCount)
  if (slices.length === 1) {
    return [png]
  }
  const bitmap = image.toBitmap()
  const stride = width * 4
  return slices.map((slice) => {
    const pageHeight = slice.height + slice.paddingTop + slice.paddingBottom
    const page = Buffer.alloc(stride * pageHeight)
    const top = marginRow(bitmap, width, slice.y)
    const bottom = marginRow(bitmap, width, slice.y + slice.height - 1)
    for (let y = 0; y < slice.paddingTop; y += 1) {
      top.copy(page, y * stride)
    }
    bitmap.copy(
      page,
      slice.paddingTop * stride,
      slice.y * stride,
      (slice.y + slice.height) * stride
    )
    for (let y = slice.paddingTop + slice.height; y < pageHeight; y += 1) {
      bottom.copy(page, y * stride)
    }
    return nativeImage.createFromBitmap(page, { width, height: pageHeight }).toPNG()
  })
}

/** Save all numbered pages in a unique folder and remove partial output on failure. */
export const saveSplitShareImageFiles = async (
  directory: string,
  options: { images: Buffer[]; defaultFileName: string }
): Promise<{ path: string; count: number }> => {
  if (options.images.length === 0) {
    throw new Error('Share image pages are empty')
  }
  const name =
    path
      .basename(options.defaultFileName || 'VidBee.png', '.png')
      .replace(/[<>:"/\\|?*]+/g, '_')
      .slice(0, 80) || 'VidBee'
  const output = await fs.mkdtemp(path.join(directory, `${name}-`))
  try {
    for (const [index, png] of options.images.entries()) {
      const number = String(index + 1).padStart(String(options.images.length).length, '0')
      await fs.writeFile(path.join(output, `${name}-${number}.png`), png)
    }
    return { path: output, count: options.images.length }
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true })
    throw error
  }
}
