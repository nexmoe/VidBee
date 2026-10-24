import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveDownloadSubtitleLanguages } from '@vidbee/downloader-core/yt-dlp-args'
import { lowerChildPriority } from '@vidbee/task-queue/process'
import type {
  ExtensionTranscriptSnapshot,
  ExtensionTranscriptTrack
} from '../../shared/extension-transcript'
import {
  captionCuesFromPayload,
  classifyCaptionExtractError,
  parseCaptionSidecarName,
  pickExtensionCaptionTrack
} from '../../shared/extension-transcript'
import { settingsManager } from '../settings'
import { createBoundedTextBuffer } from './bounded-output-buffer'
import { buildCaptionExtractArgs } from './command-utils'
import { applyExtensionCookieSettings } from './extension-cookies'
import { ytdlpManager } from './ytdlp-manager'

const EXTRACT_TIMEOUT_MS = 90_000
const MAX_RUNNING = 2
let running = 0

interface CaptionExtractOptions {
  language?: string
  languages?: readonly string[]
  onProcess?: (child: { kill: () => void; pid?: number }) => void
  signal?: AbortSignal
}

/** Empty running snapshot used until yt-dlp finishes. */
export function emptyCaptionSnapshot(
  status: ExtensionTranscriptSnapshot['status'] = 'running'
): ExtensionTranscriptSnapshot {
  return {
    author: '',
    duration: 0,
    error: null,
    errorCode: null,
    segments: [],
    selectedTrackId: '',
    status,
    title: '',
    tracks: [],
    updatedAt: Date.now()
  }
}

/** Overlay live extension cookies onto Desktop's yt-dlp settings for this URL. */
async function settingsForUrl(url: string) {
  const settings = settingsManager.getAll()
  const overlay = await applyExtensionCookieSettings(url, {
    browserForCookies: settings.browserForCookies,
    cookiesPath: settings.cookiesPath
  })
  return overlay ? { ...settings, ...overlay } : settings
}

/** Run yt-dlp until it exits, times out, or is killed. */
function execCaptionExtract(
  args: string[],
  { onProcess, signal }: CaptionExtractOptions
): Promise<{ code: number | null; stderr: string }> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const proc = ytdlpManager.getInstance().exec(args)
    lowerChildPriority(proc.ytDlpProcess?.pid)
    const stderr = createBoundedTextBuffer()
    proc.ytDlpProcess?.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk))
    let timedOut = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const child = {
      pid: proc.ytDlpProcess?.pid,
      /** Stop the owned child and bound shutdown before removing its temporary files. */
      kill: () => {
        proc.ytDlpProcess?.kill('SIGTERM')
        killTimer ??= setTimeout(() => proc.ytDlpProcess?.kill('SIGKILL'), 2000)
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, EXTRACT_TIMEOUT_MS)
    /** Detach cancellation and timers only after the child process has exited. */
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', child.kill)
    }
    proc.on('error', (error) => {
      cleanup()
      reject(error)
    })
    proc.on('close', (code) => {
      cleanup()
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      if (timedOut) {
        reject(new Error('Caption extract timed out'))
        return
      }
      resolve({ code, stderr: stderr.get() })
    })
    signal?.addEventListener('abort', child.kill, { once: true })
    onProcess?.(child)
    if (signal?.aborted) {
      child.kill()
    }
  })
}

/** Read title, uploader, and duration from the yt-dlp info JSON sidecar. */
async function readInfoJson(
  directory: string
): Promise<{ author: string; duration: number; title: string }> {
  const names = await readdir(directory)
  const name = names.find((item) => item.endsWith('.info.json'))
  if (!name) {
    return { author: '', duration: 0, title: '' }
  }
  try {
    const payload = JSON.parse(await readFile(path.join(directory, name), 'utf8')) as {
      duration?: number
      title?: string
      uploader?: string
    }
    return {
      author: typeof payload.uploader === 'string' ? payload.uploader : '',
      duration: Number(payload.duration) || 0,
      title: typeof payload.title === 'string' ? payload.title : ''
    }
  } catch {
    return { author: '', duration: 0, title: '' }
  }
}

