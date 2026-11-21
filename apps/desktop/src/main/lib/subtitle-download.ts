import { open, rm } from 'node:fs/promises'
import { resolveSubtitleLanguages } from '@vidbee/downloader-core/subtitle-languages'
import { z } from 'zod'
import { buildSrtDocument, buildVttDocument } from '../../shared/subtitle-export'
import { settingsManager } from '../settings'
import { libraryExportPath } from './library-export'
import { extractRemoteCaptions } from './remote-captions'

export const subtitleDownloadSchema = z.object({
  language: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i)
    .refine((value) => value.toLowerCase() !== 'all', 'Provide one subtitle language tag')
    .optional(),
  format: z.enum(['srt', 'vtt']).default('srt')
})

type SubtitleDownloadOptions = z.output<typeof subtitleDownloadSchema> & {
  languages?: string[]
  title?: string
  customDownloadPath?: string
  onProcess?: (child: { kill: () => void; pid?: number }) => void
}

/** Fetch one website caption track and save an owned file without downloading media or running ASR. */
export async function downloadSubtitles(
  url: string,
  options: SubtitleDownloadOptions,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const { language, format } = options
  const languages = language
    ? [language]
    : (options.languages ??
      resolveSubtitleLanguages(
        settingsManager.get('subtitleLanguages'),
        settingsManager.get('language')
      ))
  const snapshot = await extractRemoteCaptions(url, {
    language,
    languages,
    signal,
    ...(options.onProcess ? { onProcess: options.onProcess } : {})
  })
  signal.throwIfAborted()
  if (snapshot.status !== 'completed') {
    throw Object.assign(new Error(`${snapshot.errorCode}: ${snapshot.error}`), {
      code: snapshot.errorCode
    })
  }
  const cues = snapshot.segments.map((segment) => ({
    startMs: Math.round(segment.start * 1000),
    endMs: Math.round(segment.end * 1000),
    text: segment.text
  }))
  const content = format === 'srt' ? buildSrtDocument(cues) : buildVttDocument(cues)
  const title = options.title || snapshot.title || 'subtitles'
  const file = await libraryExportPath(title, format, options.customDownloadPath)
  signal.throwIfAborted()
  const handle = await open(file, 'wx')
  try {
    try {
      await handle.writeFile(content, { encoding: 'utf8', signal })
    } finally {
      await handle.close()
    }
    signal.throwIfAborted()
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
  return {
    path: file,
    bytes: Buffer.byteLength(content),
    format,
    title,
    language: snapshot.tracks.find((track) => track.id === snapshot.selectedTrackId)?.language,
    tracks: snapshot.tracks,
    segmentCount: cues.length,
    snapshot
  }
}
