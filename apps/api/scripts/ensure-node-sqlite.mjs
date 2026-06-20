#!/usr/bin/env node

import { execSync } from 'node:child_process'

// GitHub issue #368: the desktop app rebuilds the shared, pnpm-hoisted
// better-sqlite3 for Electron's ABI (NODE_MODULE_VERSION 139). The API runs on
// plain Node (ABI 137) and then crashes loading the same binary. This mirrors
// apps/desktop/scripts/ensure-native-deps.mjs for the Node side: detect the ABI
// mismatch and rebuild better-sqlite3 for the current Node before the API boots.
const checkScript =
  "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close()"

function canLoadBetterSqlite3WithNode() {
  try {
    // Run in a child node so a failed native load cannot crash this process.
    execSync(`node -e "${checkScript}"`, { stdio: 'pipe' })
    return true
  } catch (error) {
    const details = error.stderr?.toString().trim() || error.message
    console.warn(`[native-deps] better-sqlite3 (Node) check failed: ${details}`)
    return false
  }
}

if (canLoadBetterSqlite3WithNode()) {
  process.exit(0)
}

console.log('[native-deps] Rebuilding better-sqlite3 for Node...')
execSync('pnpm rebuild better-sqlite3', { stdio: 'inherit' })

if (!canLoadBetterSqlite3WithNode()) {
  throw new Error('[native-deps] better-sqlite3 is still unavailable for Node after rebuild')
}

console.log('[native-deps] better-sqlite3 is ready for Node')
