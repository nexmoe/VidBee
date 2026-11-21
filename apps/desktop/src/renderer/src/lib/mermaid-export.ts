import type { MermaidExportImage, MermaidExportPayload } from '@shared/types/mermaid-export'
import { prepareMermaidExport } from '@vidbee/ui/lib/mermaid-export'
import { mermaid } from '@vidbee/ui/lib/pele-mermaid-plugin'
import { svgToRasterBlob } from 'streamdown'

/** Render with Desktop's Pele plugin and freeze the app palette for standalone image files. */
export async function renderMermaidExport(
  payload: MermaidExportPayload
): Promise<MermaidExportImage> {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(payload.theme)
  const { svg: source } = await mermaid
    .getMermaid({ theme: payload.theme === 'dark' ? 'dark' : 'default' })
    .render('mermaid-export', payload.source)
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  const svg = parsed.documentElement
  if (!(svg instanceof SVGSVGElement) || parsed.querySelector('parsererror')) {
    throw new Error('Invalid Mermaid SVG')
  }
  const { width, height } = svg.viewBox.baseVal
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    throw new Error('Invalid Mermaid diagram dimensions')
  }
  document.body.appendChild(svg)
  try {
    await document.fonts.ready
    const serialized = prepareMermaidExport(source, svg)
    if (payload.format === 'svg') {
      const exported = new DOMParser().parseFromString(serialized, 'image/svg+xml').documentElement
      return {
        data: new TextEncoder().encode(serialized),
        width: Number(exported.getAttribute('width')),
        height: Number(exported.getAttribute('height'))
      }
    }
    const mimeType = payload.format === 'jpg' ? 'image/jpeg' : 'image/png'
    const blob = await svgToRasterBlob(serialized, mimeType, svg, 4096)
    const image = await createImageBitmap(blob)
    try {
      return {
        data: new Uint8Array(await blob.arrayBuffer()),
        width: image.width,
        height: image.height
      }
    } finally {
      image.close()
    }
  } finally {
    svg.remove()
  }
}
