export const CONTENT_SEARCH_QUERY_LIMIT = 300
export const CONTENT_SEARCH_RESULT_LIMIT = 25
export const CONTENT_SEARCH_MAX_PAGE_SIZE = 100

export interface ContentSearchPage {
  offset: number
  limit: number
}

export interface TranscriptSearchHit {
  downloadId: string
  transcriptId: string
  segmentId: string
  sourceKey: string
  startMs: number
  snippet: string
}

export interface ChatSearchHit {
  downloadId: string
  promptId: string
  threadId: string
  messageId: string
  title: string
  snippet: string
}

export interface ContentSearchResults {
  transcripts: TranscriptSearchHit[]
  messages: ChatSearchHit[]
  hasMore: boolean
}

/** Create an empty response without sharing mutable result arrays. */
export function emptyContentSearchResults(): ContentSearchResults {
  return { transcripts: [], messages: [], hasMore: false }
}
