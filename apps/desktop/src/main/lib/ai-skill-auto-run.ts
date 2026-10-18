import { TRANSCRIBABLE_TASK_KINDS } from '@vidbee/task-queue'
import { AI_CHAT_PROMPT_ID } from '../../shared/ai-prompts'
import { settingsManager } from '../settings'
import { scopedLoggers } from '../utils/logger'
import { openAgentThread, sendAgentMessage } from './agent-chat-runner'
import { aiStore } from './ai-store'
import { peekDesktopTaskQueueRef } from './queue-ref'
import type { TranscriptSnapshot } from './transcript-host'

/** Start each opted-in skill once when a completed download has usable subtitles. */
export function runAutoSkillsForTranscript(snapshot: TranscriptSnapshot): void {
  if (
    snapshot.record?.resultKind !== 'transcript' ||
    !snapshot.record.segments.some((segment) => segment.text.trim())
  ) {
    return
  }
  const download = peekDesktopTaskQueueRef()?.get(snapshot.downloadTaskId)
  if (download?.status !== 'completed' || !TRANSCRIBABLE_TASK_KINDS.has(download.kind)) {
    return
  }
  for (const prompt of aiStore.getSnapshot().prompts) {
    if (!(prompt.enabled && prompt.autoRun) || prompt.id === AI_CHAT_PROMPT_ID) {
      continue
    }
    try {
      const thread = openAgentThread(download.id, prompt.id)
      if (thread.messages.length) {
        continue
      }
      sendAgentMessage({
        downloadId: download.id,
        promptId: prompt.id,
        threadId: thread.id,
        uiLanguage: String(settingsManager.get('language') || 'en'),
        sourceTitle: snapshot.title ?? undefined
      })
    } catch (error) {
      scopedLoggers.ai.warn(
        `Automatic skill run failed: ${JSON.stringify({ downloadId: download.id, promptId: prompt.id, error: error instanceof Error ? error.message : String(error) })}`
      )
    }
  }
}
