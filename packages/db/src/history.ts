import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  ytDlpCommand: text('yt_dlp_command'),
  ytDlpLog: text('yt_dlp_log'),
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

export type DownloadHistoryRow = typeof downloadHistoryTable.$inferSelect
export type DownloadHistoryInsert = typeof downloadHistoryTable.$inferInsert
