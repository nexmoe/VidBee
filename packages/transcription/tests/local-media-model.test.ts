import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { importLocalMediaFiles } from '../../../apps/desktop/src/main/lib/import-local-media'
import { MemoryPersistAdapter, TaskQueueAPI } from '../../task-queue/src'
import { DEFAULT_ASR_TIER } from '../src/asr-tiers'
import type { TranscriptStore } from '../src/transcript-store'

test('local media import queues the selected model and retains the default when omitted', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'vidbee-local-media-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const queue = new TaskQueueAPI({
    persist: new MemoryPersistAdapter(),
    executor: {
      run: () => ({ cancel: async () => {}, pause: async () => {} })
    },
    idleQueueKickMs: 0
  })
  t.after(() => queue.stop())
  const store = { getLatestForDownload: () => null } as unknown as TranscriptStore
  for (const asrTier of ['orukeet', undefined] as const) {
    const path = join(directory, `${asrTier ?? 'default'}.wav`)
    writeFileSync(path, 'nonempty media fixture; no decoder is run')
    const result = await importLocalMediaFiles({
      queue,
      store,
      paths: [path],
      ...(asrTier ? { asrTier } : {})
    })
    assert.deepEqual(result.rejected, [])
    assert.equal(result.imported.length, 1)
    const imported = result.imported[0]
    assert.ok(imported)
    const children = queue.list({ parentId: imported.downloadId }).tasks
    assert.equal(children.length, 1)
    assert.equal(children[0]?.kind, 'transcription')
    assert.equal(children[0]?.input.options?.asrTier, asrTier ?? DEFAULT_ASR_TIER)
    assert.equal(children[0]?.input.options?.sourceFilePath, path)
  }
})
