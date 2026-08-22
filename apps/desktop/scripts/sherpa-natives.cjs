'use strict'
const { createWriteStream, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } =
  require('node:fs')
const { tmpdir } = require('node:os')
const { basename, dirname, join } = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

const requireFromDesktop = createRequire(join(__dirname, '..', 'package.json'))

const ARCH_NAMES = {
  0: 'ia32',
  1: 'x64',
  2: 'armv7l',
  3: 'arm64',
  4: 'universal'
}

const SHERPA_PREFIX = 'sherpa-onnx-'

/**
 * sherpa-onnx-node uses `win` instead of Node's `win32`.
 * @param {string} electronPlatformName
 * @returns {string}
 */
const sherpaOsName = (electronPlatformName) =>
  electronPlatformName === 'win32' ? 'win' : electronPlatformName

/**
 * @param {string | number} arch
 * @returns {string}
 */
const toArchName = (arch) => {
  if (typeof arch === 'string') {
    return arch
  }
  return ARCH_NAMES[arch] ?? String(arch)
}

/**
 * Platform package name that sherpa-onnx-node requires() at runtime.
 * @param {string} electronPlatformName Node platform (`darwin` / `win32` / `linux`)
 * @param {string | number} arch
 * @returns {string}
 */
const sherpaNativePackageName = (electronPlatformName, arch) => {
  const archName = toArchName(arch)
  if (archName === 'universal') {
    throw new Error('Sherpa natives are per-arch; universal Electron binaries are not supported')
  }
  return `${SHERPA_PREFIX}${sherpaOsName(electronPlatformName)}-${archName}`
}

const sherpaNodeVersion = () => requireFromDesktop('sherpa-onnx-node/package.json').version

const sherpaNodeDir = () => dirname(requireFromDesktop.resolve('sherpa-onnx-node/package.json'))

const desktopRoot = () => join(__dirname, '..')

const packageInstallDirs = (packageName) => [
  join(sherpaNodeDir(), '..', packageName),
  join(desktopRoot(), 'node_modules', packageName),
  join(
    desktopRoot(),
    '..',
    '..',
    'node_modules',
    '.pnpm',
    `${packageName}@${sherpaNodeVersion()}`,
    'node_modules',
    packageName
  )
]

const isPackagePresent = (dir) => existsSync(join(dir, 'package.json'))

const isPackageInstalled = (packageName) => {
  if (packageInstallDirs(packageName).some(isPackagePresent)) {
    return true
  }
  try {
    requireFromDesktop.resolve(`${packageName}/package.json`)
    return true
  } catch {
    return false
  }
}

const registryBase = () => {
  const fromEnv = process.env.npm_config_registry || process.env.NPM_CONFIG_REGISTRY
  return (fromEnv || 'https://registry.npmjs.org').replace(/\/$/, '')
}

