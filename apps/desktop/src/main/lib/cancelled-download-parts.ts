import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const MIN_STEM_LENGTH = 8

/**
 * Turn a logged or saved path into the media basename used to recognize leftovers.
 * Trailing `.part` / `.ytdl` markers are stripped so the prefix matches those files.
 *
 * @param filePath Absolute or relative file path from the task or yt-dlp log.
 */
export function mediaBasenameFromPath(filePath: string): string | null {
  const base = path.basename(filePath.trim())
  if (!base || base === '.' || base === '..') {
    return null
  }
  const stripped = base.replace(/(?:\.(?:part|ytdl)|-Frag\d+)+$/g, '')
  return stripped || null
}

/**
 * True when `fileName` is a yt-dlp partial, `.ytdl`, or fragment file for one known output.
 * Finished media, sidecars, and names that only share a short stem are left alone.
 *
 * @param fileName Entry name inside the output directory.
 * @param basenames Known output file names for this task, without directories.
 */
export function isCancelledDownloadPartFile(
  fileName: string,
  basenames: readonly string[]
): boolean {
  for (const basename of basenames) {
    if (!basename || fileName === basename) {
      continue
    }
    const stem = basename.includes('.') ? basename.slice(0, basename.lastIndexOf('.')) : basename
    const prefixes = [basename]
    if (stem !== basename && stem.length >= MIN_STEM_LENGTH) {
      prefixes.push(stem)
    }
    for (const prefix of prefixes) {
      if (!(fileName.startsWith(`${prefix}.`) || fileName.startsWith(`${prefix}-`))) {
        continue
      }
      const rest = fileName.slice(prefix.length)
      if (/\.(?:part|ytdl)(?:$|[.-])/.test(rest) || /\.part-Frag\d+/.test(rest)) {
        return true
      }
    }
  }
  return false
}

/**
 * Group known output basenames by the directory that holds their partial files.
 * Paths outside `downloadDir` are ignored when a download directory is known.
 *
 * @param input Saved path, yt-dlp log, and the task output directory.
 */
export function cancelledPartTargets(input: {
  downloadDir?: string | null
  filePath?: string | null
  log?: string | null
  outputTemplate?: string | null
}): Array<{ directory: string; basenames: string[] }> {
  const downloadDir = input.downloadDir?.trim() ?? ''
  const grouped = new Map<string, Set<string>>()
  const add = (filePath: string | null | undefined): void => {
    if (!filePath?.trim()) {
      return
    }
    const resolved = path.resolve(filePath.trim())
    const directory = path.dirname(resolved)
    if (downloadDir && !isInsideDirectory(path.resolve(downloadDir), directory)) {
      return
    }
    const basename = mediaBasenameFromPath(resolved)
    if (!basename) {
      return
    }
    const names = grouped.get(directory) ?? new Set<string>()
    names.add(basename)
    grouped.set(directory, names)
  }
  add(input.filePath)
  for (const candidate of outputPathsFromLog(input.log ?? '')) {
    add(candidate)
  }
  const template = input.outputTemplate?.trim() ?? ''
  const concreteTemplate =
    template.length > 0 &&
    !template.includes('%(') &&
    !template.includes('/') &&
    !template.includes('\\')
  if (downloadDir && concreteTemplate) {
    add(path.join(downloadDir, template))
  }
  return [...grouped.entries()].map(([directory, names]) => ({
    directory,
    basenames: [...names]
  }))
}

/**
 * True when `directory` is `root` or a child of it.
 *
 * @param root Allowed download root.
 * @param directory Candidate directory.
 */
function isInsideDirectory(root: string, directory: string): boolean {
  const relative = path.relative(root, directory)
  return relative === '' || !(relative.startsWith('..') || path.isAbsolute(relative))
}

/**
 * Pull destination paths out of a yt-dlp log tail.
 *
 * @param log Stdout/stderr tail stored for the task.
 */
function outputPathsFromLog(log: string): string[] {
  const found: string[] = []
  for (const line of log.split(/\r?\n/)) {
    const marked = line.indexOf('__VIDBEE_OUTPUT_PATH__:')
    if (marked >= 0) {
      const candidate = line.slice(marked + '__VIDBEE_OUTPUT_PATH__:'.length).trim()
      if (candidate) {
        found.push(candidate)
      }
      continue
    }
    const destination = line.indexOf('Destination:')
    if (destination >= 0) {
      const candidate = line
        .slice(destination + 'Destination:'.length)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (candidate) {
        found.push(candidate)
      }
    }
  }
  return found
}

/**
 * Delete leftover partial files for one cancelled download. Only regular files in
 * `directory` whose names match `basenames` are removed.
 *
 * @param directory Output directory that owns the partials.
 * @param basenames Known output basenames for the cancelled task.
 * @returns Names that were removed.
 */
export async function deleteCancelledDownloadParts(
  directory: string,
  basenames: readonly string[]
): Promise<string[]> {
  const known = basenames.filter((name) => name.length > 0)
  if (!directory || known.length === 0) {
    return []
  }
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const fileName of entries) {
    if (!isCancelledDownloadPartFile(fileName, known)) {
      continue
    }
    const fullPath = path.join(directory, fileName)
    try {
      const info = await stat(fullPath)
      if (!info.isFile()) {
        continue
      }
      await rm(fullPath, { force: true, recursive: false })
      removed.push(fileName)
    } catch {
      // Another owner may have removed the file already.
    }
  }
  return removed
}
