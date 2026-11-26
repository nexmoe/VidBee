import { parseSync } from 'vite'

// Scope governance to this new integration suite; strings and comments are not code.
export function validateScenarioSource(filename, source) {
  const { program, comments, errors } = parseSync(filename, source)
  const failures = errors.map((error) => error.message)
  const tests = new Set()
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration' || node.source.value !== 'node:test') {
      continue
    }
    for (const specifier of node.specifiers) {
      if (specifier.imported?.name === 'mock') {
        failures.push('mock imports are forbidden')
      }
      if (['test', 'it', 'describe'].includes(specifier.imported?.name)) {
        tests.add(specifier.local.name)
      }
    }
  }
  const walk = (node) => {
    if (!node || typeof node !== 'object') {
      return
    }
    if (node.type === 'CallExpression') {
      let callee = node.callee
      const members = []
      while (callee.type === 'MemberExpression') {
        members.push(callee.property.name ?? callee.property.value)
        callee = callee.object
      }
      if (tests.has(callee.name)) {
        if (members.some((name) => ['only', 'skip', 'todo'].includes(name))) {
          failures.push('focused or skipped scenarios are forbidden')
        }
        const title = node.arguments[0]
        const prefix = title?.value ?? title?.quasis?.[0]?.value?.cooked ?? ''
        if (!prefix.startsWith('user ')) {
          failures.push('scenario names must start with user ')
        }
        const callback = node.arguments.at(-1)
        const steps = comments
          .filter((comment) => comment.start >= callback.start && comment.end <= callback.end)
          .map((comment) => comment.value.trim())
          .filter((comment) => /^(Given|When|Then)\s+\S/.test(comment))
        if (
          steps.length !== 3 ||
          !steps[0].startsWith('Given ') ||
          !steps[1].startsWith('When ') ||
          !steps[2].startsWith('Then ')
        ) {
          failures.push('scenarios need ordered, nonempty Given/When/Then comments')
        }
      }
      if (
        members.some((name) =>
          ['mock', 'spyOn', 'toBeTruthy', 'toBeDefined', 'waitForTimeout'].includes(name)
        )
      ) {
        failures.push('mocks, spies, empty assertions and fixed waits are forbidden')
      }
      if (callee.name === 'setTimeout' && node.arguments[0]?.type === 'Literal') {
        failures.push('fixed sleeps are forbidden; use event deadlines')
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          walk(child)
        }
      } else if (value && typeof value === 'object') {
        walk(value)
      }
    }
  }
  walk(program)
  return failures
}
