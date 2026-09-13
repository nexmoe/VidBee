/** Search params that pin the visible transcript conversation. */
export interface TranscriptTabSearch {
  tab?: string
  thread?: string
}

/**
 * Parse transcript `tab` / `thread` search params and drop empty values.
 *
 * @param search Raw search params from the URL hash.
 * @returns A typed transcript tab search object.
 */
export const validateTranscriptTabSearch = (
  search: Record<string, unknown>
): TranscriptTabSearch => {
  const tab = typeof search.tab === 'string' ? search.tab.trim() : ''
  const thread = typeof search.thread === 'string' ? search.thread.trim() : ''
  return {
    ...(tab ? { tab } : {}),
    ...(thread ? { thread } : {})
  }
}

/**
 * Build search params for a transcript tab. The captions tab omits them.
 *
 * @param tab Transcript tab, prompt id, or chat prompt id.
 * @param threadId Chat thread when the tab is a conversation.
 */
export const transcriptTabSearch = (tab: string, threadId: string | null): TranscriptTabSearch => {
  if ((tab === 'transcript' || tab === '') && !threadId) {
    return {}
  }
  return {
    tab,
    ...(threadId ? { thread: threadId } : {})
  }
}
