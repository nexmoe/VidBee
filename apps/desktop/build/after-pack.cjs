const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const {
  pruneSherpaNatives,
  resolveUnpackedNodeModules,
  sherpaNativePackageName
} = require('../scripts/sherpa-natives.cjs')

const BINARIES = [
  'yt-dlp_macos',
  path.join('ffmpeg', 'ffmpeg'),
  path.join('ffmpeg', 'ffprobe'),
  'deno'
]

const findAppBundle = (appOutDir) => {
  const entries = fs.readdirSync(appOutDir)
  const app = entries.find((entry) => entry.endsWith('.app'))
  return app ? path.join(appOutDir, app) : null
}

const resolveSigningIdentity = () =>
  process.env.CSC_NAME || process.env.APPLE_SIGNING_IDENTITY || '-'

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
 * Resolves the packaged runtime binary directory for the app bundle.
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
    log.info(`afterPack: Signing ${binary} with entitlements.`)
    signBinary(targetPath, entitlementsPath)
  }
}

exports.resolveBinaryResourcesPath = resolveBinaryResourcesPath
