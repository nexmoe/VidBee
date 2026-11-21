/**
 * Build the task-queue input for a desktop subscription item.
 *
 * Scheduled feed checks and manual feed downloads share this builder so both
 * snapshot the same runtime settings as a one-off download. The desktop
 * executor has no default runtime settings. GitHub issue #475.
 */
import { resolveSubtitleLanguages } from '@vidbee/downloader-core/subtitle-languages'
import { buildSubscriptionDownloadOptions } from '@vidbee/subscriptions-core/download-options'
import type { SubscriptionDownloadPreferences } from '@vidbee/subscriptions-core/types'
import type { TaskCreationMetadata, TaskInput } from '@vidbee/task-queue'
import type { AppSettings } from '../../shared/types'
import { sanitizeFilenameTemplate, toSharedSettings } from '../download-engine/args-builder'

export interface SubscriptionDownloadSource extends SubscriptionDownloadPreferences {
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

/** Snapshot subscription format overrides and global runtime settings into a queued task. */
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
  const tags = Array.from(new Set([input.subscription.platform, ...input.subscription.tags]))
  const downloadOptions = buildSubscriptionDownloadOptions(input.subscription, input.settings)

  return {
    downloadDirectory,
    task: {
      url: input.item.url,
      kind: downloadOptions.type === 'subtitles' ? 'subtitles' : 'subscription-item',
      title: input.item.title,
      ...(input.item.thumbnail === undefined ? {} : { thumbnail: input.item.thumbnail }),
      subscriptionId: input.subscription.id,
      options: {
        ...downloadOptions,
        ...(downloadOptions.type === 'subtitles'
          ? {
              languages: resolveSubtitleLanguages(
                input.settings.subtitleLanguages,
                input.settings.language
              )
            }
          : {}),
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
