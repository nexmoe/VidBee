const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { resolveBinaryResourcesPath } = require('../../apps/desktop/build/after-pack.cjs')

test('afterPack resolves binaries copied by extraResources', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidbee-after-pack-'))
  const appBundle = path.join(tempDir, 'VidBee.app')
  const resourcesPath = path.join(appBundle, 'Contents', 'Resources', 'resources')

  try {
    fs.mkdirSync(resourcesPath, { recursive: true })
    fs.writeFileSync(path.join(resourcesPath, 'yt-dlp_macos'), '')

    assert.equal(resolveBinaryResourcesPath(appBundle), resourcesPath)
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true })
  }
})
