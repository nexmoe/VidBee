import { z } from 'zod'

export const AGENT_SUBTITLE_MODEL_VERSION = 'agent-subtitles-v1'
export const MAX_AGENT_SUBTITLE_CUES = 500

/** Tool input uses original source seconds, matching read_transcript and media tools. */
export const agentSubtitleInputSchema = z
  .object({
    language: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i),
    append: z.boolean().optional(),
    cues: z
      .array(
        z
          .object({
            start: z.number().finite().min(0).max(604_800),
            end: z.number().finite().positive().max(604_800),
            text: z.string().trim().min(1).max(4000)
          })
          .strict()
      )
      .min(1)
      .max(MAX_AGENT_SUBTITLE_CUES)
  })
  .strict()

export type AgentSubtitleInput = z.infer<typeof agentSubtitleInputSchema>
