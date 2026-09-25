import path from 'node:path'
import { ffmpegManager } from './ffmpeg-manager'
import { runKernelCommand } from './ytdlp-kernel-command'

export interface LocalMediaProbe {
  format?: { duration?: string; size?: string; format_name?: string }
  streams: Array<{
    index?: number
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    sample_rate?: string
    channels?: number
    duration?: string
  }>
}

/** Probe local stream facts without exposing filenames, tags, headers or remote protocols. */
export async function probeLocalMedia(
  file: string,
  signal?: AbortSignal
): Promise<LocalMediaProbe> {
  const ffmpeg = await ffmpegManager.ensureInitialized()
  const executable = path.join(
    path.dirname(ffmpeg),
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  )
  const result = await runKernelCommand(
    executable,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file,pipe',
      '-show_entries',
      'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,sample_rate,channels,duration',
      '-of',
      'json',
      file
    ],
    { signal, timeoutMs: 30_000 }
  )
  return JSON.parse(result.stdout) as LocalMediaProbe
}
