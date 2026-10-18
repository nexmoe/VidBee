import { spawn } from 'node:child_process'
import { backgroundChildSpawnOptions, lowerChildPriority } from '@vidbee/task-queue/process'
import { createBoundedTextBuffer } from './bounded-output-buffer'
import type {
  KernelCommandOptions,
  KernelCommandResult,
  KernelCommandRunner
} from './ytdlp-kernel-service'

/**
 * Execute a kernel binary without a shell and enforce timeout and abort limits.
 */
export const runKernelCommand: KernelCommandRunner = (
  executable: string,
  args: string[],
  options: KernelCommandOptions
): Promise<KernelCommandResult> =>
  new Promise((resolve, reject) => {
    const stdout = createBoundedTextBuffer()
    const stderr = createBoundedTextBuffer()
    let aborted = false
    let timedOut = false
    const child = spawn(executable, args, {
      env: { ...process.env, NO_COLOR: '1' },
      shell: false,
      windowsHide: true,
      ...backgroundChildSpawnOptions()
    })
    lowerChildPriority(child.pid)

    const abort = (): void => {
      aborted = true
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk))
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) {
      abort()
    }

    child.once('error', (error) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (aborted) {
        reject(new Error(`Kernel command aborted: ${executable}`))
        return
      }
      if (timedOut) {
        reject(new Error(`Kernel command timed out after ${options.timeoutMs}ms: ${executable}`))
        return
      }
      if (code !== 0) {
        reject(
          new Error(
            `Kernel command exited with code ${String(code)}: ${executable} ${stderr.get()}`.trim()
          )
        )
        return
      }
      resolve({ stderr: stderr.get(), stdout: stdout.get() })
    })
  })
