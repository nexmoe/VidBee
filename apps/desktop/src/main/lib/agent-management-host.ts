import { randomUUID } from 'node:crypto'
import { linkSync, lstatSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import {
  normalizeFeedItems,
  RssParserFeedFetcher,
  type SubscriptionUpdateInput
} from '@vidbee/subscriptions-core'
import {
  isMediaTaskKind,
  ListInputSchema,
  sanitizeOutput,
  type Task,
  type TaskCreationMetadata
} from '@vidbee/task-queue'
import { agentTaskSchema } from '../../shared/agent-task'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '../../shared/utils/format-preferences'
import { sanitizeFilenameTemplate } from '../download-engine/args-builder'
import { settingsManager } from '../settings'
import { isOutsideDownloadPath } from './agent-tool-approval'
import { enqueueAsrModelDownload } from './asr-model-task'
import { getDatabaseConnection } from './database'
import { prepareDownloadTaskInput } from './download-facade'
import { historyManager } from './history-manager'
import { getDesktopSubscriptions, removeDesktopSubscription } from './subscriptions-host'
import { getDesktopTaskQueue } from './task-queue-host'
import { startTranscriptionForDownload } from './transcript-host'

/** Restrict task/feed entry points to ordinary web URLs without embedded credentials. */
function webUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Provide an HTTP(S) URL without embedded credentials')
  }
  return parsed.href
}

/** Require a concrete existing task before mutations can have side effects. */
function requireTask(id: string): Readonly<Task> {
  const task = getDesktopTaskQueue().get(id)
  if (!task) {
    throw new Error(`Task not found: ${id}`)
  }
  return task
}

/** Return task facts without exposing settings, cookies or raw execution arguments. */
function taskSummary(task: Readonly<Task>): Record<string, unknown> {
  return {
    id: task.id,
    kind: task.kind,
    parentId: task.parentId,
    title: task.input.title,
    url: task.input.url,
    status: task.status,
    progress: task.progress.percent,
    currentTransfer:
      task.kind === 'model-download'
        ? { receivedBytes: task.progress.bytesDownloaded, totalBytes: task.progress.bytesTotal }
        : undefined,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    nextRetryAt: task.nextRetryAt,
    error: task.lastError,
    asrTier: task.kind === 'model-download' ? task.input.options?.asrTier : undefined,
    filename:
      isMediaTaskKind(task.kind) && task.output?.filePath
        ? path.basename(task.output.filePath)
        : null
  }
}

/** Filter the complete task index before paginating across any task kind. */
export async function listAgentTasks(input: {
  query?: string
  kind?: string
  status?: string
  parentId?: string
  cursor?: string
}): Promise<Record<string, unknown>> {
  const page = getDesktopTaskQueue().list(ListInputSchema.parse({ ...input, limit: 20 }))
  return { tasks: page.tasks.map(taskSummary), nextCursor: page.nextCursor }
}

/** Include persisted failure logs and explicit automatic retry state for diagnosis. */
export async function getAgentTask(id: string): Promise<Record<string, unknown>> {
  const task = requireTask(id)
  const children = getDesktopTaskQueue().list({ parentId: id, limit: 20 })
  const log = await getDesktopTaskQueue().getTaskLog(id)
  return {
    ...taskSummary(task),
    log: log ? sanitizeOutput(log) : null,
    automaticRetry: task.status === 'retry-scheduled',
    children: children.tasks.map(taskSummary),
    childrenNextCursor: children.nextCursor
  }
}

/** Enqueue media using saved download preferences, or use the existing transcription workflow. */
export async function createAgentTask(
  raw: unknown,
  signal?: AbortSignal,
  creation: TaskCreationMetadata = { origin: 'agent' }
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const queue = getDesktopTaskQueue()
  const input = agentTaskSchema.parse(raw)
  if (input.kind === 'conversion') {
    const { kind: _kind, ...transform } = input
    const { createAgentMediaTask } = await import('./agent-capability-host')
    const created = await createAgentMediaTask(transform, creation)
    return { created: true, task: taskSummary(requireTask(created.id as string)) }
  }
  if (input.kind === 'model-download') {
    const result = await enqueueAsrModelDownload(input.asrTier, creation)
    return { created: result.created, task: taskSummary(result.task) }
  }
  const kind = input.kind ?? 'video'
  if (input.kind === 'transcription') {
    const parent = requireTask(input.parentId)
    if (parent.status !== 'completed') {
      throw new Error('Wait for the parent media task to complete')
    }
    const snapshot = await startTranscriptionForDownload(
      input.parentId,
      false,
      undefined,
      undefined,
      creation
    )
    return {
      parentId: input.parentId,
      transcript: snapshot,
      tasks: queue.list({ parentId: input.parentId, limit: 50 }).tasks.map(taskSummary)
    }
  }
  if (!(['video', 'audio'].includes(kind) && input.url)) {
    throw new Error('Media tasks require a URL and video/audio kind')
  }
  const url = webUrl(input.url)
  /** Recheck after asynchronous metadata resolution to avoid concurrent duplicate additions. */
  const existingTask = () => {
    let cursor: string | null = null
    do {
      const page = queue.list({ kind: kind === 'audio' ? 'audio' : 'video', limit: 200, cursor })
      const existing = page.tasks.find(
        (task) =>
          task.input.url === url &&
          (!input.format || task.input.options?.format === input.format) &&
          (!input.container || task.input.options?.containerFormat === input.container)
      )
      if (existing) {
        return existing
      }
      cursor = page.nextCursor
    } while (cursor)
    return undefined
  }
  const existing = existingTask()
  if (existing) {
    return { created: false, task: taskSummary(existing) }
  }
  const settings = settingsManager.getAll()
  const id = randomUUID()
  const prepared = await prepareDownloadTaskInput(id, {
    url,
    type: kind === 'audio' ? 'audio' : 'video',
    title: input.title,
    format:
      input.format ??
      (kind === 'audio'
        ? buildAudioFormatPreference(settings)
        : buildVideoFormatPreference(settings)),
    containerFormat:
      kind === 'video' ? (input.container ?? settings.oneClickContainer ?? 'auto') : undefined
  })
  signal?.throwIfAborted()
  const concurrent = existingTask()
  if (concurrent) {
    return { created: false, task: taskSummary(concurrent) }
  }
  const added = await queue.add({
    id,
    input: { ...prepared, options: { ...prepared.options, ...creation } }
  })
  return { created: true, task: taskSummary(requireTask(added.id)) }
}

