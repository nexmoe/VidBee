import {
  buildAudioFormatPreference as buildSharedAudioFormatPreference,
  buildVideoFormatPreference as buildSharedVideoFormatPreference
} from '@vidbee/downloader-core/format-preferences'
import type { AppSettings } from '../types'

type QualityPreferenceSettings = Pick<AppSettings, 'oneClickQuality'>

export const buildVideoFormatPreference = (settings: QualityPreferenceSettings): string =>
  buildSharedVideoFormatPreference({ oneClickQuality: settings.oneClickQuality })

export const buildAudioFormatPreference = (settings: QualityPreferenceSettings): string =>
  buildSharedAudioFormatPreference({ oneClickQuality: settings.oneClickQuality })