/** Load caption sidecars written next to the info JSON. */
async function readSidecarTracks(
  directory: string
): Promise<
  Array<
    ExtensionTranscriptTrack & { cues: Array<{ endMs: number; startMs: number; text: string }> }
  >
> {
  const names = await readdir(directory)
  const tracks: Array<
    ExtensionTranscriptTrack & { cues: Array<{ endMs: number; startMs: number; text: string }> }
  > = []
  for (const name of names) {
    const parsed = parseCaptionSidecarName(name)
    if (!parsed) {
      continue
    }
    const text = await readFile(path.join(directory, name), 'utf8')
    const cues = captionCuesFromPayload(text, parsed.format).filter(
      (cue) => Number.isFinite(cue.startMs) && cue.endMs > cue.startMs && cue.text.trim()
    )
    if (!cues.length) {
      continue
    }
    tracks.push({
      auto: parsed.auto,
      cues,
      id: parsed.language,
      label: parsed.language,
      language: parsed.language
    })
  }
  return tracks
}

/** Download caption sidecars for one watch URL and return a public snapshot. */
export async function extractRemoteCaptions(
  sourceUrl: string,
  options: CaptionExtractOptions = {}
): Promise<ExtensionTranscriptSnapshot> {
  const { language = '', signal } = options
  signal?.throwIfAborted()
  if (running >= MAX_RUNNING) {
    throw new Error('Too many caption downloads are running. Wait for one to finish.')
  }
  running += 1
  let directory: string | undefined
  try {
    directory = await mkdtemp(path.join(os.tmpdir(), 'vidbee-subs-'))
    const settings = await settingsForUrl(sourceUrl)
    const languages = language ? [language] : (options.languages ?? [])
    const aliases = resolveDownloadSubtitleLanguages(
      languages,
      sourceUrl,
      settings.writeAutoSubs ?? true
    )
    const args = buildCaptionExtractArgs(
      sourceUrl,
      path.join(directory, '%(id)s'),
      settings,
      languages
    )
    const { code, stderr } = await execCaptionExtract(args, options)
    signal?.throwIfAborted()
    if (code !== 0) {
      const errorCode = classifyCaptionExtractError(stderr)
      return {
        ...emptyCaptionSnapshot('error'),
        error: stderr.trim().split('\n').at(-1) || 'Caption extract failed',
        errorCode
      }
    }
    const info = await readInfoJson(directory)
    const tracks = await readSidecarTracks(directory)
    const normalizedAliases = new Set(
      aliases.map((alias) => alias.replaceAll('_', '-').toLowerCase())
    )
    const selected =
      pickExtensionCaptionTrack(tracks, language) ??
      tracks.find((track) =>
        normalizedAliases.has(track.language.replaceAll('_', '-').toLowerCase())
      )
    if (!selected) {
      return {
        ...emptyCaptionSnapshot('error'),
        ...info,
        error: 'No captions available',
        errorCode: 'noCaptions'
      }
    }
    return {
      author: info.author,
      duration: info.duration,
      error: null,
      errorCode: null,
      segments: selected.cues.map((cue) => ({
        end: cue.endMs / 1000,
        start: cue.startMs / 1000,
        text: cue.text
      })),
      selectedTrackId: selected.id,
      status: 'completed',
      title: info.title,
      tracks: tracks.map(({ auto, id, label, language: itemLanguage }) => ({
        auto,
        id,
        label,
        language: itemLanguage
      })),
      updatedAt: Date.now()
    }
  } catch (error) {
    signal?.throwIfAborted()
    const message = error instanceof Error ? error.message : 'Caption extract failed'
    return {
      ...emptyCaptionSnapshot('error'),
      error: message,
      errorCode: classifyCaptionExtractError(message)
    }
  } finally {
    try {
      if (directory) {
        await rm(directory, { force: true, recursive: true })
      }
    } finally {
      running -= 1
    }
  }
}
