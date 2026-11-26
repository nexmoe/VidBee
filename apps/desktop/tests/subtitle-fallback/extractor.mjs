import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// #516 CLI protocol fixture: real streams, filesystem, signals and child exits.
const executable = fileURLToPath(import.meta.url)
const root = dirname(executable)
const { scenario = 'subtitle429' } = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
const args = process.argv.slice(2)
const subtitles =
  args.includes('--write-subs') ||
  args.includes('--write-auto-subs') ||
  args.includes('--embed-subs')
appendFileSync(join(root, 'argv.jsonl'), `${JSON.stringify({ args, pid: process.pid })}\n`)
const subtitleError =
  "ERROR: Unable to download video subtitles for 'fr': HTTP Error 429: Too Many Requests\n"

if (scenario === 'media403') {
  process.stderr.write('ERROR: unable to download video data: HTTP Error 403: Forbidden\n')
  process.exitCode = 1
} else if (
  (subtitles && scenario !== 'success-subs' && scenario !== 'unavailable') ||
  scenario === 'fail-twice'
) {
  if (scenario === 'stale-output') {
    const old = join(root, 'old.mp4')
    writeFileSync(old, 'old-output')
    process.stdout.write(`__VIDBEE_OUTPUT_PATH__:${old}\n`)
  }
  if (scenario === 'retry-launch-failure') {
    unlinkSync(executable)
  }
  process.stderr.write(subtitleError)
  if (scenario === 'hold-initial') {
    process.stdout.write('FIXTURE_READY:initial\n')
    await new Promise((resolve) => process.once('SIGTERM', resolve))
  }
  process.exitCode = 1
} else if (scenario === 'hold-retry') {
  process.stdout.write('FIXTURE_READY:retry\n')
  await new Promise((resolve) => process.once('SIGTERM', resolve))
} else if (scenario !== 'stale-output') {
  if (scenario === 'success-subs') {
    process.stdout.write('[info] owned: Downloading subtitles: fr, en\n')
  }
  if (scenario === 'unavailable') {
    process.stdout.write('[info] There are no subtitles for the requested languages\n')
  }
  const media = join(root, 'media.mp4')
  writeFileSync(media, 'owned-media-fixture')
  process.stdout.write('[info] owned: Downloading 1 format(s): 137+140\n')
  process.stdout.write(`__VIDBEE_OUTPUT_PATH__:${media}\n`)
  // Exercise streaming path capture after the persisted log tail has rolled over.
  if (scenario === 'long-output') {
    process.stdout.write(`${'diagnostic output\n'.repeat(2000)}`)
  }
}
