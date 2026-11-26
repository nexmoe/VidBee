import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fixture, input, records, start, subtitleSettings } from './helpers.mjs'

const optOuts = ['--no-write-subs', '--no-write-auto-subs', '--no-embed-subs']

for (const kind of ['video', 'audio']) {
  test(`user gets fresh ${kind} with subtitles disabled`, { timeout: 10_000 }, async (t) => {
    // Given the user's new task has all subtitle settings off.
    const { root, executor } = await fixture(t, {
      downloadSubtitles: false,
      embedSubs: false,
      writeAutoSubs: false
    })
    // When the actual executor and locked wrapper run the owned CLI.
    const result = await start(executor, { ...input, kind }).finished
    // Then media is present and the CLI contract explicitly opts out of all subtitles.
    assert.equal(result.result.type, 'success')
    assert.equal(result.result.output.size, 19)
    assert.equal(await readFile(result.result.output.filePath, 'utf8'), 'owned-media-fixture')
    const invocations = await records(root)
    assert.equal(invocations.length, 1)
    for (const flag of optOuts) {
      assert.equal(invocations[0].args.includes(flag), true)
    }
  })
}

test('user retains saved subtitle settings when retrying an older task', async (t) => {
  // Given global subtitles are off but an older task stored subtitles on.
  const { executor } = await fixture(t, { downloadSubtitles: false })
  // When the user inspects commands for the fresh and stored tasks.
  const fresh = executor.describeCommandFor(input)
  const stored = executor.describeCommandFor({ ...input, options: { settings: subtitleSettings } })
  // Then only the stored task still requests subtitles; the reporter's disabled path remains unconfirmed.
  assert.match(fresh, /--no-write-subs/)
  assert.match(stored, / --write-subs /)
})

for (const scenario of ['subtitle429', 'long-output']) {
  test(`user receives media after optional French subtitles fail (${scenario})`, {
    timeout: 10_000
  }, async (t) => {
    // Given requested optional subtitles fail with the reported HTTP 429 and a real exit 1.
    const { root, executor } = await fixture(t, subtitleSettings, scenario)
    // When the real locked wrapper emits its error through the production executor.
    const attempt = start(executor)
    const result = await attempt.finished
    // Then the media-only recovery completes one attempt with a failed subtitle acquisition.
    assert.equal(result.result.type, 'success', JSON.stringify(result.result))
    assert.equal(result.result.output.subtitleStatus, 'failed')
    assert.equal(result.result.output.subtitleAcquisition.id, attempt.ctx.attemptId)
    assert.equal(result.result.output.size, 19)
    assert.equal(result.result.output.formatId, '137+140')
    assert.equal(await readFile(result.result.output.filePath, 'utf8'), 'owned-media-fixture')
    assert.equal(attempt.spawns.length, 1)
    assert.equal(attempt.finishes.length, 1)
    assert.equal(result.attemptId, attempt.ctx.attemptId)
    assert.equal(
      attempt.logs.filter((event) => event.line.includes('[VidBee] Subtitle download failed'))
        .length,
      1
    )
    const invocations = await records(root)
    assert.equal(invocations.length, 2)
    assert.equal(invocations[1].args.at(-1), input.url)
    for (const flag of optOuts) {
      assert.equal(invocations[1].args.includes(flag), true)
    }
    for (const flag of [
      '--write-subs',
      '--write-auto-subs',
      '--embed-subs',
      '--sub-langs',
      '--sleep-subtitles'
    ]) {
      assert.equal(invocations[1].args.includes(flag), false)
    }
  })
}

for (const [scenario, expectedRuns, category] of [
  ['fail-twice', 2, 'http-429'],
  ['media403', 1, 'unknown'],
  ['retry-launch-failure', 1, 'http-429']
]) {
  test(`user sees a bounded failure for ${scenario}`, { timeout: 10_000 }, async (t) => {
    // Given subtitles are enabled and the CLI encounters the selected failure.
    const { root, executor } = await fixture(t, subtitleSettings, scenario)
    // When the user downloads through the real wrapper.
    const attempt = start(executor)
    const result = await attempt.finished
    // Then recovery is bounded and the final failure is exposed once.
    assert.equal(result.result.type, 'error')
    assert.equal(result.result.error.category, category)
    if (scenario === 'retry-launch-failure') {
      assert.match(result.result.error.rawMessage, /ENOENT/)
    }
    assert.equal((await records(root)).length, expectedRuns)
    assert.equal(attempt.finishes.length, 1)
  })
}

