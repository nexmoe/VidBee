import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { type TestContext, test } from 'node:test'
import {
  defaultWebSettings,
  ASR_TIERS as WEB_ASR_TIERS
} from '../../../apps/web/src/lib/web-settings'
import { WebAppSettingsSchema } from '../../downloader-core/src/schemas'
import { tryRecognizerConfig } from '../src/asr-recognizer'
import { asrTierInfo, DEFAULT_ASR_TIER, ORUKEET_DIR, parseAsrTier } from '../src/asr-tiers'
import { modelDownloadUrls } from '../src/download-mirrors'
import { catalogFor } from '../src/model-catalog'
import { isModelDownloadCancelled, ModelManager, modelPartPath } from '../src/model-manager'

const options = { groups: ['asr'], tiers: ['orukeet'] } as const
const sha256 = (body: string): string => createHash('sha256').update(body).digest('hex')

// Exercise the real catalog and downloader using small text bodies, never model weights.
const fixture = (t: TestContext, manifestBody?: string) => {
  const modelsDir = mkdtempSync(join(tmpdir(), 'vidbee-orukeet-'))
  t.after(() => rmSync(modelsDir, { recursive: true, force: true }))
  const specs = catalogFor(options)
  const responses = new Map(specs.map((spec) => [spec.url, `fixture: ${spec.id}`]))
  const manifest = specs.find((spec) => spec.id === 'orukeet-manifest')
  if (!manifest) {
    throw new Error('Orukeet manifest is missing from the catalog')
  }
  const contents =
    manifestBody ??
    JSON.stringify({
      files: specs
        .filter((spec) => spec.checksumManifest)
        .map((spec) => ({
          path: basename(spec.fileName),
          sha256: sha256(`fixture: ${spec.id}`)
        }))
    })
  responses.set(manifest.url, contents)
  const catalog = specs.map((spec) =>
    spec.id === manifest.id ? { ...spec, sha256: sha256(contents) } : spec
  )
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    const body = responses.get(url)
    if (body === undefined) {
      throw new Error(`unexpected download: ${url}`)
    }
    return new Response(body)
  }
  const manager = new ModelManager({ modelsDir, catalog, fetchImpl, preferChina: false })
  return { modelsDir, catalog, responses, manifest, calls, fetchImpl, manager }
}

test('Orukeet is optional and downloads a pinned, authenticated HF bundle in either mirror mode', () => {
  assert.equal(DEFAULT_ASR_TIER, 'minimal')
  assert.equal(parseAsrTier('orukeet'), 'orukeet')
  assert.equal(asrTierInfo('orukeet').family, 'parakeet')
  assert.equal(
    catalogFor().some((spec) => spec.tier === 'orukeet'),
    false
  )
  const specs = catalogFor(options)
  assert.deepEqual(
    specs.map((spec) => basename(spec.fileName)),
    [
      'manifest.json',
      'encoder.int8.onnx',
      'decoder.int8.onnx',
      'joiner.int8.onnx',
      'tokens.txt',
      'LICENSE-WEIGHTS',
      'NOTICE.md'
    ]
  )
  assert.match(specs[0]?.sha256 ?? '', /^[a-f0-9]{64}$/)
  for (const spec of specs) {
    assert.match(
      spec.url,
      /^https:\/\/huggingface.co\/oruk\/orukeet\/resolve\/[a-f0-9]{40}\/onnx\/sherpa-v0\.1\.0-int8\//
    )
    assert.deepEqual(modelDownloadUrls(spec, false), [spec.url])
    assert.deepEqual(modelDownloadUrls(spec, true), [spec.url])
    if (spec.id !== 'orukeet-manifest') {
      assert.equal(spec.checksumManifest, specs[0]?.fileName)
    }
  }
})

test('shared API validation and persisted web settings both accept the optional Orukeet tier', () => {
  assert.equal(WebAppSettingsSchema.shape.asrTier.parse('orukeet'), 'orukeet')
  assert.equal(WEB_ASR_TIERS.includes('orukeet'), true)
  assert.equal(WebAppSettingsSchema.shape.asrTier.safeParse('unknown-model').success, false)
  assert.equal(WebAppSettingsSchema.shape.asrTier.parse(undefined), DEFAULT_ASR_TIER)
  assert.equal(defaultWebSettings.asrTier, DEFAULT_ASR_TIER)
})

