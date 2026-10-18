import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import type { DesktopMcpStatus } from '../../shared/mcp'
import { getAutomationDescriptorPath } from '../lib/automation-descriptor'

const credentialsSchema = z.object({
  enabled: z.boolean(),
  token: z.string().regex(/^[a-f0-9]{64}$/)
})

let credentials: z.infer<typeof credentialsSchema> | null = null
let endpoint: string | null = null

/** Resolve a discoverable MCP file while respecting isolated and portable profiles. */
export function getMcpConfigPath(): string {
  return (
    process.env.VIDBEE_MCP_CONFIG?.trim() ||
    path.join(path.dirname(getAutomationDescriptorPath()), 'mcp.json')
  )
}

/** Load a stable credential once; malformed existing files fail closed instead of resetting opt-outs. */
function readCredentials(): z.infer<typeof credentialsSchema> {
  if (!credentials) {
    const file = getMcpConfigPath()
    credentials = existsSync(file)
      ? credentialsSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
      : { enabled: true, token: randomBytes(32).toString('hex') }
  }
  return credentials
}

/** Atomically publish credentials with owner-only permissions before exposing the endpoint. */
function persistCredentials(next = readCredentials()): void {
  const file = getMcpConfigPath()
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(
    temporary,
    JSON.stringify(
      { version: 1, ...next, url: endpoint, pid: endpoint ? process.pid : null },
      null,
      2
    ),
    { mode: 0o600 }
  )
  if (process.platform !== 'win32') {
    chmodSync(temporary, 0o600)
  }
  renameSync(temporary, file)
  credentials = next
}

/** Announce the currently bound port without changing the token or enablement preference. */
export function publishMcpEndpoint(host: string, port: number): void {
  endpoint = `http://${host}:${port}/mcp`
  persistCredentials()
}

/** Mark the endpoint offline while retaining the user's stable credentials for the next launch. */
export function unpublishMcpEndpoint(): void {
  endpoint = null
  if (credentials) {
    persistCredentials()
  }
}

/** Enable or disable external access without disturbing the extension or task queue server. */
export function setMcpEnabled(enabled: boolean): void {
  persistCredentials({ ...readCredentials(), enabled })
}

/** Revoke all saved external configurations by replacing the bearer credential. */
export function rotateMcpToken(): void {
  persistCredentials({ ...readCredentials(), token: randomBytes(32).toString('hex') })
}

/** Validate a bearer credential in constant time, independently of CLI handshake tokens. */
export function authorizeMcp(authorization: string | undefined): boolean {
  const current = readCredentials()
  if (!(current.enabled && endpoint && authorization && /^Bearer /i.test(authorization))) {
    return false
  }
  const supplied = Buffer.from(authorization.slice(7))
  const expected = Buffer.from(current.token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

/** Check endpoint availability without constructing credential-bearing client configurations. */
export function isMcpAvailable(): boolean {
  return readCredentials().enabled && endpoint !== null
}

/** Build ready-to-copy configurations for HTTP clients and clients that launch a stdio command. */
export function getMcpStatus(toolCount: number): DesktopMcpStatus {
  const current = readCredentials()
  const bridge = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'mcp-bridge.mjs')
    : path.join(app.getAppPath(), 'resources', 'mcp-bridge.mjs')
  const bundledNode = path.join(
    path.dirname(bridge),
    'node',
    process.platform === 'win32' ? 'node.exe' : 'node'
  )
  return {
    enabled: current.enabled,
    running: current.enabled && endpoint !== null,
    url: endpoint,
    configPath: getMcpConfigPath(),
    toolCount,
    httpConfig: JSON.stringify(
      {
        mcpServers: {
          vidbee: { url: endpoint, headers: { Authorization: `Bearer ${current.token}` } }
        }
      },
      null,
      2
    ),
    stdioConfig: JSON.stringify(
      {
        mcpServers: {
          vidbee: {
            command: existsSync(bundledNode) ? bundledNode : 'node',
            args: [bridge],
            env: { VIDBEE_MCP_CONFIG: getMcpConfigPath() }
          }
        }
      },
      null,
      2
    )
  }
}
