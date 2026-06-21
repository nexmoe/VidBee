import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Resolve the resources directory that actually contains the requested assets.
 *
 * Bundled binaries (yt-dlp, ffmpeg, deno) live in different places depending on
 * how the app runs:
 *   - `electron-vite dev` / `preview`: `<cwd>/resources` (the app package dir)
 *   - packaged builds: under `process.resourcesPath`, either directly or in
 *     `resources/` or `app.asar.unpacked/resources` (GitHub issues #334, #348,
 *     #349, #352, #353 showed the Windows `resources/resources` variant).
 *
 * We probe every known location and return the first that actually contains the
 * required assets. This intentionally does NOT branch on `NODE_ENV`: that flag
 * is unset under `electron-vite preview`, which made the old code look in the
 * packaged resources dir and fail with "yt-dlp not initialized".
 *
 * @param requiredRelativePaths Relative asset paths that must exist under the chosen directory.
 * @returns The most likely resources directory for the current runtime.
 */
export const resolveBundledResourcesPath = (requiredRelativePaths: string[]): string => {
  const devResourcesPath = path.join(process.cwd(), 'resources')
  const candidates = [devResourcesPath]

  if (process.resourcesPath) {
    candidates.push(
      process.resourcesPath,
      path.join(process.resourcesPath, 'app.asar.unpacked', 'resources'),
      path.join(process.resourcesPath, 'resources')
    )
  }

  for (const candidate of candidates) {
    if (
      requiredRelativePaths.every((relativePath) => existsSync(path.join(candidate, relativePath)))
    ) {
      return candidate
    }
  }

  return process.resourcesPath || devResourcesPath
}
