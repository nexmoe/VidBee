import { EXPORT_BRAND } from './export-brand'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

/** Measure attribution with the same system font and weight as the HTML share footer. */
function measureBrandText(text: string, fontFamily: string, weight = 400): number {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) {
    throw new Error('Failed to measure diagram export branding')
  }
  context.font = `${weight} ${EXPORT_BRAND.fontSize}px ${fontFamily}`
  return context.measureText(text).width
}

/** Build the centered share-card attribution with separate label, logo and wordmark opacity. */
function createBrandFooter(
  color: string,
  fontFamily: string
): { element: SVGGElement; width: number } {
  const brand = EXPORT_BRAND
  const prefixWidth = measureBrandText(brand.prefix, fontFamily)
  const nameWidth = measureBrandText(brand.name, fontFamily, brand.fontWeight)
  const brandWidth = prefixWidth + brand.logoSize + nameWidth + 2 * brand.gap
  const top = brand.dividerGap
  const watermark = document.createElementNS(SVG_NAMESPACE, 'g')
  watermark.setAttribute('data-vidbee-watermark', '')

  const divider = document.createElementNS(SVG_NAMESPACE, 'rect')
  divider.setAttribute('x', String((brandWidth - brand.dividerWidth) / 2))
  divider.setAttribute('width', String(brand.dividerWidth))
  divider.setAttribute('height', '1')
  divider.setAttribute('fill', color)
  divider.setAttribute('opacity', String(brand.dividerOpacity))

  const prefix = document.createElementNS(SVG_NAMESPACE, 'text')
  prefix.setAttribute('x', '0')
  prefix.setAttribute('y', String(top + brand.logoSize / 2))
  prefix.setAttribute('dominant-baseline', 'central')
  prefix.setAttribute('opacity', String(brand.prefixOpacity))
  prefix.style.setProperty('fill', color)
  prefix.style.setProperty('font-family', fontFamily)
  prefix.style.setProperty('font-size', `${brand.fontSize}px`)
  prefix.style.setProperty('font-weight', '400')
  prefix.textContent = brand.prefix

  const logo = document.createElementNS(SVG_NAMESPACE, 'image')
  logo.setAttribute('href', brand.logoSrc)
  logo.setAttribute('x', String(prefixWidth + brand.gap))
  logo.setAttribute('y', String(top))
  logo.setAttribute('width', String(brand.logoSize))
  logo.setAttribute('height', String(brand.logoSize))

  const wordmark = prefix.cloneNode(true) as SVGTextElement
  wordmark.setAttribute('x', String(prefixWidth + brand.logoSize + 2 * brand.gap))
  wordmark.setAttribute('opacity', String(brand.nameOpacity))
  wordmark.style.setProperty('font-weight', String(brand.fontWeight))
  wordmark.textContent = brand.name
  watermark.append(divider, prefix, logo, wordmark)
  return { element: watermark, width: brandWidth }
}

/** Freeze the displayed palette and add a self-contained VidBee footer without covering the diagram. */
export function prepareMermaidExport(source: string, container?: Element | null): string {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const svg = parsed.documentElement
  if (!(svg instanceof SVGSVGElement) || parsed.querySelector('parsererror')) {
    throw new Error('Invalid Mermaid SVG')
  }
  const { x, y, width, height } = svg.viewBox.baseVal
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    throw new Error('Invalid Mermaid diagram dimensions')
  }
  const preview = container?.querySelector('[data-streamdown="mermaid"] [role="img"] > svg')
  const styles = getComputedStyle(preview ?? container ?? document.documentElement)
  for (const name of styles) {
    if (name.startsWith('--pele-')) {
      svg.style.setProperty(name, styles.getPropertyValue(name))
    }
  }
  svg.style.color = styles.color
  svg.style.fontFamily = styles.fontFamily

  const fontFamily = getComputedStyle(document.body).fontFamily
  const { element: watermark, width: brandWidth } = createBrandFooter(styles.color, fontFamily)
  const scale = Math.max(0.6, Math.max(width, height) / 1600)
  const exportWidth = Math.max(width, (brandWidth + 32) * scale)
  const footerHeight = 12 + EXPORT_BRAND.dividerGap + EXPORT_BRAND.logoSize + 20
  const exportHeight = height + footerHeight * scale
  const left = x - (exportWidth - width) / 2
  svg.setAttribute('viewBox', `${left} ${y} ${exportWidth} ${exportHeight}`)
  svg.setAttribute('width', String(exportWidth))
  svg.setAttribute('height', String(exportHeight))

  watermark.setAttribute(
    'transform',
    `translate(${left + (exportWidth - brandWidth * scale) / 2} ${y + height + 12 * scale}) scale(${scale})`
  )
  svg.appendChild(watermark)
  return new XMLSerializer().serializeToString(svg)
}
