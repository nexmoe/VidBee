import type { ShareImageLayout } from '@shared/types/share-card'

interface Band {
  top: number
  bottom: number
}

/** Find empty horizontal gaps after merging overlapping painted content bands. */
const gapCenters = (bands: Band[], height: number): number[] => {
  const sorted = bands.toSorted((a, b) => a.top - b.top)
  const gaps: number[] = []
  let bottom = 0
  for (const band of sorted) {
    if (band.top - bottom >= 2) {
      gaps.push((bottom + band.top) / 2)
    }
    bottom = Math.max(bottom, band.bottom)
  }
  if (height - bottom >= 2) {
    gaps.push((bottom + height) / 2)
  }
  return gaps
}

/** Measure safe page breaks from actual text lines and indivisible visual elements. */
export const measureShareImageLayout = (root: HTMLElement): ShareImageLayout => {
  const box = root.getBoundingClientRect()
  const lines: Band[] = []
  const blocks: Band[] = []
  /** Convert a visible rectangle to a protected vertical band inside the poster. */
  const bandFor = (rect: DOMRect): Band => ({
    top: Math.max(0, rect.top - box.top - 1),
    bottom: Math.min(box.height, rect.bottom - box.top + 1)
  })
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest('[aria-hidden="true"]')) {
      continue
    }
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (rect.width > 0 && rect.height > 0) {
        lines.push(bandFor(rect))
      }
    }
  }
  for (const element of root.querySelectorAll('header, footer, img, svg, canvas, video, tr, hr')) {
    if (element.closest('[aria-hidden="true"]')) {
      continue
    }
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      // Adjacent table rows share a border, so allow a cut exactly along that border.
      lines.push(
        element.tagName === 'TR'
          ? { top: rect.top - box.top + 1, bottom: rect.bottom - box.top - 1 }
          : bandFor(rect)
      )
    }
  }
  // Keep a heading with the first line of its following content.
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const rect = heading.getBoundingClientRect()
    const nextLine = lines
      .filter((line) => line.top >= rect.bottom - box.top)
      .toSorted((a, b) => a.top - b.top)[0]
    if (nextLine) {
      lines.push({ top: bandFor(rect).top, bottom: nextLine.bottom })
    }
  }
  for (const element of root.querySelectorAll(
    'p, li, pre, pre code > span, blockquote, table, figure'
  )) {
    const rect = element.getBoundingClientRect()
    if (rect.height > 0 && rect.height < box.width * 2) {
      // Adjacent list items and code lines can meet at their padded box edges.
      blocks.push({ top: rect.top - box.top + 1, bottom: rect.bottom - box.top - 1 })
    }
  }
  return {
    width: box.width,
    height: box.height,
    padding: (36 / 540) * box.width,
    safeBreaks: gapCenters(lines, box.height),
    preferredBreaks: gapCenters([...lines, ...blocks], box.height)
  }
}
