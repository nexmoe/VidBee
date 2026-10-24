import {
  buildAudioFormatPreference,
  buildVideoFormatPreference,
  type OneClickContainerOption,
  type OneClickQualityPreset
} from '@vidbee/downloader-core/format-preferences'
import type { SubscriptionDownloadPreferences } from './types'

interface SubscriptionDownloadDefaults {
  oneClickDownloadType?: 'video' | 'audio'
  oneClickQuality?: OneClickQualityPreset
  oneClickContainer?: OneClickContainerOption
}

/** Resolve subscription overrides into executor options for automatic and manual downloads. */
export const buildSubscriptionDownloadOptions = (
  subscription: SubscriptionDownloadPreferences,
  defaults: SubscriptionDownloadDefaults
):
  | { type: 'subtitles'; format: 'srt' }
  | { type: 'video' | 'audio'; format: string; containerFormat?: OneClickContainerOption } => {
  const type = subscription.downloadType ?? defaults.oneClickDownloadType ?? 'video'
  if (type === 'subtitles') {
    return { type, format: 'srt' }
  }
  const settings = {
    oneClickQuality: subscription.downloadQuality ?? defaults.oneClickQuality ?? 'best'
  }
  if (type === 'audio') {
    return { type, format: buildAudioFormatPreference(settings) }
  }
  return {
    type,
    format: buildVideoFormatPreference(settings),
    containerFormat: subscription.downloadContainer ?? defaults.oneClickContainer ?? 'auto'
  }
}
