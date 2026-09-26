/**
 * Overlap fixture spawned by qwen3-asr-model.test.ts.
 * Two processes share one model cache and pause after their private staging
 * directories contain the extracted encoder.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { QWEN3_ASR_DIR } from '../src/asr-tiers'
import { catalogFor } from '../src/model-catalog'
import { ModelManager } from '../src/model-manager'
import type { DirectoryMemberRequirement, ModelFileSpec } from '../src/types'

const role = process.env.VIDBEE_QWEN_OVERLAP_ROLE
const modelsDir = process.env.VIDBEE_QWEN_OVERLAP_MODELS
const gate = process.env.VIDBEE_QWEN_OVERLAP_GATE
const archiveUrl = process.env.VIDBEE_QWEN_OVERLAP_URL

const vocabBody = '{"version":"qwen3"}\n'
const mergesBody = 'a b\n'
const configBody = '{"model_type":"qwen2"}\n'
const quality = { groups: ['asr'] as const, tiers: ['quality'] as const }

const member = (name: string, body: string, json = false): DirectoryMemberRequirement => ({
  name,
  minBytes: Buffer.byteLength(body),
  sha256: createHash('sha256').update(body).digest('hex'),
  ...(json ? { json: true } : {})
})

const qualityCatalog = (): ModelFileSpec[] =>
  catalogFor(quality).map((spec) =>
    spec.id === 'qwen3-asr-tokenizer'
      ? {
          ...spec,
          directoryMembers: [
            member('vocab.json', vocabBody, true),
            member('merges.txt', mergesBody),
            member('tokenizer_config.json', configBody, true)
          ]
        }
      : spec
  )

const waitForRelease = async (releaseFile: string): Promise<void> => {
  const deadline = Date.now() + 30_000
  while (!existsSync(releaseFile)) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${releaseFile}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

const main = async (): Promise<void> => {
  if (role !== 'leader' && role !== 'follower') {
    return
  }
  if (!(modelsDir && gate && archiveUrl)) {
    throw new Error('overlap child is missing VIDBEE_QWEN_OVERLAP_* environment')
  }
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${String(input)}`)
    if (method === 'HEAD') {
      return new Response(null, { status: 200 })
    }
    throw new Error('download unavailable')
  }
  try {
    const manager = new ModelManager({
      modelsDir,
      catalog: qualityCatalog(),
      fetchImpl,
      preferChina: false,
      resolveUrls: () => [archiveUrl],
      afterArchiveStaged: async (staging) => {
        const encoder = join(staging, QWEN3_ASR_DIR, 'encoder.int8.onnx')
        if (!existsSync(encoder) || readFileSync(encoder).length === 0) {
          throw new Error(`${role} staging is missing the encoder at ${encoder}`)
        }
        writeFileSync(join(gate, `${role}-staging`), staging)
        await waitForRelease(join(gate, 'release'))
      }
    })
    const status = await manager.ensureReady(quality)
    if (!status.ready) {
      throw new Error(`${role} finished without a ready model`)
    }
  } finally {
    writeFileSync(join(gate, `${role}-calls`), calls.join('\n'))
  }
}

if (role === 'leader' || role === 'follower') {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
