import { randomUUID } from 'node:crypto'
import { lstat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { TaskCreationMetadata } from '@vidbee/task-queue'
import { isMediaTaskKind } from '@vidbee/task-queue'
import { agentAiSettingsSchema, agentSettingsSchema } from '../../shared/agent-settings'
import { AI_PROVIDER_PRESETS, getAiProviderPreset } from '../../shared/ai-presets'
import { mediaTransformSchema } from '../../shared/media-transform'
import { settingsManager } from '../settings'
import { ffmpegManager } from './ffmpeg-manager'
import { probeLocalMedia } from './media-probe'
import { broadcastSettingsChanged, updateDesktopSettings } from './settings-host'
import { getDesktopTaskQueue } from './task-queue-host'
import { fetchPlaylistInfo, fetchVideoInfo } from './yt-dlp-info'
import { runKernelCommand } from './ytdlp-kernel-command'
import { getYtDlpKernelService } from './ytdlp-kernel-host'

/** Preserve useful endpoint information while masking credential-bearing URL components. */
function publicEndpoint(value: string): string {
  if (!value) {
    return value
  }
  try {
    const url = new URL(value)
    if (url.username || url.password) {
      url.username = 'REDACTED'
      url.password = 'REDACTED'
    }
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, 'REDACTED')
    }
    url.hash = ''
    return url.href
  } catch {
    return '[configured]'
  }
}

/** Read only declared public settings, masking proxy credentials before model access. */
export function getAgentSettings(): Record<string, unknown> {
  const all = settingsManager.getAll()
  const settings = Object.fromEntries(
    Object.keys(agentSettingsSchema.shape).map((key) => [key, all[key as keyof typeof all]])
  )
  settings.proxy = publicEndpoint(all.proxy)
  return {
    settings,
    readOnly: { autoUpdate: all.autoUpdate }
  }
}

/** Validate the entire patch before persistence and preserve all unspecified preferences. */
export async function updateAgentSettings(raw: unknown): Promise<Record<string, unknown>> {
  const patch = agentSettingsSchema.parse(raw)
  for (const key of ['downloadPath', 'cookiesPath', 'configPath'] as const) {
    const value = patch[key]
    if (value && !path.isAbsolute(value)) {
      throw new Error(`${key} must be an absolute path`)
    }
    if (value && key !== 'downloadPath' && !(await lstat(value)).isFile()) {
      throw new Error(`${key} must be a regular file`)
    }
  }
  if (patch.proxy) {
    const proxy = new URL(patch.proxy)
    if (
      !['http:', 'https:', 'socks4:', 'socks5:', 'socks5h:'].includes(proxy.protocol) ||
      patch.proxy.includes('REDACTED')
    ) {
      throw new Error('Provide a valid proxy URL, not a redacted value')
    }
  }
  if (patch.downloadPath) {
    await mkdir(patch.downloadPath, { recursive: true })
  }
  if (patch.asrTier) {
    const { getTranscriptionModelStatus } = await import('./transcript-host')
    const status = await getTranscriptionModelStatus()
    if (!status.tiers.find((tier) => tier.id === patch.asrTier)?.ready) {
      throw new Error(
        'ASR model is not ready. Create a model-download task with asrTier, wait for completion, then update settings. No settings were applied.'
      )
    }
  }
  updateDesktopSettings(patch)
  const { settings } = getAgentSettings() as { settings: Record<string, unknown> }
  return {
    updated: Object.keys(patch),
    settings: Object.fromEntries(Object.keys(patch).map((key) => [key, settings[key]]))
  }
}

/** Resolve media through its recorded task output, never a model-invented filesystem path. */
export async function requireAgentMediaTask(id: string) {
  const task = getDesktopTaskQueue().get(id)
  const file = task?.output?.filePath
  if (
    task?.status !== 'completed' ||
    !isMediaTaskKind(task.kind) ||
    !file ||
    !(await lstat(file)).isFile()
  ) {
    throw new Error('Choose a completed task with an existing local media file')
  }
  return { task, file }
}

