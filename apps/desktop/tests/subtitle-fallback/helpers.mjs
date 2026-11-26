import { randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJiti } from 'jiti'

export const jiti = createJiti(import.meta.url, { fsCache: false })
export const { YtDlpExecutor } = await jiti.import(
  '../../../../packages/downloader-core/src/yt-dlp-executor.ts'
)
export const input = { kind: 'video', url: 'https://example.invalid/video' }
export const subtitleSettings = { downloadSubtitles: true, embedSubs: false, writeAutoSubs: false }

// Integration surface: #516 depends on real wrapper events and process lifecycle,
// which cannot be controlled deterministically through a live YouTube/UI request.
const ownedExecutors = new WeakMap()

export async function fixture(
  t,
  settings = subtitleSettings,
  scenario = 'subtitle429',
  overrides = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'vidbee-516-'))
  const runs = []
  const cleanup = []
  t.after(async () => {
    for (const dispose of cleanup) {
      await dispose()
    }
    for (const attempt of runs) {
      await attempt.run.cancel(0)
    }
    await Promise.all(runs.map((attempt) => attempt.finished))
    await rm(root, { recursive: true, force: true })
  })
  const executable = join(root, 'extractor.mjs')
  const source = await readFile(new URL('./extractor.mjs', import.meta.url), 'utf8')
  await writeFile(executable, `#!${process.execPath}\n${source}`)
  await writeFile(join(root, 'config.json'), JSON.stringify({ scenario }))
  await chmod(executable, 0o755)
  const executor = new YtDlpExecutor({
    resolveYtDlpPath: () => executable,
    resolveFfmpegLocation: () => root,
    defaultDownloadDir: root,
    defaultRuntimeSettings: settings,
    killGraceMs: 100,
    ...overrides
  })
  ownedExecutors.set(executor, runs)
  return { root, executable, executor, cleanup }
}

export function start(executor, taskInput = input, onStd = () => {}) {
  const spawns = []
  const finishes = []
  const logs = []
  const ctx = { taskId: randomUUID(), attemptId: randomUUID(), input: taskInput }
  let resolve
  const finished = new Promise((done) => {
    resolve = done
  })
  const run = executor.run(ctx, {
    onSpawn(event) {
      spawns.push(event)
    },
    onStd(event) {
      logs.push(event)
      onStd(event)
    },
    onProgress() {},
    onFinish(event) {
      finishes.push(event)
      resolve(event)
    }
  })
  const attempt = { finished, run, spawns, finishes, logs, ctx }
  ownedExecutors.get(executor)?.push(attempt)
  return attempt
}

export async function records(root) {
  return (await readFile(join(root, 'argv.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
}