for (const mode of ['raw-args', 'custom-builder']) {
  test(`user keeps ${mode} behavior without automatic subtitle recovery`, {
    timeout: 10_000
  }, async (t) => {
    // Given the caller owns the extractor arguments.
    const args = ['--write-subs', input.url]
    const overrides = mode === 'custom-builder' ? { buildArgs: () => [...args] } : {}
    const { root, executor } = await fixture(t, subtitleSettings, 'subtitle429', overrides)
    // When that invocation fails with the subtitle error.
    const result = await start(executor, mode === 'raw-args' ? { ...input, rawArgs: args } : input)
      .finished
    // Then the caller receives the failure and its invocation is not rewritten or repeated.
    assert.equal(result.result.type, 'error')
    assert.equal(result.result.error.category, 'http-429')
    assert.equal((await records(root)).length, 1)
  })
}

for (const phase of ['initial', 'retry']) {
  for (const action of ['cancel', 'pause']) {
    test(`user can ${action} during the ${phase} process`, { timeout: 10_000 }, async (t) => {
      // Given a live owned child waits during the requested phase.
      const { root, executor } = await fixture(t, subtitleSettings, `hold-${phase}`)
      let signalReady
      const ready = new Promise((resolve) => {
        signalReady = resolve
      })
      const attempt = start(executor, input, (event) => {
        if (event.line.includes(`FIXTURE_READY:${phase}`)) {
          signalReady()
        }
      })
      await ready
      // When the user stops this attempt with its original cancellation handle.
      await attempt.run[action]()
      const result = await attempt.finished
      // Then the child exits, the attempt ends once as cancelled, and no further retry is launched.
      assert.equal(result.result.type, 'cancelled')
      assert.equal(attempt.finishes.length, 1)
      const invocations = await records(root)
      assert.equal(invocations.length, phase === 'initial' ? 1 : 2)
      for (const { pid } of invocations) {
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
      }
    })
  }
}

test('user cancellation at the fallback boundary does not launch a replacement child', {
  timeout: 10_000
}, async (t) => {
  // Given subtitle failure reaches the user-visible fallback log.
  const { root, executor } = await fixture(t)
  let attempt
  attempt = start(executor, input, (event) => {
    if (event.line.includes('[VidBee] Subtitle download failed')) {
      void attempt.run.cancel()
    }
  })
  // When cancellation is requested at that boundary.
  const result = await attempt.finished
  // Then the attempt is cancelled once without creating another process.
  assert.equal(result.result.type, 'cancelled')
  assert.equal((await records(root)).length, 1)
  assert.equal(attempt.finishes.length, 1)
})

for (const [scenario, expectedStatus] of [
  ['success-subs', 'downloaded'],
  ['unavailable', 'unavailable']
]) {
  test(`user retains the ${expectedStatus} subtitle outcome`, { timeout: 10_000 }, async (t) => {
    // Given subtitle acquisition succeeds or finds no matching language.
    const { root, executor } = await fixture(t, subtitleSettings, scenario)
    // When the task completes without an extractor error.
    const result = await start(executor).finished
    // Then its original subtitle outcome and media remain correct with no retry.
    assert.equal(result.result.type, 'success')
    assert.equal(result.result.output.subtitleStatus, expectedStatus)
    if (expectedStatus === 'downloaded') {
      assert.deepEqual(result.result.output.subtitleLanguages, ['fr', 'en'])
    }
    assert.equal((await records(root)).length, 1)
  })
}

test('user does not receive a stale output from the failed subtitle process', {
  timeout: 10_000
}, async (t) => {
  // Given a failed first process reported an old file but recovery creates no output.
  const { root, executor } = await fixture(t, subtitleSettings, 'stale-output')
  // When the real wrapper performs the internal retry.
  const result = await start(executor).finished
  // Then output discovery cannot promote the first process file to the recovered media.
  assert.equal((await records(root)).length, 2)
  assert.equal(result.result.type, 'success')
  assert.equal(result.result.output.filePath, '')
  assert.equal(result.result.output.size, 0)
})
