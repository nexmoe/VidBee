import {
  buildAudioFormatPreference as buildSharedAudioFormatPreference,
  buildVideoFormatPreference as buildSharedVideoFormatPreference
} from '@vidbee/downloader-core/format-preferences'
import type { AppSettings } from '../types'

export const buildVideoFormatPreference = (settings: AppSettings): string =>
  buildSharedVideoFormatPreference({ oneClickQuality: settings.oneClickQuality })

export const buildAudioFormatPreference = (settings: AppSettings): string =>
  buildSharedAudioFormatPreference({ oneClickQuality: settings.oneClickQuality })