/** Rename an owned completed media file without overwriting another file or racing active readers. */
async function renameTaskFile(id: string, name: string): Promise<void> {
  const queue = getDesktopTaskQueue()
  const task = requireTask(id)
  const source = task.output?.filePath
  if (task.status !== 'completed' || !source || !isMediaTaskKind(task.kind)) {
    throw new Error('Choose a completed media task with a file')
  }
  const normalized = name.trim()
  if (
    !normalized ||
    normalized.length > 200 ||
    /[<>:"/\\|?*]/.test(normalized) ||
    [...normalized].some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(normalized)
  ) {
    throw new Error('Provide a filename, not a path')
  }
  if (!lstatSync(source).isFile()) {
    throw new Error('Task output must be a regular file')
  }
  const extension = path.extname(source)
  const target = path.join(
    path.dirname(source),
    normalized.endsWith(extension) ? normalized : `${normalized}${extension}`
  )
  if (source === target) {
    return
  }
  // Linking fails atomically if the destination exists and retains the original during persistence.
  linkSync(source, target)
  const { sqlite } = getDatabaseConnection()
  try {
    await queue.relocateFileReferences(source, target)
    sqlite
      .prepare('UPDATE transcripts SET source_file_path = ? WHERE source_file_path = ?')
      .run(target, source)
    unlinkSync(source)
  } catch (error) {
    // Keep both names until every durable reference has been restored successfully.
    await queue.relocateFileReferences(target, source)
    sqlite
      .prepare('UPDATE transcripts SET source_file_path = ? WHERE source_file_path = ?')
      .run(source, target)
    unlinkSync(target)
    throw error
  }
}

/** Route common lifecycle actions through the shared queue rather than download-only APIs. */
export async function manageAgentTask(input: {
  id: string
  action: string
  name?: string
}): Promise<Record<string, unknown>> {
  const queue = getDesktopTaskQueue()
  const task = requireTask(input.id)
  switch (input.action) {
    case 'pause':
      if (!['queued', 'running', 'processing', 'retry-scheduled'].includes(task.status)) {
        throw new Error('Task cannot be paused in its current state')
      }
      await queue.pause(input.id)
      break
    case 'resume':
      if (task.status !== 'paused') {
        throw new Error('Only paused tasks can be resumed')
      }
      await queue.resume(input.id)
      break
    case 'cancel':
      await queue.cancel(input.id)
      break
    case 'retry':
      if (!['failed', 'cancelled'].includes(task.status)) {
        throw new Error(
          'Only failed or cancelled tasks can be retried; scheduled retries already run automatically'
        )
      }
      await queue.retryManual(input.id)
      break
    case 'remove':
      await queue.cancel(input.id)
      await historyManager.removeHistoryItem(input.id)
      return { removed: !queue.get(input.id), filesDeleted: false }
    case 'rename':
      if (!input.name) {
        throw new Error('name is required')
      }
      await queue.rename(input.id, input.name)
      break
    case 'rename_file':
      if (!input.name) {
        throw new Error('name is required')
      }
      await renameTaskFile(input.id, input.name)
      break
    default:
      throw new Error('Unsupported task action')
  }
  return { task: taskSummary(requireTask(input.id)) }
}

/** Strip item collections from subscription lists to keep tool results bounded. */
export async function listAgentSubscriptions(input: {
  query?: string
  offset?: number
}): Promise<Record<string, unknown>> {
  const all = await getDesktopSubscriptions().list()
  const query = input.query?.toLocaleLowerCase() ?? ''
  const matches = all.items.filter((sub) =>
    `${sub.id}\n${sub.title}\n${sub.feedUrl}`.toLocaleLowerCase().includes(query)
  )
  const offset = input.offset ?? 0
  return {
    subscriptions: matches
      .slice(offset, offset + 20)
      .map(({ items, ...sub }) => ({ ...sub, itemCount: items.length })),
    total: matches.length,
    nextOffset: offset + 20 < matches.length ? offset + 20 : null
  }
}

/** Fetch and parse without saving configuration or invoking the auto-download scheduler. */
async function probeSubscription(url: string, signal?: AbortSignal) {
  const resolved = getDesktopSubscriptions().resolve({ rawUrl: webUrl(url) })
  webUrl(resolved.feedUrl)
  const timeout = AbortSignal.timeout(30_000)
  const probeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const fetcher = new RssParserFeedFetcher()
  let probed: Awaited<ReturnType<RssParserFeedFetcher['probe']>>
  try {
    probed = await fetcher.probe(resolved.feedUrl, probeSignal)
  } catch (error) {
    probeSignal.throwIfAborted()
    if (resolved.sourceUrl === resolved.feedUrl) {
      throw error
    }
    probed = await fetcher.probe(resolved.sourceUrl, probeSignal)
  }
  const { feed } = probed
  const items = normalizeFeedItems(feed.items)
  return {
    resolved: { ...resolved, feedUrl: probed.feedUrl },
    discovered: probed.discovered,
    corrected: probed.feedUrl !== resolved.feedUrl,
    title: feed.title,
    parsedItems: feed.items.length,
    usableItems: items.length,
    samples: items.slice(0, 5)
  }
}

/** Return actionable fetch evidence, including a failed result instead of invented success. */
export async function testAgentSubscription(
  url: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  try {
    return { valid: true, ...(await probeSubscription(url, signal)), downloadsTested: false }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
      downloadsTested: false
    }
  }
}

