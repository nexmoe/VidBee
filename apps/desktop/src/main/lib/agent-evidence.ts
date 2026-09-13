import type { AgentChatRun } from '../../shared/agent-chat'
import type { AgentTranscriptLine } from './agent-tools'

/** Track source characters independently of query-local pagination and compacted message positions. */
export class AgentEvidence {
  readonly coverage: NonNullable<AgentChatRun['evidenceCoverage']>

  /** Copy branch state so retries cannot mutate an ancestor's coverage. */
  constructor(coverage: AgentChatRun['evidenceCoverage'] = {}) {
    this.coverage = structuredClone(coverage)
  }

  /** Merge overlapping character intervals and return only genuinely new source coverage. */
  record(source: string, line: number, start: number, length: number): number {
    const key = `${source}:${line}`
    const previous = this.coverage[key] ?? []
    const before = previous.reduce((sum, [a, b]) => sum + b - a, 0)
    const merged: [number, number][] = []
    for (const range of [...previous, [start, start + length] as [number, number]].sort(
      (a, b) => a[0] - b[0]
    )) {
      const last = merged.at(-1)
      if (last && range[0] <= last[1]) {
        last[1] = Math.max(last[1], range[1])
      } else {
        merged.push([...range])
      }
    }
    this.coverage[key] = merged
    return merged.reduce((sum, [a, b]) => sum + b - a, 0) - before
  }

  /** Report global coverage and a valid unfiltered resume cursor without claiming unseen text was read. */
  describe(source: string, lines: AgentTranscriptLine[]): Record<string, unknown> {
    let completedLines = 0
    let firstUnread: { offset: number; textOffset: number } | null = null
    let charactersRead = 0
    for (const [index, line] of lines.entries()) {
      const ranges = this.coverage[`${source}:${index}`] ?? []
      charactersRead += ranges.reduce((sum, [a, b]) => sum + b - a, 0)
      const prefix = ranges[0]?.[0] === 0 ? ranges[0][1] : 0
      if (prefix >= line.text.length) {
        completedLines += 1
      } else {
        firstUnread ??= { offset: index, textOffset: prefix }
      }
    }
    return {
      source,
      totalLines: lines.length,
      completedLines,
      charactersRead,
      firstUnread,
      cursorScope:
        'Global source; omit start/end when using firstUnread. Reading all text is only necessary when the task requires it.'
    }
  }
}
