import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.resolve(process.argv[2] || path.join(desktopDir, 'dist'))
const manifestPath = path.join(distDir, 'latest-mac.yml')
const fileEntry = /^ {2}- url: (.+)\r?\n {4}sha512: [^\r\n]+\r?\n {4}size: \d+/gm

/** Hash the final published bytes after signing and notarization have finished. */
async function artifactMetadata(name) {
  if (path.basename(name) !== name) {
    throw new Error(`Unexpected update artifact path: ${name}`)
  }
  const file = path.join(distDir, name)
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
  }
  return { sha512: hash.digest('base64'), size: (await stat(file)).size }
}

/** Refresh electron-builder's generated file entries without changing other update fields. */
async function refreshManifest() {
  let manifest = await readFile(manifestPath, 'utf8')
  const entries = [...manifest.matchAll(fileEntry)]
  if (!entries.length) {
    throw new Error('The macOS update manifest contains no artifact entries')
  }
  const metadata = new Map()
  for (const entry of entries) {
    const name = entry[1]
    const details = await artifactMetadata(name)
    metadata.set(name, details)
    manifest = manifest.replace(
      entry[0],
      `  - url: ${name}\n    sha512: ${details.sha512}\n    size: ${details.size}`
    )
  }
  const primary = metadata.get(manifest.match(/^path: (.+)$/m)?.[1])
  if (!(primary && /^sha512: .+$/m.test(manifest))) {
    throw new Error('The macOS update manifest primary artifact is missing')
  }
  manifest = manifest.replace(/^sha512: .+$/m, `sha512: ${primary.sha512}`)
  await writeFile(manifestPath, manifest)
  process.stdout.write(`Refreshed macOS update manifest: ${entries.length} final artifacts\n`)
}

await refreshManifest()