const downloadTarball = async (packageName, version, dest) => {
  const url = `${registryBase()}/${packageName}/-/${packageName}-${version}.tgz`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'vidbee-desktop' }
  })
  if (!(response.ok && response.body)) {
    throw new Error(`Failed to download ${url}: ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest))
}

const extractTarball = (tarball) => {
  // Relative paths: Windows tar treats `C:` in `-C C:\...` as a remote host.
  execFileSync('tar', ['-xzf', basename(tarball)], {
    cwd: dirname(tarball),
    stdio: 'pipe',
    windowsHide: true
  })
  const extracted = join(dirname(tarball), 'package')
  if (!existsSync(extracted)) {
    throw new Error('npm pack tarball did not contain a package/ directory')
  }
  return extracted
}

/**
 * Download the target-arch sherpa native next to sherpa-onnx-node so
 * electron-builder can copy it when packaging a non-host arch (e.g. mac x64
 * on Apple Silicon).
 * @param {string} electronPlatformName
 * @param {string | number} arch
 * @param {{ info?: (msg: string) => void }} [logger]
 */
const ensureSherpaNative = async (electronPlatformName, arch, logger = console) => {
  const packageName = sherpaNativePackageName(electronPlatformName, arch)
  if (isPackageInstalled(packageName)) {
    logger.info?.(`Sherpa native already present: ${packageName}`)
    return packageName
  }

  const version = sherpaNodeVersion()
  logger.info?.(
    `Downloading ${packageName}@${version} for ${electronPlatformName}/${toArchName(arch)}`
  )

  const tmp = mkdtempSync(join(tmpdir(), 'vidbee-sherpa-dl-'))
  const tarball = join(tmp, `${packageName}.tgz`)
  try {
    await downloadTarball(packageName, version, tarball)
    const extracted = extractTarball(tarball)
    for (const dest of packageInstallDirs(packageName)) {
      mkdirSync(dirname(dest), { recursive: true })
      rmSync(dest, { recursive: true, force: true })
      cpSync(extracted, dest, { recursive: true })
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  if (!isPackageInstalled(packageName)) {
    throw new Error(`Failed to install ${packageName}@${version}`)
  }
  logger.info?.(`Installed ${packageName}@${version}`)
  return packageName
}

/**
 * Unpacked node_modules inside a packaged Electron app.
 * @param {{ appOutDir: string, electronPlatformName: string }} context
 * @returns {string | null}
 */
const resolveUnpackedNodeModules = (context) => {
  const { appOutDir, electronPlatformName } = context
  if (electronPlatformName === 'darwin') {
    if (!existsSync(appOutDir)) {
      return null
    }
    const app = readdirSync(appOutDir).find((entry) => entry.endsWith('.app'))
    if (!app) {
      return null
    }
    return join(appOutDir, app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
  }
  return join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')
}

/**
 * Keep only the sherpa native that matches this package's platform/arch.
 * @param {string} nodeModulesDir
 * @param {string} keepName
 * @param {{ info?: (msg: string) => void }} [logger]
 */
const listSherpaNatives = (nodeModulesDir) => {
  if (!existsSync(nodeModulesDir)) {
    return []
  }
  return readdirSync(nodeModulesDir).filter(
    (entry) => entry.startsWith(SHERPA_PREFIX) && entry !== 'sherpa-onnx-node'
  )
}

/**
 * Fail if the packaged app is missing the target sherpa native or still has
 * leftovers from another platform/arch.
 * @param {string} nodeModulesDir
 * @param {string} keepName
 */
const assertPackagedSherpa = (nodeModulesDir, keepName) => {
  if (!existsSync(nodeModulesDir)) {
    throw new Error(`Packaged node_modules not found: ${nodeModulesDir}`)
  }

  const sherpaNatives = listSherpaNatives(nodeModulesDir)
  if (!sherpaNatives.includes(keepName)) {
    throw new Error(
      `Expected ${keepName} in packaged app, found: ${sherpaNatives.join(', ') || '(none)'}`
    )
  }

  const leftovers = sherpaNatives.filter((entry) => entry !== keepName)
  if (leftovers.length > 0) {
    throw new Error(`Unexpected sherpa natives in packaged app: ${leftovers.join(', ')}`)
  }
}

const pruneSherpaNatives = (nodeModulesDir, keepName, logger = console) => {
  if (!existsSync(nodeModulesDir)) {
    throw new Error(`Packaged node_modules not found: ${nodeModulesDir}`)
  }

  const sherpaEntries = readdirSync(nodeModulesDir).filter((entry) =>
    entry.startsWith(SHERPA_PREFIX)
  )
  if (!existsSync(join(nodeModulesDir, keepName))) {
    throw new Error(
      `Expected ${keepName} in packaged app, found: ${sherpaEntries.join(', ') || '(none)'}`
    )
  }

  for (const entry of sherpaEntries) {
    if (entry === 'sherpa-onnx-node' || entry === keepName) {
      continue
    }
    logger.info?.(`Removing leftover sherpa native ${entry}`)
    rmSync(join(nodeModulesDir, entry), { recursive: true, force: true })
  }

  assertPackagedSherpa(nodeModulesDir, keepName)
}

module.exports = {
  assertPackagedSherpa,
  ensureSherpaNative,
  pruneSherpaNatives,
  resolveUnpackedNodeModules,
  sherpaNativePackageName,
  toArchName
}
