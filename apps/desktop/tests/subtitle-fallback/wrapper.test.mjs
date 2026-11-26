import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import Wrapped from 'yt-dlp-wrap-plus'
import { fixture, input, jiti, start } from './helpers.mjs'

// Surface: downloader CLI/wrapper contract, protecting #516 without network or GUI.
const { resolveYtDlpWrapCtor } = await jiti.import(
  '../../../../packages/downloader-core/src/yt-dlp-wrap.ts'
)
const Wrapper = resolveYtDlpWrapCtor(Wrapped)

async function observe(wrapper, args, cleanup) {
  const target = wrapper.exec(args)
  const closed = new Promise((resolve) => target.ytDlpProcess.once('close', resolve))
  cleanup.push(async () => {
    if (target.ytDlpProcess.exitCode === null && target.ytDlpProcess.signalCode === null) {
      target.ytDlpProcess.kill('SIGKILL')
    }
    await closed
  })
  const signals = []
  target.on('error', (error) => signals.push({ type: 'error', message: error.message }))
  target.on('close', (code) => signals.push({ type: 'close', code }))
  await closed
  return { signals, exitCode: target.ytDlpProcess.exitCode }
}

test('user receives the locked wrapper error contract for a nonzero subtitle exit', {
  timeout: 10_000
}, async (t) => {
  // Given the owned CLI emits the exact reported subtitle stderr and exits 1.
  const { root, executable, cleanup } = await fixture(t)
  const wrapper = new Wrapper(executable)
  // When the actual locked yt-dlp-wrap-plus 2.5.0 adapter observes both CLI outcomes.
  const failure = await observe(wrapper, ['--write-subs', input.url], cleanup)
  const success = await observe(
    wrapper,
    ['--no-write-subs', '--no-write-auto-subs', '--no-embed-subs', input.url],
    cleanup
  )
  // Then failure emits only error while the media-only command emits close and creates media.
  assert.equal(failure.exitCode, 1)
  assert.equal(failure.signals.length, 1)
  assert.equal(failure.signals[0].type, 'error')
  assert.match(failure.signals[0].message, /Error code: 1/)
  assert.match(
    failure.signals[0].message,
    /Unable to download video subtitles for 'fr': HTTP Error 429/
  )
  assert.deepEqual(success.signals, [{ type: 'close', code: 0 }])
  assert.equal(await readFile(join(root, 'media.mp4'), 'utf8'), 'owned-media-fixture')
})

test('user sees an initial launch failure without a subtitle retry', {
  timeout: 10_000
}, async (t) => {
  // Given an absent executable and a task that requests optional subtitles.
  const { root, executor } = await fixture(t, undefined, undefined, {
    resolveYtDlpPath: () => '/nonexistent/vidbee-516/yt-dlp'
  })
  // When the real wrapper receives the operating system launch failure.
  const attempt = start(executor)
  const result = await attempt.finished
  // Then the error is delivered once without any child invocation or fallback log.
  assert.equal(result.result.type, 'error')
  assert.match(result.result.error.rawMessage, /ENOENT/)
  assert.equal(attempt.finishes.length, 1)
  assert.equal(
    attempt.logs.filter((event) => event.line.includes('[VidBee] Subtitle download failed')).length,
    0
  )
  await assert.rejects(readFile(join(root, 'argv.jsonl')), { code: 'ENOENT' })
})

// This adapter uses native ChildProcess events and streams, with no mocked methods.
function spawnRawChild(binary, args, signal) {
  const child = spawn(binary, args, { signal, detached: process.platform !== 'win32' })
  return Object.assign(child, { ytDlpProcess: child })
}

test('user retains one-time recovery through native nonzero close events', {
  timeout: 10_000
}, async (t) => {
  // Given a real child adapter that reports nonzero exits through close.
  const { root, executor } = await fixture(t, undefined, undefined, { spawnFn: spawnRawChild })
  // When the first child exits with a subtitle 429 and its replacement writes media.
  const attempt = start(executor)
  const result = await attempt.finished
  // Then the same recovery works through close and completes the original attempt once.
  assert.equal(result.result.type, 'success')
  assert.equal(result.result.output.subtitleStatus, 'failed')
  assert.equal(await readFile(result.result.output.filePath, 'utf8'), 'owned-media-fixture')
  assert.equal(attempt.spawns.length, 1)
  assert.equal(attempt.finishes.length, 1)
  assert.equal((await readFile(join(root, 'argv.jsonl'), 'utf8')).trim().split('\n').length, 2)
})

test('user gets one completion when a failed native launch also emits close', {
  timeout: 10_000
}, async (t) => {
  // Given a real operating system launch failure emits error followed by close.
  let closed
  const { executor } = await fixture(t, undefined, undefined, {
    resolveYtDlpPath: () => '/nonexistent/vidbee-516/yt-dlp',
    spawnFn: (binary, args, signal) => {
      const child = spawnRawChild(binary, args, signal)
      closed = new Promise((resolve) => child.once('close', resolve))
      return child
    }
  })
  // When both lifecycle events reach the production executor.
  const attempt = start(executor)
  const result = await attempt.finished
  await closed
  // Then the late close cannot create a second completion or start subtitle recovery.
  assert.equal(result.result.type, 'error')
  assert.match(result.result.error.rawMessage, /ENOENT/)
  assert.equal(attempt.finishes.length, 1)
  assert.equal(
    attempt.logs.filter((event) => event.line.includes('[VidBee] Subtitle download failed')).length,
    0
  )
})
