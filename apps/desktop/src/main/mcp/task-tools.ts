import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { resolveSubtitleLanguages } from '@vidbee/downloader-core/subtitle-languages'
import { ListInputSchema, sanitizeOutput, type Task } from '@vidbee/task-queue'
import { z } from 'zod'
import { agentSettingsSchema } from '../../shared/agent-settings'
import { agentTaskParameters } from '../../shared/agent-task'
import type { DownloadOptions } from '../../shared/types'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '../../shared/utils/format-preferences'
import { inspectAgentEngine } from '../lib/agent-capability-host'
import { createAgentTask, getAgentTask, manageAgentTask } from '../lib/agent-management-host'
import { prepareDownloadTaskInput } from '../lib/download-facade'
import { hydrateDownloadMetadata } from '../lib/download-metadata'
import { historyManager } from '../lib/history-manager'
import { subtitleDownloadSchema } from '../lib/subtitle-download'
import { getDesktopTaskQueue } from '../lib/task-queue-host'
import { settingsManager } from '../settings'
import { defineMcpTool, mcpId, mcpLimit, mcpOffset, mcpPage, mcpWebUrl } from './tool'

const downloadSchema = z.object({
  url: mcpWebUrl,
  type: z.enum(['video', 'audio', 'subtitles']).default('video'),
  language: subtitleDownloadSchema.shape.language.describe(
    'Select one caption language when type is subtitles.'
  ),
  title: z.string().min(1).max(200).optional(),
  format: z.string().min(1).max(500).optional(),
  audioFormat: z.enum(['mp3', 'm4a', 'wav', 'flac', 'opus', 'vorbis', 'aac', 'best']).optional(),
  audioFormatIds: z.array(mcpId).max(20).optional(),
  containerFormat: z.enum(['auto', 'mp4', 'mkv', 'webm', 'original']).optional(),
  startTime: z
    .string()
    .regex(/^(?:\d+:){0,2}\d+(?:\.\d+)?$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^(?:\d+:){0,2}\d+(?:\.\d+)?$/)
    .optional(),
  customDownloadPath: z.string().min(1).max(4096).optional(),
  customFilenameTemplate: z.string().min(1).max(300).optional(),
  tags: z.array(z.string().max(100)).max(30).optional(),
  subtitles: agentSettingsSchema
    .pick({
      downloadSubtitles: true,
      subtitleLanguages: true,
      embedSubs: true,
      writeAutoSubs: true
    })
    .optional()
})

/** Project queue data without runtime cookie/proxy settings or arbitrary execution arguments. */
export function mcpTask(task: Readonly<Task>) {
  return {
    id: task.id,
    kind: task.kind,
    parentId: task.parentId,
    groupKey: task.groupKey,
    url: task.input.url,
    title: task.input.title,
    status: task.status,
    progress: task.progress,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    nextRetryAt: task.nextRetryAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    output: task.output,
    error: task.lastError
      ? { ...task.lastError, rawMessage: sanitizeOutput(task.lastError.rawMessage) }
      : null
  }
}

/** Admit a media download with validated options and the same defaults as the Desktop UI. */
async function downloadMedia(input: z.output<typeof downloadSchema>, signal: AbortSignal) {
  if (input.customDownloadPath && !path.isAbsolute(input.customDownloadPath)) {
    throw new Error('customDownloadPath must be an absolute path')
  }
  const settings = settingsManager.getAll()
  const queue = getDesktopTaskQueue()
  if (input.type === 'subtitles') {
    const { url, type, title, language, format, customDownloadPath, ...mediaOptions } = input
    if (Object.values(mediaOptions).some((value) => value !== undefined)) {
      throw new Error(
        'Subtitle-only downloads accept url, type, title, language, format and customDownloadPath'
      )
    }
    const options = subtitleDownloadSchema.parse({ language, format })
    const prepared = {
      url,
      kind: type,
      title,
      options: {
        ...options,
        origin: 'agent',
        customDownloadPath,
        languages: options.language
          ? [options.language]
          : resolveSubtitleLanguages(settings.subtitleLanguages, settings.language)
      }
    }
    signal.throwIfAborted()
    const duplicate = queue.findDuplicateDownload(prepared)
    if (duplicate) {
      return { created: false, task: mcpTask(duplicate) }
    }
    const metadata = await hydrateDownloadMetadata({ url, title }, signal)
    const id = randomUUID()
    const admitted = await queue.add({
      id,
      input: { ...prepared, title: metadata.title, thumbnail: metadata.thumbnail }
    })
    const task = queue.get(admitted.id)
    return { created: admitted.id === id, task: task ? mcpTask(task) : null }
  }
  if (input.language !== undefined) {
    throw new Error('language requires type: subtitles')
  }
  const { subtitles, language: _language, ...values } = input
  const options: DownloadOptions = {
    ...values,
    type: input.type,
    origin: 'agent',
    format:
      input.format ??
      (input.type === 'audio'
        ? buildAudioFormatPreference(settings)
        : buildVideoFormatPreference(settings)),
    containerFormat: input.containerFormat ?? settings.oneClickContainer
  }
  const duplicate = queue.findDuplicateDownload({
    url: input.url,
    kind: input.type,
    options: { ...options }
  })
  if (duplicate) {
    return { created: false, task: mcpTask(duplicate) }
  }
  const id = randomUUID()
  const prepared = await prepareDownloadTaskInput(id, options)
  if (subtitles) {
    prepared.options = {
      ...prepared.options,
      settings: { ...(prepared.options?.settings as object), ...subtitles }
    }
  }
  signal.throwIfAborted()
  const admitted = await queue.add({ id, input: prepared })
  const task = queue.get(admitted.id)
  return { created: admitted.id === id, task: task ? mcpTask(task) : null }
}

