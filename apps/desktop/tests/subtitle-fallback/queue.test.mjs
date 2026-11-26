import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { fixture, input, jiti, records, subtitleSettings } from './helpers.mjs'

const { TaskQueueAPI } = await jiti.import('../../../../packages/task-queue/src/api/index.ts')
const { SqlitePersistAdapter } = await jiti.import(
  '../../../../packages/task-queue/src/persist/sqlite.ts'
)
const { TASK_QUEUE_DDL_V1 } = await jiti.import('../../../../packages/db/src/task-queue.ts')

async function queueFixture(t, scenario, settings = subtitleSettings) {
  const owned = await fixture(t, settings, scenario)
  const db = new Database(join(owned.root, 'queue.sqlite'))
  db.exec(TASK_QUEUE_DDL_V1)
  const queue = new TaskQueueAPI({
    persist: new SqlitePersistAdapter({ db, ownsConnection: false }),
    executor: owned.executor,
    maxConcurrency: 1,
    idleQueueKickMs: 0
  })
  await queue.start()
  const events = []
  queue.subscribe((event) => events.push(event))
  owned.cleanup.push(async () => {
    await queue.stop()
    db.close()
  })
  return { ...owned, db, queue, events }
}

function waitFor(queue, predicate) {
  let unsubscribe = () => {}
  const promise = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      unsubscribe()
      reject(new Error('Queue event deadline exceeded'))
    }, 10_000)
    unsubscribe = queue.subscribe((event) => {
      if (predicate(event)) {
        clearTimeout(deadline)
        unsubscribe()
        resolve(event)
      }
    })
  })
  return promise
}

async function waitUntilClosed(db, id) {
  const deadline = Date.now() + 10_000
  while (
    !(
      db.prepare('SELECT ended_at FROM attempts WHERE task_id = ?').get(id)?.ended_at &&
      db
        .prepare("SELECT count(*) AS n FROM process_journal WHERE task_id = ? AND op = 'close'")
        .get(id).n === 1
    )
  ) {
    if (Date.now() >= deadline) {
      throw new Error('Persisted attempt close deadline exceeded')
    }
    await new Promise(setImmediate)
  }
}

function assertSingleAttempt(db, id, category = null) {
  const attempts = db
    .prepare(
      'SELECT id, attempt_number, ended_at, exit_code, error_category FROM attempts WHERE task_id = ?'
    )
    .all(id)
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].attempt_number, 1)
  assert.equal(typeof attempts[0].ended_at, 'number')
  assert.equal(attempts[0].error_category, category)
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM process_journal WHERE task_id = ? AND op = 'spawn'")
      .get(id).n,
    1
  )
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM process_journal WHERE task_id = ? AND op = 'close'")
      .get(id).n,
    1
  )
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM process_journal WHERE op = 'panic'").get().n,
    0
  )
}

test('user receives recovered media as one completed persisted queue attempt', {
  timeout: 15_000
}, async (t) => {
  // Given an isolated SQLite queue and optional subtitles that fail with the reported 429.
  const { root, queue, db, events } = await queueFixture(t, 'subtitle429')
  const terminal = waitFor(
    queue,
    (event) =>
      event.type === 'transition' && ['completed', 'failed', 'retry-scheduled'].includes(event.to)
  )
  // When the user adds the task through the actual queue API.
  const { id } = await queue.add({ input })
  const event = await terminal
  // Then one persisted attempt completes with media and failed subtitle acquisition, without queue retry.
  assert.equal(event.to, 'completed')
  const task = queue.get(id)
  assert.equal(task.attempt, 1)
  assert.equal(task.output.subtitleStatus, 'failed')
  assert.equal(
    task.output.subtitleAcquisition.id,
    db.prepare('SELECT id FROM attempts WHERE task_id = ?').get(id).id
  )
  assert.equal(await readFile(task.output.filePath, 'utf8'), 'owned-media-fixture')
  assert.equal(
    JSON.parse(db.prepare('SELECT output_json FROM tasks WHERE id = ?').get(id).output_json)
      .subtitleStatus,
    'failed'
  )
  assert.equal((await records(root)).length, 2)
  assert.equal(
    events.filter((value) => value.type === 'transition' && value.to === 'completed').length,
    1
  )
  assert.equal(
    events.filter((value) => value.type === 'transition' && value.to === 'retry-scheduled').length,
    0
  )
  assertSingleAttempt(db, id)
})

