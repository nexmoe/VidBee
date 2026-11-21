import { type RenderOptions, renderAsync } from 'pele/lazy'
import type { DiagramPlugin } from 'streamdown'
import { prepareMermaidExport } from './mermaid-export'

/** Copy Mermaid settings into Pele's JSON-compatible config, omitting callbacks and undefined. */
function toPeleConfig(config: Parameters<DiagramPlugin['getMermaid']>[0]): RenderOptions['config'] {
  return JSON.parse(JSON.stringify(config ?? {}))
}

/** Streamdown diagram plugin that loads Pele diagram types on demand. */
export const mermaid: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  prepareExport: prepareMermaidExport,
  /** Create an independent renderer with Streamdown's Mermaid configuration. */
  getMermaid: (config) => {
    let renderConfig = toPeleConfig(config)

    return {
      /** Replace the configuration for subsequent diagram renders. */
      initialize: (next) => {
        renderConfig = toPeleConfig(next)
      },
      /** Render Mermaid source with unique SVG IDs and propagate parsing errors. */
      render: async (id, source) => {
        const { svg } = await renderAsync(source, { idPrefix: id, config: renderConfig })
        return { svg }
      }
    }
  }
}
