import { z } from 'zod'
import { CONTENT_SEARCH_QUERY_LIMIT } from '../../shared/content-search'
import { searchDesktopLibrary } from '../lib/desktop-search'
import { defineMcpTool, mcpLimit, mcpOffset } from './tool'

/** Discover saved media, subtitle text and public chat bodies without changing the user's view. */
export function createMcpSearchTools() {
  return [
    defineMcpTool(
      'search',
      'Search local media metadata, saved subtitles/ASR, and user/assistant chat message bodies, including standalone and video conversations. Returns short snippets plus media, transcript, segment, thread and message IDs. limit applies separately to each category. Follow nextOffset with the same query and limit; use get_task, get_transcript (downloadId and transcriptId) or get_agent_message for full content. Search never changes the selected subtitle source or chat branch and makes no network requests.',
      z.object({
        query: z.string().max(CONTENT_SEARCH_QUERY_LIMIT).trim().min(1),
        offset: mcpOffset,
        limit: mcpLimit
      }),
      ({ query, offset, limit }, signal) => searchDesktopLibrary(query, { offset, limit }, signal),
      { readOnlyHint: true, idempotentHint: true }
    )
  ]
}
