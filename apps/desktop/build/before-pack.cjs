const fs = require('node:fs')
const path = require('node:path')
const {
  sherpaNativePackageName,
  toArchName
} = require('../scripts/sherpa-natives.cjs')

const desktopPackage = require('../package.json')

const SHERPA_PACKAGES = Object.keys(desktopPackage.optionalDependencies || {}).filter(
  (name) => name.startsWith('sherpa-onnx-') && name !== 'sherpa-onnx-node'
)

const SQLITE_PREBUILDS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'linuxmusl-arm64',
  'linuxmusl-x64',
  'win32-arm64',
  'win32-x64'
]

let originalFiles = null

// electron-builder's yml excludes miss some of these (especially out/**/*.map).
const PACKAGING_FILE_IGNORES = [
  '!resources{,/**}',
  '!src{,/**}',
  '!scripts{,/**}',
  '!docs{,/**}',
  '!changelogs{,/**}',
  '!build{,/**}',
  '!**/*.map',
  '!out/**/*.map',
  '!**/*.tsbuildinfo',
  '!electron.vite.config.{js,ts,mjs,cjs}',
  '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}',
  '!electron-builder.yml',
  '!drizzle.config.ts',
  '!components.json',
  '!renderer-react-resolve.ts',
  '!dev-app-update.yml'
]

/**
 * Deletes electron-vite sourcemaps under `out/` so they cannot enter app.asar.
 * Maps stay on disk until this hook; upload them before `electron-builder`.
 * @param {string} projectDir
 * @returns {{ removed: number, bytes: number }}
 */
const removeOutSourcemaps = (projectDir) => {
  const outDir = path.join(projectDir, 'out')
  let removed = 0
  let bytes = 0

  /**
   * @param {string} dir
   */
  const walk = (dir) => {
    if (!fs.existsSync(dir)) {
      return
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!entry.name.endsWith('.map')) {
        continue
      }
      bytes += fs.statSync(fullPath).size
      fs.unlinkSync(fullPath)
      removed += 1
    }
  }

  walk(outDir)
  return { removed, bytes }
}

/**
 * better-sqlite3 prebuild id for this electron-builder target.
 * @param {string} electronPlatformName
 * @param {string | number} arch
 * @returns {string}
 */
const sqlitePrebuildName = (electronPlatformName, arch) =>
  `${electronPlatformName}-${toArchName(arch)}`

/**
 * File globs that drop natives for other OS/arch from this pack's asar.
 * @param {string} electronPlatformName
 * @param {string | number} arch
 * @returns {string[]}
 */
const extraFileIgnores = (electronPlatformName, arch) => {
  const keepSherpa = sherpaNativePackageName(electronPlatformName, arch)
  const keepSqlite = sqlitePrebuildName(electronPlatformName, arch)
  const ignores = []

  for (const name of SHERPA_PACKAGES) {
    if (name !== keepSherpa) {
      ignores.push(`!node_modules/${name}{,/**}`)
    }
  }

  for (const name of SQLITE_PREBUILDS) {
    if (name !== keepSqlite) {
      ignores.push(`!node_modules/better-sqlite3/prebuilds/${name}*`)
      ignores.push(`!node_modules/tree-sitter-bash/prebuilds/${name}{,/**}`)
    }
  }

  return ignores
}

/** Append ignores to the normalized root FileSet without creating a second catch-all matcher. */
const appendFileIgnores = (files, ignores) => {
  const result = structuredClone(files)
  const root = result.find(
    (entry) => typeof entry === 'object' && (entry.from == null || entry.from === '.')
  )
  if (root) {
    const filter = root.filter ?? ['**/*']
    root.filter = [...(Array.isArray(filter) ? filter : [filter]), ...ignores]
  } else {
    result.push(...ignores)
  }
  return result
}

/**
 * Snapshot electron-builder `files` once, then append per-target ignores.
 * Sequential `--x64 --arm64` packs share one config object.
 * @param {{ electronPlatformName: string, arch: string | number, packager: { config: { files?: unknown }, projectDir: string } }} context
 */
exports.default = async function beforePack(context) {
  const { log } = await import('@vidbee/logger/script')
  const { removed, bytes } = removeOutSourcemaps(context.packager.projectDir)
  if (removed > 0) {
    log.info(
      `beforePack: Removed ${removed} sourcemaps (${(bytes / 1024 / 1024).toFixed(1)} MB) from out/.`
    )
  }

  const config = context.packager.config
  if (!Array.isArray(config.files)) {
    return
  }

  if (originalFiles === null) {
    originalFiles = structuredClone(config.files)
  }

  config.files = appendFileIgnores(originalFiles, [
    ...PACKAGING_FILE_IGNORES,
    ...extraFileIgnores(context.electronPlatformName, context.arch)
  ])
}

exports.PACKAGING_FILE_IGNORES = PACKAGING_FILE_IGNORES
exports.appendFileIgnores = appendFileIgnores
exports.SHERPA_PACKAGES = SHERPA_PACKAGES
exports.SQLITE_PREBUILDS = SQLITE_PREBUILDS
exports.extraFileIgnores = extraFileIgnores
exports.removeOutSourcemaps = removeOutSourcemaps
exports.sqlitePrebuildName = sqlitePrebuildName
