import type { GpuKind } from './asr-recommend'

export const SHERPA_EXECUTION_PROVIDERS = ['cpu', 'cuda', 'directml', 'coreml'] as const

export type SherpaExecutionProvider = (typeof SHERPA_EXECUTION_PROVIDERS)[number]

export interface SherpaProviderProbeResult {
  durationMs: number | null
  error: string | null
  ok: boolean
  provider: SherpaExecutionProvider
  stderr?: string
}

export interface SherpaProviderSelection {
  cacheable: boolean
  candidates: SherpaExecutionProvider[]
  provider: SherpaExecutionProvider
  reason: string
}

export interface SelectSherpaProviderInput {
  arch?: string
  gpuKinds?: readonly GpuKind[]
  platform?: NodeJS.Platform
  probe: (provider: SherpaExecutionProvider) => Promise<SherpaProviderProbeResult>
}

const CUDA_ARCHES = new Set(['arm64', 'x64'])
const MAX_ACCELERATOR_DURATION_RATIO = 0.95
const PROVIDER_FALLBACK_PATTERN =
  /fall(?:ing)? back to (?:the )?cpu|failed to .*?(?:coreml|cuda|directml|\bdml\b)|(?:coreml|cuda|directml|\bdml\b).*?(?:failed|not available|not compiled|not enabled|not supported|only available)/i
const MODEL_UNAVAILABLE_PATTERN = /probe model unavailable/i

/**
 * Detect sherpa-onnx logs that mean a requested provider silently used CPU instead.
 */
export const isSherpaProviderFallbackLog = (
  provider: SherpaExecutionProvider,
  text: string
): boolean => provider !== 'cpu' && PROVIDER_FALLBACK_PATTERN.test(text)

/**
 * Build a compatibility-first provider ladder for this OS, architecture, and GPU set.
 */
export const sherpaProviderCandidates = (input?: {
  arch?: string
  gpuKinds?: readonly GpuKind[]
  platform?: NodeJS.Platform
}): SherpaExecutionProvider[] => {
  const platform = input?.platform ?? process.platform
  const arch = input?.arch ?? process.arch
  const knownGpuKinds = new Set((input?.gpuKinds ?? []).filter((kind) => kind !== 'unknown'))
  const gpuInventoryKnown = knownGpuKinds.size > 0
  const canTryCuda = CUDA_ARCHES.has(arch) && (!gpuInventoryKnown || knownGpuKinds.has('nvidia'))

  if (platform === 'darwin') {
    return ['coreml', 'cpu']
  }
  if (platform === 'win32') {
    return canTryCuda ? ['cuda', 'directml', 'cpu'] : ['directml', 'cpu']
  }
  if (platform === 'linux' && canTryCuda) {
    return ['cuda', 'cpu']
  }
  return ['cpu']
}

/**
 * Run one isolated provider probe without leaking probe failures into selection.
 */
const safeProbe = async (
  provider: SherpaExecutionProvider,
  probe: SelectSherpaProviderInput['probe']
): Promise<SherpaProviderProbeResult> => {
  try {
    return await probe(provider)
  } catch (error) {
    return {
      durationMs: null,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      provider
    }
  }
}

/**
 * Try the preferred accelerator ladder, compare the first working option with CPU, and stop.
 */
export const selectSherpaProvider = async (
  input: SelectSherpaProviderInput
): Promise<SherpaProviderSelection> => {
  const candidates = sherpaProviderCandidates({
    arch: input.arch,
    gpuKinds: input.gpuKinds,
    platform: input.platform
  })
  if (candidates.length === 1 && candidates[0] === 'cpu') {
    return {
      cacheable: true,
      candidates,
      provider: 'cpu',
      reason: 'no-compatible-accelerator'
    }
  }

  const probes: SherpaProviderProbeResult[] = []
  let accelerator: SherpaProviderProbeResult | null = null
  for (const provider of candidates) {
    if (provider === 'cpu') {
      continue
    }
    const result = await safeProbe(provider, input.probe)
    probes.push(result)
    if (result.ok) {
      accelerator = result
      break
    }
  }
  const cpu = await safeProbe('cpu', input.probe)
  probes.push(cpu)

  const cacheable = !probes.some((probe) => MODEL_UNAVAILABLE_PATTERN.test(probe.error ?? ''))
  if (!accelerator) {
    return {
      cacheable,
      candidates,
      provider: 'cpu',
      reason: 'accelerator-probes-failed'
    }
  }

  const acceleratorDuration = accelerator.durationMs
  if (!(cpu.ok && cpu.durationMs && acceleratorDuration)) {
    return {
      cacheable,
      candidates,
      provider: accelerator.provider,
      reason: 'accelerator-verified-without-timing'
    }
  }

  if (acceleratorDuration >= cpu.durationMs * MAX_ACCELERATOR_DURATION_RATIO) {
    return {
      cacheable,
      candidates,
      provider: 'cpu',
      reason: 'cpu-faster-or-within-margin'
    }
  }

  return {
    cacheable,
    candidates,
    provider: accelerator.provider,
    reason: 'accelerator-faster'
  }
}
