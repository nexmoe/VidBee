import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateScenarioSource } from './check-tests.mjs'

const files = readdirSync(import.meta.dirname)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
for (const name of files) {
  const source = readFileSync(join(import.meta.dirname, name), 'utf8')
  const failures = validateScenarioSource(name, source)
  if (failures.length) {
    throw new Error(`${name}: ${failures.join('; ')}`)
  }
}

// Do not forward session credentials or preload hooks to owned test processes.
const env = {
  PATH: process.env.PATH,
  TMPDIR: process.env.TMPDIR,
  SystemRoot: process.env.SystemRoot
}
if (process.env.NODE_V8_COVERAGE) {
  env.NODE_V8_COVERAGE = process.env.NODE_V8_COVERAGE
}
const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-branches=70',
    '--test-coverage-include=**/packages/downloader-core/src/yt-dlp-executor.ts',
    ...files.map((name) => join(import.meta.dirname, name))
  ],
  { cwd: new URL('../../../../', import.meta.url), env, stdio: 'inherit' }
)
if (result.error) {
  throw result.error
}
process.exitCode = result.status ?? 1
