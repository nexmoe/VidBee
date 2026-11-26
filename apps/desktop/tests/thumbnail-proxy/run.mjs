import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../../../..')
const output = path.join(root, '.cache/issue-474')
assert.equal(process.version, 'v22.22.3', 'Use the Node version in .node-version')
assert.equal(process.platform, 'darwin', 'This background-only launcher currently supports macOS')
const profile = await fs.mkdtemp('/private/tmp/vidbee474-regression-')
const bundle = path.join(output, 'Background Electron.app')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
try {
  try {
    await fs.access(bundle)
  } catch {
    await fs.cp(path.join(root, 'node_modules/electron/dist/Electron.app'), bundle, {
      recursive: true,
      verbatimSymlinks: true
    })
    const plistPath = path.join(bundle, 'Contents/Info.plist')
    const plist = await fs.readFile(plistPath, 'utf8')
    await fs.writeFile(
      plistPath,
      plist.replace(
        '<dict>',
        '<dict><key>LSUIElement</key><true/><key>LSBackgroundOnly</key><true/>'
      )
    )
  }
  const tls = path.join(output, 'tls')
  await fs.mkdir(tls, { recursive: true })
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(tls, 'key.pem'),
      '-out',
      path.join(tls, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=covers.invalid',
      '-addext',
      'subjectAltName=DNS:covers.invalid'
    ],
    { stdio: 'ignore' }
  )
  const env = {
    PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
    HOME: profile,
    TMPDIR: profile,
    LANG: 'en_US.UTF-8',
    NODE_PATH: path.join(root, 'apps/desktop/node_modules'),
    VIDBEE_PORTABLE_DIR: profile,
    PROBE_ROOT: output,
    PROBE_PROFILE: profile,
    PROBE_NODE: process.execPath,
    PROBE_REVISION: revision
  }
  const child = spawn(
    path.join(bundle, 'Contents/MacOS/Electron'),
    [
      path.join(output, 'runtime.cjs'),
      '--no-proxy-server',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`
    ],
    { env, stdio: 'inherit' }
  )
  const deadline = setTimeout(() => {
    console.error('Regression deadline exceeded')
    child.kill('SIGTERM')
  }, 120_000)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(deadline))
  await fs.writeFile(
    path.join(output, 'receipts/regression-launch.json'),
    JSON.stringify(
      { ...result, revision, node: process.version, pid: child.pid, profile, backgroundOnly: true },
      null,
      2
    )
  )
  process.exitCode = result.code ?? 1
} finally {
  await fs.rm(profile, { recursive: true, force: true })
}
