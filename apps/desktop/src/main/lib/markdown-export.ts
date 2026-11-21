import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { AgentArtifact } from '../../shared/agent-chat'
import { embedArtifactImages } from '../../shared/agent-markdown'
import { getAgentChatStore } from './agent-chat-store'
import { readAgentArtifactImage } from './agent-media'
import { type ExportVideoSource, markdownToPrintableHtml, printHtmlToPdf } from './markdown-pdf'

/** Inline owned screenshots so UI and MCP Markdown/PDF exports remain self-contained. */
export async function markdownWithEmbeddedImages(
  markdown: string,
  threadId?: string,
  ownedArtifacts?: AgentArtifact[]
): Promise<string> {
  const artifacts =
    ownedArtifacts ??
    (threadId ? getAgentChatStore().get(threadId, { sessionEntries: false })?.artifacts : undefined)
  return artifacts?.length
    ? await embedArtifactImages(markdown, artifacts, readAgentArtifactImage)
    : markdown
}

/** Print the existing Markdown layout in an isolated hidden window, with bounded cancellation and cleanup. */
export async function writeMarkdownPdf(
  outputPath: string,
  options: {
    markdown: string
    title?: string
    threadId?: string
    artifacts?: AgentArtifact[]
    thinkingLabel?: string
    source?: ExportVideoSource
  },
  signal?: AbortSignal,
  overwrite = true
): Promise<void> {
  await writeFile(outputPath, await renderMarkdownPdf(options, signal), {
    flag: overwrite ? 'w' : 'wx'
  })
}

/** Render native and browser PDF downloads through the same isolated print pipeline. */
export async function renderMarkdownPdf(
  options: Parameters<typeof writeMarkdownPdf>[1],
  signal?: AbortSignal
): Promise<Buffer> {
  const abort = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    : AbortSignal.timeout(60_000)
  abort.throwIfAborted()
  const markdown = await markdownWithEmbeddedImages(
    options.markdown,
    options.threadId,
    options.artifacts
  )
  const html = markdownToPrintableHtml(
    markdown,
    options.title,
    options.thinkingLabel,
    options.source
  )
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vidbee-pdf-'))
  let window: BrowserWindow | undefined
  /** Stop only this export's private renderer when the request is cancelled. */
  const cancel = () => {
    if (window && !window.isDestroyed()) {
      window.destroy()
    }
  }
  abort.addEventListener('abort', cancel, { once: true })
  try {
    const htmlPath = path.join(directory, 'document.html')
    await writeFile(htmlPath, html, 'utf8')
    abort.throwIfAborted()
    const pdf = await printHtmlToPdf(htmlPath, () => {
      window = new BrowserWindow({
        backgroundColor: '#ffffff',
        show: false,
        focusable: false,
        skipTaskbar: true,
        hiddenInMissionControl: true,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: `vidbee-pdf-${path.basename(directory)}`
        }
      })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      return window
    })
    abort.throwIfAborted()
    return pdf
  } finally {
    abort.removeEventListener('abort', cancel)
    cancel()
    await rm(directory, { recursive: true, force: true })
  }
}
