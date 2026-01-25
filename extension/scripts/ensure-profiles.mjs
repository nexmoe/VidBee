import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const profiles = [
  '.context/wxt-profiles/chromium',
  '.context/wxt-profiles/firefox'
]

for (const profile of profiles) {
  mkdirSync(resolve(rootDir, profile), { recursive: true })
}
