import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type TestContext, test } from 'node:test'
import { resolveAsrModelPaths, tryRecognizerConfig } from '../src/asr-recognizer'
import { QWEN3_ASR_DIR, WHISPER_TINY_DIR } from '../src/asr-tiers'
import { classifyTranscriptionFailure } from '../src/errors'
import { catalogFor, MODEL_CATALOG } from '../src/model-catalog'
import { ModelManager } from '../src/model-manager'
import { QWEN3_ASR_TOKENIZER_FILES, QWEN3_TOKENIZER_REPAIR_HINT } from '../src/qwen3-tokenizer'
import type { DirectoryMemberRequirement, ModelFileSpec } from '../src/types'

const quality = { groups: ['asr'] as const, tiers: ['quality'] as const }
const archiveName = 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2'
const archiveUrl = `https://models.example/${archiveName}`
const vocabBody = '{"version":"qwen3"}\n'
const mergesBody = 'a b\n'
const configBody = '{"model_type":"qwen2"}\n'
const encoderBody = 'encoder-from-archive'
const sha256 = (body: string): string => createHash('sha256').update(body).digest('hex')

const member = (name: string, body: string, json = false): DirectoryMemberRequirement => ({
  name,
  minBytes: Buffer.byteLength(body),
  sha256: sha256(body),
  ...(json ? { json: true } : {})
})

const successMembers: readonly DirectoryMemberRequirement[] = [
  member('vocab.json', vocabBody, true),
  member('merges.txt', mergesBody),
  member('tokenizer_config.json', configBody, true)
]

const modelsDirFor = (t: TestContext): string => {
  const modelsDir = mkdtempSync(join(tmpdir(), 'vidbee-qwen3-'))
  t.after(() => rmSync(modelsDir, { recursive: true, force: true }))
  return modelsDir
}

const writeOnnx = (root: string, body = 'onnx-placeholder'): void => {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'encoder.int8.onnx'), body)
  writeFileSync(join(root, 'decoder.int8.onnx'), body)
  writeFileSync(join(root, 'conv_frontend.onnx'), body)
}

const seedPartialTokenizer = (modelsDir: string, vocab = '{'): string => {
  const root = join(modelsDir, QWEN3_ASR_DIR)
  writeOnnx(root)
  mkdirSync(join(root, 'tokenizer'), { recursive: true })
  writeFileSync(join(root, 'tokenizer', 'vocab.json'), vocab)
  return root
}

