import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { ModelManagerOptions } from '@vidbee/transcription'
import { ModelManager, sherpaWorkerEnv } from '@vidbee/transcription'
import { DEFAULT_TTS_MODEL_ID, type TtsModelId } from '../../shared/tts-models'
import { runAgentMediaProcess } from './agent-media'
import {
  installedSpeechInfo,
  requireSpeechModel,
  type SpeechAsset,
  speechModelCatalog,
  speechModelsDirectory,
  speechReleaseAssets
} from './local-speech-catalog'
import { localSpeechConfig, speechModelEntries, speechModelReferences } from './local-speech-config'
import type { LocalSpeechRequest } from './local-speech-worker'
import { resolveWorkerBundle } from './transcription-worker-path'

const VERSION = createRequire(import.meta.url)('sherpa-onnx-node/package.json').version as string
const SEPARATION = 'sherpa-onnx-spleeter-2stems-fp16'
type ModelFileSpec = NonNullable<ModelManagerOptions['catalog']>[number]
const ARCHIVE_DIGESTS: Record<string, string> = {
  'sherpa-onnx-v1.13.8-osx-arm64-shared.tar.bz2':
    'b10e5c7e2c30ea03de9c442655d14860d9edc475c6251d58a8f5f06e913a1d56',
  'sherpa-onnx-v1.13.8-osx-x64-shared.tar.bz2':
    '54aad64acee9d2d596535a6080d6f22602a720af5460e1d50461b1e1b06bee40',
  'sherpa-onnx-v1.13.8-linux-x64-shared.tar.bz2':
    'c0bdb7907d3a74bba1d55d22bf4d9fa75586cf1530614ebe88a27b9118e015c4',
  'sherpa-onnx-v1.13.8-linux-aarch64-shared-cpu.tar.bz2':
    '4e3734f82bc1379fd91f219f5869c7e9d03b7a4f7561907d8abca4849c51a789',
  'sherpa-onnx-v1.13.8-win-x64-shared-MD-Release.tar.bz2':
    '3e971a04b2e0ba4dfa53d381a006367ce8c9f5f09b4ae00043e9845c2baded22',
  'sherpa-onnx-v1.13.8-win-arm64-shared-MD-Release.tar.bz2':
    '40fd749779c41e357c4a1382b071970999d4828ceb50b133b1643878ca08ead8',
  'sherpa-onnx-spleeter-2stems-fp16.tar.bz2':
    'd54561979bd2e08a51e7dbd99ac36bb47564e089eefd403636dbca93e811bba2'
}

