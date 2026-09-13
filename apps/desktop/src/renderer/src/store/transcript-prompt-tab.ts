import { atom } from 'jotai'

/** Conversation to open after navigating to another video from history. */
export const pendingPromptTabAtom = atom<{
  downloadId: string
  promptId: string
  threadId?: string
} | null>(null)
