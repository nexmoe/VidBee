import { atom } from 'jotai'

type UpdateReadyState = {
  ready: boolean
  version?: string
}

type UpdateAvailableState = {
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
