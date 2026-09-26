import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { THUMBNAIL_EMBED_UNSUPPORTED_LOG } from '../src/yt-dlp-args'
import { YtDlpExecutor } from '../src/yt-dlp-executor'

const SOURCE_URL = 'https://example.com/watch?v=webm-cover'

class FakeYtDlpProcess extends EventEmitter {
  ytDlpProcess: {
    pid: number
    stdout: EventEmitter
    stderr: EventEmitter
    kill: () => boolean
  }

  constructor() {
    super()
    this.ytDlpProcess = {
      pid: 42,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => true
    }
  }
}

const runFakeDownload = (
  directory: string,
  stderr: string,
  filePath: string
): { type: string; filePath?: string; size?: number; stderrTail: string } => {
  let fake: FakeYtDlpProcess | undefined
  const executor = new YtDlpExecutor({
    resolveYtDlpPath: () => 'yt-dlp',
    resolveFfmpegLocation: () => '/usr/bin',
    defaultDownloadDir: directory,
    defaultRuntimeSettings: { embedThumbnail: true, downloadSubtitles: false },
    spawnFn: () => {
      fake = new FakeYtDlpProcess()
      return fake
    }
  })
  let outcome: { type: string; filePath?: string; size?: number; stderrTail: string } | undefined
  executor.run(
    {
      taskId: 'task-webm',
      attemptId: 'attempt-webm',
      attemptNumber: 1,
      input: {
        url: SOURCE_URL,
        kind: 'video',
        options: { type: 'video', containerFormat: 'webm' }
      }
    },
    {
      onSpawn: () => undefined,
      onProgress: () => undefined,
      onStd: () => undefined,
      onFinish: (event) => {
        outcome = {
          type: event.result.type,
          filePath: event.result.type === 'success' ? event.result.output.filePath : undefined,
          size: event.result.type === 'success' ? event.result.output.size : undefined,
          stderrTail: event.stderrTail
        }
      }
    }
  )
  if (!fake) {
    throw new Error('yt-dlp process was not spawned')
  }
  fake.ytDlpProcess.stdout.emit('data', Buffer.from(`__VIDBEE_OUTPUT_PATH__:${filePath}\n`))
  fake.ytDlpProcess.stderr.emit('data', Buffer.from(stderr))
  fake.emit('close', 1)
  if (!outcome) {
    throw new Error('download did not finish')
  }
  return outcome
}

test('a saved video is not failed solely because cover embedding is unsupported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vidbee-webm-thumb-'))
  try {
    const filePath = join(directory, 'clip.webm')
    writeFileSync(filePath, 'webm-bytes')
    const outcome = runFakeDownload(
      directory,
      'ERROR: Postprocessing: Supported filetypes for thumbnail embedding are: mp4, mkv, mka\n',
      filePath
    )
    assert.equal(outcome.type, 'success')
    assert.equal(outcome.filePath, filePath)
    assert.ok((outcome.size ?? 0) > 0)
    assert.ok(outcome.stderrTail.includes(THUMBNAIL_EMBED_UNSUPPORTED_LOG))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('thumbnail embedding does not hide a real download error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vidbee-webm-thumb-fail-'))
  try {
    const filePath = join(directory, 'clip.webm')
    writeFileSync(filePath, 'webm-bytes')
    const outcome = runFakeDownload(
      directory,
      'ERROR: Postprocessing: Supported filetypes for thumbnail embedding are: mp4, mkv\nERROR: Unable to download video data: HTTP Error 403\n',
      filePath
    )
    assert.equal(outcome.type, 'error')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('missing media is still a failure when cover embedding is unsupported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vidbee-webm-thumb-missing-'))
  try {
    const outcome = runFakeDownload(
      directory,
      'ERROR: Postprocessing: Supported filetypes for thumbnail embedding are: mp4, mkv\n',
      join(directory, 'missing.webm')
    )
    assert.equal(outcome.type, 'error')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
