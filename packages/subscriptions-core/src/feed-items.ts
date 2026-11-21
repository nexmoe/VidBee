/**
 * Helpers for working with parsed RSS items: normalization, dedupe, and
 * thumbnail/cover extraction. All functions are pure — feeding the same
 * `ParsedFeedItem[]` always returns the same `NormalizedFeedItem[]`.
 */
import type { NormalizedFeedItem, ParsedFeed, ParsedFeedItem, SubscriptionFeedItem } from './types'

interface SubscriptionFeedSource {
  id: string
  items?: SubscriptionFeedItem[]
}

export interface SubscriptionFeedEntry<TSubscription extends SubscriptionFeedSource> {
  subscription: TSubscription
  item: NonNullable<TSubscription['items']>[number]
}

/** Merge subscription items into one newest-first timeline while retaining their source. */
export const getSubscriptionFeedEntries = <TSubscription extends SubscriptionFeedSource>(
  subscriptions: TSubscription[]
): SubscriptionFeedEntry<TSubscription>[] => {
  const entries: SubscriptionFeedEntry<TSubscription>[] = []
  for (const subscription of subscriptions) {
    for (const item of subscription.items ?? []) {
      entries.push({ subscription, item })
    }
  }
  return entries.sort((left, right) => right.item.publishedAt - left.item.publishedAt)
}

const resolveItemId = (item: ParsedFeedItem): string | null => {
  const candidate =
    item.youtubeId || item.guid || item.id || (typeof item.link === 'string' ? item.link : null)
  if (!candidate) {
    return null
  }
  return candidate.trim()
}

const resolvePublishedAt = (item: ParsedFeedItem, now: () => number): number => {
  for (const candidate of [item.isoDate, item.pubDate]) {
    if (!candidate) {
      continue
    }
    const ts = Date.parse(candidate)
    if (!Number.isNaN(ts)) {
      return ts
    }
  }
  return now()
}

const extractImageFromHtml = (html?: string): string | undefined => {
  if (!html) {
    return undefined
  }

  const srcMatch = html.match(
    /<img\b[^>]*\b(?:src|data-src|data-original)\b\s*=\s*(['"]?)([^'">\s]+)\1/i
  )
  if (srcMatch?.[2]) {
    return srcMatch[2]
  }

  const srcsetMatch = html.match(/<img[^>]+srcset\s*=\s*(['"])([^'"]+)\1/i)
  if (srcsetMatch?.[2]) {
    const firstCandidate = srcsetMatch[2].split(',')[0]?.trim().split(/\s+/)[0]
    if (firstCandidate) {
      return firstCandidate
    }
  }

  return undefined
}

/**
 * Read an iTunes-style image URL from a string or `{ href }` / `{ url }` object.
 *
 * Ximalaya and most podcast feeds use `<itunes:image href="..."/>` with no RSS
 * 2.0 `<image>` / `<media:thumbnail>`, so this is the primary cover source.
 *
 * @param image rss-parser `itunes.image` value
 */
const extractItunesImageUrl = (image: unknown): string | undefined => {
  if (typeof image === 'string') {
    const trimmed = image.trim()
    return trimmed || undefined
  }
  if (!image || typeof image !== 'object') {
    return undefined
  }
  const record = image as { href?: unknown; url?: unknown }
  if (typeof record.href === 'string' && record.href.trim()) {
    return record.href.trim()
  }
  if (typeof record.url === 'string' && record.url.trim()) {
    return record.url.trim()
  }
  return undefined
}

/**
 * Pick the best thumbnail for one feed item: iTunes episode artwork first,
 * then media/enclosure images, then an `<img>` extracted from HTML content.
 *
 * @param item Parsed rss-parser item
 */
export const resolveThumbnail = (item: ParsedFeedItem): string | undefined => {
  const itunesImageUrl = extractItunesImageUrl(item.itunes?.image)
  if (itunesImageUrl) {
    return itunesImageUrl
  }

  const thumbnail = item.mediaThumbnail
  if (Array.isArray(thumbnail)) {
    const found = thumbnail.find((entry) => entry?.url)
    if (found?.url) {
      return found.url
    }
  }
  if (thumbnail && typeof thumbnail === 'object' && 'url' in thumbnail) {
    return (thumbnail as { url?: string }).url
  }

  const enclosure = item.enclosure
  if (Array.isArray(enclosure)) {
    const imageEnclosure = enclosure.find(
      (entry) => entry?.url && entry?.type?.startsWith('image/')
    )
    if (imageEnclosure?.url) {
      return imageEnclosure.url
    }
  }
  if (enclosure && typeof enclosure === 'object' && 'url' in enclosure) {
    const enc = enclosure as { url?: string; type?: string }
    if (enc.url && enc.type?.startsWith('image/')) {
      return enc.url
    }
  }

  const mediaContent = item.mediaContent
  if (Array.isArray(mediaContent)) {
    const found = mediaContent.find((entry) => entry?.url)
    if (found?.url) {
      return found.url
    }
  }
  if (mediaContent && typeof mediaContent === 'object' && 'url' in mediaContent) {
    return (mediaContent as { url?: string }).url
  }

  for (const html of [
    item.content,
    item.contentEncoded,
    item.description,
    item.summary,
    item.contentSnippet
  ]) {
    const imageUrl = extractImageFromHtml(html)
    if (imageUrl) {
      return imageUrl
    }
  }

  return undefined
}

/**
 * Pick the best cover URL for a feed: explicit feed image first, then
 * iTunes-style image, then the first thumbnail we can extract from any item.
 */
export const resolveFeedCover = (
  feed: Pick<ParsedFeed, 'image' | 'itunes'>,
  items: NormalizedFeedItem[],
  rawItems: ParsedFeedItem[]
): string | undefined => {
  const feedImageUrl = typeof feed.image?.url === 'string' ? feed.image.url : undefined
  if (feedImageUrl) {
    return feedImageUrl
  }

  const itunesImageUrl = extractItunesImageUrl(feed.itunes?.image)
  if (itunesImageUrl) {
    return itunesImageUrl
  }

  const itemThumb = items.find((item) => item.thumbnail)?.thumbnail
  if (itemThumb) {
    return itemThumb
  }

  for (const item of rawItems) {
    const thumb = resolveThumbnail(item)
    if (thumb) {
      return thumb
    }
  }

  return undefined
}

export interface NormalizeOptions {
  now?: () => number
}

/**
 * Convert a list of parsed RSS items into the canonical normalized shape.
 * Items missing id / link / title are dropped silently. Output is sorted by
 * publishedAt descending so callers can take the head as "latest".
 */
export const normalizeFeedItems = (
  items: ParsedFeedItem[],
  options: NormalizeOptions = {}
): NormalizedFeedItem[] => {
  const now = options.now ?? (() => Date.now())
  const out: NormalizedFeedItem[] = []
  for (const item of items) {
    const id = resolveItemId(item)
    if (!(id && item.link && item.title)) {
      continue
    }
    out.push({
      id,
      url: item.link,
      title: item.title,
      publishedAt: resolvePublishedAt(item, now),
      thumbnail: resolveThumbnail(item)
    })
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt)
}

/**
 * Drop items whose stable id has already been seen earlier in the list,
 * preserving order. Used after `normalizeFeedItems` for upserts and again
 * before queue insertion to guarantee one-task-per-(subscription, itemId).
 */
export const dedupeFeedItems = <T extends { id: string }>(items: T[]): T[] => {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    out.push(item)
  }
  return out
}
