import type { ContentSearchPage } from '../../shared/content-search'
import { mediaSearchText, mediaSearchTitle } from '../../shared/media-search'
import type { DownloadItem } from '../../shared/types'
import { getAgentChatStore } from './agent-chat-store'
import { contentSearchSnippet, contentSearchWords, searchContent } from './content-search'
import { getDatabaseConnection } from './database'
import { downloadEngine } from './download-facade'
import { historyManager } from './history-manager'
import { getTranscriptStore } from './transcript-host'

/** Initialize shared stores once and search only saved public text. */
export async function searchDesktopContent(
  query: string,
  signal?: AbortSignal,
  page?: ContentSearchPage
) {
  getTranscriptStore()
  getAgentChatStore()
  return await searchContent(getDatabaseConnection().sqlite, query, signal, page)
}

/** Read bounded, paginated matches across the same media and text sources as global search. */
export async function searchDesktopLibrary(
  query: string,
  page: ContentSearchPage,
  signal: AbortSignal
) {
  const words = contentSearchWords(query)
  signal.throwIfAborted()
  const content = await searchDesktopContent(query, signal, page)
  signal.throwIfAborted()
  const records = new Map<string, DownloadItem>()
  for (const item of historyManager.getHistory()) {
    records.set(item.id, { ...item, createdAt: item.createdAt ?? item.downloadedAt })
  }
  for (const item of downloadEngine.getActiveDownloads()) {
    records.set(item.id, item)
  }
  const matches = [...records.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((item) => {
      const text = mediaSearchText(item).toLowerCase()
      return words.every((word) => text.includes(word))
    })
  const hasMore = content.hasMore || matches.length > page.offset + page.limit
  return {
    ...content,
    media: matches.slice(page.offset, page.offset + page.limit).map((item) => ({
      id: item.id,
      title: mediaSearchTitle(item),
      url: item.url,
      type: item.type,
      status: item.status,
      snippet: contentSearchSnippet(mediaSearchText(item), words)
    })),
    offset: page.offset,
    limit: page.limit,
    hasMore,
    nextOffset: hasMore ? page.offset + page.limit : null
  }
}
