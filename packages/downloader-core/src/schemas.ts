import { z } from 'zod'

export const DownloadTypeSchema = z.enum(['video', 'audio'])

export const DownloadProgressSchema = z.object({
  percent: z.number(),
  currentSpeed: z.string().optional(),
  eta: z.string().optional(),
  downloaded: z.string().optional(),
  total: z.string().optional()
})

export const DownloadTaskSchema = z.object({
  id: z.string(),
  url: z.url(),
  type: DownloadTypeSchema,
  status: z.enum(['pending', 'downloading', 'completed', 'error', 'cancelled']),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  progress: DownloadProgressSchema.optional(),
  error: z.string().optional()
})

export const CreateDownloadInputSchema = z.object({
  url: z.url(),
  type: DownloadTypeSchema,
  format: z.string().optional(),
  audioFormat: z.string().optional()
})

export const VideoInfoInputSchema = z.object({
  url: z.url()
})

export const VideoFormatSchema = z.object({
  formatId: z.string(),
  ext: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  fps: z.number().optional(),
  vcodec: z.string().optional(),
  acodec: z.string().optional(),
  filesize: z.number().optional(),
  filesizeApprox: z.number().optional(),
  formatNote: z.string().optional(),
  tbr: z.number().optional()
})

export const VideoInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnail: z.string().optional(),
  duration: z.number().optional(),
  formats: z.array(VideoFormatSchema)
})

export const StatusOutputSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  active: z.number(),
  pending: z.number()
})

export const CreateDownloadOutputSchema = z.object({
  download: DownloadTaskSchema
})

export const ListDownloadsOutputSchema = z.object({
  downloads: z.array(DownloadTaskSchema)
})

export const CancelDownloadInputSchema = z.object({
  id: z.string()
})

export const CancelDownloadOutputSchema = z.object({
  cancelled: z.boolean()
})

export const ListHistoryOutputSchema = z.object({
  history: z.array(DownloadTaskSchema)
})

export const VideoInfoOutputSchema = z.object({
  video: VideoInfoSchema
})
