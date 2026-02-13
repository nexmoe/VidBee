import type { AppSettings, OneClickQualityPreset } from '../types'

const qualityPresetToVideoHeight: Record<OneClickQualityPreset, number | null> = {
  best: null,
  good: 1080,
  normal: 720,
  bad: 480,
  worst: 360
}

const qualityPresetToAudioAbr: Record<OneClickQualityPreset, number | null> = {
  best: 320,
  good: 256,
  normal: 192,
  bad: 128,
  worst: 96
}

const dedupe = (candidates: Array<string | undefined>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    if (seen.has(candidate)) {
      continue
    }
    seen.add(candidate)
    result.push(candidate)
  }
  return result
}

const getQualityPreset = (settings: AppSettings): OneClickQualityPreset =>
  settings.oneClickQuality ?? 'best'

const buildAudioSelectors = (preset: OneClickQualityPreset): string[] => {
  if (preset === 'worst') {
    return dedupe(['worstaudio', 'bestaudio'])
  }

  const abrLimit = qualityPresetToAudioAbr[preset]
  return dedupe([abrLimit ? `bestaudio[abr<=${abrLimit}]` : undefined, 'bestaudio'])
}

export const buildVideoFormatPreference = (settings: AppSettings): string => {
  const preset = getQualityPreset(settings)

  if (preset === 'worst') {
    return 'worstvideo+worstaudio/worst/best'
  }

  const maxHeight = qualityPresetToVideoHeight[preset]
  const videoCandidates = dedupe([
    maxHeight ? `bestvideo[height<=${maxHeight}]` : undefined,
    'bestvideo'
  ])

  const audioSelectors = buildAudioSelectors(preset)
  const combinations: string[] = []

  for (const video of videoCandidates) {
    for (const audio of audioSelectors) {
      combinations.push(`${video}+${audio}`)
    }
  }

  if (audioSelectors.includes('none')) {
    for (const video of videoCandidates) {
      combinations.push(video)
    }
  } else {
    combinations.push('bestvideo+bestaudio')
  }

  combinations.push('best')

  return dedupe(combinations).join('/')
}

export const buildAudioFormatPreference = (settings: AppSettings): string => {
  const selectors = buildAudioSelectors(getQualityPreset(settings))
  return dedupe([...selectors, 'best']).join('/')
}
