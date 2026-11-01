import { atom } from 'jotai'

/** A one-time editable draft handed from skill management to a new standalone chat. */
export const agentChatLaunchDraftAtom = atom<string | null>(null)
