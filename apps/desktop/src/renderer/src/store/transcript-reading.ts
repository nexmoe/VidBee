import { atom } from 'jotai'

/** Bilingual reading choices remembered for one video during the application session. */
export interface TranscriptBilingualPreference {
  enabled: boolean
  secondaryKey: string
}

/** Preserve reading choices across page and tab unmounts without mixing different videos. */
export const transcriptBilingualPreferencesAtom = atom<
  Record<string, TranscriptBilingualPreference>
>({})
