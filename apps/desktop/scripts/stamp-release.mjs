import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Stamps a release tag into the desktop build inputs for CI.
 *
 * 1. Writes the tag's version into package.json so the built app reports it at runtime and in
 *    artifact names.
 * 2. For prerelease tags, injects the matching `publish.channel` into electron-builder.yml.
 *    The electron-builder GitHub provider does not derive channel file names from the version
 *    (unlike the generic/s3 providers), so without this a `1.2.3-preview.1` build would still
 *    emit `latest*.yml` instead of `preview*.yml`, breaking the preview update channel.
 *
 * Usage: node scripts/stamp-release.mjs v1.2.3-preview.1
 */

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!version) {
  throw new Error('stamp-release: missing tag argument (e.g. v1.2.3 or v1.2.3-preview.1)')
}

const pkgPath = path.join(desktopDir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
pkg.version = version
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

// Derive the channel from the prerelease label: 1.2.3-preview.1 -> preview, 1.2.3 -> latest.
const channel = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest'

if (channel !== 'latest') {
  const ymlPath = path.join(desktopDir, 'electron-builder.yml')
  const yml = fs.readFileSync(ymlPath, 'utf8')
  if (!/^\s+channel:/m.test(yml)) {
    fs.writeFileSync(ymlPath, yml.replace(/^publish:\n/m, `publish:\n  channel: ${channel}\n`))
  }
}

console.log(`stamp-release: version=${version} channel=${channel}`)
