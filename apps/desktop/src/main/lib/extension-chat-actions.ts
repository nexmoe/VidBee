import en from '@vidbee/i18n/locales/en'
import { thinkingDurationHeader } from '@vidbee/ui/lib/thinking-header'
import { selectedAgentMessages } from '../../shared/agent-chat'
import { exportFileName } from '../../shared/agent-export'
import { isUuid } from '../../shared/agent-history'
import { artifactsForMessage } from '../../shared/agent-markdown'
import type { ExtensionChatExport, ExtensionChatFile } from '../../shared/extension-chat'
import { sharePromptUserText } from '../../shared/types/share-card'
import { attachAgentImages } from './agent-chat-runner'
import { getAgentChatStore } from './agent-chat-store'
import { getAgentComposerOptions, selectAgentComposerModel } from './agent-composer'
import { importAgentImageData } from './agent-image-attachments'
import { aiStore } from './ai-store'
import { dislikeCloudResult } from './cloud-device'
import { historyManager } from './history-manager'
import { markdownWithEmbeddedImages, renderMarkdownPdf } from './markdown-export'
import { withVidBeeExportAttribution, withVideoSourceLink } from './markdown-pdf'
import { peekDesktopTaskQueueRef } from './queue-ref'
import { captureShareCardPages, captureShareCardPng } from './share-capture-window'

/** Resolve an owned assistant reply instead of accepting caller-supplied content or paths. */
function reply(input: Record<string, unknown>) {
  if (
    typeof input.threadId !== 'string' ||
    !isUuid(input.threadId) ||
    typeof input.messageId !== 'string' ||
    !isUuid(input.messageId)
  ) {
    throw new Error('Invalid assistant reply')
  }
  const thread = getAgentChatStore().get(input.threadId, { sessionEntries: false })
  const message = thread?.messages.find(
    (item) => item.id === input.messageId && item.role === 'assistant'
  )
  if (!(thread && message)) {
    throw new Error('Assistant reply is unavailable')
  }
  const run = thread.runs.find((item) => item.id === message.runId)
  if (run?.status === 'running') {
    throw new Error('Wait for this reply to finish')
  }
  return { thread, message, run }
}

/** Match Desktop's translated export labels without depending on a renderer locale instance. */
function translate(key: string, values?: Record<string, unknown>): string {
  let value: unknown = en
  for (const part of key.split('.')) {
    value = value && typeof value === 'object' ? Reflect.get(value, part) : undefined
  }
  return (typeof value === 'string' ? value : key).replace(
    /\{\{(\w+)\}\}/g,
    (match, name: string) => String(values?.[name] ?? match)
  )
}

/** Return bounded download bytes while leaving the user's Desktop dialogs and clipboard untouched. */
function file(name: string, bytes: Buffer, mime: string): ExtensionChatFile {
  if (bytes.byteLength > 32_000_000) {
    throw new Error('Export is too large to download in the browser')
  }
  return { name, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` }
}

/** Export the same branded image, printable PDF or self-contained Markdown as Desktop. */
export async function exportExtensionChatReply(
  input: ExtensionChatExport,
  signal?: AbortSignal
): Promise<ExtensionChatFile[]> {
  const { thread, message } = reply({ ...input })
  if (!message.text.trim()) {
    throw new Error('A non-empty assistant reply is required')
  }
  const task = peekDesktopTaskQueueRef()?.get(thread.downloadId)
  const history = historyManager.getHistory().find((item) => item.id === thread.downloadId)
  const title = task?.input.title ?? history?.title ?? 'VidBee'
  const prompt = aiStore.getSnapshot().prompts.find((item) => item.id === thread.promptId)
  const promptTitle = prompt?.isPreset
    ? translate(`settings.ai.presetPrompts.${prompt.id}.title`)
    : (prompt?.title ?? translate('transcript.promptHistoryChat'))
  const artifacts = artifactsForMessage(
    thread.artifacts,
    message.text,
    selectedAgentMessages({ ...thread, leafId: message.id }).map((item) => item.runId)
  )
  const thinkingLabel = message.thinkingMs
    ? thinkingDurationHeader(translate, false, message.thinkingMs)
    : undefined
  const source = task?.input.url
    ? { url: task.input.url, label: translate('transcript.info.url') }
    : undefined
  if (input.format === 'png') {
    const payload = {
      kind: 'prompt' as const,
      markdown: message.text,
      promptTitle,
      sourceTitle: title,
      sourceByline: history?.channel ?? history?.uploader,
      coverSrc: task?.input.thumbnail ?? history?.thumbnail,
      tagline: translate('transcript.promptShareTagline'),
      thinkingLabel,
      userText: sharePromptUserText(thread.messages, message.id, promptTitle, prompt?.title),
      artifacts,
      runId: message.runId ?? undefined
    }
    const images = input.split
      ? await captureShareCardPages(payload, input.imageCount)
      : [await captureShareCardPng(payload)]
    if (images.reduce((total, image) => total + image.byteLength, 0) > 32_000_000) {
      throw new Error('Export is too large to download in the browser')
    }
    return images.map((image, index) =>
      file(exportFileName(input.split ? `${title} ${index + 1}` : title, 'png'), image, 'image/png')
    )
  }
  const options = {
    markdown: message.text,
    title,
    threadId: thread.id,
    artifacts,
    thinkingLabel,
    source
  }
  if (input.format === 'pdf') {
    return [
      file(
        exportFileName(title, 'pdf'),
        await renderMarkdownPdf(options, signal),
        'application/pdf'
      )
    ]
  }
  const markdown = withVideoSourceLink(
    withVidBeeExportAttribution(
      await markdownWithEmbeddedImages(message.text, thread.id, artifacts),
      thinkingLabel
    ),
    source
  )
  return [file(exportFileName(title, 'md'), Buffer.from(markdown), 'text/markdown;charset=utf-8')]
}

/** Validate and apply sidebar-only actions against Desktop's existing services. */
export async function executeExtensionChatAction(
  action: string,
  value: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid chat action')
  }
  const input = value as Record<string, unknown>
  if (action === 'model') {
    if (typeof input.value !== 'string' || input.value.length > 256) {
      throw new Error('Invalid model')
    }
    await selectAgentComposerModel(input.value)
    return await getAgentComposerOptions()
  }
  if (action === 'images') {
    if (
      typeof input.threadId !== 'string' ||
      !isUuid(input.threadId) ||
      typeof input.name !== 'string' ||
      input.name.length > 255 ||
      typeof input.data !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data) ||
      input.data.length > 28_000_000
    ) {
      throw new Error('Invalid image upload')
    }
    const data = Buffer.from(input.data, 'base64')
    await attachAgentImages(input.threadId, () =>
      importAgentImageData(input.threadId as string, [{ name: input.name as string, data }])
    )
    return null
  }
  if (action === 'feedback') {
    const { run } = reply(input)
    if (!run?.cloudResultId) {
      throw new Error('This reply was not generated by Cloud')
    }
    await dislikeCloudResult(run.cloudResultId)
    return null
  }
  if (action === 'export') {
    if (
      typeof input.format !== 'string' ||
      !['md', 'pdf', 'png'].includes(input.format) ||
      (input.split !== undefined && typeof input.split !== 'boolean') ||
      (input.imageCount !== undefined &&
        (!Number.isSafeInteger(input.imageCount) ||
          Number(input.imageCount) < 1 ||
          Number(input.imageCount) > 50))
    ) {
      throw new Error('Invalid export options')
    }
    return await exportExtensionChatReply(input as unknown as ExtensionChatExport, signal)
  }
  throw new Error('Unknown chat action')
}
