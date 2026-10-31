import { isPortableMode } from '../portable'

export const canUseAppAutoUpdater = !(isPortableMode || process.windowsStore)
