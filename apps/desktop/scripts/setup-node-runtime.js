#!/usr/bin/env node

/**
 * Prefetch the locked official Node LTS binary into extraResources.
 * Packaged apps must not depend on a user-installed Node (§11.1).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync
} from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { log } from '@vidbee/logger/script'

const here = dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(readFileSync(join(here, 'node-runtime-lock.json'), 'utf8'))
const RESOURCES_DIR = join(here, '..', 'resources')
const NODE_DIR = join(RESOURCES_DIR, 'node')

const platformKey = (platform = process.platform, arch = process.arch) => {
  const os = platform === 'win32' ? 'win32' : platform
  const cpu = arch === 'arm64' ? 'arm64' : 'x64'
  return `${os}-${cpu}`
}

const outputName = (platform = process.platform) => (platform === 'win32' ? 'node.exe' : 'node')

const moveFile = (source, dest) => {
  try {
    renameSync(source, dest)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'EXDEV') {
      throw error
    }
    copyFileSync(source, dest)
    unlinkSync(source)
  }
}

const sha256File = (filePath) => {
  const hash = createHash('sha256')
  hash.update(readFileSync(filePath))
  return hash.digest('hex')
}

const download = (url, dest) =>
  new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const file = createWriteStream(dest)
    const req = proto.get(url, { headers: { 'User-Agent': 'vidbee-setup' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        unlinkSync(dest)
        return download(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        unlinkSync(dest)
        return reject(new Error(`download ${url} failed: ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    })
    req.on('error', (err) => {
      file.close()
      if (existsSync(dest)) {
        unlinkSync(dest)
      }
      reject(err)
    })
  })

const extractArchive = (archive, destDir) => {
  mkdirSync(destDir, { recursive: true })
  if (archive.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path '${archive}' -DestinationPath '${destDir}' -Force`
        ],
        { stdio: 'inherit' }
      )
      return
    }
    execFileSync('unzip', ['-q', archive, '-d', destDir], { stdio: 'inherit' })
    return
  }
  execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'inherit' })
}

const nodeVersionOk = (bin, expected) => {
  const result = spawnSync(bin, ['-v'], { encoding: 'utf8', timeout: 8000 })
  if (result.error || result.status !== 0) {
    return false
  }
  return (result.stdout || '').trim() === `v${expected}`
}

const fetchAsset = async (key, destBin) => {
  const asset = lock.assets[key]
  if (!asset) {
    throw new Error(`no locked Node asset for ${key}`)
  }
  const archive = join(tmpdir(), asset.file)
  const extractDir = join(tmpdir(), `vidbee-node-${key}`)
  try {
    log.log(`📦 Downloading Node ${lock.version} (${key})...`)
    await download(`${lock.baseUrl}/${asset.file}`, archive)
    const digest = sha256File(archive)
    if (digest !== asset.sha256) {
      throw new Error(`checksum mismatch for ${asset.file}: ${digest}`)
    }
    extractArchive(archive, extractDir)
    const source = join(extractDir, asset.innerBin)
    if (!existsSync(source)) {
      throw new Error(`node binary missing in archive: ${source}`)
    }
    mkdirSync(dirname(destBin), { recursive: true })
    moveFile(source, destBin)
    if (process.platform !== 'win32') {
      execFileSync('chmod', ['755', destBin])
    }
  } finally {
    if (existsSync(archive)) {
      unlinkSync(archive)
    }
    if (existsSync(extractDir)) {
      rmSync(extractDir, { recursive: true, force: true })
    }
  }
}

export const downloadNodeRuntime = async () => {
  const dest = join(NODE_DIR, outputName())
  const universal =
    process.platform === 'darwin' &&
    (process.env.VIDBEE_MAC_NODE_MODE || process.env.VIDBEE_MAC_FFMPEG_MODE) === 'universal'

  if (existsSync(dest) && nodeVersionOk(dest, lock.version) && !universal) {
    log.log(`📦 node ${lock.version} already exists, skipping download`)
    return dest
  }

  mkdirSync(NODE_DIR, { recursive: true })

  if (universal) {
    const arm = join(NODE_DIR, 'node-arm64')
    const x64 = join(NODE_DIR, 'node-x64')
    await fetchAsset('darwin-arm64', arm)
    await fetchAsset('darwin-x64', x64)
    execFileSync('lipo', ['-create', arm, x64, '-output', dest])
    execFileSync('chmod', ['755', dest])
    unlinkSync(arm)
    unlinkSync(x64)
  } else {
    await fetchAsset(platformKey(), dest)
  }

  if (!nodeVersionOk(dest, lock.version)) {
    throw new Error(`bundled node failed version check (want v${lock.version})`)
  }
  log.log(`✅ Bundled Node ${lock.version} ready at ${dest}`)
  return dest
}

const isDirect = process.argv[1] && join(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirect) {
  downloadNodeRuntime().catch((err) => {
    log.error(`❌ Node runtime setup failed: ${err.message}`)
    process.exit(1)
  })
}