/** Describe one required member of a checksum-pinned publisher archive. */
function speechArchiveMember(directory: string, file: string, release: string): ModelFileSpec {
  return {
    id: file ? `${directory}/${file}` : directory,
    role: 'speech',
    group: 'speech',
    required: true,
    fileName: file ? `${directory}/${file}` : directory,
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/${release}/${directory}.tar.bz2`
  }
}

/** Advertise usable local models and their actual cache state without starting a download. */
export async function localSpeechModels(
  signal: AbortSignal,
  options: {
    modelId?: string
    query?: string
    language?: string
    family?: string
    offset?: number
    limit?: number
    refresh?: boolean
  } = {}
) {
  const catalog = await speechModelCatalog(signal, options.refresh)
  const query = options.query?.toLowerCase()
  const matches = catalog.filter(
    (model) =>
      (!options.modelId || model.id === options.modelId) &&
      (!query || `${model.id} ${model.name} ${model.family}`.toLowerCase().includes(query)) &&
      (!options.language ||
        model.languages.some((language) => language.code === options.language)) &&
      (!options.family || model.family === options.family)
  )
  const offset = options.offset ?? 0
  const models = matches.slice(offset, offset + (options.limit ?? 15)).map((model) => {
    const directory = path.join(speechModelsDirectory(), model.id)
    let installed = false
    let voices = model.voiceCount ? { min: 0, max: model.voiceCount - 1 } : null
    try {
      localSpeechConfig({ modelId: model.id, model: directory, chineseRules: false })
      installed = true
      const info = installedSpeechInfo(model.id)
      if (info && info.voiceCount > 0) {
        voices = { min: 0, max: info.voiceCount - 1 }
      }
    } catch {
      /* Missing weights or inference metadata remain visible as unprepared models. */
    }
    return {
      id: model.id,
      name: model.name,
      family: model.family,
      description: model.description,
      languages: model.languages,
      voices,
      downloadBytes: model.downloadBytes,
      installed,
      referenceRequired: model.family === 'pocket' || model.family === 'zipvoice',
      referenceTextRequired: model.family === 'zipvoice',
      references: installed ? speechModelReferences(directory) : [],
      source: 'https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models'
    }
  })
  return {
    total: matches.length,
    catalogTotal: catalog.length,
    models,
    nextOffset: offset + models.length < matches.length ? offset + models.length : null
  }
}

/** Verify publisher archives while streaming; truncated or changed assets never reach extraction. */
async function fetchSpeechArchive(
  url: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  signal: AbortSignal,
  assets: Map<string, SpeechAsset>
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal
  })
  if (!(response.ok && response.body) || init?.method === 'HEAD') {
    return response
  }
  const name =
    new URL(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).pathname
      .split('/')
      .at(-1) ?? ''
  const asset = assets.get(name)
  const expected = asset?.sha256 ?? ARCHIVE_DIGESTS[name]
  if (!(asset || expected)) {
    throw new Error('Unknown local speech archive')
  }
  const hash = createHash('sha256')
  let bytes = 0
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      /** Keep verification bounded to one streamed network chunk. */
      transform(chunk, controller) {
        hash.update(chunk)
        bytes += chunk.length
        controller.enqueue(chunk)
      },
      /** Reject altered or incomplete archives before the downloader publishes them. */
      flush() {
        const digest = hash.digest('hex')
        if ((expected && digest !== expected) || (asset && bytes !== asset.size)) {
          throw new Error(`Local speech archive checksum mismatch: ${name}`)
        }
      }
    })
  )
  return new Response(body, { status: response.status, headers: response.headers })
}

/** Resolve the optional separation CLI matching the bundled native addon's version. */
export function speechRuntimeName(platform = process.platform, arch = process.arch): string {
  const platforms: Record<string, string> = {
    'darwin:arm64': 'osx-arm64-shared',
    'darwin:x64': 'osx-x64-shared',
    'linux:arm64': 'linux-aarch64-shared-cpu',
    'linux:x64': 'linux-x64-shared',
    'win32:arm64': 'win-arm64-shared-MD-Release',
    'win32:x64': 'win-x64-shared-MD-Release'
  }
  const target = platforms[`${platform}:${arch}`]
  if (!target) {
    throw new Error(`Local speech is unavailable on ${platform}/${arch}`)
  }
  return `sherpa-onnx-v${VERSION}-${target}`
}

/** Fetch only the requested local speech assets using the existing atomic model downloader. */
export async function prepareLocalSpeech(
  signal: AbortSignal,
  separate: boolean,
  onProgress: (text: string) => void,
  modelId: TtsModelId = DEFAULT_TTS_MODEL_ID
) {
  signal.throwIfAborted()
  const definition = await requireSpeechModel(modelId, signal)
  const executableSuffix = process.platform === 'win32' ? '.exe' : ''
  const catalog = [speechArchiveMember(modelId, '', 'tts-models')]
  const assets = new Map<string, SpeechAsset>([
    [
      `${modelId}.tar.bz2`,
      {
        name: `${modelId}.tar.bz2`,
        size: definition.downloadBytes,
        sha256: definition.sha256,
        release: 'tts-models'
      }
    ]
  ])
  if (separate) {
    const runtime = speechRuntimeName()
    catalog.push(
      speechArchiveMember(
        runtime,
        `bin/sherpa-onnx-offline-source-separation${executableSuffix}`,
        `v${VERSION}`
      ),
      speechArchiveMember(runtime, 'lib', `v${VERSION}`)
    )
    for (const file of ['vocals.fp16.onnx', 'accompaniment.fp16.onnx']) {
      catalog.push(speechArchiveMember(SEPARATION, file, 'source-separation-models'))
    }
  }
  const modelsDir = speechModelsDirectory()
  const manager = new ModelManager({
    modelsDir,
    catalog,
    /** Tie every network request to this run without cancelling unrelated ASR model downloads. */
    fetchImpl: (url, init) => fetchSpeechArchive(url, init, signal, assets),
    /** Reject incomplete native layouts while the archive is still in isolated staging. */
    afterArchiveStaged(staging) {
      const staged = path.join(staging, modelId)
      if (existsSync(staged)) {
        localSpeechConfig({ modelId, model: staged, chineseRules: false })
      }
    }
  })
  const unsubscribe = manager.subscribe((status) => {
    const download = status.downloading
    const received = download ? `${(download.received / 1_048_576).toFixed(1)} MB` : ''
    const total = download?.total ? ` / ${(download.total / 1_048_576).toFixed(1)} MB` : ''
    onProgress(`Preparing local speech models${received ? `: ${received}${total}` : ''}`)
  })
  const model = path.join(modelsDir, modelId)
  let vocoder: string | undefined
  let dataDir: string | undefined
  try {
    await manager.ensureReady({ groups: ['speech'] })
    const entries = speechModelEntries(model)
    if (definition.family === 'matcha' || definition.family === 'zipvoice') {
      const bundled = entries.find((file) => /(?:vocos|vocoder|hifigan).*\.onnx$/.test(file))
      if (bundled) {
        vocoder = path.join(model, bundled)
      } else {
        const name = definition.family === 'matcha' ? 'vocos-22khz-univ.onnx' : 'vocos_24khz.onnx'
        const asset = (await speechReleaseAssets('vocoder-models', signal)).find(
          (candidate) => candidate.name === name
        )
        if (!asset) {
          throw new Error(`Official TTS vocoder is unavailable: ${name}`)
        }
        assets.set(name, asset)
        vocoder = path.join(modelsDir, 'vocoders', name)
        catalog.push({
          id: name,
          role: 'speech',
          group: 'speech',
          required: true,
          fileName: `vocoders/${name}`,
          url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/${name}`,
          sha256: asset.sha256
        })
      }
    }
    const needsPhonemizer =
      ['vits', 'kokoro', 'kitten', 'matcha', 'zipvoice'].includes(definition.family) &&
      !entries.some((file) => /^lexicon.*\.txt$/.test(file))
    if (!entries.includes('espeak-ng-data') && needsPhonemizer) {
      const asset = (await speechReleaseAssets('tts-models', signal)).find(
        (candidate) => candidate.name === 'espeak-ng-data.tar.bz2'
      )
      if (!asset) {
        throw new Error('Official phonemizer data is unavailable')
      }
      assets.set(asset.name, asset)
      catalog.push(speechArchiveMember('espeak-ng-data', '', 'tts-models'))
      dataDir = path.join(modelsDir, 'espeak-ng-data')
    }
    await manager.ensureReady({ groups: ['speech'] })
    localSpeechConfig({ modelId, model, vocoder, dataDir, chineseRules: false })
  } finally {
    unsubscribe()
  }
  signal.throwIfAborted()
  if (!separate) {
    return { modelId, model, vocoder, dataDir, family: definition.family, separator: null }
  }
  const runtime = path.join(modelsDir, speechRuntimeName())
  const separator = path.join(
    runtime,
    'bin',
    `sherpa-onnx-offline-source-separation${executableSuffix}`
  )
  if (process.platform !== 'win32') {
    await chmod(separator, 0o755)
  }
  const library = path.join(runtime, 'lib')
  return {
    separator,
    modelId,
    model,
    vocoder,
    dataDir,
    family: definition.family,
    separation: path.join(modelsDir, SEPARATION),
    env: {
      ...process.env,
      DYLD_LIBRARY_PATH: [library, process.env.DYLD_LIBRARY_PATH]
        .filter(Boolean)
        .join(path.delimiter),
      LD_LIBRARY_PATH: [library, process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter),
      PATH: [path.dirname(separator), library, process.env.PATH]
        .filter(Boolean)
        .join(path.delimiter)
    }
  }
}

