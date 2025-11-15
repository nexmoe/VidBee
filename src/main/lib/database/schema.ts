import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const downloadHistoryTable = sqliteTable('download_history', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  thumbnail: text('thumbnail'),
  type: text('type').notNull(),
  status: text('status').notNull(),
  downloadPath: text('download_path'),
  savedFileName: text('saved_file_name'),
  fileSize: integer('file_size', { mode: 'number' }),
  duration: integer('duration', { mode: 'number' }),
  downloadedAt: integer('downloaded_at', { mode: 'number' }).notNull(),
  completedAt: integer('completed_at', { mode: 'number' }),
  sortKey: integer('sort_key', { mode: 'number' }).notNull(),
  error: text('error'),
  description: text('description'),
  channel: text('channel'),
  uploader: text('uploader'),
  viewCount: integer('view_count', { mode: 'number' }),
  tags: text('tags'),
  origin: text('origin'),
  subscriptionId: text('subscription_id'),
  selectedFormat: text('selected_format'),
  playlistId: text('playlist_id'),
  playlistTitle: text('playlist_title'),
  playlistIndex: integer('playlist_index', { mode: 'number' }),
  playlistSize: integer('playlist_size', { mode: 'number' })
})

export const subscriptionsTable = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sourceUrl: text('source_url').notNull(),
  feedUrl: text('feed_url').notNull(),
  platform: text('platform').notNull(),
  keywords: text('keywords').notNull(),
  tags: text('tags').notNull(),
  onlyDownloadLatest: integer('only_latest', { mode: 'number' }).notNull(),
  enabled: integer('enabled', { mode: 'number' }).notNull(),
  coverUrl: text('cover_url'),
  latestVideoTitle: text('latest_video_title'),
  latestVideoPublishedAt: integer('latest_video_published_at', { mode: 'number' }),
  lastCheckedAt: integer('last_checked_at', { mode: 'number' }),
  lastSuccessAt: integer('last_success_at', { mode: 'number' }),
  status: text('status').notNull(),
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  downloadDirectory: text('download_directory'),
  namingTemplate: text('naming_template')
})

export const subscriptionItemsTable = sqliteTable(
  'subscription_items',
  {
    subscriptionId: text('subscription_id').notNull(),
    itemId: text('item_id').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    publishedAt: integer('published_at', { mode: 'number' }).notNull(),
    thumbnail: text('thumbnail'),
    added: integer('added', { mode: 'number' }).notNull(),
    downloadId: text('download_id'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull()
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.subscriptionId, table.itemId],
      name: 'subscription_items_pk'
    }),
    subscriptionIdx: index('subscription_items_subscription_idx').on(table.subscriptionId)
  })
)

export type DownloadHistoryRow = typeof downloadHistoryTable.$inferSelect
export type DownloadHistoryInsert = typeof downloadHistoryTable.$inferInsert
export type SubscriptionRow = typeof subscriptionsTable.$inferSelect
export type SubscriptionInsert = typeof subscriptionsTable.$inferInsert
export type SubscriptionItemRow = typeof subscriptionItemsTable.$inferSelect
export type SubscriptionItemInsert = typeof subscriptionItemsTable.$inferInsert
