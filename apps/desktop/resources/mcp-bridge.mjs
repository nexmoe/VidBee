import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const MAX_LINE_BYTES = 1024 * 1024
const MAX_PENDING_REQUESTS = 32
let buffer = ''
let pending = 0
let ended = false
let protocolVersion
const requests = new Map()

/** Discover the same private connection file as the running Desktop app. */
function configPath() {
  if (process.env.VIDBEE_MCP_CONFIG?.trim()) {
    return process.env.VIDBEE_MCP_CONFIG.trim()
  }
  if (process.env.VIDBEE_AUTOMATION_DESCRIPTOR?.trim()) {
    return path.join(path.dirname(process.env.VIDBEE_AUTOMATION_DESCRIPTOR.trim()), 'mcp.json')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'VidBee', 'mcp.json')
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'VidBee',
      'mcp.json'
    )
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'VidBee',
    'mcp.json'
  )
}

/** Keep stdout exclusively for newline-delimited protocol responses. */
function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

/** Report transport failures against the original JSON-RPC request ID. */
function fail(id, message, code = -32_603) {
  write({ jsonrpc: '2.0', id, error: { code, message } })
}

/** Re-read discovery per request so port moves, app restarts and token rotations are transparent. */
async function forward(message, controller) {
  const config = JSON.parse(await readFile(configPath(), 'utf8'))
  if (!(config.enabled && config.url && /^[a-f0-9]{64}$/.test(config.token))) {
    throw new Error('Start VidBee Desktop and enable MCP in Settings')
  }
  const url = new URL(config.url)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/mcp' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid local MCP endpoint')
  }
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${config.token}`,
      ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {})
    },
    body: JSON.stringify(message),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60_000)])
  })
  if (response.status === 202) {
    await response.body?.cancel()
    return
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Desktop MCP returned HTTP ${response.status}`)
  }
  const result = await response.json()
  if (message.method === 'initialize' && typeof result.result?.protocolVersion === 'string') {
    protocolVersion = result.result.protocolVersion
  }
  if (message.id !== undefined) {
    write(result)
  }
}

/** Admit a bounded number of concurrent lines without logging request bodies or credentials. */
async function handleLine(line) {
  if (!line.trim()) {
    return
  }
  let message
  try {
    message = JSON.parse(line)
    if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      throw new Error('Invalid JSON-RPC request')
    }
  } catch {
    fail(null, 'Invalid JSON-RPC request', -32_700)
    return
  }
  if (message.method === 'notifications/cancelled') {
    requests.get(message.params?.requestId)?.abort()
    return
  }
  if (pending >= MAX_PENDING_REQUESTS) {
    if (message.id !== undefined) {
      fail(message.id, 'Too many pending MCP requests')
    }
    return
  }
  const controller = new AbortController()
  if (message.id !== undefined) {
    requests.set(message.id, controller)
  }
  pending += 1
  try {
    await forward(message, controller)
  } catch (error) {
    if (message.id !== undefined) {
      fail(
        message.id,
        error instanceof Error && error.code === 'ENOENT'
          ? 'Start VidBee Desktop before connecting MCP'
          : error instanceof Error
            ? error.message
            : 'Desktop MCP unavailable'
      )
    }
  } finally {
    if (message.id !== undefined) {
      requests.delete(message.id)
    }
    pending -= 1
    if (ended && pending === 0) {
      process.exitCode = 0
    }
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      fail(null, 'MCP request exceeds 1 MiB', -32_600)
    } else {
      void handleLine(line)
    }
    newline = buffer.indexOf('\n')
  }
  if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
    fail(null, 'MCP request exceeds 1 MiB', -32_600)
    process.stdin.destroy()
    buffer = ''
  }
})
process.stdin.on('end', () => {
  ended = true
  if (buffer.trim()) {
    void handleLine(buffer)
  }
  buffer = ''
})
