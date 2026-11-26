import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateScenarioSource } from './check-tests.mjs'

// Surface: scoped integration-scenario lint contract.
test('user can maintain readable acceptance scenarios without false positives in examples', () => {
  // Given a scenario using an aliased node:test import and a harmless example string.
  const source = `import { test as scenario } from 'node:test'
  scenario('user downloads media', () => {
    // Given subtitles are optional.
    const example = 'test.only mock.spyOn waitForTimeout'
    // When the download runs.
    const result = 'completed'
    // Then media is available.
    assert.equal(result, 'completed')
  })`
  // When the scoped AST check reads the source.
  const failures = validateScenarioSource('valid.test.mjs', source)
  // Then the compliant scenario has no lint errors.
  assert.deepEqual(failures, [])
})

test('user is protected from unreadable or disabled acceptance scenarios', () => {
  // Given aliased focused tests, missing steps, mocks, empty assertions and a fixed wait.
  const source = `import { test as scenario, mock as pretend } from 'node:test'
  scenario.only('implementation detail', () => { thing.spyOn(); setTimeout(100); expect(result).toBeTruthy() })`
  // When the scoped AST check reads the invalid source.
  const failures = validateScenarioSource('invalid.test.mjs', source)
  // Then each deterministically detectable violation is rejected.
  assert.equal(failures.includes('mock imports are forbidden'), true)
  assert.equal(failures.includes('focused or skipped scenarios are forbidden'), true)
  assert.equal(failures.includes('scenario names must start with user '), true)
  assert.equal(failures.includes('scenarios need ordered, nonempty Given/When/Then comments'), true)
  assert.equal(
    failures.includes('mocks, spies, empty assertions and fixed waits are forbidden'),
    true
  )
  assert.equal(failures.includes('fixed sleeps are forbidden; use event deadlines'), true)
})
