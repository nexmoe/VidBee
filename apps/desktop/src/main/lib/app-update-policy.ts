import { isPortableMode } from '../portable'

export const isMicrosoftStore = process.windowsStore === true
export const canUseAppAutoUpdater = !(isPortableMode || isMicrosoftStore)
