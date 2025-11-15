import { join } from 'node:path'
import { app } from 'electron'

export const getDatabaseFilePath = (): string => {
  return join(app.getPath('userData'), 'vidbee.db')
}
