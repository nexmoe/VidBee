import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '@vidbee/logger/script'

/**
 * Writes a release tag's version into package.json for runtime and artifact names.
 *
 * Usage: node scripts/stamp-release.mjs v1.2.3
 */

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!version) {
  throw new Error('stamp-release: missing tag argument (e.g. v1.2.3)')
}

const pkgPath = path.join(desktopDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.version = version
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

log.log(`stamp-release: version=${version}`)
