import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { settingsManager } from '../settings'

/** Allocate a filesystem-safe unique export name without overwriting existing library files. */
export async function libraryExportPath(title: string, extension: string): Promise<string> {
  const directory = path.join(settingsManager.get('downloadPath'), 'Exports')
  await mkdir(directory, { recursive: true })
  const name =
    path
      .basename(title)
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .replace(/[. ]+$/g, '')
      .slice(0, 80) || 'VidBee'
  return path.join(directory, `${name}-${randomUUID()}.${extension}`)
}