/** Generate all raw cues in one bounded worker so the selected model loads only once. */
export async function synthesizeLocalSpeech(input: {
  modelId?: TtsModelId
  model: string
  vocoder?: string
  dataDir?: string
  language?: string
  reference?: LocalSpeechRequest['reference']
  cues: LocalSpeechRequest['cues']
  maxSpeed: number
  directory: string
  voice: number
  lang?: string
  chineseRules: boolean
  signal: AbortSignal
  onProgress: (text: string) => void
}) {
  input.signal.throwIfAborted()
  const request: LocalSpeechRequest = {
    modelId: input.modelId ?? DEFAULT_TTS_MODEL_ID,
    model: input.model,
    vocoder: input.vocoder,
    dataDir: input.dataDir,
    language: input.language,
    reference: input.reference,
    cues: input.cues,
    maxSpeed: input.maxSpeed,
    voice: input.voice,
    lang: input.lang,
    chineseRules: input.chineseRules
  }
  const file = path.join(input.directory, 'speech-request.json')
  await writeFile(file, JSON.stringify(request))
  let pending = ''
  let metadata: { voiceCount: number; sampleRate: number } | undefined
  await runAgentMediaProcess(
    process.execPath,
    [resolveWorkerBundle(import.meta.dirname, 'speech-worker'), file],
    {
      directory: input.directory,
      signal: input.signal,
      env: sherpaWorkerEnv(),
      timeoutMs: 50 * 60 * 1000,
      idleTimeoutMs: 120_000,
      maxBytes: 8_000_000_000,
      /** Frame progress across pipe chunks without retaining unbounded native output. */
      onStdout(text) {
        pending = (pending + text).slice(-8192)
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('speech_metadata=')) {
            metadata = JSON.parse(line.slice('speech_metadata='.length))
          }
          const progress = /^speech_progress=(\d+)\/(\d+)$/.exec(line)
          if (progress) {
            input.onProgress(`Generating speech ${progress[1]}/${progress[2]}`)
          }
        }
      }
    }
  )
  if (metadata) {
    await writeFile(path.join(input.model, 'speech-info.json'), JSON.stringify(metadata))
  }
}