/** Enqueue a persistent conversion child using the same task lifecycle as downloads and ASR. */
export async function createAgentMediaTask(
  raw: unknown,
  creation: TaskCreationMetadata = { origin: 'manual' }
): Promise<Record<string, unknown>> {
  const input = mediaTransformSchema.parse(raw)
  if (input.height && ['mp3', 'm4a', 'wav', 'flac'].includes(input.format)) {
    throw new Error('Audio output does not support height')
  }
  const { task, file } = await requireAgentMediaTask(input.parentId)
  const id = randomUUID()
  await getDesktopTaskQueue().add({
    id,
    parentId: task.id,
    groupKey: 'conversion',
    input: {
      kind: 'conversion',
      url: task.input.url,
      title: input.title ?? `${task.input.title ?? 'Media'} (${input.format})`,
      options: {
        ...creation,
        transform: input,
        type: ['mp3', 'm4a', 'wav', 'flac'].includes(input.format) ? 'audio' : 'video',
        sourceFilePath: file,
        outputDirectory: path.join(settingsManager.get('downloadPath'), 'Conversions'),
        durationSeconds: task.output?.durationMs ? task.output.durationMs / 1000 : undefined
      }
    }
  })
  return {
    id,
    kind: 'conversion',
    parentId: task.id,
    status: getDesktopTaskQueue().get(id)?.status
  }
}

/** Inspect actual engine state or bounded, credential-free media metadata. */
export async function inspectAgentEngine(
  input: { action: string; url?: string; taskId?: string; offset?: number },
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  const offset = input.offset ?? 0
  if (input.action === 'status') {
    let ffmpegVersion: string | null = null
    let ffmpegError: string | null = null
    try {
      const executable = await ffmpegManager.ensureInitialized()
      const result = await runKernelCommand(executable, ['-version'], { signal, timeoutMs: 10_000 })
      ffmpegVersion = result.stdout.split('\n')[0] ?? null
    } catch (error) {
      signal.throwIfAborted()
      ffmpegError = error instanceof Error ? error.message : String(error)
    }
    return {
      ytDlp: getYtDlpKernelService().getStatus(),
      ffmpegReady: Boolean(ffmpegVersion),
      ffmpegVersion,
      ffmpegError,
      conversions: mediaTransformSchema.shape.format.options
    }
  }
  if (input.action === 'update_ytdlp' || input.action === 'repair_ytdlp') {
    const kernel = getYtDlpKernelService()
    if (input.action === 'update_ytdlp') {
      await kernel.checkForUpdates()
    } else {
      await kernel.prepare()
    }
    return { ytDlp: kernel.getStatus() }
  }
  if (input.action === 'probe') {
    const { file } = await requireAgentMediaTask(input.taskId ?? '')
    return { taskId: input.taskId, media: await probeLocalMedia(file, signal) }
  }
  if (!['formats', 'playlist'].includes(input.action)) {
    throw new Error('Unknown engine action')
  }
  const url = new URL(input.url ?? '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Provide an HTTP(S) URL without credentials')
  }
  if (input.action === 'playlist') {
    const info = await fetchPlaylistInfo(url.href, signal)
    signal.throwIfAborted()
    return {
      ...info,
      entries: info.entries.slice(offset, offset + 25),
      nextOffset: offset + 25 < info.entries.length ? offset + 25 : null
    }
  }
  const info = await fetchVideoInfo(url.href, signal)
  signal.throwIfAborted()
  return {
    id: info.id,
    title: info.title,
    duration: info.duration,
    uploader: info.uploader,
    formats: info.formats
      .slice(offset, offset + 40)
      .map((format) =>
        Object.fromEntries(
          [
            'format_id',
            'ext',
            'height',
            'width',
            'fps',
            'vcodec',
            'acodec',
            'filesize',
            'filesize_approx',
            'format_note',
            'language',
            'tbr'
          ]
            .filter((key) => key in format)
            .map((key) => [key, format[key as keyof typeof format]])
        )
      ),
    nextOffset: offset + 40 < info.formats.length ? offset + 40 : null
  }
}

