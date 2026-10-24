import { open, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { nativeImage, nativeTheme } from 'electron'
import { z } from 'zod'
import { selectedAgentMessages } from '../../shared/agent-chat'
import { artifactsForMessage } from '../../shared/agent-markdown'
import {
  type ShareCardPayload,
  shareCardSourceByline,
  sharePromptUserText
} from '../../shared/types/share-card'
import { getAgentChatStore } from '../lib/agent-chat-store'
import { getPromptRunSnapshot } from '../lib/ai-prompt-runner'
import { aiStore } from '../lib/ai-store'
import { historyManager } from '../lib/history-manager'
import { libraryExportPath } from '../lib/library-export'
import { markdownWithEmbeddedImages, writeMarkdownPdf } from '../lib/markdown-export'
import { withVidBeeExportAttribution, withVideoSourceLink } from '../lib/markdown-pdf'
import { extractMermaidDiagrams } from '../lib/mermaid-diagrams'
import {
  captureShareCardPages,
  captureShareCardPng,
  exportMermaidDiagram
} from '../lib/share-capture-window'
import { saveSplitShareImageFiles } from '../lib/share-image-split'
import { getDesktopTaskQueue } from '../lib/task-queue-host'
import { readTranscriptDetail } from '../lib/transcript-host'
import { settingsManager } from '../settings'
import { defineMcpTool, mcpId, mcpLimit, mcpOffset, mcpPage } from './tool'

const imageOptions = {
  imageMode: z.enum(['long', 'pages']).default('long'),
  imageCount: z.number().int().min(1).max(50).optional(),
  includeCover: z.boolean().default(true),
  tagline: z.string().max(200).default('Download. Transcribe locally. Ask AI.')
}
const resultSelector = z.object({
  threadId: mcpId,
  messageId: mcpId.optional()
})

interface ExportedImage {
  path: string
  bytes: number
  width: number
  height: number
}
interface SkillResultSummary {
  kind: 'skill' | 'agent_reply'
  title: string
  selector: z.output<typeof resultSelector> | { downloadId: string; promptId: string }
  status: string
  characters: number
  updatedAt: number
  formats: string[]
}

/** Resolve source metadata from saved records without reading arbitrary caller-supplied paths. */
function sourceMetadata(downloadId: string) {
  const task = getDesktopTaskQueue().get(downloadId)
  if (!task) {
    throw new Error(`Media task not found: ${downloadId}`)
  }
  const history = historyManager.getHistory().find((item) => item.id === downloadId)
  return {
    title: task.input.title ?? history?.title ?? 'VidBee',
    coverSrc: task.input.thumbnail ?? history?.thumbnail,
    source: { url: task.input.url },
    byline: shareCardSourceByline(undefined, history?.channel ?? history?.uploader),
    durationMs: task.output?.durationMs ?? undefined
  }
}

/** Read one owned assistant reply, including its cited artifacts. Skill runs stay listed but are not exportable. */
function resolveSkillResult(input: z.output<typeof resultSelector>) {
  const thread = getAgentChatStore().get(input.threadId, { sessionEntries: false })
  if (!thread) {
    throw new Error('Agent conversation not found')
  }
  const message = input.messageId
    ? thread.messages.find((item) => item.id === input.messageId && item.role === 'assistant')
    : selectedAgentMessages(thread).findLast(
        (item) => item.role === 'assistant' && item.text.trim()
      )
  if (!message?.text.trim()) {
    throw new Error('A non-empty assistant reply is required')
  }
  const run = thread.runs.find((item) => item.id === message.runId)
  if (run && run.status !== 'completed') {
    throw new Error('Wait for this assistant reply to complete before exporting')
  }
  const prompt = aiStore.getSnapshot().prompts.find((item) => item.id === thread.promptId)
  const artifacts = artifactsForMessage(
    thread.artifacts,
    message.text,
    selectedAgentMessages({ ...thread, leafId: message.id }).map((item) => item.runId)
  )
  return {
    ...sourceMetadata(thread.downloadId),
    markdown: message.text,
    promptTitle: prompt?.title ?? 'Agent',
    threadId: thread.id,
    messageId: message.id,
    runId: run?.id,
    artifacts,
    thinkingLabel: message.thinkingMs
      ? `Thought for ${Math.round(message.thinkingMs / 1000)} seconds`
      : undefined,
    userText: sharePromptUserText(thread.messages, message.id, prompt?.title)
  }
}

/** Capture the product's branded share card and return generated paths and real PNG dimensions. */
async function exportShareImage(
  payload: ShareCardPayload,
  title: string,
  options: { imageMode: 'long' | 'pages'; imageCount?: number },
  signal: AbortSignal
) {
  if (options.imageMode !== 'pages' && options.imageCount !== undefined) {
    throw new Error('imageCount requires imageMode=pages')
  }
  signal.throwIfAborted()
  const outputPath = await libraryExportPath(title, 'png')
  let files: string[]
  let savedPath = outputPath
  if (options.imageMode === 'pages') {
    const images = await captureShareCardPages(payload, options.imageCount)
    signal.throwIfAborted()
    const saved = await saveSplitShareImageFiles(path.dirname(outputPath), {
      images,
      defaultFileName: path.basename(outputPath)
    })
    savedPath = saved.path
    files = (await readdir(saved.path))
      .filter((file) => file.endsWith('.png'))
      .sort()
      .map((file) => path.join(saved.path, file))
  } else {
    const image = await captureShareCardPng(payload)
    signal.throwIfAborted()
    await writeFile(outputPath, image, { flag: 'wx' })
    files = [outputPath]
  }
  const images: ExportedImage[] = []
  for (const file of files) {
    const size = nativeImage.createFromPath(file).getSize()
    images.push({ path: file, bytes: (await stat(file)).size, ...size })
  }
  return { format: 'png', path: savedPath, count: images.length, files: images }
}

/** Expose complete skill-result documents and caption share images using the same exporters as detail pages. */
export function createMcpExportTools() {
  return [
    defineMcpTool(
      'list_skill_results',
      'Discover saved one-shot skills and assistant replies on a media item. Results include selectors, completion status and available export formats. New/custom skills are supported automatically.',
      z.object({ downloadId: mcpId, offset: mcpOffset, limit: mcpLimit }),
      ({ downloadId, offset, limit }) => {
        sourceMetadata(downloadId)
        const results: SkillResultSummary[] = []
        for (const prompt of aiStore.getSnapshot().prompts) {
          const run = getPromptRunSnapshot(downloadId, prompt.id)
          if (run.status === 'idle') {
            continue
          }
          results.push({
            kind: 'skill',
            title: prompt.title,
            selector: { downloadId, promptId: prompt.id },
            status: run.status,
            characters: run.text.length,
            updatedAt: run.updatedAt,
            formats: ['md', 'pdf', 'png']
          })
        }
        const store = getAgentChatStore()
        for (const summary of store.listVideoThreads(downloadId)) {
          const thread = store.get(summary.id, { sessionEntries: false })
          if (!thread) {
            continue
          }
          for (const message of thread.messages) {
            if (message.role !== 'assistant' || !message.text.trim()) {
              continue
            }
            const run = thread.runs.find((item) => item.id === message.runId)
            results.push({
              kind: 'agent_reply',
              title: thread.title || thread.promptId,
              selector: { threadId: thread.id, messageId: message.id },
              status: run?.status ?? 'completed',
              characters: message.text.length,
              updatedAt: run?.updatedAt ?? message.createdAt,
              formats: ['md', 'pdf', 'png']
            })
          }
        }
        return mcpPage(
          results.sort((left, right) => right.updatedAt - left.updatedAt),
          offset,
          limit
        )
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'export_skill_result',
      'Export one assistant reply as Markdown, PDF or a branded PNG share image. Requires threadId and an optional messageId from an agent_reply in list_skill_results. downloadId+promptId skill records are not exportable: their screenshots are text placeholders. Embedded screenshots, source links and attribution match Desktop. PNG supports long posters or paginated images. Writes unique files under library/Exports; opens no dialogs or foreground windows.',
      resultSelector.extend({ format: z.enum(['md', 'pdf', 'png']), ...imageOptions }),
      async (input, signal) => {
        const result = resolveSkillResult(input)
        if (input.format === 'png') {
          return exportShareImage(
            {
              kind: 'prompt',
              markdown: result.markdown,
              promptTitle: result.promptTitle,
              sourceTitle: result.title,
              sourceByline: result.byline,
              coverSrc: input.includeCover ? result.coverSrc : undefined,
              artifacts: result.artifacts,
              runId: result.runId,
              thinkingLabel: result.thinkingLabel,
              userText: result.userText,
              tagline: input.tagline
            },
            `${result.title} ${result.promptTitle}`,
            input,
            signal
          )
        }
        const outputPath = await libraryExportPath(
          `${result.title} ${result.promptTitle}`,
          input.format
        )
        if (input.format === 'pdf') {
          await writeMarkdownPdf(outputPath, { ...result, title: result.title }, signal, false)
        } else {
          const embedded = await markdownWithEmbeddedImages(
            result.markdown,
            result.threadId,
            result.artifacts
          )
          signal.throwIfAborted()
          const markdown = withVideoSourceLink(
            withVidBeeExportAttribution(embedded, result.thinkingLabel),
            result.source
          )
          await writeFile(outputPath, markdown, { encoding: 'utf8', flag: 'wx' })
        }
        return { format: input.format, path: outputPath, bytes: (await stat(outputPath)).size }
      }
    ),
    defineMcpTool(
      'export_mermaid_diagram',
      "Export one Mermaid diagram from a completed assistant reply as PNG (default), JPG, SVG or MMD source. Requires threadId; messageId defaults to the latest non-empty reply in the selected branch. diagramIndex is zero-based in Markdown display order, including lists and blockquotes. theme defaults to Desktop's current light/dark theme. Renders with the same Pele plugin and raster exporter as Streamdown; raster edges are capped at 4096 pixels. Returns the saved path, bytes, diagram count and image dimensions. Writes a unique file under library/Exports using a private hidden window, with cancellation and no dialogs or clipboard access.",
      resultSelector.extend({
        diagramIndex: z.number().int().nonnegative().default(0),
        format: z.enum(['png', 'jpg', 'svg', 'mmd']).default('png'),
        theme: z.enum(['light', 'dark']).optional()
      }),
      async (input, signal) => {
        const result = resolveSkillResult(input)
        const diagrams = extractMermaidDiagrams(result.markdown)
        const source = diagrams[input.diagramIndex]
        if (source === undefined) {
          throw new Error(
            diagrams.length
              ? `diagramIndex ${input.diagramIndex} is out of range; this reply contains ${diagrams.length} Mermaid diagrams (zero-based)`
              : 'This assistant reply contains no Mermaid diagrams'
          )
        }
        if (!source.trim() || source.length > 100_000) {
          throw new Error('A Mermaid diagram must contain between 1 and 100000 characters')
        }
        signal.throwIfAborted()
        const savedTheme = settingsManager.get('theme')
        const theme =
          input.theme ??
          (savedTheme === 'dark' || (savedTheme !== 'light' && nativeTheme.shouldUseDarkColors)
            ? 'dark'
            : 'light')
        const image =
          input.format === 'mmd'
            ? undefined
            : await exportMermaidDiagram({ source, format: input.format, theme }, signal)
        signal.throwIfAborted()
        const outputPath = await libraryExportPath(
          `${result.title} diagram ${input.diagramIndex + 1}`,
          input.format
        )
        const file = await open(outputPath, 'wx')
        let complete = false
        try {
          await file.writeFile(image ? image.data : source)
          const bytes = (await file.stat()).size
          signal.throwIfAborted()
          complete = true
          return {
            threadId: result.threadId,
            messageId: result.messageId,
            diagramIndex: input.diagramIndex,
            diagramCount: diagrams.length,
            format: input.format,
            path: outputPath,
            bytes,
            ...(image ? { width: image.width, height: image.height, theme } : {})
          }
        } finally {
          await file.close()
          if (!complete) {
            await rm(outputPath, { force: true })
          }
        }
      }
    ),
    defineMcpTool(
      'export_caption_share_image',
      'Export selected stored caption segments as the same branded quote image used on the transcript detail page. Supply owned segment IDs. Supports long or paginated PNG images and never opens a share sheet or touches the clipboard.',
      z.object({ downloadId: mcpId, segmentIds: z.array(mcpId).min(1).max(100), ...imageOptions }),
      async ({ downloadId, segmentIds, ...options }, signal) => {
        const record = readTranscriptDetail(downloadId).record
        if (!record) {
          throw new Error('No transcript is available')
        }
        const wanted = new Set(segmentIds)
        const selected = record.segments.filter((item) => wanted.has(item.id))
        if (selected.length !== wanted.size) {
          throw new Error('Every segment must belong to the selected transcript source')
        }
        const first = selected[0]
        const last = selected.at(-1)
        if (!(first && last)) {
          throw new Error('Choose at least one caption segment')
        }
        const source = sourceMetadata(downloadId)
        const beforeIndex = record.segments.findIndex((item) => item.id === first.id) - 1
        const afterIndex = record.segments.findIndex((item) => item.id === last.id) + 1
        const payload: ShareCardPayload = {
          kind: 'caption',
          sourceTitle: source.title,
          sourceByline: source.byline,
          durationMs: source.durationMs,
          coverSrc: options.includeCover ? source.coverSrc : undefined,
          tagline: options.tagline,
          quote: {
            startMs: first.startMs,
            endMs: last.endMs,
            quote: selected.map((item) => item.text).join(' '),
            before: record.segments[beforeIndex]?.text ?? '',
            after: record.segments[afterIndex]?.text ?? ''
          }
        }
        return exportShareImage(payload, `${source.title} captions`, options, signal)
      }
    )
  ]
}