for (const action of ['cancel', 'pause']) {
  test(`user can ${action} the internal retry through the persisted queue`, {
    timeout: 15_000
  }, async (t) => {
    // Given the retry child is running under the queue's original attempt handle.
    const { root, queue, db } = await queueFixture(t, 'hold-retry')
    const ready = waitFor(
      queue,
      (event) => event.type === 'log' && event.line.includes('FIXTURE_READY:retry')
    )
    const { id } = await queue.add({ input })
    await ready
    const expected = action === 'pause' ? 'paused' : 'cancelled'
    const terminal = waitFor(queue, (event) => event.type === 'transition' && event.to === expected)
    // When the user pauses or cancels through the actual queue API.
    await queue[action](id)
    await terminal
    // Then the task retains the correct stopped state and a single closed attempt.
    assert.equal(queue.get(id).status, expected)
    assert.equal(queue.get(id).attempt, 1)
    assert.equal(queue.get(id).output, null)
    await waitUntilClosed(db, id)
    assertSingleAttempt(db, id, 'cancelled-by-user')
    const invocations = await records(root)
    assert.equal(invocations.length, 2)
    for (const { pid } of invocations) {
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    }
  })
}

test('user sees output missing when the recovered process produces no media', {
  timeout: 15_000
}, async (t) => {
  // Given a failed first process reports a stale file and its retry produces nothing.
  const { queue, db } = await queueFixture(t, 'stale-output')
  const terminal = waitFor(
    queue,
    (event) =>
      event.type === 'transition' && ['completed', 'failed', 'retry-scheduled'].includes(event.to)
  )
  // When the user downloads through the real queue and filesystem guard.
  const { id } = await queue.add({ input })
  const event = await terminal
  // Then no stale output is promoted into the user's library.
  assert.equal(event.to, 'failed')
  assert.equal(queue.get(id).statusReason, 'output-missing')
  assert.equal(queue.get(id).output, null)
  assertSingleAttempt(db, id, 'output-missing')
})

// Surface: persisted downloader queue settings and recovery.
test('user retains stored task subtitle settings when global subtitles are off', {
  timeout: 15_000
}, async (t) => {
  // Given a stored task requests subtitles while global download settings disable them.
  const { root, queue, db } = await queueFixture(t, 'subtitle429', {
    downloadSubtitles: false,
    embedSubs: false,
    writeAutoSubs: false
  })
  const terminal = waitFor(
    queue,
    (event) =>
      event.type === 'transition' && ['completed', 'failed', 'retry-scheduled'].includes(event.to)
  )
  const taskInput = { ...input, options: { settings: subtitleSettings } }
  // When the queue runs the task and recovers from optional subtitle rate limiting.
  const { id } = await queue.add({ input: taskInput })
  const event = await terminal
  // Then the saved choice remains intact while recovered media records the subtitle failure.
  assert.equal(event.to, 'completed')
  const storedInput = JSON.parse(
    db.prepare('SELECT input_json FROM tasks WHERE id = ?').get(id).input_json
  )
  assert.equal(storedInput.kind, taskInput.kind)
  assert.equal(storedInput.url, taskInput.url)
  assert.deepEqual(storedInput.options.settings, subtitleSettings)
  assert.equal(queue.get(id).output.subtitleStatus, 'failed')
  const invocations = await records(root)
  assert.equal(invocations.length, 2)
  assert.equal(invocations[0].args.includes('--write-subs'), true)
  assert.equal(invocations[1].args.includes('--no-write-subs'), true)
  assertSingleAttempt(db, id)
})
