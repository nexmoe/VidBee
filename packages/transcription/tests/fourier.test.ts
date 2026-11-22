import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { ExecutorFinishEvent } from '@vidbee/task-queue'
import { recommendAsrModels } from '../src/asr-recommend'
import { asrTierInfo, DEFAULT_ASR_TIER, parseAsrTier } from '../src/asr-tiers'
import { TranscriptionExecutor } from '../src/executor'
import { MemoryTranscriptStore } from '../src/memory-store'
import { catalogFor } from '../src/model-catalog'
import { ModelManager } from '../src/model-manager'

test('Fourier is an opt-in English model with checksums for both ONNX external-data files and its own tokenizer', () => {
  const tier = 'fourier-en'
  const model = asrTierInfo(tier)
  assert.deepEqual(model.languages, ['en'])
  assert.equal(model.family, 'qwen3')
  assert.equal(parseAsrTier(tier), tier)
  assert.notEqual(DEFAULT_ASR_TIER, tier)
  assert.ok(
    !recommendAsrModels({ cpuCount: 16, ramBytes: 64 * 1024 ** 3, language: 'en' }).includes(tier)
  )
  const specs = catalogFor({ groups: ['asr'], tiers: [tier] })
  assert.deepEqual(
    specs
      .filter((s) => s.role === 'asr-extra')
      .map((s) => s.fileName)
      .sort(),
    ['fourier-en-int8/decoder.int8.onnx.data', 'fourier-en-int8/encoder.int8.onnx.data']
  )
  assert.ok(
    specs
      .filter((s) => s.role !== 'asr-tokenizer')
      .every((s) => /^[a-f0-9]{64}$/.test(s.sha256 ?? ''))
  )
  const tokenizer = specs.find((s) => s.role === 'asr-tokenizer')
  assert.deepEqual(tokenizer?.directoryMembers?.map((s) => s.name).sort(), [
    'config.json',
    'merges.txt',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json'
  ])
  assert.ok(tokenizer?.directoryMembers?.every((s) => /^[a-f0-9]{64}$/.test(s.sha256)))
  assert.ok(
    specs.every((s) => s.url.startsWith('https://huggingface.co/oruk/oruk-fourier-2b/resolve/'))
  )
})

test('the hosted executor rejects Fourier before starting model work', async () => {
  const executor = new TranscriptionExecutor({
    store: new MemoryTranscriptStore(),
    workerScript: '',
    modelsDir: '',
    resolveFfmpegPath: () => assert.fail('hosted transcription reached audio processing')
  })
  const finished = await new Promise<ExecutorFinishEvent>((resolve) => {
    executor.run(
      {
        taskId: 'test',
        attemptId: 'test-1',
        attemptNumber: 1,
        input: {
          kind: 'transcription',
          url: 'file.wav',
          options: {
            downloadTaskId: 'test-parent',
            sourceFilePath: 'file.wav',
            asrTier: 'fourier-en'
          }
        }
      },
      { onSpawn: () => {}, onProgress: () => {}, onStd: () => {}, onFinish: resolve }
    )
  })
  assert.equal(finished.result.type, 'error')
  if (finished.result.type === 'error') {
    assert.equal(finished.result.error.category, 'permission-denied')
    assert.match(finished.result.error.rawMessage, /Oruk Fourier/)
  }
})

test('the model manager downloads the ten catalog paths and rejects a corrupt decoder sidecar', async (t) => {
  const tier = 'fourier-en'
  const options = { groups: ['asr'], tiers: [tier] } as const
  const directory = await mkdtemp(join(tmpdir(), 'vidbee-fourier-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const contents = (name: string) => JSON.stringify({ file: name })
  const digest = (name: string) => createHash('sha256').update(contents(name)).digest('hex')
  const catalog = catalogFor(options).map((spec) => {
    const name = spec.fileName.slice('fourier-en-int8/'.length)
    if (spec.directoryMembers) {
      return {
        ...spec,
        directoryMembers: spec.directoryMembers.map((member) => ({
          ...member,
          minBytes: 1,
          sha256: digest(`${name}/${member.name}`)
        }))
      }
    }
    return { ...spec, sha256: digest(name) }
  })
  const requested: string[] = []
  let damaged = false
  const manager = new ModelManager({
    modelsDir: directory,
    catalog,
    preferChina: false,
    fetchImpl: async (input) => {
      const uri = new URL(input.toString())
      assert.equal(uri.origin, 'https://huggingface.co')
      const name = uri.pathname.split('/onnx/sherpa-int8/')[1]
      assert.ok(name)
      requested.push(name)
      return new Response(damaged ? 'corrupt' : contents(name))
    }
  })
  assert.equal(manager.status(options.groups, options.tiers).ready, false)
  assert.equal((await manager.ensureReady(options)).ready, true)
  const exactPaths = [
    'conv_frontend.onnx',
    'encoder.int8.onnx',
    'decoder.int8.onnx',
    'encoder.int8.onnx.data',
    'decoder.int8.onnx.data',
    'tokenizer/config.json',
    'tokenizer/merges.txt',
    'tokenizer/tokenizer.json',
    'tokenizer/tokenizer_config.json',
    'tokenizer/vocab.json'
  ]
  assert.deepEqual([...requested].sort(), exactPaths.sort())
  for (const name of exactPaths) {
    assert.equal(await readFile(join(directory, 'fourier-en-int8', name), 'utf8'), contents(name))
  }
  damaged = true
  await rm(join(directory, 'fourier-en-int8', 'decoder.int8.onnx.data'))
  await assert.rejects(manager.ensureReady(options), /checksum mismatch/)
  assert.equal(manager.status(options.groups, options.tiers).ready, false)
})
