import fs from 'node:fs/promises'
import path from 'node:path'

const here = path.resolve(import.meta.dirname, '../../../../.cache/issue-474')
const scope = [
  ['main', 'apps/desktop/src/main/lib/thumbnail-cache.ts'],
  ['main', 'apps/desktop/src/main/ipc/services/thumbnail-service.ts'],
  ['renderer', 'apps/desktop/src/renderer/src/hooks/use-cached-thumbnail.ts']
]
const results = []
for (const [side, file] of scope) {
  const bundle = `${side === 'main' ? 'main.mjs' : 'renderer.js'}`
  const text = await fs.readFile(path.join(here, bundle), 'utf8')
  const markers = [
    ...text.matchAll(/^\s*\/\/ ((?:apps|packages|node_modules|\.cache)\/[^\n]+)\n/gm)
  ]
  const spans = markers.flatMap((marker, i) =>
    marker[1] === file ? [[marker.index, markers[i + 1]?.index ?? text.length]] : []
  )
  const coverage = JSON.parse(
    await fs.readFile(path.join(here, `receipts/regression-${side}-coverage.json`), 'utf8')
  ).result.find((script) => script.url.endsWith(bundle))
  if (!coverage || spans.length === 0) {
    throw new Error(`Missing full declared coverage scope: ${file}`)
  }
  const functions = coverage.functions.filter((fn) =>
    spans.some(([start, end]) => fn.ranges[0].startOffset >= start && fn.ranges[0].endOffset <= end)
  )
  const ranges = functions.flatMap((fn) => fn.ranges)
  const covered = ranges.filter((range) => range.count > 0).length
  const uncovered = functions
    .filter((fn) => fn.ranges.some((range) => range.count === 0))
    .map((fn) => ({
      name: fn.functionName,
      zeroRanges: fn.ranges.filter((range) => range.count === 0).length
    }))
  results.push({
    file,
    covered,
    total: ranges.length,
    percent: (100 * covered) / ranges.length,
    uncovered
  })
}
const covered = results.reduce((n, result) => n + result.covered, 0)
const total = results.reduce((n, result) => n + result.total, 0)
const receipt = {
  metric:
    'V8 precise function/block-range branch coverage across all three changed production files, including unexecuted function entries; not Istanbul or whole-application coverage',
  covered,
  total,
  percent: (100 * covered) / total,
  files: results
}
await fs.writeFile(path.join(here, 'receipts/coverage.json'), JSON.stringify(receipt, null, 2))
console.info(JSON.stringify(receipt, null, 2))
if (receipt.percent < 70) {
  process.exitCode = 1
}