/** Inspect and delete ASR resources; selection belongs to settings and downloads to tasks. */
export async function manageAgentAsr(input: {
  action: string
  tier?: string
}): Promise<Record<string, unknown>> {
  const host = await import('./transcript-host')
  if (input.action === 'status') {
    return { model: await host.getTranscriptionModelStatus() }
  }
  const tier = agentSettingsSchema.shape.asrTier.unwrap().parse(input.tier)
  const actions = {
    delete: host.deleteAsrTier
  }
  const action = actions[input.action as keyof typeof actions]
  if (!action) {
    throw new Error('Unknown ASR action')
  }
  const model = await action(tier)
  broadcastSettingsChanged()
  return { model }
}

/** Reuse saved AI credentials without ever exposing or accepting secrets through chat. */
export async function manageAgentAi(raw: unknown): Promise<Record<string, unknown>> {
  const input = agentAiSettingsSchema.parse(raw)
  const { aiStore } = await import('./ai-store')
  const snapshot = aiStore.getSnapshot()
  const provider = snapshot.providers.find((item) => item.id === input.id)
  switch (input.action) {
    case 'list':
      break
    case 'catalog': {
      const { loadCloudModels } = await import('./cloud-models')
      return { presets: AI_PROVIDER_PRESETS, cloud: await loadCloudModels() }
    }
    case 'select_cloud_model': {
      const { loadCloudModels } = await import('./cloud-models')
      const catalog = await loadCloudModels()
      if (!(input.modelId && catalog.models.some((model) => model.id === input.modelId))) {
        throw new Error('Cloud model is unavailable')
      }
      aiStore.setCloudModel(input.modelId)
      break
    }
    case 'test_provider': {
      if (!provider) {
        throw new Error('Provider not found')
      }
      const { testProviderConnection } = await import('./ai-provider-test')
      return { providerId: provider.id, test: await testProviderConnection(provider) }
    }
    case 'select_provider':
      if (input.id === undefined) {
        throw new Error('id is required; null selects Cloud')
      }
      aiStore.setActiveProvider(input.id)
      break
    case 'save_provider':
    case 'update_provider': {
      if ((input.id || input.action === 'update_provider') && !provider) {
        throw new Error('Provider not found')
      }
      const preset = getAiProviderPreset(input.presetId ?? provider?.presetId ?? '')
      const modelId = input.modelId ?? provider?.modelId
      if (!(preset && modelId)) {
        throw new Error('presetId and modelId are required for a new provider')
      }
      if (input.baseUrl) {
        const url = new URL(input.baseUrl)
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        ) {
          throw new Error(
            'Use an HTTP(S) provider URL without embedded credentials or query parameters'
          )
        }
      }
      if (
        input.copyApiKeyFromId &&
        !snapshot.providers.some((item) => item.id === input.copyApiKeyFromId)
      ) {
        throw new Error('Credential source provider not found')
      }
      const {
        action: _action,
        title: _title,
        content: _content,
        enabled: _enabled,
        id: _id,
        ...patch
      } = input
      aiStore.upsertProvider({
        ...provider,
        ...patch,
        id: provider?.id,
        presetId: preset.id,
        modelId
      })
      break
    }
    case 'delete_provider':
      if (!provider) {
        throw new Error('Provider not found')
      }
      aiStore.deleteProvider(provider.id)
      break
    case 'save_prompt': {
      const existing = snapshot.prompts.find((prompt) => prompt.id === input.id)
      if (input.id && !existing) {
        throw new Error('Prompt not found')
      }
      const title = input.title ?? existing?.title
      const content = input.content ?? existing?.content
      if (!(title?.trim() && content?.trim())) {
        throw new Error('Prompt title and content are required')
      }
      aiStore.upsertPrompt({
        id: existing?.id,
        title,
        content,
        enabled: input.enabled ?? existing?.enabled,
        icon: existing?.icon ?? 'sparkles'
      })
      break
    }
    case 'delete_prompt':
      if (!(input.id && snapshot.prompts.some((prompt) => prompt.id === input.id))) {
        throw new Error('Prompt not found')
      }
      aiStore.deletePrompt(input.id)
      break
    case 'restore_prompts':
      aiStore.restoreDefaultPrompts()
      break
    default:
      throw new Error('Unknown AI settings action')
  }
  broadcastSettingsChanged()
  const updated = aiStore.getSnapshot()
  return {
    ...updated,
    providers: updated.providers.map((provider) => ({
      ...provider,
      baseUrl: publicEndpoint(provider.baseUrl)
    }))
  }
}