/** Expose queue operations, download options, conversion, metadata and paginated history. */
export function createMcpTaskTools() {
  return [
    defineMcpTool(
      'list_tasks',
      'List downloads, conversions, transcription and model tasks. Follow nextCursor with the same filters.',
      ListInputSchema.extend({ limit: mcpLimit }),
      (input) => {
        const page = getDesktopTaskQueue().list(input)
        return { tasks: page.tasks.map(mcpTask), nextCursor: page.nextCursor }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_task',
      'Read one task, local output paths, progress, retry state, child tasks and sanitized failure logs.',
      z.object({ id: mcpId }),
      async ({ id }) => {
        const detail = await getAgentTask(id)
        const task = getDesktopTaskQueue().get(id)
        return { ...detail, ...(task ? mcpTask(task) : {}) }
      },
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'get_queue_stats',
      'Read task counts, execution capacity and running tasks per group.',
      z.object({}),
      () => getDesktopTaskQueue().stats(),
      { readOnlyHint: true, idempotentHint: true }
    ),
    defineMcpTool(
      'create_task',
      'Queue video/audio from url, convert/trim/resize a completed parentId, transcribe parentId, or download an asrTier. Returns admission; poll get_task for completion. Formats and containers use saved preferences when omitted.',
      agentTaskParameters,
      (input, signal) => createAgentTask(input, signal)
    ),
    defineMcpTool(
      'download_media',
      'Queue video, audio, or subtitles only. Use type: subtitles with optional language and format: srt (default) or vtt to fetch existing website captions without media or ASR. Captions appear in the library and transcript detail; use the returned task ID as get_transcript.downloadId. Subtitle mode also accepts title and customDownloadPath. Video/audio support format selection, audio tracks, clipping, filenames, folders, tags and subtitle settings. Saved preferences and credentials are reused. Returns admission; poll get_task for completion and output.filePath.',
      downloadSchema,
      downloadMedia,
      { openWorldHint: true }
    ),
    defineMcpTool(
      'download_batch',
      'Queue up to 50 media URLs serially with common options. Each result reports admission or error independently; duplicate downloads are reused.',
      z.object({
        urls: z.array(mcpWebUrl).min(1).max(50),
        options: downloadSchema.omit({ url: true }).optional()
      }),
      async ({ urls, options }, signal) => {
        const results: unknown[] = []
        for (const url of urls) {
          signal.throwIfAborted()
          try {
            results.push({
              url,
              ...(await downloadMedia(downloadSchema.parse({ ...options, url }), signal))
            })
          } catch (error) {
            signal.throwIfAborted()
            results.push({
              url,
              error:
                error instanceof Error ? sanitizeOutput(error.message) : 'Download admission failed'
            })
          }
        }
        return { results }
      },
      { openWorldHint: true }
    ),
    defineMcpTool(
      'manage_task',
      'Pause, resume, cancel, retry, remove history, rename title, or rename a completed media file. Inspect get_task before retrying. remove retains physical files; name is required for renames.',
      z.object({
        id: mcpId,
        action: z.enum(['pause', 'resume', 'cancel', 'retry', 'remove', 'rename', 'rename_file']),
        name: z.string().min(1).max(200).optional()
      }),
      (input) => manageAgentTask(input),
      { destructiveHint: true }
    ),
    defineMcpTool(
      'configure_queue_group',
      'Set a per-group concurrency limit (1–64); null restores the shared default. Global limits are available through update_settings.',
      z.object({ groupKey: mcpId, limit: z.number().int().min(1).max(64).nullable() }),
      async ({ groupKey, limit }) => {
        await getDesktopTaskQueue().setMaxPerGroup(groupKey, limit)
        return getDesktopTaskQueue().stats()
      },
      { idempotentHint: true }
    ),
    defineMcpTool(
      'inspect_media_engine',
      'Inspect yt-dlp/FFmpeg, paginate URL formats or playlist entries, probe a completed local task, or update/repair yt-dlp. No shell commands or arbitrary flags are accepted.',
      z.object({
        action: z.enum(['status', 'formats', 'playlist', 'probe', 'update_ytdlp', 'repair_ytdlp']),
        url: mcpWebUrl.optional(),
        taskId: mcpId.optional(),
        offset: mcpOffset
      }),
      (input, signal) => inspectAgentEngine(input, signal),
      { openWorldHint: true }
    ),
    defineMcpTool(
      'list_download_history',
      'Search persisted media history by ID/title/URL, with optional status. Logs and execution commands are omitted; local paths are included.',
      z.object({
        query: z.string().max(200).optional(),
        status: z
          .enum(['pending', 'downloading', 'processing', 'completed', 'error', 'cancelled'])
          .optional(),
        offset: mcpOffset,
        limit: mcpLimit
      }),
      ({ query, status, offset, limit }) => {
        const needle = query?.toLocaleLowerCase() ?? ''
        const items = historyManager
          .getHistory()
          .filter(
            (item) =>
              (!status || item.status === status) &&
              `${item.id}\n${item.title}\n${item.url}`.toLocaleLowerCase().includes(needle)
          )
        return mcpPage(
          items.map(({ ytDlpCommand: _command, ytDlpLog: _log, ...item }) => item),
          offset,
          limit
        )
      },
      { readOnlyHint: true, idempotentHint: true }
    )
  ]
}
