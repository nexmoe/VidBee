const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const BINARIES = ['yt-dlp_macos', 'ffmpeg_macos', 'deno']

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

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appBundle = findAppBundle(context.appOutDir)
  if (!appBundle) {
    console.warn('afterPack: No .app bundle found, skipping tool signing.')
    return
  }

  const resourcesPath = path.join(
    appBundle,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'resources'
  )

  const entitlementsPath = path.resolve(__dirname, 'entitlements.mac.plist')

  for (const binary of BINARIES) {
    const targetPath = path.join(resourcesPath, binary)
    if (!fs.existsSync(targetPath)) {
      console.warn(`afterPack: Missing ${binary}, skipping.`)
      continue
    }
    console.log(`afterPack: Signing ${binary} with entitlements.`)
    signBinary(targetPath, entitlementsPath)
  }
}
