import type { AgentArtifact } from './agent-chat'
import { PROMPT_CLOCK_PATTERN, parsePromptClock } from './ai-prompt-text'

/** Markdown image or link: `![alt](url)` / `[alt](url)`. */
export const AGENT_MARKDOWN_MEDIA = /(!?)\[([^\]]*)\]\(([^)]+)\)/g

/** Legacy matcher for `artifact:` UUID citations, including image and link forms. */
export const ARTIFACT_REFERENCE = /!?\[([^\]]*)\]\(artifact:([0-9a-f-]{36})\)/gi

const ARTIFACT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ARTIFACT_PREFIX = /^[0-9a-f]{8,}$/i
const IMAGE_CUE_RANGE = /(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b|s\b)/i

export interface AgentResponsePart {
  key: string
  text?: string
  artifact?: AgentArtifact
  caption?: string
}

/** Read a stored screenshot from `artifact:uuid`, a bare uuid, or a unique 8+ character prefix. */
export function artifactIdFromUrl(
  url: string,
  artifacts: AgentArtifact[] = []
): string | undefined {
  const raw = url.trim().replace(/^artifact:/i, '')
  if (ARTIFACT_UUID.test(raw)) {
    return raw.toLowerCase()
  }
  if (!ARTIFACT_PREFIX.test(raw)) {
    return undefined
  }
  const needle = raw.toLowerCase()
  const matches = artifacts.filter((item) => {
    const id = item.id.toLowerCase()
    return id.startsWith(needle) || id.replace(/-/g, '').startsWith(needle)
  })
  return matches.length === 1 ? matches[0].id.toLowerCase() : undefined
}

/** Read a screenshot's clock or the midpoint of a cited subtitle range in seconds. */
export function clockFromImage(alt: string, url: string): number | null {
  const matches = `${alt} ${url}`.match(new RegExp(PROMPT_CLOCK_PATTERN, 'g'))
  const token = matches?.at(-1)
  if (token) {
    return parsePromptClock(token)
  }
  const range = alt.match(IMAGE_CUE_RANGE)
  if (!range) {
    return null
  }
  const start = Number(range[1])
  const end = Number(range[2])
  return end >= start ? (start + end) / 2 : null
}

/** Pick the unused image from this run whose source time is closest to the cited clock. */
export function matchArtifactByClock(
  artifacts: AgentArtifact[],
  used: Set<string>,
  time: number | null,
  runId?: string
): AgentArtifact | undefined {
  if (time === null) {
    return undefined
  }
  return artifacts
    .filter(
      (artifact) =>
        artifact.kind === 'image' &&
        !used.has(artifact.id) &&
        Math.abs(artifact.start - time) <= 5 &&
        (runId === undefined || artifact.runId === runId)
    )
    .sort((left, right) => Math.abs(left.start - time) - Math.abs(right.start - time))[0]
}

/** Rewrite screenshot markdown onto real `artifact:` ids after frames have been captured. */
export function bindArticleImageArtifacts(
  text: string,
  artifacts: AgentArtifact[],
  runId: string
): string {
  const used = new Set<string>()
  return text.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (raw, alt: string, url: string) => {
    const id = artifactIdFromUrl(url, artifacts)
    const known =
      (id ? artifacts.find((artifact) => artifact.id.toLowerCase() === id) : undefined) ??
      matchArtifactByClock(artifacts, used, clockFromImage(alt, url), runId)
    if (!known) {
      return raw
    }
    used.add(known.id)
    return `![${alt}](artifact:${known.id})`
  })
}

/** Collect screenshot times cited in markdown that are not already bound to a stored artifact. */
export function unboundArticleImageTimes(
  text: string,
  artifacts: AgentArtifact[],
  runId?: string
): number[] {
  const times: number[] = []
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)]*)\)/g)) {
    const url = match[2].trim()
    const id = artifactIdFromUrl(url, artifacts)
    if (id && artifacts.some((artifact) => artifact.id.toLowerCase() === id)) {
      continue
    }
    const time = clockFromImage(match[1], url)
    if (time !== null && !matchArtifactByClock(artifacts, new Set(), time, runId)) {
      times.push(time)
    }
  }
  return [...new Set(times)]
}

/** Collect screenshot ids cited as `artifact:uuid` or a bare uuid. */
export function citedArtifactIds(text: string, artifacts: AgentArtifact[] = []): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(AGENT_MARKDOWN_MEDIA)) {
    const id = artifactIdFromUrl(match[3], artifacts)
    if (id) {
      ids.push(id)
    }
  }
  return ids
}

