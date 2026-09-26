/**
 * Drizzle schema mirror of the subscription tables.
 *
 * Authoritative spec: NEX-132 (RSS 全栈) — Phase A 共享 schema。
 *
 * Three tables:
 *   - subscriptions          — one row per RSS subscription rule
 *   - subscription_items     — feed items pulled from each subscription
 *   - subscriptions_meta     — workspace-level metadata, including the
 *                              feed-check leader lock (§ Phase A · leader 选举)
 *
 * Both Desktop (`apps/desktop`) and the Web/API host (`apps/api`) point at the
 * same SQLite file in shared deployments and at separate files in standalone
 * deployments. The schema must be identical in both worlds, which is why it
 * lives here next to the task-queue schema rather than inside any host.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const subscriptionsTable = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sourceUrl: text('source_url').notNull(),
  feedUrl: text('feed_url').notNull(),
  platform: text('platform').notNull(),
  /** JSON array of strings. */
  keywords: text('keywords').notNull(),
  /** JSON array of strings. */
  tags: text('tags').notNull(),
  onlyDownloadLatest: integer('only_latest', { mode: 'number' }).notNull(),
  autoDownload: integer('auto_download', { mode: 'number' }).notNull(),
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
    /** 1 while the item is linked to a task that still exists. */
    added: integer('added', { mode: 'number' }).notNull(),
    /** Task id while the item is queued. Null after that task is removed. */
    taskId: text('task_id'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.subscriptionId, table.itemId],
      name: 'subscription_items_pk'
    }),
    index('idx_subscription_items_sub').on(table.subscriptionId),
    index('idx_subscription_items_task').on(table.taskId)
  ]
)

/**
 * Workspace-scoped key/value store for subscription-related metadata.
 *
 * Reserved keys (see NEX-132 Phase A · feed-check leader 选举):
 *   - `leader_kind`           — 'desktop' | 'api'
 *   - `leader_pid`            — INTEGER
 *   - `leader_started_at`     — INTEGER (epoch ms)
 *   - `leader_heartbeat_at`   — INTEGER (epoch ms)
 *   - `leader_lock_expires_at`— INTEGER (epoch ms; lock TTL = heartbeat + 90s)
 *   - `leader_lease_id`       — TEXT (random per acquisition; CAS guard)
 *   - `preferred_leader`      — 'desktop' | 'api' (operator override)
 *
 * Storing all of these as flat key/value rows lets us upgrade the lease shape
 * without DDL changes; CAS is implemented by reading + writing inside a single
 * transaction in `LeaderElection`.
 */
export const subscriptionsMetaTable = sqliteTable('subscriptions_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull()
})

export type SubscriptionRow = typeof subscriptionsTable.$inferSelect
export type SubscriptionInsert = typeof subscriptionsTable.$inferInsert
export type SubscriptionItemRow = typeof subscriptionItemsTable.$inferSelect
export type SubscriptionItemInsert = typeof subscriptionItemsTable.$inferInsert
export type SubscriptionsMetaRow = typeof subscriptionsMetaTable.$inferSelect
export type SubscriptionsMetaInsert = typeof subscriptionsMetaTable.$inferInsert

/**
 * Raw SQL applied on a fresh subscriptions DB. Hosts that share a file with
 * the task-queue schema run this *after* TASK_QUEUE_DDL_V1; standalone
 * subscription databases run it on its own.
 *
 * The migration is idempotent (`CREATE TABLE IF NOT EXISTS`) and writes a
 * `('subscriptions_version', '1')` row into `schema_meta` if that table
 * exists, otherwise into `subscriptions_meta` so we still have a version
 * marker on subscription-only databases.
 */
export const SUBSCRIPTIONS_DDL_V1 = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id                          TEXT PRIMARY KEY,
  title                       TEXT NOT NULL,
  source_url                  TEXT NOT NULL,
  feed_url                    TEXT NOT NULL,
  platform                    TEXT NOT NULL,
  keywords                    TEXT NOT NULL,
  tags                        TEXT NOT NULL,
  only_latest                 INTEGER NOT NULL,
  enabled                     INTEGER NOT NULL,
  cover_url                   TEXT,
  latest_video_title          TEXT,
  latest_video_published_at   INTEGER,
  last_checked_at             INTEGER,
  last_success_at             INTEGER,
  status                      TEXT NOT NULL,
  last_error                  TEXT,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL,
  download_directory          TEXT,
  naming_template             TEXT
);

CREATE TABLE IF NOT EXISTS subscription_items (
  subscription_id   TEXT NOT NULL,
  item_id           TEXT NOT NULL,
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  published_at      INTEGER NOT NULL,
  thumbnail         TEXT,
  added             INTEGER NOT NULL,
  task_id           TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (subscription_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_subscription_items_sub  ON subscription_items(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_items_task ON subscription_items(task_id);

CREATE TABLE IF NOT EXISTS subscriptions_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

INSERT INTO subscriptions_meta (key, value, updated_at)
  VALUES ('subscriptions_version', '1', 0)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value;
`

/**
 * Existing databases created with `SUBSCRIPTIONS_DDL_V1` lack `auto_download`.
 * Default 1 keeps current auto-queue behavior for already-saved subscriptions.
 */
export const SUBSCRIPTIONS_DDL_V2 = `
ALTER TABLE subscriptions ADD COLUMN auto_download INTEGER NOT NULL DEFAULT 1;
`

/**
 * Apply subscription DDL and additive column migrations. `columns` is the
 * current `PRAGMA table_info(subscriptions)` name list (empty when the table
 * does not exist yet). Idempotent.
 *
 * @param exec SQLite exec callback used by the host.
 * @param columns Existing `subscriptions` column names.
 */
export const applySubscriptionsMigrations = (
  exec: (sql: string) => void,
  columns: string[]
): void => {
  exec(SUBSCRIPTIONS_DDL_V1)
  if (!columns.includes('auto_download')) {
    exec(SUBSCRIPTIONS_DDL_V2)
  }
}
