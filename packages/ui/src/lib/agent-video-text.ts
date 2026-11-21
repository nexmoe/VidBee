import { type AgentSkillLabel, agentSkillTextParts } from './agent-skill-text'

export interface AgentVideoReference {
  id: string
  title: string
}

const VIDEO_REFERENCE = /@\[((?:\\.|[^\]\\\r\n])*)\]\(task:([^\s)]+)\)/g
const ESCAPED_LABEL = /\\([\\[\]])/g

/** Keep a readable title and an exact task identity in drafts, copied text and message history. */
export function agentVideoToken(video: AgentVideoReference): string {
  const title = video.title.replace(/[\r\n]/g, ' ').replace(/[\\[\]]/g, '\\$&')
  return `@[${title}](task:${encodeURIComponent(video.id)})`
}

/** Split video references and known skill commands without changing their order or original text. */
export function agentMentionTextParts(
  text: string,
  resolve: (name: string) => AgentSkillLabel | undefined,
  names: Iterable<string> = []
): { text: string; start: number; skill?: AgentSkillLabel; video?: AgentVideoReference }[] {
  const parts: ReturnType<typeof agentMentionTextParts> = []
  const available = [...names]
  let cursor = 0
  /** Preserve canonical offsets when splitting ordinary text into skill commands. */
  function appendSkills(end: number): void {
    for (const part of agentSkillTextParts(text.slice(cursor, end), resolve, available)) {
      parts.push({ ...part, start: cursor + part.start })
    }
  }
  for (const match of text.matchAll(VIDEO_REFERENCE)) {
    let id: string
    try {
      id = decodeURIComponent(match[2] ?? '')
    } catch {
      continue
    }
    if (!id) {
      continue
    }
    appendSkills(match.index)
    parts.push({
      text: match[0],
      start: match.index,
      video: { id, title: (match[1] ?? '').replace(ESCAPED_LABEL, '$1') }
    })
    cursor = match.index + match[0].length
  }
  appendSkills(text.length)
  return parts
}
