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
  return matches.length === 1 ? matches[0]?.id.toLowerCase() : undefined
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

/**
 * Pick the unused image whose source time is closest to the cited clock.
 *
 * @param runId When set, clock matches stay inside that run.
 * @param returnedIds Frames this capture returned, including a cache hit from an earlier run.
 */
export function matchArtifactByClock(
  artifacts: AgentArtifact[],
  used: Set<string>,
  time: number | null,
  runId?: string,
  returnedIds?: ReadonlySet<string>
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
        (runId === undefined ||
          artifact.runId === runId ||
          returnedIds?.has(artifact.id.toLowerCase()))
    )
    .sort((left, right) => Math.abs(left.start - time) - Math.abs(right.start - time))[0]
}

interface ArticleImageClaim {
  index: number
  raw: string
  alt: string
  time: number | null
  artifact?: AgentArtifact
}

/**
 * Claim one artifact for a markdown image or link.
 *
 * An explicit id wins and is consumed. Clock matching is image-only, and the
 * claimed frame cannot satisfy a later citation.
 *
 * @param allowClock When false, only an explicit artifact id can match.
 * @param returnedIds Frames this capture returned, including a cache hit from an earlier run.
 */
function claimArticleArtifact(
  artifacts: AgentArtifact[],
  used: Set<string>,
  alt: string,
  url: string,
  runId: string | undefined,
  allowClock: boolean,
  returnedIds?: ReadonlySet<string>
): { artifact?: AgentArtifact; time: number | null } {
  const time = allowClock ? clockFromImage(alt, url) : null
  const id = artifactIdFromUrl(url, artifacts)
  const artifact =
    (id ? artifacts.find((item) => item.id.toLowerCase() === id) : undefined) ??
    (allowClock ? matchArtifactByClock(artifacts, used, time, runId, returnedIds) : undefined)
  if (artifact) {
    used.add(artifact.id)
  }
  return { artifact, time }
}

/**
 * Claim one exclusive artifact for each markdown image, in document order.
 *
 * @param runId When set, clock matches stay inside that run. Explicit ids do not.
 * @param returnedIds Frames this capture returned, including a cache hit from an earlier run.
 */
function claimArticleImages(
  text: string,
  artifacts: AgentArtifact[],
  runId?: string,
  returnedIds?: ReadonlySet<string>
): ArticleImageClaim[] {
  const used = new Set<string>()
  const claims: ArticleImageClaim[] = []
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)]*)\)/g)) {
    const alt = match[1] ?? ''
    const url = match[2] ?? ''
    const { artifact, time } = claimArticleArtifact(
      artifacts,
      used,
      alt,
      url,
      runId,
      true,
      returnedIds
    )
    claims.push({ index: match.index ?? 0, raw: match[0], alt, time, artifact })
  }
  return claims
}

/**
 * Rewrite screenshot markdown onto real `artifact:` ids after frames have been captured.
 *
 * @param returnedIds Frames this capture returned, including a cache hit from an earlier run.
 */
export function bindArticleImageArtifacts(
  text: string,
  artifacts: AgentArtifact[],
  runId: string,
  returnedIds?: ReadonlySet<string>
): string {
  const pieces: string[] = []
  let position = 0
  for (const image of claimArticleImages(text, artifacts, runId, returnedIds)) {
    pieces.push(text.slice(position, image.index))
    pieces.push(image.artifact ? `![${image.alt}](artifact:${image.artifact.id})` : image.raw)
    position = image.index + image.raw.length
  }
  pieces.push(text.slice(position))
  return pieces.join('')
}

/**
 * Collect screenshot times that did not claim an exclusive stored frame.
 *
 * A frame within five seconds can satisfy only one citation. The next nearby
 * citation stays in this list so another capture can be requested.
 *
 * @param returnedIds Frames this capture returned, including a cache hit from an earlier run.
 */
export function unboundArticleImageTimes(
  text: string,
  artifacts: AgentArtifact[],
  runId?: string,
  returnedIds?: ReadonlySet<string>
): number[] {
  const times: number[] = []
  for (const image of claimArticleImages(text, artifacts, runId, returnedIds)) {
    if (!image.artifact && image.time !== null) {
      times.push(image.time)
    }
  }
  return [...new Set(times)]
}

/** Collect screenshot ids cited as `artifact:uuid` or a bare uuid. */
export function citedArtifactIds(text: string, artifacts: AgentArtifact[] = []): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(AGENT_MARKDOWN_MEDIA)) {
    const id = artifactIdFromUrl(match[3] ?? '', artifacts)
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

/** Render selected inline media, falling back to run attachments only when none are selected. */
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
    const [raw = '', bang = '', alt = '', url = ''] = match
    const index = match.index
    const image = bang === '!'
    const { artifact } = claimArticleArtifact(artifacts, used, alt, url, ownRunId, image)
    if (!(image || artifact)) {
      continue
    }
    if (index > position) {
      parts.push({ key: `text-${position}`, text: text.slice(position, index) })
    }
    if (artifact) {
      parts.push({ key: `${artifact.id}-${index}`, artifact, caption: alt })
    } else {
      parts.push({ key: `image-${index}`, text: alt.trim() })
    }
    position = index + raw.length
  }
  if (position < text.length) {
    parts.push({ key: `text-${position}`, text: text.slice(position) })
  }
  if (includeUncited && used.size === 0) {
    for (const artifact of artifacts) {
      if (artifact.runId === ownRunId) {
        parts.push({ key: artifact.id, artifact })
      }
    }
  }
  return parts
}
