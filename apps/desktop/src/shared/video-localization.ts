import { z } from 'zod'
import { ttsModelIdSchema } from './tts-models'

/** Export a named subtitle source without changing the visible transcript. */
export const subtitleExportInputSchema = z
  .object({
    sourceKey: z.string().min(1).max(100),
    format: z.enum(['srt', 'vtt', 'mkv', 'mp4']),
    bilingual: z.boolean().default(false)
  })
  .strict()

/** Generate local speech and fit it to the selected subtitle track. */
export const dubbingInputSchema = z
  .object({
    sourceKey: z.string().min(1).max(100),
    modelId: ttsModelIdSchema.optional(),
    voice: z.number().int().min(0).max(1_000_000).optional(),
    reference: z
      .object({
        file: z
          .string()
          .min(1)
          .max(200)
          .regex(/^(?!\/|\\|[A-Za-z]:)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\n\r]+\.wav$/),
        text: z.string().min(1).max(4000).optional()
      })
      .strict()
      .optional(),
    background: z.enum(['remove', 'separate']).default('separate'),
    maxSpeed: z.number().min(1).max(2).default(1.5),
    burnSubtitles: z.boolean().default(false),
    speechOverrides: z
      .array(
        z
          .object({
            cueIndex: z.number().int().min(1).max(50_000),
            originalText: z.string().min(1).max(4000),
            text: z.string().trim().min(1).max(4000)
          })
          .strict()
      )
      .max(50_000)
      .optional()
  })
  .strict()

export type SubtitleExportInput = z.infer<typeof subtitleExportInputSchema>
export type DubbingInput = z.infer<typeof dubbingInputSchema>
