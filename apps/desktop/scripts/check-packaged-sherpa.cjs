#!/usr/bin/env node
'use strict'

const { existsSync } = require('node:fs')
const { join } = require('node:path')
const {
  assertPackagedSherpa,
  resolveUnpackedNodeModules,
  sherpaNativePackageName
} = require('./sherpa-natives.cjs')

const desktopRoot = join(__dirname, '..')
const distRoot = join(desktopRoot, 'dist')

const PLATFORM_ALIASES = {
  mac: 'macos',
  macos: 'macos',
  darwin: 'macos',
  win: 'windows',
  windows: 'windows',
  win32: 'windows',
  linux: 'linux'
}

const TARGETS = {
  macos: [
    { appOutDir: join(distRoot, 'mac'), electronPlatformName: 'darwin', arch: 'x64' },
    { appOutDir: join(distRoot, 'mac-arm64'), electronPlatformName: 'darwin', arch: 'arm64' }
  ],
  windows: [
    { appOutDir: join(distRoot, 'win-unpacked'), electronPlatformName: 'win32', arch: 'x64' }
  ],
  linux: [
    { appOutDir: join(distRoot, 'linux-unpacked'), electronPlatformName: 'linux', arch: 'x64' }
  ]
}

const platformArg = process.argv[2]
const platform = PLATFORM_ALIASES[platformArg]

if (!(platform && TARGETS[platform])) {
  process.stderr.write('Usage: node scripts/check-packaged-sherpa.cjs [macos|windows|linux]\n')
  process.exit(1)
}

const run = async () => {
  const { log } = await import('@vidbee/logger/script')

  for (const target of TARGETS[platform]) {
    if (!existsSync(target.appOutDir)) {
      throw new Error(`Missing packaged app directory: ${target.appOutDir}`)
    }

    const keepName = sherpaNativePackageName(target.electronPlatformName, target.arch)
    const nodeModulesDir = resolveUnpackedNodeModules(target)
    if (!nodeModulesDir) {
      throw new Error(`Could not locate unpacked node_modules in ${target.appOutDir}`)
    }

    assertPackagedSherpa(nodeModulesDir, keepName)
    log.info(`${target.arch} ${target.electronPlatformName}: ${keepName}`)
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exit(1)
})