/** MIME type for a stored screenshot or clip poster. */
export function artifactImageMime(artifact: AgentArtifact): string {
  const file = (artifact.kind === 'image' ? artifact.path : artifact.posterPath) || artifact.name
  const ext = file.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'image/jpeg'
  }
}

/**
 * Replace cited artifact images and clip posters with standalone data URIs.
 *
 * @param markdown Reply body that still uses `artifact:` ids.
 * @param dataUrisById Lowercase artifact id → `data:image/...;base64,...`.
 * @param artifacts Thread attachments, used to resolve truncated ids.
 */
export function embedArtifactDataUris(
  markdown: string,
  dataUrisById: ReadonlyMap<string, string>,
  artifacts: AgentArtifact[] = []
): string {
  if (dataUrisById.size === 0) {
    return markdown
  }
  return markdown.replace(AGENT_MARKDOWN_MEDIA, (raw, _bang: string, alt: string, url: string) => {
    const id = artifactIdFromUrl(url, artifacts)
    const dataUri = id ? dataUrisById.get(id) : undefined
    return dataUri ? `![${alt}](${dataUri})` : raw
  })
}

/**
 * Read cited screenshots and rewrite markdown so exports no longer depend on `artifact:` URLs.
 *
 * @param markdown Reply body.
 * @param artifacts Thread attachments with real filesystem paths.
 * @param readImage Returns raw base64 bytes for one screenshot or clip poster.
 */
export async function embedArtifactImages(
  markdown: string,
  artifacts: AgentArtifact[],
  readImage: (artifact: AgentArtifact) => Promise<string>
): Promise<string> {
  const ids = [...new Set(citedArtifactIds(markdown, artifacts))]
  if (ids.length === 0) {
    return markdown
  }
  const byId = new Map(artifacts.map((item) => [item.id.toLowerCase(), item]))
  const dataUris = new Map<string, string>()
  await Promise.all(
    ids.map(async (id) => {
      const artifact = byId.get(id)
      if (!artifact) {
        return
      }
      try {
        const base64 = await readImage(artifact)
        if (!base64) {
          return
        }
        dataUris.set(id, `data:${artifactImageMime(artifact)};base64,${base64}`)
      } catch {
        // Leave the original citation; PDF/Markdown can still show the caption.
      }
    })
  )
  return embedArtifactDataUris(markdown, dataUris, artifacts)
}

/** Keep this reply's media plus any screenshot it cites from an earlier version. */
export function artifactsForMessage(
  artifacts: AgentArtifact[],
  text: string,
  branchRunIds: Iterable<string | null | undefined>
): AgentArtifact[] {
  const runs = new Set(branchRunIds)
  const cited = new Set(citedArtifactIds(text, artifacts))
  return artifacts.filter((item) => runs.has(item.runId) || cited.has(item.id.toLowerCase()))
}

/** Split verified attachments out of markdown so Streamdown never sees disallowed image URLs. */
export function splitAgentResponseMedia(
  text: string,
  artifacts: AgentArtifact[],
  ownRunId?: string,
  includeUncited = true
): AgentResponsePart[] {
  const parts: AgentResponsePart[] = []
  const used = new Set<string>()
  let position = 0
  for (const match of text.matchAll(AGENT_MARKDOWN_MEDIA)) {
    const [raw, bang, alt, url] = match
    const index = match.index
    const image = bang === '!'
    const id = artifactIdFromUrl(url, artifacts)
    const artifact =
      (id ? artifacts.find((item) => item.id.toLowerCase() === id) : undefined) ??
      (image
        ? matchArtifactByClock(artifacts, used, clockFromImage(alt, url), ownRunId)
        : undefined)
    if (!(image || artifact)) {
      continue
    }
    if (index > position) {
      parts.push({ key: `text-${position}`, text: text.slice(position, index) })
    }
    if (artifact) {
      used.add(artifact.id)
      parts.push({ key: `${artifact.id}-${index}`, artifact, caption: alt })
    } else {
      parts.push({ key: `image-${index}`, text: alt.trim() })
    }
    position = index + raw.length
  }
  if (position < text.length) {
    parts.push({ key: `text-${position}`, text: text.slice(position) })
  }
  for (const artifact of artifacts) {
    if (includeUncited && artifact.runId === ownRunId && !used.has(artifact.id)) {
      parts.push({ key: artifact.id, artifact })
    }
  }
  return parts
}
