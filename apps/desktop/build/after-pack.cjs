const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  pruneSherpaNatives,
  resolveUnpackedNodeModules,
  sherpaNativePackageName,
  toArchName
} = require('../scripts/sherpa-natives.cjs')

const LIPO_ARCH_BY_ELECTRON_ARCH = {
  arm64: 'arm64',
  x64: 'x86_64'
}

const SIGN_ALWAYS = [
  'yt-dlp_macos',
  path.join('ffmpeg', 'ffmpeg'),
  path.join('ffmpeg', 'ffprobe')
]

const BINARIES = [...SIGN_ALWAYS, path.join('node', 'node')]

// Official Node ships DWARF; strip -x is safe after re-sign. Never strip yt-dlp
// (PyInstaller payload) or ffmpeg/ffprobe (already stripped, zero savings).
const STRIP_BINARIES = [path.join('node', 'node')]

/**
 * Finds the .app bundle inside electron-builder's output directory.
 * @param {string} appOutDir
 * @returns {string | null}
 */
const findAppBundle = (appOutDir) => {
  const entries = fs.readdirSync(appOutDir)
  const app = entries.find((entry) => entry.endsWith('.app'))
  return app ? path.join(appOutDir, app) : null
}

/**
 * Resolves the codesign identity, defaulting to ad-hoc when unset.
 * @returns {string}
 */
const resolveSigningIdentity = () =>
  process.env.CSC_NAME || process.env.APPLE_SIGNING_IDENTITY || '-'

/**
 * Signs a bundled Mach-O with the desktop entitlements.
 * @param {string} targetPath
 * @param {string} entitlementsPath
 */
const signBinary = (targetPath, entitlementsPath) => {
  const identity = resolveSigningIdentity()
  const args = ['--force', '--sign', identity, '--entitlements', entitlementsPath]

  if (identity !== '-') {
    args.push('--options', 'runtime', '--timestamp')
  }

  args.push(targetPath)
  execFileSync('codesign', args, { stdio: 'inherit' })
}

/**
 * Maps an electron-builder arch to the lipo slice name.
 * @param {string | number} arch
 * @returns {string | null}
 */
const lipoArchForElectronArch = (arch) => LIPO_ARCH_BY_ELECTRON_ARCH[toArchName(arch)] ?? null

/**
 * Lists Mach-O architectures in a binary, or null when it is not a fat/thin Mach-O.
 * @param {string} filePath
 * @returns {string[] | null}
 */
const listMachOArchitectures = (filePath) => {
  try {
    const output = execFileSync('lipo', ['-archs', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const architectures = output
      .trim()
      .split(/\s+/)
      .filter((value) => value.length > 0)
    return architectures.length > 0 ? architectures : null
  } catch {
    return null
  }
}

/**
 * True when a Mach-O still contains slices besides the pack target.
 * @param {string[]} architectures
 * @param {string} keepArch
 * @returns {boolean}
 */
const needsThinning = (architectures, keepArch) =>
  architectures.includes(keepArch) && architectures.length > 1

/**
 * Drops non-target slices from a universal binary so arch-specific DMGs
 * do not ship the other architecture. Returns whether the file was rewritten.
 * @param {string} filePath
 * @param {string | number} arch
 * @returns {boolean}
 */
const thinMachOToArch = (filePath, arch) => {
  // PyInstaller's shared PKG archive lives in the final universal2 slice.
  // Thinning yt-dlp to x86_64 removes that archive and breaks both kernel paths.
  if (path.basename(filePath) === 'yt-dlp_macos') {
    return false
  }

  const keepArch = lipoArchForElectronArch(arch)
  if (!keepArch) {
    return false
  }

  const architectures = listMachOArchitectures(filePath)
  if (!architectures) {
    return false
  }

  if (!architectures.includes(keepArch)) {
    throw new Error(
      `afterPack: ${filePath} is missing required arch ${keepArch} (found ${architectures.join(', ')})`
    )
  }

  if (!needsThinning(architectures, keepArch)) {
    return false
  }

  const tempPath = `${filePath}.thin`
  try {
    execFileSync('lipo', [filePath, '-thin', keepArch, '-output', tempPath])
    fs.renameSync(tempPath, filePath)
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath)
    }
  }
  return true
}

/**
 * Strips local symbols from a Mach-O/ELF binary. Returns whether the file shrank.
 * Invalidates codesign; callers must re-sign on macOS.
 * @param {string} filePath
 * @returns {boolean}
 */
const stripLocalSymbols = (filePath) => {
  const before = fs.statSync(filePath).size
  try {
    execFileSync('strip', ['-x', filePath], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch {
    return false
  }
  return fs.statSync(filePath).size < before
}

/**
 * Resolves the packaged runtime binary directory for the app bundle.
 * @param {string} appBundle
 * @returns {string}
 */
const resolveBinaryResourcesPath = (appBundle) => {
  const contentsResourcesPath = path.join(appBundle, 'Contents', 'Resources')
  const candidates = [
    path.join(contentsResourcesPath, 'resources'),
    path.join(contentsResourcesPath, 'app.asar.unpacked', 'resources')
  ]

  return (
    candidates.find((candidate) =>
      BINARIES.some((binary) => fs.existsSync(path.join(candidate, binary)))
    ) || candidates[0]
  )
}

exports.default = async function afterPack(context) {
  const { log } = await import('@vidbee/logger/script')

  const keepSherpa = sherpaNativePackageName(context.electronPlatformName, context.arch)
  const unpackedNodeModules = resolveUnpackedNodeModules(context)
  if (!unpackedNodeModules) {
    throw new Error(
      `afterPack: could not locate unpacked node_modules in ${context.appOutDir}`
    )
  }
  pruneSherpaNatives(unpackedNodeModules, keepSherpa, log)

  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appBundle = findAppBundle(context.appOutDir)
  if (!appBundle) {
    log.warn('afterPack: No .app bundle found, skipping tool signing.')
    return
  }

  const resourcesPath = resolveBinaryResourcesPath(appBundle)
  const entitlementsPath = path.resolve(__dirname, 'entitlements.mac.plist')

  for (const binary of BINARIES) {
    const targetPath = path.join(resourcesPath, binary)
    if (!fs.existsSync(targetPath)) {
      log.warn(`afterPack: Missing ${binary}, skipping.`)
      continue
    }

    const thinned = thinMachOToArch(targetPath, context.arch)
    if (thinned) {
      log.info(`afterPack: Thinned ${binary} to ${lipoArchForElectronArch(context.arch)}.`)
    }

    let stripped = false
    if (STRIP_BINARIES.includes(binary)) {
      stripped = stripLocalSymbols(targetPath)
      if (stripped) {
        log.info(`afterPack: Stripped local symbols from ${binary}.`)
      }
    }

    const shouldSign = thinned || stripped || SIGN_ALWAYS.includes(binary)
    if (!shouldSign) {
      continue
    }
    log.info(`afterPack: Signing ${binary} with entitlements.`)
    signBinary(targetPath, entitlementsPath)
  }
}

exports.BINARIES = BINARIES
exports.STRIP_BINARIES = STRIP_BINARIES
exports.lipoArchForElectronArch = lipoArchForElectronArch
exports.listMachOArchitectures = listMachOArchitectures
exports.needsThinning = needsThinning
exports.resolveBinaryResourcesPath = resolveBinaryResourcesPath
exports.stripLocalSymbols = stripLocalSymbols
exports.thinMachOToArch = thinMachOToArch
