import { execFile } from 'node:child_process'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign
} from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, safeStorage } from 'electron'
import { authClient, getDesktopAuthApiUrl } from './auth-client'

/** Encode the same deterministic wire JSON as the Cloud verifier. */
const digest = (value: unknown): string =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? Object.fromEntries(
              Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            )
          : entry
      )
    )
    .digest('hex')
/** Hash a machine identifier locally; raw identifiers never leave this process. */
const machineDigest = async (): Promise<string | undefined> => {
  try {
    let value: string
    if (process.platform === 'darwin') {
      const { stdout } = await promisify(execFile)(
        '/usr/sbin/ioreg',
        ['-rd1', '-c', 'IOPlatformExpertDevice'],
        { timeout: 2000 }
      )
      value = stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? ''
    } else if (process.platform === 'linux') {
      value = (await readFile('/etc/machine-id', 'utf8')).trim()
    } else {
      const { stdout } = await promisify(execFile)(
        'reg.exe',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        { timeout: 2000 }
      )
      value = stdout.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? ''
    }
    return value ? digest(['vidbee-device-v1', value]) : undefined
  } catch {
    return undefined
  }
}
let installationKey: Promise<string> | undefined
/** Load an installation secret protected by the operating system credential service. */
const loadInstallationKey = async (): Promise<string> => {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('Secure device storage is unavailable.')
  }
  const file = join(app.getPath('userData'), 'cloud-device.key')
  try {
    return safeStorage.decryptString(await readFile(file))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await writeFile(file, safeStorage.encryptString(pem), { mode: 0o600, flag: 'wx' })
    return pem
  }
}
/** Authenticate a fresh request without exposing installation secrets to the renderer. */
export const signCloudRequest = async (
  body: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  installationKey ??= loadInstallationKey()
  const pem = await installationKey
  const publicKey = createPublicKey(pem).export({ format: 'jwk' })
  const response = await fetch(`${getDesktopAuthApiUrl()}/api/ai/device/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authClient.getCookie() },
    body: JSON.stringify({ publicKey, machineDigest: await machineDigest() })
  })
  if (!response.ok) {
    throw new Error('Device challenge failed.')
  }
  const challenge = (await response.json()) as {
    policy: string
    userId: string
    deviceId: string
    challengeId: string
  }
  const message = JSON.stringify([
    challenge.policy,
    challenge.userId,
    challenge.challengeId,
    body.requestId,
    digest(body)
  ])
  const signature = sign('sha256', Buffer.from(message), {
    key: createPrivateKey(pem),
    dsaEncoding: 'ieee-p1363'
  }).toString('base64')
  return {
    ...body,
    deviceProof: { deviceId: challenge.deviceId, challengeId: challenge.challengeId, signature }
  }
}
/** Submit a negative vote for the exact result delivered to this account. */
export const dislikeCloudResult = async (resultId: string): Promise<void> => {
  const body = { resultId, requestId: crypto.randomUUID() }
  let signed: Record<string, unknown> = body
  try {
    signed = await signCloudRequest(body)
  } catch {
    /* Feedback remains available without voting credentials. */
  }
  const response = await fetch(`${getDesktopAuthApiUrl()}/api/ai/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: authClient.getCookie() },
    body: JSON.stringify(signed)
  })
  if (!response.ok) {
    throw new Error('Could not save feedback. Please try again.')
  }
}
