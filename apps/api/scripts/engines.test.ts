import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const root = mkdtempSync(path.join(os.tmpdir(), 'vidbee-engines-test-'))
const managed = path.join(root, 'data', 'bin', 'yt-dlp')
const configured = path.join(root, 'yt-dlp-configured')
const system = path.join(root, 'yt-dlp')
const ffmpeg = path.join(root, 'ffmpeg')
const badExecutable = '#!/vidbee-test-missing-interpreter\n'
const previousEnv = { ...process.env }
const originalFetch = globalThis.fetch
const requests: string[] = []
let download: string | ReadableStream<Uint8Array> = badExecutable

process.env.VIDBEE_DATA_DIR = path.join(root, 'data')
process.env.VIDBEE_DOWNLOAD_DIR = path.join(root, 'downloads')
process.env.VIDBEE_PERSIST_QUEUE = '0'
process.env.YTDLP_PATH = configured
process.env.FFMPEG_PATH = ffmpeg
process.env.PATH = `${root}${path.delimiter}${process.env.PATH}`
process.env.VIDBEE_DOWNLOAD_MIRROR = 'global'

globalThis.fetch = (input) => {
  const url = String(input)
  requests.push(url)
  if (url.endsWith('/releases/latest')) {
    return Promise.resolve(Response.json({ tag_name: '2026.10.26' }))
  }
  if (url.includes('/releases/latest/download/')) {
    return Promise.resolve(new Response(download))
  }
  throw new Error(`Unexpected network request: ${url}`)
}

const engines = await import('../src/lib/engines')
const { fetchPlaylistInfo, fetchVideoInfo } = await import('../src/lib/yt-dlp-info')

const executable = (version: string, title = 'configured'): string => `#!/bin/sh
case "$*" in
  *--version*) printf '%s\\n' '${version}' ;;
  *--flat-playlist*) printf '%s\\n' '{"id":"playlist","title":"${title}","entries":[{"id":"video","title":"${title}","url":"https://example.test/video"}]}' ;;
  *-j*) printf '%s\\n' '{"id":"video","title":"${title}","formats":[]}' ;;
  *) printf 'fixture media' > '${root}/${title}.mp4'; printf '__VIDBEE_OUTPUT_PATH__:%s\\n' '${root}/${title}.mp4' ;;
esac
`

beforeEach(async () => {
  rmSync(path.dirname(managed), { recursive: true, force: true })
  await mkdir(path.dirname(managed), { recursive: true })
  writeFileSync(configured, executable('2026.10.26'), { mode: 0o755 })
  writeFileSync(system, executable('2026.10.25', 'system'), { mode: 0o755 })
  writeFileSync(ffmpeg, '#!/bin/sh\nprintf "ffmpeg version fixture\\n"\n', { mode: 0o755 })
  process.env.YTDLP_PATH = configured
  download = badExecutable
  requests.length = 0
})

after(() => {
  engines.stopEngines()
  globalThis.fetch = originalFetch
  process.env = previousEnv
  rmSync(root, { recursive: true, force: true })
})

test('selects official Linux assets by libc and architecture', () => {
  for (const [arch, musl, expected] of [
    ['x64', true, 'yt-dlp_musllinux'],
    ['arm64', true, 'yt-dlp_musllinux_aarch64'],
    ['x64', false, 'yt-dlp_linux'],
    ['arm64', false, 'yt-dlp_linux_aarch64']
  ] as const) {
    assert.equal(engines.getYtDlpReleaseAssetName('linux', arch, musl), expected)
  }
  assert.equal(engines.getYtDlpReleaseAssetName('darwin'), 'yt-dlp_macos')
  assert.equal(engines.getYtDlpReleaseAssetName('win32'), 'yt-dlp.exe')
  assert.throws(() => engines.getYtDlpReleaseAssetName('linux', 'riscv64', false))
})

test('a persisted ENOENT executable falls back to the configured engine', async () => {
  writeFileSync(managed, badExecutable, { mode: 0o755 })
  const status = await engines.checkEngineUpdates()
  assert.equal(status.state, 'up-to-date')
  assert.equal(status.ytDlpPath, configured)
  assert.equal(status.ytDlpVersion, '2026.10.26')
  assert.equal(engines.resolveYtDlpPath(), configured)
})

test('invalid managed and configured engines fall back to PATH', async () => {
  writeFileSync(managed, badExecutable, { mode: 0o755 })
  writeFileSync(configured, badExecutable, { mode: 0o755 })
  const status = await engines.checkEngineUpdates()
  assert.equal(status.ytDlpPath, system)
  assert.equal(status.ytDlpVersion, '2026.10.25')
})

test('a failed staged update preserves the working managed engine and removes staging', async () => {
  const original = executable('2026.10.25', 'managed')
  writeFileSync(managed, original, { mode: 0o755 })
  await engines.checkEngineUpdates()
  const status = await engines.updateYtDlp()
  assert.ok(status.error)
  assert.equal(status.state, 'update-available')
  assert.equal(status.ytDlpPath, managed)
  assert.equal(status.ytDlpVersion, '2026.10.25')
  assert.equal(readFileSync(managed, 'utf8'), original)
  assert.equal(existsSync(`${managed}.part`), false)
})

