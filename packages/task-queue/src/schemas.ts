import { z } from 'zod'

export const TaskKindSchema = z.enum([
  'video',
  'audio',
  'playlist',
  'subscription-item',
  'yt-dlp-forward',
  'transcription',
  'conversion',
  'model-download'
])

export const TaskStatusSchema = z.enum([
  'queued',
  'running',
  'processing',
  'paused',
  'retry-scheduled',
  'completed',
  'failed',
  'cancelled'
])

export const TaskPrioritySchema = z.union([z.literal(0), z.literal(10), z.literal(20)])

export const ErrorCategorySchema = z.enum([
  'http-429',
  'auth-required',
  'geo-blocked',
  'not-found',
  'disk-full',
  'permission-denied',
  'binary-missing',
  'ffmpeg',
  'network-transient',
  'stalled',
  'cancelled-by-user',
  'output-missing',
  'unknown'
])

export const TaskInputSchema = z.object({
  url: z.string().min(1),
  kind: TaskKindSchema,
  title: z.string().optional(),
  thumbnail: z.string().optional(),
  subscriptionId: z.string().optional(),
  playlistId: z.string().optional(),
  playlistIndex: z.number().int().nonnegative().optional(),
  rawArgs: z.array(z.string()).optional(),
  options: z.record(z.string(), z.unknown()).optional()
})

export const TranscriptTaskResultSchema = z.object({
  resultKind: z.enum(['transcript', 'no-speech']),
  transcriptId: z.string().min(1)
})

export const SubtitleDownloadStatusSchema = z.enum([
  'downloaded',
  'unavailable',
  'skipped-auth',
  'failed'
])

export const TaskOutputSchema = z.object({
  filePath: z.string(),
  size: z.number().int().nonnegative(),
  durationMs: z.number().int().nullable(),
  sha256: z.string().nullable(),
  formatId: z.string().nullable().optional(),
  subtitleStatus: SubtitleDownloadStatusSchema.optional(),
  subtitleLanguages: z.array(z.string()).optional(),
  subtitleAcquisition: z
    .object({
      id: z.string(),
      acquiredAt: z.number(),
      credentialsUsed: z.boolean().optional(),
      visibility: z.enum(['public', 'private', 'unlisted']).optional()
    })
    .optional(),
  transcript: TranscriptTaskResultSchema.optional()
})

export const TaskProgressSchema = z.object({
  percent: z.number().min(0).max(1).nullable(),
  bytesDownloaded: z.number().int().nullable(),
  bytesTotal: z.number().int().nullable(),
  speedBps: z.number().nullable(),
  etaMs: z.number().int().nullable(),
  ticks: z.number().int().nonnegative()
})

export const ClassifiedErrorSchema = z.object({
  category: ErrorCategorySchema,
  exitCode: z.number().int().nullable(),
  rawMessage: z.string(),
  uiMessageKey: z.string(),
  uiActionHints: z.array(z.string()).readonly(),
  retryable: z.boolean(),
  suggestedRetryAfterMs: z.number().int().nonnegative().nullable()
})

export const TaskSchema = z.object({
  id: z.string(),
  kind: TaskKindSchema,
  parentId: z.string().nullable(),
  input: TaskInputSchema,
  priority: TaskPrioritySchema,
  groupKey: z.string(),
  status: TaskStatusSchema,
  prevStatus: TaskStatusSchema.nullable(),
  statusReason: z.string().nullable(),
  enteredStatusAt: z.number().int(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().nonnegative(),
  nextRetryAt: z.number().int().nullable(),
  progress: TaskProgressSchema,
  output: TaskOutputSchema.nullable(),
  lastError: ClassifiedErrorSchema.nullable(),
  pid: z.number().int().nullable(),
  pidStartedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int()
})

// ───────────── API I/O schemas ─────────────

export const AddInputSchema = z.object({
  input: TaskInputSchema,
  priority: TaskPrioritySchema.optional(),
  groupKey: z.string().optional(),
  parentId: z.string().nullable().optional(),
  maxAttempts: z.number().int().nonnegative().optional()
})

export const AddOutputSchema = z.object({ id: z.string() })

export const TaskIdInputSchema = z.object({ id: z.string() })

export const ListInputSchema = z.object({
  query: z.string().max(200).optional(),
  kind: TaskKindSchema.optional(),
  status: TaskStatusSchema.optional(),
  groupKey: z.string().optional(),
  parentId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().optional()
})

export const ListOutputSchema = z.object({
  tasks: z.array(TaskSchema),
  nextCursor: z.string().nullable()
})

export const StatsOutputSchema = z.object({
  total: z.number().int(),
  byStatus: z.record(TaskStatusSchema, z.number().int()),
  running: z.number().int(),
  queued: z.number().int(),
  capacity: z.number().int(),
  perGroup: z.record(z.string(), z.number().int())
})

export const SetMaxConcurrencyInputSchema = z.object({
  n: z.number().int().min(1).max(64)
})

export const SetMaxPerGroupInputSchema = z.object({
  groupKey: z.string(),
  n: z.number().int().min(1).max(64).nullable()
})

export const PauseInputSchema = z.object({
  id: z.string(),
  reason: z.string().optional()
})

export const RetryInputSchema = z.object({
  id: z.string()
})

export const VoidOutputSchema = z.object({ ok: z.literal(true) })