const archiveBuffer = (t: TestContext, fill: (root: string) => void): Buffer => {
  const scratch = mkdtempSync(join(tmpdir(), 'vidbee-qwen3-tar-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  fill(join(scratch, QWEN3_ASR_DIR))
  const archivePath = join(scratch, archiveName)
  execFileSync('tar', ['-cjf', archivePath, '-C', scratch, QWEN3_ASR_DIR])
  return readFileSync(archivePath)
}

const goodArchive = (t: TestContext): Buffer =>
  archiveBuffer(t, (root) => {
    writeOnnx(root, encoderBody)
    mkdirSync(join(root, 'tokenizer'), { recursive: true })
    writeFileSync(join(root, 'tokenizer', 'vocab.json'), vocabBody)
    writeFileSync(join(root, 'tokenizer', 'merges.txt'), mergesBody)
    writeFileSync(join(root, 'tokenizer', 'tokenizer_config.json'), configBody)
  })

const fetching = (body: () => Buffer | string): { calls: string[]; fetchImpl: typeof fetch } => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${String(input)}`)
    if (method === 'HEAD') {
      return new Response(null, { status: 200 })
    }
    return new Response(body())
  }
  return { calls, fetchImpl }
}

const qualityCatalog = (): ModelFileSpec[] =>
  catalogFor(quality).map((spec) =>
    spec.id === 'qwen3-asr-tokenizer' ? { ...spec, directoryMembers: successMembers } : spec
  )

const markerPath = (modelsDir: string, name = archiveName): string =>
  join(modelsDir, '.downloads', `${name}.extracted`)

const writeMarker = (modelsDir: string, name = archiveName): void => {
  const marker = markerPath(modelsDir, name)
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, 'ok')
}

test('Qwen3 tokenizer requirements are pinned to the 2026-03-25 package', () => {
  assert.deepEqual(
    QWEN3_ASR_TOKENIZER_FILES.map((file) => [file.name, file.minBytes, file.sha256, file.json]),
    [
      [
        'vocab.json',
        2_776_833,
        'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910',
        true
      ],
      [
        'merges.txt',
        1_671_853,
        '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5',
        undefined
      ],
      [
        'tokenizer_config.json',
        12_487,
        '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c',
        true
      ]
    ]
  )
  const spec = MODEL_CATALOG.find((item) => item.id === 'qwen3-asr-tokenizer')
  assert.equal(spec?.directoryMembers, QWEN3_ASR_TOKENIZER_FILES)
  assert.equal(spec?.fileName, `${QWEN3_ASR_DIR}/tokenizer`)
})

test('missing tokenizer siblings are not ready and are not recognizer paths', (t) => {
  const modelsDir = modelsDirFor(t)
  const root = seedPartialTokenizer(modelsDir)
  const manager = new ModelManager({ modelsDir, preferChina: false })
  const status = manager.status(quality.groups, quality.tiers)
  assert.equal(status.ready, false)
  assert.equal(status.tiers.find((tier) => tier.id === 'quality')?.ready, false)
  assert.equal(status.files.find((file) => file.id === 'qwen3-asr-tokenizer')?.present, false)
  assert.equal(manager.pathByRole('asr-encoder', 'quality'), join(root, 'encoder.int8.onnx'))
  assert.equal(manager.pathByRole('asr-tokenizer', 'quality'), null)
  assert.equal(manager.pathById('qwen3-asr-tokenizer'), null)
  assert.equal(tryRecognizerConfig(manager, 'quality'), null)
  assert.throws(
    () => resolveAsrModelPaths(manager, 'quality'),
    /incomplete model: missing tokenizer\/merges\.txt/
  )
  assert.match(
    manager.incompleteModelIssue('quality') ?? '',
    new RegExp(QWEN3_TOKENIZER_REPAIR_HINT)
  )
})

test('truncated tokenizer JSON is an incomplete model', (t) => {
  const modelsDir = modelsDirFor(t)
  const root = seedPartialTokenizer(modelsDir, '{')
  writeFileSync(join(root, 'tokenizer', 'merges.txt'), mergesBody)
  writeFileSync(join(root, 'tokenizer', 'tokenizer_config.json'), configBody)
  const manager = new ModelManager({ modelsDir, preferChina: false })
  assert.equal(manager.status(quality.groups, quality.tiers).ready, false)
  assert.match(
    manager.incompleteModelIssue('quality') ?? '',
    /incomplete model: tokenizer\/vocab\.json is truncated JSON/
  )
})

test('a tokenizer checksum mismatch is an incomplete model', (t) => {
  const modelsDir = modelsDirFor(t)
  const root = join(modelsDir, QWEN3_ASR_DIR)
  writeOnnx(root)
  mkdirSync(join(root, 'tokenizer'), { recursive: true })
  writeFileSync(join(root, 'tokenizer', 'vocab.json'), '{"a":2}')
  writeFileSync(join(root, 'tokenizer', 'merges.txt'), mergesBody)
  writeFileSync(join(root, 'tokenizer', 'tokenizer_config.json'), configBody)
  const catalog = qualityCatalog().map((spec) =>
    spec.id === 'qwen3-asr-tokenizer'
      ? {
          ...spec,
          directoryMembers: [
            member('vocab.json', '{"a":1}', true),
            member('merges.txt', mergesBody),
            member('tokenizer_config.json', configBody, true)
          ]
        }
      : spec
  )
  const manager = new ModelManager({ modelsDir, catalog, preferChina: false })
  assert.equal(manager.status(quality.groups, quality.tiers).ready, false)
  assert.match(
    manager.incompleteModelIssue('quality') ?? '',
    /incomplete model: tokenizer\/vocab\.json checksum mismatch/
  )
})

test('a stale marker and partial extract are not skipped, and a bad archive is invalidated', async (t) => {
  const modelsDir = modelsDirFor(t)
  seedPartialTokenizer(modelsDir)
  writeMarker(modelsDir)
  const archivePath = join(modelsDir, '.downloads', archiveName)
  writeFileSync(archivePath, 'not a tar')
  const sibling = join(modelsDir, 'another-model', 'tokens.txt')
  mkdirSync(dirname(sibling), { recursive: true })
  writeFileSync(sibling, 'keep another model')
  writeFileSync(join(modelsDir, 'silero_vad.onnx'), 'keep shared VAD')
  const { calls, fetchImpl } = fetching(() => 'still not a tar')
  const manager = new ModelManager({
    modelsDir,
    fetchImpl,
    preferChina: false,
    resolveUrls: () => [archiveUrl]
  })
  await assert.rejects(
    manager.ensureReady(quality),
    /incomplete model: extraction failed for sherpa-onnx-qwen3-asr-0\.6B-int8-2026-03-25\.tar\.bz2/
  )
  assert.equal(manager.status(quality.groups, quality.tiers).ready, false)
  assert.equal(manager.pathByRole('asr-tokenizer', 'quality'), null)
  assert.equal(existsSync(markerPath(modelsDir)), false)
  assert.equal(existsSync(archivePath), false)
  assert.equal(existsSync(`${archivePath}.staging`), false)
  assert.ok(calls.some((call) => call.startsWith(`GET ${archiveUrl}`)))
  assert.equal(readFileSync(sibling, 'utf8'), 'keep another model')
  assert.equal(readFileSync(join(modelsDir, 'silero_vad.onnx'), 'utf8'), 'keep shared VAD')
})

test('a stale marker is replaced from a valid archive without downloading again', async (t) => {
  const modelsDir = modelsDirFor(t)
  const root = seedPartialTokenizer(modelsDir, '{')
  writeMarker(modelsDir)
  const archivePath = join(modelsDir, '.downloads', archiveName)
  writeFileSync(archivePath, goodArchive(t))
  const { calls, fetchImpl } = fetching(() => {
    throw new Error('archive is already on disk')
  })
  const manager = new ModelManager({
    modelsDir,
    catalog: qualityCatalog(),
    fetchImpl,
    preferChina: false,
    resolveUrls: () => [archiveUrl]
  })
  const status = await manager.ensureReady(quality)
  assert.equal(status.ready, true)
  assert.equal(status.tiers.find((tier) => tier.id === 'quality')?.ready, true)
  assert.equal(readFileSync(join(root, 'tokenizer', 'vocab.json'), 'utf8'), vocabBody)
  assert.equal(readFileSync(join(root, 'encoder.int8.onnx'), 'utf8'), encoderBody)
  assert.equal(readFileSync(markerPath(modelsDir), 'utf8'), 'ok')
  assert.equal(
    calls.some((call) => call.startsWith('GET ')),
    false
  )
  assert.equal(manager.pathByRole('asr-tokenizer', 'quality'), join(root, 'tokenizer'))
  assert.equal(tryRecognizerConfig(manager, 'quality') === null, false)
})

test('interrupted extraction stays incomplete, then a later archive can be published', async (t) => {
  const modelsDir = modelsDirFor(t)
  const root = seedPartialTokenizer(modelsDir)
  writeMarker(modelsDir)
  const sibling = join(modelsDir, 'another-model', 'tokens.txt')
  mkdirSync(dirname(sibling), { recursive: true })
  writeFileSync(sibling, 'keep another model')
  let interrupted = true
  const archived = goodArchive(t)
  const { calls, fetchImpl } = fetching(() => (interrupted ? 'truncated-tar' : archived))
  const manager = new ModelManager({
    modelsDir,
    catalog: qualityCatalog(),
    fetchImpl,
    preferChina: false,
    resolveUrls: () => [archiveUrl]
  })
  await assert.rejects(manager.ensureReady(quality), /incomplete model/)
  assert.equal(manager.status(quality.groups, quality.tiers).ready, false)
  assert.equal(existsSync(markerPath(modelsDir)), false)
  assert.equal(existsSync(join(modelsDir, '.downloads', archiveName)), false)
  assert.equal(readFileSync(join(root, 'tokenizer', 'vocab.json'), 'utf8'), '{')
  assert.ok(calls.some((call) => call.startsWith(`GET ${archiveUrl}`)))
  interrupted = false
  const status = await manager.ensureReady(quality)
  assert.equal(status.ready, true)
  assert.equal(readFileSync(join(root, 'tokenizer', 'vocab.json'), 'utf8'), vocabBody)
  assert.equal(readFileSync(join(root, 'tokenizer', 'merges.txt'), 'utf8'), mergesBody)
  assert.equal(readFileSync(markerPath(modelsDir), 'utf8'), 'ok')
  assert.equal(readFileSync(sibling, 'utf8'), 'keep another model')
  assert.equal(existsSync(`${join(modelsDir, '.downloads', archiveName)}.staging`), false)
})

test('a complete tokenizer replacement is reused and does not download', async (t) => {
  const modelsDir = modelsDirFor(t)
  const root = join(modelsDir, QWEN3_ASR_DIR)
  writeOnnx(root, encoderBody)
  mkdirSync(join(root, 'tokenizer'), { recursive: true })
  writeFileSync(join(root, 'tokenizer', 'vocab.json'), vocabBody)
  writeFileSync(join(root, 'tokenizer', 'merges.txt'), mergesBody)
  writeFileSync(join(root, 'tokenizer', 'tokenizer_config.json'), configBody)
  const manager = new ModelManager({
    modelsDir,
    catalog: qualityCatalog(),
    fetchImpl: async () => {
      throw new Error('complete tokenizer must not download')
    },
    preferChina: false
  })
  const status = await manager.ensureReady(quality)
  assert.equal(status.ready, true)
  assert.equal(manager.pathByRole('asr-tokenizer', 'quality'), join(root, 'tokenizer'))
  const config = tryRecognizerConfig(manager, 'quality')
  assert.equal(
    (config?.modelConfig as { qwen3Asr?: { tokenizer?: string } } | undefined)?.qwen3Asr?.tokenizer,
    join(root, 'tokenizer')
  )
})

test('production pins reject a small tokenizer archive instead of marking it ready', async (t) => {
  const modelsDir = modelsDirFor(t)
  seedPartialTokenizer(modelsDir)
  writeMarker(modelsDir)
  const archived = goodArchive(t)
  const manager = new ModelManager({
    modelsDir,
    fetchImpl: fetching(() => archived).fetchImpl,
    preferChina: false,
    resolveUrls: () => [archiveUrl]
  })
  await assert.rejects(
    manager.ensureReady(quality),
    /incomplete model: tokenizer\/vocab\.json is truncated/
  )
  assert.match(manager.incompleteModelIssue('quality') ?? '', /Whisper Tiny/)
  assert.equal(manager.status(quality.groups, quality.tiers).ready, false)
  assert.equal(existsSync(markerPath(modelsDir)), false)
})

test('whisper archives are validated in staging before the extracted marker is written', async (t) => {
  const modelsDir = modelsDirFor(t)
  const whisperArchive = 'sherpa-onnx-whisper-tiny.tar.bz2'
  const whisperUrl = `https://models.example/${whisperArchive}`
  const root = join(modelsDir, WHISPER_TINY_DIR)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'tiny-encoder.int8.onnx'), 'partial-encoder')
  writeMarker(modelsDir, whisperArchive)
  const scratch = mkdtempSync(join(tmpdir(), 'vidbee-whisper-tar-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const packed = join(scratch, WHISPER_TINY_DIR)
  mkdirSync(packed, { recursive: true })
  writeFileSync(join(packed, 'tiny-encoder.int8.onnx'), 'encoder-bytes')
  writeFileSync(join(packed, 'tiny-decoder.int8.onnx'), 'decoder-bytes')
  writeFileSync(join(packed, 'tiny-tokens.txt'), 'tokens')
  writeFileSync(join(packed, 'tiny-encoder.onnx'), 'drop-fp32')
  const archivePath = join(scratch, whisperArchive)
  execFileSync('tar', ['-cjf', archivePath, '-C', scratch, WHISPER_TINY_DIR])
  const archived = readFileSync(archivePath)
  const manager = new ModelManager({
    modelsDir,
    fetchImpl: fetching(() => archived).fetchImpl,
    preferChina: false,
    resolveUrls: (spec) => [spec.fileName.startsWith(WHISPER_TINY_DIR) ? whisperUrl : spec.url]
  })
  const status = await manager.ensureReady({ groups: ['asr'], tiers: ['minimal'] })
  assert.equal(status.ready, true)
  assert.equal(readFileSync(join(root, 'tiny-encoder.int8.onnx'), 'utf8'), 'encoder-bytes')
  assert.equal(readFileSync(join(root, 'tiny-decoder.int8.onnx'), 'utf8'), 'decoder-bytes')
  assert.equal(readFileSync(join(root, 'tiny-tokens.txt'), 'utf8'), 'tokens')
  assert.equal(existsSync(join(root, 'tiny-encoder.onnx')), false)
  assert.equal(readFileSync(markerPath(modelsDir, whisperArchive), 'utf8'), 'ok')
  assert.equal(existsSync(`${join(modelsDir, '.downloads', whisperArchive)}.staging`), false)
})

test('incomplete model errors stay explicit for transcription', () => {
  const error = classifyTranscriptionFailure(
    new Error(`incomplete model: missing tokenizer/merges.txt. ${QWEN3_TOKENIZER_REPAIR_HINT}`)
  )
  assert.equal(error.category, 'binary-missing')
  assert.match(error.rawMessage, /incomplete model: missing tokenizer\/merges\.txt/)
  assert.match(error.rawMessage, /Whisper Tiny/)
})
