import { useEffect, useState } from 'react'

/** Fallback wash when the cover cannot be sampled. */
export const SHARE_CARD_WASH = '#d09468'

const SAMPLE_SIZE = 16
const MIN_ALPHA = 16
const TARGET_LUMINANCE = 0.38

/**
 * Darken an average cover color just enough that white text stays readable.
 *
 * @param red 0–255 red channel.
 * @param green 0–255 green channel.
 * @param blue 0–255 blue channel.
 */
export const mixCoverFillColor = (red: number, green: number, blue: number): string => {
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  const scale = luminance > TARGET_LUMINANCE ? TARGET_LUMINANCE / luminance : 1
  const nextRed = Math.round(Math.min(255, Math.max(0, red * scale)))
  const nextGreen = Math.round(Math.min(255, Math.max(0, green * scale)))
  const nextBlue = Math.round(Math.min(255, Math.max(0, blue * scale)))
  return `rgb(${nextRed}, ${nextGreen}, ${nextBlue})`
}

/**
 * Average a painted image into a solid fill color.
 *
 * @param image Decoded cover image.
 */
export const sampleImageFillColor = (image: HTMLImageElement): string | null => {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = SAMPLE_SIZE
  canvas.height = SAMPLE_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    return null
  }
  try {
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    let red = 0
    let green = 0
    let blue = 0
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < MIN_ALPHA) {
        continue
      }
      red += data[index] ?? 0
      green += data[index + 1] ?? 0
      blue += data[index + 2] ?? 0
      count += 1
    }
    if (count === 0) {
      return null
    }
    return mixCoverFillColor(red / count, green / count, blue / count)
  } catch {
    return null
  }
}

/**
 * Load a cover URL and sample it into a solid fill.
 *
 * @param src Cover URL already safe to paint in the renderer.
 */
export const loadCoverFillColor = async (src: string): Promise<string | null> => {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  try {
    if (!(image.complete && image.naturalWidth > 0)) {
      await image.decode()
    }
  } catch {
    return null
  }
  return sampleImageFillColor(image)
}

/**
 * Sample the cover into a solid background, falling back to the default wash.
 *
 * @param src Cover URL printed on the prompt card.
 */
export const useCoverFillColor = (src?: string | null): { color: string; ready: boolean } => {
  const cover = src?.trim() || ''
  const [state, setState] = useState({ color: SHARE_CARD_WASH, ready: !cover })
  useEffect(() => {
    if (!cover) {
      setState({ color: SHARE_CARD_WASH, ready: true })
      return
    }
    let cancelled = false
    setState((current) => ({ color: current.color, ready: false }))
    void loadCoverFillColor(cover).then((color) => {
      if (!cancelled) {
        setState({ color: color ?? SHARE_CARD_WASH, ready: true })
      }
    })
    return () => {
      cancelled = true
    }
  }, [cover])
  return state
}
