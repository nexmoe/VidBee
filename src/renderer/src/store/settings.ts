import { atom } from 'jotai'
import type { AppSettings } from '../../../shared/types'
import { defaultSettings } from '../../../shared/types'
import { ipcServices } from '../lib/ipc'

// Settings atom
export const settingsAtom = atom<AppSettings>(defaultSettings)

// Load settings from main process
export const loadSettingsAtom = atom(null, async (_get, set) => {
  try {
    const settings = await ipcServices.settings.getAll()
    set(settingsAtom, settings)
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
})

// Save a specific setting
export const saveSettingAtom = atom(
  null,
  async (get, set, update: { key: keyof AppSettings; value: AppSettings[keyof AppSettings] }) => {
    try {
      await ipcServices.settings.set(update.key, update.value)
      const settings = get(settingsAtom)
      set(settingsAtom, { ...settings, [update.key]: update.value })
    } catch (error) {
      console.error('Failed to save setting:', error)
    }
  }
)

// Save all settings
export const saveAllSettingsAtom = atom(
  null,
  async (get, set, newSettings: Partial<AppSettings>) => {
    try {
      await ipcServices.settings.setAll(newSettings)
      const settings = get(settingsAtom)
      set(settingsAtom, { ...settings, ...newSettings })
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
  }
)
