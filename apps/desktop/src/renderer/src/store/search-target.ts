import { atom } from 'jotai'

/** One explicit result jump, consumed only after its caption or message is mounted. */
export const searchTargetAtom = atom<
  | { kind: 'transcript'; downloadId: string; segmentId: string }
  | { kind: 'chat'; threadId: string; messageId: string }
  | null
>(null)
