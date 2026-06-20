import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { checkYtDlpBinary } from '../../apps/desktop/scripts/setup-dev-binaries.js'

test('yt-dlp version checks tolerate a slow first launch', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'vidbee-ytdlp-check-'))
  const fakeBinaryPath = path.join(tempDir, 'yt-dlp')

  try {
    writeFileSync(
      fakeBinaryPath,
      '#!/usr/bin/env node\nsetTimeout(() => console.log("2026.06.09"), 9000)\n'
    )
    await chmod(fakeBinaryPath, 0o755)

    const result = checkYtDlpBinary(fakeBinaryPath)

    assert.equal(result.ok, true)
    assert.equal(result.message, '2026.06.09')
  } finally {
    rmSync(tempDir, { force: true, recursive: true })
  }
})