test('installs once, reuses the cache offline, resolves transducer paths, and removes only Orukeet', async (t) => {
  const f = fixture(t)
  const sibling = join(f.modelsDir, 'another-model', 'tokens.txt')
  mkdirSync(dirname(sibling), { recursive: true })
  writeFileSync(sibling, 'keep another model')
  const shared = join(f.modelsDir, 'silero_vad.onnx')
  writeFileSync(shared, 'keep shared VAD')
  const installed = await Promise.all([
    f.manager.ensureReady(options),
    f.manager.ensureReady(options)
  ])
  assert.equal(
    installed.every((status) => status.ready),
    true
  )
  assert.deepEqual(
    f.calls,
    f.catalog.map((spec) => spec.url)
  )
  assert.deepEqual(tryRecognizerConfig(f.manager, 'orukeet'), {
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(f.modelsDir, ORUKEET_DIR, 'encoder.int8.onnx'),
        decoder: join(f.modelsDir, ORUKEET_DIR, 'decoder.int8.onnx'),
        joiner: join(f.modelsDir, ORUKEET_DIR, 'joiner.int8.onnx')
      },
      tokens: join(f.modelsDir, ORUKEET_DIR, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    }
  })
  const offline = new ModelManager({
    modelsDir: f.modelsDir,
    catalog: f.catalog,
    fetchImpl: async () => {
      throw new Error('network must not be used for cached models')
    }
  })
  assert.equal((await offline.ensureReady(options)).ready, true)
  rmSync(f.manager.pathFor(f.manifest))
  assert.equal(f.manager.status(options.groups, options.tiers).ready, false)
  assert.equal((await f.manager.ensureReady(options)).ready, true)
  assert.deepEqual(f.calls.slice(f.catalog.length), [f.manifest.url])
  f.manager.removeTier('orukeet')
  assert.equal(existsSync(join(f.modelsDir, ORUKEET_DIR)), false)
  assert.equal(readFileSync(sibling, 'utf8'), 'keep another model')
  assert.equal(readFileSync(shared, 'utf8'), 'keep shared VAD')
})

test('rejects altered manifest or model bytes and succeeds on a clean retry', async (t) => {
  for (const id of ['orukeet-manifest', 'orukeet-encoder']) {
    const f = fixture(t)
    const spec = f.catalog.find((entry) => entry.id === id)
    assert.ok(spec)
    const correct = f.responses.get(spec.url)
    assert.ok(correct)
    f.responses.set(spec.url, 'corrupt response')
    await assert.rejects(f.manager.ensureReady(options), /model checksum mismatch/)
    assert.equal(existsSync(f.manager.pathFor(spec)), false)
    assert.equal(existsSync(modelPartPath(f.manager.pathFor(spec))), false)
    assert.equal(f.manager.status(options.groups, options.tiers).ready, false)
    f.responses.set(spec.url, correct)
    assert.equal((await f.manager.ensureReady(options)).ready, true)
  }
})

test('rejects malformed or incomplete authenticated manifests before fetching weights', async (t) => {
  for (const contents of [
    'not JSON',
    '{}',
    '{"files":[]}',
    '{"files":[{"path":"encoder.int8.onnx","sha256":"invalid"}]}'
  ]) {
    const f = fixture(t, contents)
    await assert.rejects(f.manager.ensureReady(options))
    assert.deepEqual(f.calls, [f.manifest.url])
    assert.equal(f.manager.pathByRole('asr-encoder', 'orukeet'), null)
  }
})

test('rejects a tampered cached manifest before trusting a missing file checksum', async (t) => {
  const f = fixture(t)
  mkdirSync(join(f.modelsDir, ORUKEET_DIR), { recursive: true })
  writeFileSync(f.manager.pathFor(f.manifest), '{"files":[]}')
  await assert.rejects(f.manager.ensureReady(options), /model checksum mismatch/)
  assert.deepEqual(f.calls, [])
})

test('an interrupted body leaves no installed file or staging file and can retry', async (t) => {
  const f = fixture(t)
  const encoder = f.catalog.find((spec) => spec.id === 'orukeet-encoder')
  assert.ok(encoder)
  let interrupt = true
  const manager = new ModelManager({
    modelsDir: f.modelsDir,
    catalog: f.catalog,
    fetchImpl: async (input, init) => {
      if (String(input) === encoder.url && interrupt) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('connection interrupted'))
            }
          })
        )
      }
      return f.fetchImpl(input, init)
    }
  })
  await assert.rejects(manager.ensureReady(options), /connection interrupted/)
  assert.equal(existsSync(manager.pathFor(encoder)), false)
  assert.equal(existsSync(modelPartPath(manager.pathFor(encoder))), false)
  assert.deepEqual(manager.status().downloads, [])
  interrupt = false
  assert.equal((await manager.ensureReady(options)).ready, true)
})

test('cancellation removes the partial tier while preserving shared and sibling files', async (t) => {
  const f = fixture(t)
  const encoder = f.catalog.find((spec) => spec.id === 'orukeet-encoder')
  assert.ok(encoder)
  const started = Promise.withResolvers<void>()
  const shared = join(f.modelsDir, 'silero_vad.onnx')
  writeFileSync(shared, 'keep shared VAD')
  const sibling = join(f.modelsDir, 'another-model', 'tokens.txt')
  mkdirSync(dirname(sibling), { recursive: true })
  writeFileSync(sibling, 'keep another model')
  const manager = new ModelManager({
    modelsDir: f.modelsDir,
    catalog: f.catalog,
    fetchImpl: async (input, init) => {
      if (String(input) !== encoder.url) {
        return f.fetchImpl(input, init)
      }
      started.resolve()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial body'))
          }
        })
      )
    }
  })
  const pending = manager.ensureReady(options)
  const cancelled = assert.rejects(pending, isModelDownloadCancelled)
  await started.promise
  assert.throws(() => manager.removeTier('orukeet'), /while it is downloading/)
  manager.cancelDownload('orukeet')
  await cancelled
  assert.equal(existsSync(join(f.modelsDir, ORUKEET_DIR)), false)
  assert.deepEqual(manager.status().downloads, [])
  assert.equal(readFileSync(shared, 'utf8'), 'keep shared VAD')
  assert.equal(readFileSync(sibling, 'utf8'), 'keep another model')
})
