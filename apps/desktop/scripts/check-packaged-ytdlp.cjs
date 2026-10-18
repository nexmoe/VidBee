#!/usr/bin/env node
'use strict'

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const TARGETS = [
  { directory: 'mac', arch: 'x86_64' },
  { directory: 'mac-arm64', arch: 'arm64' }
]

/** Verify the final packaged engines with isolated, bounded version probes. */
const checkPackagedYtDlp = (distRoot) => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'vidbee-packaged-ytdlp-'))
  const options = {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: {
      ...process.env,
      TMPDIR: temporaryDirectory,
      XDG_CONFIG_HOME: join(temporaryDirectory, 'config'),
      XDG_CACHE_HOME: join(temporaryDirectory, 'cache')
    }
  }

  try {
    for (const target of TARGETS) {
      const engine = join(
        distRoot,
        target.directory,
        'VidBee.app',
        'Contents',
        'Resources',
        'resources',
        'yt-dlp_macos'
      )
      execFileSync('lipo', [engine, '-verify_arch', target.arch], options)
      const version = execFileSync(engine, ['--ignore-config', '--version'], options).trim()
      process.stdout.write(`Packaged yt-dlp ${target.arch}: ${version}\n`)
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

try {
  checkPackagedYtDlp(resolve(process.argv[2] || join(__dirname, '..', 'dist')))
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`)
  process.exitCode = 1
}
