import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveStartupDownloadPath } from '../../../apps/desktop/src/main/lib/download-path-policy'
import { startDownloadPowerSaveGuard } from '../../../apps/desktop/src/main/lib/download-power-save'
import {
  buildDownloadArgs,
  buildPlaylistInfoArgs,
  buildVideoInfoArgs,
  parseDownloadTimecode,
  VIDBEE_OUTPUT_PATH_PREFIX,
  YtDlpExecutor
} from '../../../packages/downloader-core/src'
import type { ExecutorEvents, Task, TransitionEvent } from '../../../packages/task-queue/src'

const temporaryDirectories: string[] = []

/** Create a temporary directory that is removed after each test. */
const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vidbee-core-'))
  temporaryDirectories.push(directory)
  return directory
}

/** Minimal yt-dlp process double with writable stdout and stderr streams. */
class FakeYtDlpProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly ytDlpProcess = {
    pid: 42,
    stdout: this.stdout,
    stderr: this.stderr,
    kill: () => true
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('downloader-core regressions', () => {
  it('preserves an explicit external path in portable mode', () => {
    const resolved = resolveStartupDownloadPath({
      currentPath: '/media/nas/downloads',
      defaultPath: '/portable/VidBee/Downloads',
      oldDefaultPath: '/home/user/Downloads',
      portableMode: true,
      portableRoot: '/portable/VidBee',
      previousPortableRoot: '/old/VidBee'
    })

    expect(resolved).toBe('/media/nas/downloads')
  })

  it('remaps a path stored under the previous portable root', () => {
    const resolved = resolveStartupDownloadPath({
      currentPath: '/old/VidBee/Downloads/Shows',
      defaultPath: '/portable/VidBee/Downloads',
      oldDefaultPath: '/home/user/Downloads',
      portableMode: true,
      portableRoot: '/portable/VidBee',
      previousPortableRoot: '/old/VidBee'
    })

    expect(resolved).toBe('/portable/VidBee/Downloads/Shows')
  })

  it('blocks suspension only while downloads are active', () => {
    const listeners = new Set<(event: TransitionEvent) => void>()
    const tasks: Pick<Task, 'id' | 'status'>[] = []
    const startedIds: number[] = []
    const stoppedIds: number[] = []
    const queue = {
      list: () => ({ nextCursor: null, tasks }),
      on: (_type: 'transition', listener: (event: TransitionEvent) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    const blocker = {
      isStarted: (id: number) => startedIds.includes(id) && !stoppedIds.includes(id),
      start: () => {
        const id = startedIds.length + 1
        startedIds.push(id)
        return id
      },
      stop: (id: number) => {
        stoppedIds.push(id)
        return true
      }
    }
    const stopGuard = startDownloadPowerSaveGuard(queue, blocker)

    for (const listener of listeners) {
      listener({
        at: 1,
        attempt: 1,
        from: 'queued',
        reason: null,
        taskId: 'one',
        to: 'running',
        type: 'transition'
      })
      listener({
        at: 2,
        attempt: 1,
        from: 'running',
        reason: null,
        taskId: 'one',
        to: 'processing',
        type: 'transition'
      })
      listener({
        at: 3,
        attempt: 1,
        from: 'processing',
        reason: null,
        taskId: 'one',
        to: 'completed',
        type: 'transition'
      })
    }

    expect(startedIds).toEqual([1])
    expect(stoppedIds).toEqual([1])
    stopGuard()
    expect(listeners.size).toBe(0)
  })

  it('uses the watermark filename only when sharing is enabled', () => {
    const baseOptions = {
      type: 'video' as const,
      url: 'https://example.com/watch/1'
    }
    const regularArgs = buildDownloadArgs(baseOptions, '/downloads', { shareWatermark: false })
    const sharedArgs = buildDownloadArgs(baseOptions, '/downloads', { shareWatermark: true })

    expect(regularArgs[regularArgs.indexOf('-o') + 1]).toBe(
      path.join('/downloads', '%(title)s.%(ext)s')
    )
    expect(sharedArgs[sharedArgs.indexOf('-o') + 1]).toBe(
      path.join('/downloads', '%(title)s via VidBee.%(ext)s')
    )
  })

  it('excludes optional chat tracks from subtitle downloads', () => {
    const args = buildDownloadArgs(
      { type: 'video', url: 'https://www.youtube.com/watch?v=example' },
      '/downloads',
      { embedSubs: true }
    )

    expect(args[args.indexOf('--sub-langs') + 1]).toBe('all,-live_chat,-rechat')
  })

  it('isolates metadata probes from implicit config and retries transient failures', () => {
    const videoArgs = buildVideoInfoArgs('https://x.com/example/status/1', {})
    const playlistArgs = buildPlaylistInfoArgs('https://example.com/playlist/1', {})

    for (const args of [videoArgs, playlistArgs]) {
      expect(args).toContain('--ignore-config')
      expect(args[args.indexOf('--retries') + 1]).toBe('30')
      expect(args[args.indexOf('--retry-sleep') + 1]).toBe('2')
      expect(args[args.indexOf('--socket-timeout') + 1]).toBe('30')
    }
  })

  it('keeps an explicitly selected yt-dlp config', () => {
    const args = buildVideoInfoArgs('https://example.com/watch/1', {
      configPath: '~/custom.conf'
    })

    expect(args).toContain('--config-location')
    expect(args).not.toContain('--ignore-config')
  })

  it('rejects a single media segment with page URL guidance', () => {
    expect(() => buildVideoInfoArgs('https://cdn.example.com/segment-12.m4s?token=1', {})).toThrow(
      'Paste the original video page URL instead'
    )
  })

  it('validates and normalizes download time ranges', () => {
    const args = buildDownloadArgs(
      {
        endTime: ' 02:30 ',
        startTime: ' 01:15 ',
        type: 'video',
        url: 'https://example.com/watch/1'
      },
      '/downloads',
      {}
    )

    expect(args[args.indexOf('--download-sections') + 1]).toBe('*01:15-02:30')
    expect(parseDownloadTimecode('1:02:03')).toBe(3723)
    expect(() =>
      buildDownloadArgs(
        {
          endTime: '00:30',
          startTime: '00:45',
          type: 'video',
          url: 'https://example.com/watch/1'
        },
        '/downloads',
        {}
      )
    ).toThrow('End time must be later than start time')
  })

  it('prints and retains a final output path after the log tail rolls over', async () => {
    const directory = createTemporaryDirectory()
    const filePath = path.join(directory, 'saved video.mp4')
    writeFileSync(filePath, 'downloaded')
    const fakeProcess = new FakeYtDlpProcess()
    const executor = new YtDlpExecutor({
      defaultDownloadDir: directory,
      resolveFfmpegLocation: () => directory,
      resolveYtDlpPath: () => '/fake/yt-dlp',
      spawnFn: () => fakeProcess
    })
    const finishPromise = new Promise<Parameters<ExecutorEvents['onFinish']>[0]>((resolve) => {
      executor.run(
        {
          attemptId: 'attempt-1',
          attemptNumber: 1,
          input: { kind: 'video', url: 'https://example.com/watch/1' },
          taskId: 'task-1'
        },
        {
          onFinish: resolve,
          onProgress: () => undefined,
          onSpawn: () => undefined,
          onStd: () => undefined
        }
      )
    })

    fakeProcess.stdout.write(`[download] Destination: "${filePath}"\n`)
    fakeProcess.stdout.write('x'.repeat(10 * 1024))
    fakeProcess.emit('close', 0)

    const finish = await finishPromise
    expect(finish.result.type).toBe('success')
    if (finish.result.type === 'success') {
      expect(finish.result.output.filePath).toBe(filePath)
      expect(finish.result.output.size).toBeGreaterThan(0)
    }

    const command = executor.describeCommandFor({
      kind: 'video',
      url: 'https://example.com/watch/1'
    })
    expect(command).toContain(`after_move:${VIDBEE_OUTPUT_PATH_PREFIX}%(filepath)s`)
  })
})