test('a failed first update keeps the configured engine usable', async () => {
  const status = await engines.updateYtDlp()
  assert.ok(status.error)
  assert.equal(status.ytDlpPath, configured)
  assert.equal(existsSync(managed), false)
  assert.equal(existsSync(`${managed}.part`), false)
})

test('a truncated download preserves the working managed engine and removes staging', async () => {
  const original = executable('2026.10.25', 'managed')
  writeFileSync(managed, original, { mode: 0o755 })
  download = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('#!/bin/sh\n'))
      controller.error(new Error('Fixture interrupted download'))
    }
  })
  const status = await engines.updateYtDlp()
  assert.ok(status.error?.includes('Fixture interrupted download'))
  assert.equal(readFileSync(managed, 'utf8'), original)
  assert.equal(existsSync(`${managed}.part`), false)
})

test('rejects a successful process that does not report a yt-dlp version', async () => {
  download = '#!/bin/sh\nprintf "not-a-version\\n"\n'
  const status = await engines.updateYtDlp()
  assert.ok(status.error)
  assert.equal(status.ytDlpPath, configured)
  assert.equal(existsSync(managed), false)
})

test('a validated update becomes the shared status and metadata engine', async () => {
  download = executable('2026.10.27', 'updated')
  const status = await engines.updateYtDlp()
  assert.equal(status.error, null)
  assert.equal(status.state, 'up-to-date')
  assert.equal(status.ytDlpVersion, '2026.10.27')
  assert.equal(status.ytDlpPath, managed)
  assert.equal(engines.resolveYtDlpPath(), managed)
  assert.equal((await fetchVideoInfo('https://example.test/video')).title, 'updated')
  assert.equal((await fetchPlaylistInfo('https://example.test/playlist')).title, 'updated')
  assert.ok(requests.some((url) => url.endsWith(engines.getYtDlpReleaseAssetName())))
})

test('revalidates a cached executable after an incompatible replacement', async () => {
  writeFileSync(managed, executable('2026.10.27'), { mode: 0o755 })
  assert.equal(engines.resolveYtDlpPath(), managed)
  writeFileSync(managed, badExecutable, { mode: 0o755 })
  assert.equal(engines.resolveYtDlpPath(), configured)
  assert.equal((await fetchVideoInfo('https://example.test/video')).title, 'configured')
})

test('fresh API processes recover to configured and PATH engines from a persisted bad copy', async () => {
  writeFileSync(managed, badExecutable, { mode: 0o755 })
  for (const [fallback, version] of [
    [configured, '2026.10.26'],
    [system, '2026.10.25']
  ]) {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `globalThis.fetch = async () => Response.json({ tag_name: '${version}' });
const engines = await import(${JSON.stringify(new URL('../src/lib/engines.ts', import.meta.url).href)});
await engines.startEngines();
engines.stopEngines();
process.stdout.write(JSON.stringify(await engines.getEngineStatus()));`
      ],
      {
        timeout: 30_000,
        env: { ...process.env, YTDLP_PATH: fallback === configured ? configured : managed }
      }
    )
    const status = JSON.parse(stdout)
    assert.equal(status.state, 'up-to-date')
    assert.equal(status.ytDlpPath, fallback)
    assert.equal(status.ytDlpVersion, version)
  }
})

test('queued downloads use the healthy fallback after update failure and then the validated update', async () => {
  const { taskQueue } = await import('../src/lib/task-queue-host')
  const { getDatabaseConnection } = await import('../src/lib/database')
  await taskQueue.start()
  try {
    writeFileSync(managed, badExecutable, { mode: 0o755 })
    const failed = await engines.updateYtDlp()
    assert.ok(failed.error)
    assert.equal(failed.ytDlpPath, configured)
    for (const title of ['configured', 'updated']) {
      if (title === 'updated') {
        download = executable('2026.10.27', title)
        assert.equal((await engines.updateYtDlp()).error, null)
      }
      const { id } = await taskQueue.add({
        input: { kind: 'video', url: `https://example.test/${title}` },
        maxAttempts: 1
      })
      const deadline = Date.now() + 5000
      while (
        !taskQueue.list().tasks.some((task) => task.id === id && task.status === 'completed') &&
        Date.now() < deadline
      ) {
        await delay(20)
      }
      const task = taskQueue.list().tasks.find((entry) => entry.id === id)
      assert.ok(task)
      assert.equal(task.status, 'completed', JSON.stringify(task.lastError))
      assert.equal(task.output?.filePath, path.join(root, `${title}.mp4`))
      assert.ok((task.output?.size ?? 0) > 0)
    }
  } finally {
    await taskQueue.stop()
    getDatabaseConnection().sqlite.close()
  }
})
