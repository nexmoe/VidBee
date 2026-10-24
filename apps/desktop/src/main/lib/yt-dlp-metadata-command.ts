import { spawn } from 'node:child_process'
import {
  backgroundChildSpawnOptions,
  killProcessTree,
  lowerChildPriority
} from '@vidbee/task-queue/process'
import { createBoundedTextBuffer } from './bounded-output-buffer'

const MAX_METADATA_BYTES = 64 * 1024 * 1024

/** Capture complete JSON separately from truncatable diagnostic output. */
export const runYtDlpMetadataCommand = (
  executable: string,
  args: string[],
  signal?: AbortSignal
): Promise<string> =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...backgroundChildSpawnOptions()
    })
    lowerChildPriority(child.pid)
    let chunks: Buffer[] = []
    let bytes = 0
    let stderr = createBoundedTextBuffer()
    let settled = false

    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort)
      chunks = []
      stderr = createBoundedTextBuffer()
    }
    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (child.exitCode === null && child.signalCode === null) {
        killProcessTree(child.pid, 'SIGKILL')
      }
      reject(error)
    }
    const abort = (): void => {
      const error = new Error('Metadata request aborted')
      error.name = 'AbortError'
      fail(error)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }
      bytes += chunk.byteLength
      if (bytes > MAX_METADATA_BYTES) {
        fail(new Error('yt-dlp metadata exceeds the 64 MiB safety limit'))
        return
      }
      chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!settled) {
        stderr.append(chunk)
      }
    })
    child.stdout?.once('error', fail)
    child.stderr?.once('error', fail)
    child.once('error', fail)
    child.once('close', (code) => {
      if (settled) {
        return
      }
      if (code !== 0 || bytes === 0) {
        fail(new Error(stderr.get() || `yt-dlp metadata exited with code ${String(code)}`))
        return
      }
      try {
        // Decode once so UTF-8 characters split across chunks remain intact.
        const stdout = Buffer.concat(chunks, bytes).toString('utf8')
        settled = true
        cleanup()
        resolve(stdout)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
    }
  })
