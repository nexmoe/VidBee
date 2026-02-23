#!/usr/bin/env node

import { execSync } from 'node:child_process'
import path from 'node:path'

const desktopRoot = path.resolve(import.meta.dirname, '..')
const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : ''
const forceDesktopPostinstall = process.env.VIDBEE_DESKTOP_POSTINSTALL === '1'
const isDesktopInstall = initCwd.startsWith(desktopRoot)

if (!(forceDesktopPostinstall || isDesktopInstall)) {
  console.log('Skipping desktop postinstall in workspace-level install.')
  process.exit(0)
}

execSync('node scripts/setup-dev-binaries.js', {
  cwd: desktopRoot,
  stdio: 'inherit'
})

execSync('pnpm exec electron-builder install-app-deps', {
  cwd: desktopRoot,
  stdio: 'inherit'
})
