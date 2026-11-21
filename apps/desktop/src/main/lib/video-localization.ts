import { link, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { captionLanguageKey } from '@vidbee/transcription'
import {
  alignSubtitleCues,
  buildAssDocument,
  buildSrtDocument,
  buildVttDocument,
  type SubtitleCue
} from '../../shared/subtitle-export'
import { subtitleExportInputSchema } from '../../shared/video-localization'
import { agentSourceOffset } from './agent-media'
import type { IndexedSubtitleCue } from './dubbing-text'
import { exportVideoWithSubtitles } from './export-video-subtitles'
import { libraryExportPath } from './library-export'
import { getDesktopTaskQueueRef } from './queue-ref'
import {
  getTranscriptStore,
  readTranscriptDetail,
  readTranscriptSourceCues
} from './transcript-host'

/** Resolve a concrete stored source, keeping exports independent of the user's current selection. */
export function localizationSource(downloadId: string, sourceKey: string) {
  const snapshot = readTranscriptDetail(downloadId)
  const source = snapshot.sources.find((item) => item.key === sourceKey)
  if (!source) {
    throw new Error('Subtitle source is unavailable; inspect list_transcripts first')
  }
  const record = getTranscriptStore()
    .listForDownload(downloadId)
    .find(
      (item) =>
        item.resultKind === 'transcript' &&
        item.sourceKind === source.kind &&
        (source.kind === 'asr' ||
          captionLanguageKey(item.language) === captionLanguageKey(source.language))
    )
  const task = getDesktopTaskQueueRef().get(downloadId)
  const offset = agentSourceOffset(task?.input.options?.startTime) * 1000
  const duration = task?.output?.durationMs ?? Number.POSITIVE_INFINITY
  /** Convert original source captions to the actual downloaded clip's local clock. */
  const mediaCues = (cues: readonly SubtitleCue[], captions: boolean): IndexedSubtitleCue[] =>
    cues
      .map((cue, index) => ({
        ...cue,
        cueIndex: index + 1,
        startMs: Math.max(0, cue.startMs - (captions ? offset : 0)),
        endMs: Math.min(duration, cue.endMs - (captions ? offset : 0))
      }))
      .filter((cue) => cue.endMs > cue.startMs)
  const cues = mediaCues(
    record?.segments ?? readTranscriptSourceCues(downloadId, sourceKey),
    source.kind === 'captions'
  )
  if (!cues.length) {
    throw new Error('Subtitle source has no usable cues')
  }
  return {
    snapshot,
    source,
    cues,
    originalCues: mediaCues(
      snapshot.record?.segments ?? [],
      snapshot.record?.sourceKind === 'captions'
    )
  }
}

/** Combine source and translated text by strongest overlap while retaining the export track's clock. */
function bilingualCues(primary: SubtitleCue[], secondary: SubtitleCue[]): SubtitleCue[] {
  const aligned = alignSubtitleCues(primary, secondary)
  return primary.map((cue, index) => ({
    ...cue,
    text: [...new Set([cue.text, aligned[index]])].filter(Boolean).join('\n')
  }))
}

/** Save subtitles or a subtitled video through the same encoders used by Desktop and MCP. */
export async function exportLocalizedSubtitles(
  downloadId: string,
  raw: unknown,
  signal: AbortSignal
) {
  signal.throwIfAborted()
  const input = subtitleExportInputSchema.parse(raw)
  const { snapshot, cues, originalCues: original } = localizationSource(downloadId, input.sourceKey)
  const units = input.bilingual && original.length ? bilingualCues(original, cues) : cues
  const outputPath = await libraryExportPath(snapshot.title ?? 'subtitles', input.format)
  if (input.format === 'srt' || input.format === 'vtt') {
    await writeFile(
      outputPath,
      input.format === 'srt' ? buildSrtDocument(units) : buildVttDocument(units),
      { flag: 'wx' }
    )
  } else {
    if (!snapshot.sourceFilePath) {
      throw new Error('A local video is required for subtitle muxing or burning')
    }
    const result = await exportVideoWithSubtitles(
      {
        defaultFileName: path.basename(outputPath),
        mode: input.format === 'mkv' ? 'soft' : 'hard',
        sourcePath: snapshot.sourceFilePath,
        subtitleText: input.format === 'mkv' ? buildSrtDocument(units) : buildAssDocument(units)
      },
      { outputPath, signal }
    )
    if (result.status !== 'saved') {
      throw new Error(
        result.status === 'failed' ? result.message : 'Video subtitle export did not complete'
      )
    }
  }
  return { path: outputPath, sourceKey: input.sourceKey, cues: cues.length, format: input.format }
}

/** Publish a fully rendered media file without overwriting any previous output. */
export async function publishLocalizedMedia(temporary: string, title: string, extension: string) {
  const file = await libraryExportPath(title, extension)
  const info = await stat(temporary)
  if (!info.size) {
    throw new Error('Generated media is empty')
  }
  await link(temporary, file)
  return { path: file, bytes: info.size }
}

/** Keep every intermediate file in a disposable directory on the export filesystem. */
export async function withLocalizationDirectory<T>(
  title: string,
  run: (directory: string) => Promise<T>
): Promise<T> {
  const target = await libraryExportPath(title, 'tmp')
  const directory = await mkdtemp(path.join(path.dirname(target), '.localization-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
