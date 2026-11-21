/** Main → hidden share renderer: export one saved Mermaid diagram. */
export const MERMAID_EXPORT_CHANNEL = 'share-capture:mermaid'

export interface MermaidExportPayload {
  source: string
  format: 'svg' | 'png' | 'jpg'
  theme: 'light' | 'dark'
}

export interface MermaidExportImage {
  data: Uint8Array
  width: number
  height: number
}
