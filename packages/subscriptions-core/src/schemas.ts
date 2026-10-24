/**
 * Zod schemas mirroring `./types.ts`. The oRPC `subscriptionContract` consumes
 * these directly so all three hosts (desktop / api / cli) agree byte-for-byte
 * on the input/output shapes.
 *
 * Keep these in lockstep with `./types.ts`.
 */
import {
  DownloadTypeSchema,
  OneClickContainerOptionSchema,
  OneClickQualityPresetSchema
} from '@vidbee/downloader-core/schemas'
import { z } from 'zod'

const subscriptionDownloadPreferences = {
  downloadType: DownloadTypeSchema.or(z.literal('subtitles')).optional(),
  downloadQuality: OneClickQualityPresetSchema.optional(),
  downloadContainer: OneClickContainerOptionSchema.optional()
}

export const SubscriptionPlatformSchema = z.enum(['youtube', 'bilibili', 'custom'])
export const SubscriptionStatusSchema = z.enum(['idle', 'checking', 'up-to-date', 'failed'])
export const LeaderKindSchema = z.enum(['desktop', 'api'])

export const ResolvedFeedSchema = z.object({
  sourceUrl: z.string().min(1),
  feedUrl: z.string().min(1),
  platform: SubscriptionPlatformSchema
})

export const SubscriptionRuleSchema = z.object({
  ...subscriptionDownloadPreferences,
  id: z.string(),
  title: z.string(),
  sourceUrl: z.string(),
  feedUrl: z.string(),
  platform: SubscriptionPlatformSchema,
  keywords: z.array(z.string()),
  tags: z.array(z.string()),
  onlyDownloadLatest: z.boolean(),
  autoDownload: z.boolean(),
  enabled: z.boolean(),
  coverUrl: z.string().optional(),
  latestVideoTitle: z.string().optional(),
  latestVideoPublishedAt: z.number().int().optional(),
  lastCheckedAt: z.number().int().optional(),
  lastSuccessAt: z.number().int().optional(),
  status: SubscriptionStatusSchema,
  lastError: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  downloadDirectory: z.string().optional(),
  namingTemplate: z.string().optional()
})

export const SubscriptionFeedItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  publishedAt: z.number().int(),
  thumbnail: z.string().optional(),
  addedToQueue: z.boolean(),
  taskId: z.string().optional()
})

export const SubscriptionWithItemsSchema = SubscriptionRuleSchema.extend({
  items: z.array(SubscriptionFeedItemSchema)
})

export const SubscriptionCreateInputSchema = z.object({
  ...subscriptionDownloadPreferences,
  sourceUrl: z.string().min(1),
  feedUrl: z.string().min(1),
  platform: SubscriptionPlatformSchema,
  title: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  onlyDownloadLatest: z.boolean().optional(),
  autoDownload: z.boolean().optional(),
  downloadDirectory: z.string().optional(),
  namingTemplate: z.string().optional(),
  enabled: z.boolean().optional()
})

export const SubscriptionUpdateInputSchema = z.object({
  ...subscriptionDownloadPreferences,
  title: z.string().optional(),
  sourceUrl: z.string().optional(),
  feedUrl: z.string().optional(),
  platform: SubscriptionPlatformSchema.optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  onlyDownloadLatest: z.boolean().optional(),
  autoDownload: z.boolean().optional(),
  enabled: z.boolean().optional(),
  downloadDirectory: z.string().optional(),
  namingTemplate: z.string().optional()
})

export const SubscriptionIdInputSchema = z.object({ id: z.string().min(1) })
export const ResolveInputSchema = z.object({ rawUrl: z.string().min(1) })
export const RefreshInputSchema = z.object({ id: z.string().min(1) })
export const ItemsListInputSchema = z.object({
  subscriptionId: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional()
})
export const ItemsQueueInputSchema = z.object({
  subscriptionId: z.string().min(1),
  itemId: z.string().min(1)
})

export const SubscriptionListOutputSchema = z.object({
  items: z.array(SubscriptionWithItemsSchema),
  total: z.number().int().nonnegative()
})

export const SubscriptionItemsListOutputSchema = z.object({
  items: z.array(SubscriptionFeedItemSchema),
  total: z.number().int().nonnegative()
})

export const ItemsQueueOutputSchema = z.object({
  queued: z.boolean(),
  taskId: z.string().nullable()
})

export const VoidOutputSchema = z.object({})

export const LeaderStateSchema = z.object({
  kind: LeaderKindSchema.nullable(),
  pid: z.number().int().nullable(),
  startedAt: z.number().int().nullable(),
  heartbeatAt: z.number().int().nullable(),
  lockExpiresAt: z.number().int().nullable(),
  leaseId: z.string().nullable(),
  preferred: LeaderKindSchema.nullable()
})
