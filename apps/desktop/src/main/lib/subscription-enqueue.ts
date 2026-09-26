/**
 * Build the task-queue input for a desktop subscription item.
 *
 * Scheduled feed checks and manual feed downloads share this builder so both
 * snapshot the same runtime settings as a one-off download. The desktop
 * executor has no default runtime settings. GitHub issue #475.
 */
import type { TaskCreationMetadata, TaskInput } from '@vidbee/task-queue'
import type { AppSettings } from '../../shared/types'
import {
  buildAudioFormatPreference,
  buildVideoFormatPreference
} from '../../shared/utils/format-preferences'
import { sanitizeFilenameTemplate, toSharedSettings } from '../download-engine/args-builder'

export interface SubscriptionDownloadSource {
  id: string
  platform: string
  tags: readonly string[]
  downloadDirectory?: string
  namingTemplate?: string
}

export interface SubscriptionDownloadItem {
  id: string
  url: string
  title: string
  thumbnail?: string
}

export interface DesktopSubscriptionTaskInput {
  task: TaskInput
  downloadDirectory: string
}

export const buildDesktopSubscriptionTaskInput = (input: {
  settings: AppSettings
  subscription: SubscriptionDownloadSource
  item: SubscriptionDownloadItem
  trigger: 'auto' | 'manual'
  creation?: TaskCreationMetadata
}): DesktopSubscriptionTaskInput => {
  const downloadDirectory =
    input.subscription.downloadDirectory?.trim() || input.settings.downloadPath
  const namingTemplate = input.subscription.namingTemplate
    ? sanitizeFilenameTemplate(input.subscription.namingTemplate)
    : undefined
  const downloadType = input.settings.oneClickDownloadType ?? 'video'
  const formatPreference =
    downloadType === 'video'
      ? buildVideoFormatPreference(input.settings)
      : buildAudioFormatPreference(input.settings)
  const containerFormat =
    downloadType === 'video' ? (input.settings.oneClickContainer ?? 'auto') : undefined
  const tags = Array.from(new Set([input.subscription.platform, ...input.subscription.tags]))

  return {
    downloadDirectory,
    task: {
      url: input.item.url,
      kind: 'subscription-item',
      title: input.item.title,
      ...(input.item.thumbnail === undefined ? {} : { thumbnail: input.item.thumbnail }),
      subscriptionId: input.subscription.id,
      options: {
        type: downloadType,
        format: formatPreference,
        ...(containerFormat === undefined ? {} : { containerFormat }),
        customDownloadPath: downloadDirectory,
        ...(namingTemplate ? { customFilenameTemplate: namingTemplate } : {}),
        tags,
        origin: input.trigger === 'auto' ? 'subscription' : 'manual',
        ...(input.creation ?? {}),
        subscriptionId: input.subscription.id,
        itemId: input.item.id,
        settings: toSharedSettings(input.settings)
      }
    }
  }
}
