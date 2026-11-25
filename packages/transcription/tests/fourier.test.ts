import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { ExecutorFinishEvent } from '@vidbee/task-queue'
import { recommendAsrModels } from '../src/asr-recommend'
import { asrTierInfo, DEFAULT_ASR_TIER, parseAsrTier } from '../src/asr-tiers'
import { modelDownloadUrls } from '../src/download-mirrors'
import { TranscriptionExecutor } from '../src/executor'
import { MemoryTranscriptStore } from '../src/memory-store'
import { catalogFor } from '../src/model-catalog'
import { ModelManager } from '../src/model-manager'
import type { PipelineResult } from '../src/types'

const FOURIER_RESOLVE_PREFIX =
  '/oruk/oruk-fourier-2b/resolve/3fda023e157ce7986f137f76fcf326ed6e08fa73/'

const runExecutorTask = (
  executor: TranscriptionExecutor,
  options: Record<string, unknown>,
  sourceFilePath = 'file.wav'
): Promise<ExecutorFinishEvent> =>
  new Promise<ExecutorFinishEvent>((resolve) => {
    executor.run(
      {
        taskId: 'test',
        attemptId: 'test-1',
        attemptNumber: 1,
        input: {
          kind: 'transcription',
          url: sourceFilePath,
          options: {
            downloadTaskId: 'test-parent',
            sourceFilePath,
            ...options
          }
        }
      },
      { onSpawn: () => {}, onProgress: () => {}, onStd: () => {}, onFinish: resolve }
    )
  })

const stubPipelineResult = (asrTier: string): PipelineResult => ({
  resultKind: 'transcript',
  language: 'en',
  modelVersion: 'test',
  asrTier,
  speakers: [],
  segments: [
    {
      speakerKey: null,
      startMs: 0,
      endMs: 1000,
      text: 'hello',
      confidence: null
    }
  ]
})

test('Fourier is an opt-in English model with checksums for both ONNX external-data files, root config, and its own tokenizer', () => {
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
    [
      'fourier-en-int8/config.json',
      'fourier-en-int8/decoder.int8.onnx.data',
      'fourier-en-int8/encoder.int8.onnx.data'
    ]
  )
  assert.ok(
    specs
      .filter((s) => s.role !== 'asr-tokenizer')
      .every((s) => /^[a-f0-9]{64}$/.test(s.sha256 ?? ''))
  )
  const rootConfig = specs.find((s) => s.id === 'fourier-en-config-json')
  assert.equal(rootConfig?.url, `https://huggingface.co${FOURIER_RESOLVE_PREFIX}config.json`)
  const tokenizer = specs.find((s) => s.role === 'asr-tokenizer')
  assert.deepEqual(tokenizer?.directoryMembers?.map((s) => s.name).sort(), [
    'config.json',
    'merges.txt',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json'
  ])
  assert.ok(tokenizer?.directoryMembers?.every((s) => /^[a-f0-9]{64}$/.test(s.sha256)))
  assert.ok(specs.every((s) => s.url.startsWith(`https://huggingface.co${FOURIER_RESOLVE_PREFIX}`)))
  assert.ok(
    specs.every((s) => {
      const urls = modelDownloadUrls(s, true)
      return urls.length === 1 && urls[0] === s.url
    })
  )
})

test('the hosted executor rejects Fourier before starting model work', async () => {
  const executor = new TranscriptionExecutor({
    store: new MemoryTranscriptStore(),
    workerScript: '',
    modelsDir: '',
    resolveFfmpegPath: () => assert.fail('hosted transcription reached audio processing')
  })
  const finished = await runExecutorTask(executor, { asrTier: 'fourier-en' })
  assert.equal(finished.result.type, 'error')
  if (finished.result.type === 'error') {
    assert.equal(finished.result.error.category, 'permission-denied')
    assert.match(finished.result.error.rawMessage, /Oruk Fourier/)
  }
})

