import { atom } from 'jotai'

interface UpdateReadyState {
  ready: boolean
  version?: string
}

interface UpdateAvailableState {
  available: boolean
  version?: string
}

export const updateReadyAtom = atom<UpdateReadyState>({
  ready: false,
  version: undefined
})

export const updateAvailableAtom = atom<UpdateAvailableState>({
  available: false,
  version: undefined
})
