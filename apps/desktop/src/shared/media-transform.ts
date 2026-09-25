import { z } from 'zod'

/** Structured media operations never accept arbitrary process flags or output paths. */
export const mediaTransformSchema = z
  .object({
    parentId: z.string().min(1).max(200),
    format: z.enum(['mp4', 'mkv', 'webm', 'mp3', 'm4a', 'wav', 'flac']),
    startSeconds: z.number().min(0).max(864_000).optional(),
    durationSeconds: z.number().positive().max(864_000).optional(),
    height: z.number().int().min(144).max(4320).multipleOf(2).optional(),
    title: z.string().min(1).max(200).optional()
  })
  .strict()
export type MediaTransformInput = z.infer<typeof mediaTransformSchema>

/** Produce deterministic output codecs and optional trim/scale arguments. */
export function buildMediaTransformArgs(
  input: MediaTransformInput,
  source: string,
  output: string
): string[] {
  const args = ['-nostdin', '-hide_banner', '-n', '-protocol_whitelist', 'file,pipe', '-i', source]
  if (input.startSeconds !== undefined) {
    args.push('-ss', String(input.startSeconds))
  }
  if (input.durationSeconds !== undefined) {
    args.push('-t', String(input.durationSeconds))
  }
  if (['mp3', 'm4a', 'wav', 'flac'].includes(input.format)) {
    args.push(
      '-map',
      '0:a:0',
      '-vn',
      '-c:a',
      { mp3: 'libmp3lame', m4a: 'aac', wav: 'pcm_s16le', flac: 'flac' }[input.format] ?? 'aac'
    )
  } else {
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-c:v',
      input.format === 'webm' ? 'libvpx' : 'libx264',
      '-c:a',
      input.format === 'webm' ? 'libopus' : 'aac'
    )
    if (input.height) {
      args.push('-vf', `scale=-2:${input.height}`)
    }
    args.push('-pix_fmt', 'yuv420p')
  }
  if (input.format === 'mp4' || input.format === 'm4a') {
    args.push('-movflags', '+faststart')
  }
  return [...args, '-progress', 'pipe:1', '-nostats', output]
}