test('the hosted executor rejects Fourier on cloud re-diarization before touching worker or model dirs', async (t) => {
  const workDir = await mkdtemp(join(tmpdir(), 'vidbee-fourier-work-'))
  const modelsDir = await mkdtemp(join(tmpdir(), 'vidbee-fourier-models-'))
  const audioDir = await mkdtemp(join(tmpdir(), 'vidbee-fourier-audio-'))
  t.after(() =>
    Promise.all([
      rm(workDir, { recursive: true, force: true }),
      rm(modelsDir, { recursive: true, force: true }),
      rm(audioDir, { recursive: true, force: true })
    ])
  )
  const sourceFilePath = join(audioDir, 'clip.wav')
  await writeFile(sourceFilePath, 'stub')

  const workerExecutor = new TranscriptionExecutor({
    store: new MemoryTranscriptStore(),
    workerScript: fileURLToPath(new URL('../src/worker/entry.ts', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    modelsDir,
    workDir,
    resolveFfmpegPath: () => assert.fail('hosted rediarize reached audio processing'),
    runCloud: async () => assert.fail('hosted rediarize should not invoke cloud runner')
  })
  const workerFinished = await runExecutorTask(
    workerExecutor,
    { asrTier: 'fourier-en', provider: 'cloud', rediarize: true },
    sourceFilePath
  )
  assert.equal(workerFinished.result.type, 'error')
  if (workerFinished.result.type === 'error') {
    assert.equal(workerFinished.result.error.category, 'permission-denied')
    assert.match(workerFinished.result.error.rawMessage, /Oruk Fourier/)
  }
  assert.deepEqual(await readdir(workDir), [])
  assert.deepEqual(await readdir(modelsDir), [])

  const inProcessExecutor = new TranscriptionExecutor({
    store: new MemoryTranscriptStore(),
    workerScript: '',
    modelsDir,
    resolveFfmpegPath: () => assert.fail('hosted rediarize reached audio processing'),
    runCloud: async () => assert.fail('hosted rediarize should not invoke cloud runner'),
    runInProcess: async () => assert.fail('hosted rediarize reached in-process local runner')
  })
  const inProcessFinished = await runExecutorTask(
    inProcessExecutor,
    { asrTier: 'fourier-en', provider: 'cloud', rediarize: true },
    sourceFilePath
  )
  assert.equal(inProcessFinished.result.type, 'error')
  if (inProcessFinished.result.type === 'error') {
    assert.equal(inProcessFinished.result.error.category, 'permission-denied')
    assert.match(inProcessFinished.result.error.rawMessage, /Oruk Fourier/)
  }
})

test('cloud transcription without rediarize and desktop-opted-in cloud rediarize route to their expected runners', async () => {
  let cloudCalls = 0
  const hostedCloudExecutor = new TranscriptionExecutor({
    store: new MemoryTranscriptStore(),
    workerScript: '',
    modelsDir: '',
    resolveFfmpegPath: () => assert.fail('cloud transcription reached local audio processing'),
    runInProcess: async () => assert.fail('cloud transcription reached local in-process runner'),
    runCloud: async () => {
      cloudCalls += 1
      return { result: stubPipelineResult('cloud:default'), durationMs: 10 }
    }
  })
  const cloudFinished = await runExecutorTask(hostedCloudExecutor, {
    asrTier: 'fourier-en',
    provider: 'cloud'
  })
  assert.equal(cloudFinished.result.type, 'success')
  assert.equal(cloudCalls, 1)

  const seenLocalTiers: string[] = []
  const desktopExecutor = new TranscriptionExecutor({
    allowNoncommercialDesktopModels: true,
    store: new MemoryTranscriptStore(),
    workerScript: '',
    modelsDir: '',
    resolveFfmpegPath: () => assert.fail('in-process stub should not resolve ffmpeg'),
    runCloud: async () => assert.fail('rediarize should not invoke cloud runner'),
    runInProcess: async (input) => {
      seenLocalTiers.push(input.asrTier)
      return { result: stubPipelineResult(input.asrTier), durationMs: 10 }
    }
  })
  const desktopFinished = await runExecutorTask(desktopExecutor, {
    asrTier: 'fourier-en',
    provider: 'cloud',
    rediarize: true
  })
  assert.equal(desktopFinished.result.type, 'success')
  assert.deepEqual(seenLocalTiers, ['fourier-en'])
})

test('the model manager downloads all eleven catalog paths including root config.json and rejects a corrupt decoder sidecar', async (t) => {
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
      assert.ok(uri.pathname.startsWith(FOURIER_RESOLVE_PREFIX))
      const repoPath = uri.pathname.slice(FOURIER_RESOLVE_PREFIX.length)
      assert.ok(repoPath)
      requested.push(repoPath)
      const localName = repoPath.startsWith('onnx/sherpa-int8/')
        ? repoPath.slice('onnx/sherpa-int8/'.length)
        : repoPath
      return new Response(damaged ? 'corrupt' : contents(localName))
    }
  })
  assert.equal(manager.status(options.groups, options.tiers).ready, false)
  assert.equal((await manager.ensureReady(options)).ready, true)
  const expectedRepoPaths = [
    'config.json',
    'onnx/sherpa-int8/conv_frontend.onnx',
    'onnx/sherpa-int8/encoder.int8.onnx',
    'onnx/sherpa-int8/decoder.int8.onnx',
    'onnx/sherpa-int8/encoder.int8.onnx.data',
    'onnx/sherpa-int8/decoder.int8.onnx.data',
    'onnx/sherpa-int8/tokenizer/config.json',
    'onnx/sherpa-int8/tokenizer/merges.txt',
    'onnx/sherpa-int8/tokenizer/tokenizer.json',
    'onnx/sherpa-int8/tokenizer/tokenizer_config.json',
    'onnx/sherpa-int8/tokenizer/vocab.json'
  ]
  assert.deepEqual([...requested].sort(), expectedRepoPaths.sort())
  const expectedLocalPaths = [
    'config.json',
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
  for (const name of expectedLocalPaths) {
    assert.equal(await readFile(join(directory, 'fourier-en-int8', name), 'utf8'), contents(name))
  }
  damaged = true
  await rm(join(directory, 'fourier-en-int8', 'decoder.int8.onnx.data'))
  await assert.rejects(manager.ensureReady(options), /checksum mismatch/)
  assert.equal(manager.status(options.groups, options.tiers).ready, false)
})
