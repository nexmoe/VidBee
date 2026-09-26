import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { TaskQueueAPI } from '../../task-queue/src/api'
import { MemoryPersistAdapter } from '../../task-queue/src/persist/memory'
import { YtDlpExecutor } from '../src/yt-dlp-executor'

class FakeProcess extends EventEmitter {
  ytDlpProcess = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: () => true
  }
}

const createDownload = async () => {
  let now = 1_000_000
  let timerId = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const process = new FakeProcess()
  const queue = new TaskQueueAPI({
    persist: new MemoryPersistAdapter(),
    executor: new YtDlpExecutor({
      resolveYtDlpPath: () => 'yt-dlp',
      resolveFfmpegLocation: () => '/unused',
      defaultDownloadDir: '/unused',
      spawnFn: () => process,
      clock: () => now
    }),
    clock: () => now,
    setTimer: (fn, ms) => {
      timerId += 1
      timers.set(timerId, { at: now + ms, fn })
      return timerId
    },
    clearTimer: (id) => timers.delete(id as number),
    idleQueueKickMs: 0
  })
  await queue.start()
  const { id } = await queue.add({ input: { url: 'https://example.com/video', kind: 'video' } })
  await setImmediate()
  assert.equal(queue.get(id)?.status, 'running')
  const advance = async (ms: number) => {
    now += ms
    for (const [key, timer] of [...timers]) {
      if (timer.at <= now) {
        timers.delete(key)
        timer.fn()
      }
    }
    await setImmediate()
  }
  return { queue, id, process, advance }
}

for (const stream of ['stdout', 'stderr'] as const) {
  test(`a split merge line on ${stream} promotes the queue before another progress event`, async (t) => {
    const { queue, id, process, advance } = await createDownload()
    t.after(() => queue.stop())
    process.emit('progress', { percent: 100, totalSize: '100MiB' })
    process.ytDlpProcess[stream].emit('data', Buffer.from('[Merger] Merg'))
    assert.equal(queue.get(id)?.status, 'running')
    process.ytDlpProcess[stream].emit('data', Buffer.from('ing formats into "video.mp4"\n'))
    await setImmediate()
    assert.equal(queue.get(id)?.status, 'processing')
    assert.equal(queue.get(id)?.progress.percent, 1)
    process.emit('progress', { percent: 100, totalSize: '100MiB' })
    assert.equal(queue.get(id)?.status, 'processing')
    await advance(61_000)
    assert.equal(queue.get(id)?.status, 'processing')
    await advance(539_000)
    assert.equal(queue.get(id)?.status, 'retry-scheduled')
    assert.equal(queue.get(id)?.lastError?.category, 'stalled')
    assert.match(queue.get(id)?.lastError?.rawMessage ?? '', /phase=processing, idleMs=600000/)
  })
}

test('a silent download still stalls after sixty seconds', async (t) => {
  const { queue, id, advance } = await createDownload()
  t.after(() => queue.stop())
  await advance(61_000)
  assert.equal(queue.get(id)?.status, 'retry-scheduled')
  assert.equal(queue.get(id)?.lastError?.category, 'stalled')
  assert.match(queue.get(id)?.lastError?.rawMessage ?? '', /phase=running, idleMs=61000/)
})

test('a filename mentioning FFmpeg is not a processing signal', async (t) => {
  const { queue, id, process, advance } = await createDownload()
  t.after(() => queue.stop())
  process.ytDlpProcess.stdout.emit(
    'data',
    Buffer.from('[download] Destination: FFmpeg tutorial.mp4\n')
  )
  process.emit('progress', { percent: 50, totalSize: '100MiB' })
  assert.equal(queue.get(id)?.status, 'running')
  await advance(61_000)
  assert.equal(queue.get(id)?.status, 'retry-scheduled')
})

test('postprocessing starts without any percentage and buffers stdout and stderr separately', async (t) => {
  const { queue, id, process, advance } = await createDownload()
  t.after(() => queue.stop())
  process.ytDlpProcess.stdout.emit('data', Buffer.from('[Extract'))
  process.ytDlpProcess.stderr.emit('data', Buffer.from('Audio] Destination: audio.m4a\n'))
  assert.equal(queue.get(id)?.status, 'running')
  process.ytDlpProcess.stdout.emit('data', Buffer.from('Audio] Destination: audio.m4a\n'))
  assert.equal(queue.get(id)?.status, 'processing')
  assert.equal(queue.get(id)?.progress.percent, null)
  await advance(61_000)
  assert.equal(queue.get(id)?.status, 'processing')
})
