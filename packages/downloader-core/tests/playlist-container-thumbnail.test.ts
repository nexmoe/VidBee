import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolvePlaylistContainerFormat } from '../src/format-preferences'
import { buildDownloadArgs, isUnsupportedThumbnailEmbedOnlyFailure } from '../src/yt-dlp-args'

const SOURCE_URL = 'https://example.com/playlist?list=playlist-container'
const DOWNLOAD_DIR = '/tmp/vidbee-downloads'

const flagValue = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

const videoArgs = (
  container: 'auto' | 'mp4' | 'mkv' | 'webm' | 'original' | undefined,
  embedThumbnail: boolean
): string[] =>
  buildDownloadArgs(
    {
      url: SOURCE_URL,
      type: 'video',
      format: 'best',
      containerFormat: container
    },
    DOWNLOAD_DIR,
    {
      downloadSubtitles: false,
      embedThumbnail,
      embedMetadata: false,
      embedChapters: false
    }
  )

test('desktop and web playlist dialogs share the container selection rule', () => {
  const root = join(import.meta.dirname, '../../..')
  const desktop = readFileSync(
    join(root, 'apps/desktop/src/renderer/src/components/download/DownloadDialog.tsx'),
    'utf8'
  )
  const web = readFileSync(
    join(root, 'apps/web/src/components/download/download-dialog.tsx'),
    'utf8'
  )
  assert.match(desktop, /resolvePlaylistContainerFormat\(/)
  assert.match(web, /resolvePlaylistContainerFormat\(/)
  assert.match(desktop, /WebmThumbnailNotice/)
  assert.match(web, /WebmThumbnailNotice/)
})

test('playlist container selection is passed through for each video entry', () => {
  assert.equal(resolvePlaylistContainerFormat('video', 'webm', 'mp4'), 'webm')
  assert.equal(resolvePlaylistContainerFormat('video', undefined, 'mkv'), 'mkv')
  assert.equal(resolvePlaylistContainerFormat('audio', 'webm', 'mp4'), undefined)

  for (const container of ['mp4', 'mkv', 'webm'] as const) {
    const selected = resolvePlaylistContainerFormat('video', container, 'auto')
    const args = videoArgs(selected, true)
    assert.equal(flagValue(args, '--merge-output-format'), container)
    assert.equal(flagValue(args, '--remux-video'), container)
  }

  const original = resolvePlaylistContainerFormat('video', 'original', 'mp4')
  const originalArgs = videoArgs(original, true)
  assert.equal(originalArgs.includes('--merge-output-format'), false)
  assert.equal(originalArgs.includes('--remux-video'), false)
  assert.equal(originalArgs.includes('--embed-thumbnail'), true)
})

test('explicit WebM with thumbnail embedding writes a separate thumbnail', () => {
  const args = videoArgs('webm', true)
  assert.equal(flagValue(args, '--merge-output-format'), 'webm')
  assert.equal(flagValue(args, '--remux-video'), 'webm')
  assert.equal(args.includes('--embed-thumbnail'), false)
  assert.equal(args.includes('--no-embed-thumbnail'), true)
  assert.equal(args.includes('--write-thumbnail'), true)
})

test('WebM without cover art does not write or embed a thumbnail', () => {
  const args = videoArgs('webm', false)
  assert.equal(flagValue(args, '--remux-video'), 'webm')
  assert.equal(args.includes('--embed-thumbnail'), false)
  assert.equal(args.includes('--no-embed-thumbnail'), true)
  assert.equal(args.includes('--write-thumbnail'), false)
})

test('MP4, MKV, and Auto still embed the thumbnail', () => {
  for (const container of ['mp4', 'mkv'] as const) {
    const args = videoArgs(container, true)
    assert.equal(args.includes('--embed-thumbnail'), true)
    assert.equal(args.includes('--write-thumbnail'), false)
    assert.equal(args.includes('--no-embed-thumbnail'), false)
  }

  const auto = videoArgs('auto', true)
  assert.equal(flagValue(auto, '--merge-output-format'), 'mp4/mkv')
  assert.equal(auto.includes('--remux-video'), false)
  assert.equal(auto.includes('--embed-thumbnail'), true)
  assert.equal(auto.includes('--write-thumbnail'), false)
})

test('audio downloads keep thumbnail embedding when a video container is unused', () => {
  const container = resolvePlaylistContainerFormat('audio', 'webm', 'mp4')
  const args = buildDownloadArgs(
    {
      url: SOURCE_URL,
      type: 'audio',
      format: 'bestaudio',
      containerFormat: container
    },
    DOWNLOAD_DIR,
    { downloadSubtitles: false, embedThumbnail: true }
  )
  assert.equal(args.includes('--embed-thumbnail'), true)
  assert.equal(args.includes('--remux-video'), false)
  assert.equal(args.includes('--write-thumbnail'), false)
})

test('only an unsupported thumbnail embed error is ignored', () => {
  const sole =
    'ERROR: Postprocessing: Supported filetypes for thumbnail embedding are: mp4, mkv, mka, ogg, opus, flac, m4a'
  assert.equal(isUnsupportedThumbnailEmbedOnlyFailure(sole), true)
  assert.equal(
    isUnsupportedThumbnailEmbedOnlyFailure(
      `${sole}\nERROR: Unable to download video data: HTTP Error 403`
    ),
    false
  )
  assert.equal(isUnsupportedThumbnailEmbedOnlyFailure('ERROR: ffmpeg not found'), false)
})
