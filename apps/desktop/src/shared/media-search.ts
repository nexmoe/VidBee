import type { DownloadItem } from './types'

type MediaSearchRecord = Pick<
  DownloadItem,
  | 'title'
  | 'url'
  | 'savedFileName'
  | 'channel'
  | 'uploader'
  | 'playlistTitle'
  | 'description'
  | 'tags'
>

/** Keep the palette and MCP metadata query on the same authoritative fields. */
export function mediaSearchText(record: MediaSearchRecord): string {
  return [
    record.title,
    record.savedFileName,
    record.url,
    record.channel,
    record.uploader,
    record.playlistTitle,
    record.description,
    ...(record.tags ?? [])
  ]
    .filter(Boolean)
    .join(' ')
}

/** Resolve the same display title for media matches on every search surface. */
export function mediaSearchTitle(record: MediaSearchRecord): string {
  return record.title || record.savedFileName || record.url
}