/** Manage saved feeds only after validating URL changes; preserve omitted configuration fields. */
export async function manageAgentSubscription(
  input: {
    action: string
    id?: string
    itemId?: string
    url?: string
    title?: string
    downloadDirectory?: string
    approvedPath?: boolean
    namingTemplate?: string
    enabled?: boolean
    autoDownload?: boolean
    onlyDownloadLatest?: boolean
    keywords?: string[]
    tags?: string[]
    offset?: number
  },
  signal?: AbortSignal,
  creation: TaskCreationMetadata = { origin: 'agent' }
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const api = getDesktopSubscriptions()
  if (input.action !== 'add' && !input.id) {
    throw new Error('id is required')
  }
  const id = input.id ?? ''
  if (input.action === 'remove') {
    await api.get({ id })
    await removeDesktopSubscription(id)
    return { removed: true }
  }
  if (input.action === 'refresh') {
    return { subscription: await api.refresh({ id }) }
  }
  if (input.action === 'items') {
    return api.itemsList({ subscriptionId: id, offset: input.offset, limit: 50 })
  }
  if (input.action === 'queue_item') {
    if (!input.itemId) {
      throw new Error('itemId is required')
    }
    return api.itemsQueue({ subscriptionId: id, itemId: input.itemId }, creation)
  }
  if (!['add', 'update'].includes(input.action)) {
    throw new Error('Unsupported subscription action')
  }
  const patch: SubscriptionUpdateInput = {}
  if (input.downloadDirectory !== undefined) {
    if (!path.isAbsolute(input.downloadDirectory)) {
      throw new Error('downloadDirectory must be an absolute path')
    }
    const downloadPath = settingsManager.getAll().downloadPath
    if (isOutsideDownloadPath(input.downloadDirectory, downloadPath) && !input.approvedPath) {
      throw new Error(
        'downloadDirectory must stay inside the library folder unless the user approved this path.'
      )
    }
    patch.downloadDirectory = input.downloadDirectory
  }
  if (input.namingTemplate !== undefined) {
    patch.namingTemplate = sanitizeFilenameTemplate(input.namingTemplate)
  }
  for (const key of [
    'title',
    'enabled',
    'autoDownload',
    'onlyDownloadLatest',
    'keywords',
    'tags'
  ] as const) {
    if (input[key] !== undefined) {
      Object.assign(patch, { [key]: input[key] })
    }
  }
  const probe = input.url ? await probeSubscription(input.url, signal) : null
  signal?.throwIfAborted()
  if (probe) {
    Object.assign(patch, probe.resolved)
  }
  if (input.action === 'update') {
    return { subscription: await api.update({ id, ...patch }), tested: Boolean(probe) }
  }
  if (!probe) {
    throw new Error('url is required')
  }
  const created = await api.add({
    ...patch,
    ...probe.resolved,
    title: input.title ?? probe.title,
    autoDownload: input.autoDownload ?? false,
    downloadDirectory:
      input.downloadDirectory ?? path.join(settingsManager.getAll().downloadPath, 'Subscriptions')
  })
  const subscription = created.enabled ? await api.refresh({ id: created.id }) : created
  return { subscription, tested: true, usableItems: probe.usableItems }
}
