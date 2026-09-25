import { z } from 'zod'
import { mediaTransformSchema } from './media-transform'

/** Validate executor-specific task options at both tool and host boundaries. */
export const agentTaskSchema = z.union([
  z
    .object({
      kind: z.enum(['video', 'audio']).optional(),
      url: z.string().min(1).max(4096),
      title: z.string().min(1).max(200).optional(),
      format: z.string().min(1).max(500).optional(),
      container: z.enum(['auto', 'mp4', 'mkv', 'webm', 'original']).optional()
    })
    .strict(),
  mediaTransformSchema.extend({ kind: z.literal('conversion') }),
  z.object({ kind: z.literal('transcription'), parentId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('model-download'), asrTier: z.string().min(1).max(100) }).strict()
])

/** Expose a flat object for providers that cannot generate root-union tool arguments. */
export const agentTaskParameters = mediaTransformSchema.partial().extend({
  ...agentTaskSchema.options[0].partial().shape,
  kind: z.enum(['video', 'audio', 'conversion', 'transcription', 'model-download']).optional(),
  asrTier: agentTaskSchema.options[3].shape.asrTier.optional()
})
