import type { AgentMessage, AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { type Static, type TSchema, Type } from 'typebox'
import type { AgentArtifact } from '../../shared/agent-chat'
import { sanitizeAgentConversationTitle } from '../../shared/agent-history'
import { OVERHEAD } from './agent-budget'
import { documentPageBudget, MIN_DOCUMENT_RESULT_BYTES, readAgentDocument } from './agent-document'
import type { AgentEvidence } from './agent-evidence'
import { createAgentManagementTools } from './agent-management-tools'
import {
  AGENT_NOTES_BYTES,
  AGENT_TOOL_BYTES,
  agentHistoryText,
  agentMessageId,
  agentTextPage,
  pageContentBudget
} from './agent-memory'
import type { AgentTranscriptSource } from './agent-run-context'
import {
  APPROVAL_DENIED_RESULT,
  requiredApproval,
  requiresInteractivePathApproval
} from './agent-tool-approval'

export interface AgentTranscriptLine {
  start: number
  end: number
  text: string
  speakerId?: string | null
  speaker?: string | null
  words?: { start: number; end: number; text: string }[]
}
export interface AgentTranscriptPageLine extends AgentTranscriptLine {
  lineOffset: number
  globalLineOffset: number
  textOffset: number
  wordsOmitted?: boolean
}

export interface AgentToolContext {
  downloadId: string
  threadId: string
  promptId?: string
  runId: string
  title: string
  duration: number
  lines: AgentTranscriptLine[]
  timingLines?: AgentTranscriptLine[]
  listTranscripts?: () => AgentTranscriptSource[]
  selectTranscript?: (key: string) => AgentTranscriptSource
  artifacts?: AgentArtifact[]
  history?: () => AgentMessage[]
  evidence?: AgentEvidence
  notes?: () => string
  writeNotes?: (text: string) => void
  /** Rename the current chat tab; omit when this conversation has a fixed prompt name. */
  renameConversation?: (title: string) => void
  maxToolBytes?: number
  documentMaxBytes?: () => number
  reviewArticle?: (article: string) => Promise<Record<string, unknown>>
  writeArticle?: () => void
  vision: boolean
  mediaEnabled?: boolean
  managementEnabled?: boolean
  mediaKind?: 'audio' | 'video'
  signal: AbortSignal
  onArtifact: (artifact: AgentArtifact) => void
  onProgress: (toolCallId: string, text: string) => void
  requestApproval?: (
    toolCallId: string,
    request: import('../../shared/agent-chat').AgentApprovalRequest,
    options?: { path?: boolean }
  ) => Promise<{ approved: boolean; approvedPath: boolean }>
  downloadPath?: string
  pathApproved?: (toolCallId: string) => boolean
}

/** Prefer the interior of a precise subtitle cue without guessing inside merged paragraphs. */
export function agentFrameTimestamp(
  time: number,
  cues: AgentTranscriptLine[],
  exact = false
): number {
  if (exact) {
    return time
  }
  const cue = cues.find((line) => line.start <= time && time < line.end)
  if (!cue || cue.end <= cue.start || cue.end - cue.start > 10) {
    return time
  }
  return Number(((cue.start + cue.end) / 2).toFixed(3))
}

/** Return compact structured facts to the model without leaking local filesystem paths. */
function textResult(
  details: Record<string, unknown>,
  display: Record<string, unknown> = details
): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: 'text', text: JSON.stringify(display) }], details }
}

/** Encode every transcript field once per column, with a shared speaker identity table. */
function transcriptTable(lines: AgentTranscriptPageLine[]): Record<string, unknown> {
  const speakers: [string | null, string | null][] = []
  const speakerIndices = new Map<string, number>()
  const rows = lines.map((line) => {
    const identity: [string | null, string | null] = [line.speakerId ?? null, line.speaker ?? null]
    const key = JSON.stringify(identity)
    let index = speakerIndices.get(key)
    if (index === undefined) {
      index = speakers.length
      speakerIndices.set(key, index)
      speakers.push(identity)
    }
    return [
      line.lineOffset,
      line.globalLineOffset,
      line.textOffset,
      line.start,
      line.end,
      index,
      line.text,
      line.words ?? null,
      line.wordsOmitted ?? false
    ]
  })
  return {
    timeUnit: 'seconds',
    speakerColumns: ['speakerId', 'speaker'],
    speakers,
    lineColumns: [
      'lineOffset',
      'globalLineOffset',
      'textOffset',
      'start',
      'end',
      'speakerIndex',
      'text',
      'words',
      'wordsOmitted'
    ],
    lines: rows
  }
}

/** Define the schema and execution boundary together so tools cannot bypass run cancellation. */
export function defineAgentTool<T extends TSchema>(
  context: AgentToolContext,
  name: string,
  description: string,
  parameters: T,
  execute: (
    params: Static<T>,
    toolCallId: string
  ) => Promise<AgentToolResult<Record<string, unknown>>>,
  resultBudget?: (params: Static<T>) => number
): AgentTool<T> {
  return {
    name,
    label: name,
    description,
    parameters,
    executionMode: 'sequential',
    execute: async (id, params, signal) => {
      context.signal.throwIfAborted()
      signal?.throwIfAborted()
      const gate = requiredApproval(name, params)
      const pathGate = requiresInteractivePathApproval(name, params, context.downloadPath ?? '')
      if ((gate || pathGate) && context.requestApproval) {
        const request = gate ?? {
          action: 'subscription.update' as const,
          summary: 'Use a download folder outside the library',
          risk: 'config' as const
        }
        const decision = await context.requestApproval(id, request, { path: pathGate })
        if (!decision.approved) {
          return APPROVAL_DENIED_RESULT
        }
      }
      const result = await execute(params, id)
      context.signal.throwIfAborted()
      const fullText = result.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const budget = resultBudget?.(params) ?? context.maxToolBytes ?? AGENT_TOOL_BYTES
      if (Buffer.byteLength(fullText) <= budget) {
        return result
      }
      const page = agentTextPage(fullText, 0, budget, OVERHEAD.toolPage)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              truncated: true,
              messageId: `tool:${id}`,
              preview: page.text,
              recovery:
                'Use read_history with this messageId and offset=0 to retrieve the complete original result.'
            })
          },
          ...result.content.filter((part) => part.type === 'image')
        ],
        details: { ...result.details, archivedText: fullText }
      }
    }
  }
}

/** Expose video-scoped evidence and media capabilities with explicit per-run limits. */
export function createAgentTools(context: AgentToolContext): AgentTool[] {
  const reviewArticle = context.reviewArticle
  const writeArticle = context.writeArticle
  let historySnapshot: string | undefined
  /** Keep edited text and original timing explicitly addressable throughout pagination. */
  const transcriptLines = (source?: string): AgentTranscriptLine[] =>
    source === 'original' ? (context.timingLines ?? context.lines) : context.lines
  const downloadBudget = { used: 0 }
  let frameCount = 0
  let clipCount = 0
  const completed = new Map<string, AgentArtifact>()
  /** Reuse an identical immutable result rather than repeating work after a model retry. */
  async function media(
    kind: 'image' | 'video',
    start: number,
    end: number,
    callId: string
  ): Promise<AgentArtifact> {
    const { createAgentMedia } = await import('./agent-media')
    const key = `${kind}:${start}:${end}`
    const cached = completed.get(key)
    if (cached) {
      return cached
    }
    const artifact = await createAgentMedia(
      { ...context, downloadBudget, onProgress: (text) => context.onProgress(callId, text) },
      kind,
      start,
      end
    )
    completed.set(key, artifact)
    context.onArtifact(artifact)
    return artifact
  }
  const tools: AgentTool[] = [
    ...(context.listTranscripts && context.selectTranscript
      ? [
          defineAgentTool(
            context,
            'list_transcripts',
            'List ready subtitle languages for this video. The selected source is a UI default, not a required language.',
            Type.Object({}, { additionalProperties: false }),
            async () => textResult({ sources: context.listTranscripts?.() })
          ),
          defineAgentTool(
            context,
            'select_transcript',
            'Choose a ready subtitle source by its exact listed key for this run. Read, search, frame timing and section writing then use it. Does not change the user interface. Previous reads belong to the previous source; read the new source as needed.',
            Type.Object({ key: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
            async ({ key }) => textResult({ source: context.selectTranscript?.(key) })
          )
        ]
      : []),
    defineAgentTool(
      context,
      'read_history',
      'Read original messages in the selected conversation, even after compaction. Use messageId from search_history or a tool reference for a specific message, and nextOffset to paginate. Without messageId, returns a stable snapshot from the first legacy read. Images require read_artifact.',
      Type.Object(
        {
          messageId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 }))
        },
        { additionalProperties: false }
      ),
      async ({ messageId, offset = 0 }) => {
        const messages = context.history?.() ?? []
        if (messageId) {
          const message = messages.find((item) => agentMessageId(item) === messageId)
          if (!message) {
            throw new Error('History message is unavailable in the selected conversation')
          }
          return textResult({
            messageId,
            ...agentTextPage(agentHistoryText(message), offset, context.maxToolBytes)
          })
        }
        historySnapshot ??= `[${messages.map(agentHistoryText).join(',')}]`
        return textResult(agentTextPage(historySnapshot, offset, context.maxToolBytes))
      }
    ),
    defineAgentTool(
      context,
      'search_history',
      'Search original user messages, assistant messages and tool text in the selected branch by keyword. Returns stable messageId references for read_history. Keep the query unchanged when paginating. Does not search other conversations or image pixels.',
      Type.Object(
        {
          query: Type.String({ minLength: 1, maxLength: 200 }),
          offset: Type.Optional(Type.Integer({ minimum: 0 }))
        },
        { additionalProperties: false }
      ),
      async ({ query, offset = 0 }) => {
        const matches = (context.history?.() ?? []).flatMap((message) => {
          const text = agentHistoryText(message)
          const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
          return index < 0
            ? []
            : [
                {
                  messageId: agentMessageId(message),
                  role: message.role,
                  excerpt: text.slice(Math.max(0, index - 100), index + query.length + 200)
                }
              ]
        })
        const page = [] as typeof matches
        const budget = pageContentBudget(context.maxToolBytes ?? AGENT_TOOL_BYTES)
        for (const match of matches.slice(offset, offset + 10)) {
          if (page.length && Buffer.byteLength(JSON.stringify([...page, match])) > budget) {
            break
          }
          page.push(match)
        }
        return textResult({
          matches: page,
          total: matches.length,
          nextOffset: offset + page.length < matches.length ? offset + page.length : null
        })
      }
    ),
    defineAgentTool(
      context,
      'read_notes',
      'Read your persistent working notes for the selected branch. Follow nextOffset for remaining text. Notes are fallible working state; verify exact details against original evidence.',
      Type.Object(
        { offset: Type.Optional(Type.Integer({ minimum: 0 })) },
        { additionalProperties: false }
      ),
      async ({ offset = 0 }) =>
        textResult(agentTextPage(context.notes?.() ?? '', offset, context.maxToolBytes))
    ),
    defineAgentTool(
      context,
      'write_notes',
      'Replace your working notes with concise Markdown (maximum 8192 UTF-8 bytes). Save goals, findings, unresolved questions and evidence references when useful. Empty text clears the notes. Notes persist for follow-ups on this branch.',
      Type.Object({ text: Type.String() }, { additionalProperties: false }),
      async ({ text }) => {
        if (Buffer.byteLength(text) > AGENT_NOTES_BYTES) {
          throw new Error(
            'Notes exceed 8192 UTF-8 bytes; condense and write again. Existing notes were preserved.'
          )
        }
        if (!context.writeNotes) {
          throw new Error('Working notes are unavailable for this run')
        }
        context.writeNotes(text)
        return textResult({ saved: true, bytes: Buffer.byteLength(text) })
      }
    ),
    defineAgentTool(
      context,
      'get_video_info',
      'Read the current source title, media kind (audio or video), duration and available transcript coverage. No other source can be accessed.',
      Type.Object({}, { additionalProperties: false }),
      async () => {
        const { getAgentVideoAvailability } = await import('./agent-media')
        const availability = getAgentVideoAvailability(context.downloadId)
        return textResult({
          ...availability,
          title: context.title,
          durationSeconds: context.duration || null,
          transcriptLines: context.lines.length,
          visionAvailable: context.vision && availability.hasVideoFrames
        })
      }
    ),
    defineAgentTool(
      context,
      'read_transcript',
      'Read source evidence that is missing from the supplied context. view=document returns compact prose with stable [Lindex] references using the available context budget; it can read a complete short transcript for any task. coverage=complete selects the unfiltered edited source and only tracks reading coverage; it does not start writing or review. view=details with source=original provides precise subtitle and word timing (falls back to edited). Default source=edited includes user corrections. Continue with returned nextOffset AND nextTextOffset when more text is needed. Keep source/range consistent when paginating. Times are seconds; null words means unavailable.',
      Type.Object(
        {
          view: Type.Optional(Type.Union([Type.Literal('document'), Type.Literal('details')])),
          coverage: Type.Optional(Type.Union([Type.Literal('complete'), Type.Literal('relevant')])),
          source: Type.Optional(Type.Union([Type.Literal('edited'), Type.Literal('original')])),
          offset: Type.Optional(Type.Integer({ minimum: 0 })),
          textOffset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 150 })),
          start: Type.Optional(Type.Number({ minimum: 0 })),
          end: Type.Optional(Type.Number({ minimum: 0 }))
        },
        { additionalProperties: false }
      ),
      async (params) => {
        if (
          params.coverage === 'complete' &&
          (params.source === 'original' || params.start !== undefined || params.end !== undefined)
        ) {
          throw new Error(
            'Complete coverage requires the unfiltered edited source. Omit source, start and end.'
          )
        }
        const sourceLines = transcriptLines(params.source)
        const source =
          params.source === 'original' && sourceLines !== context.lines ? 'original' : 'edited'
        const globalIndices = new Map(sourceLines.map((line, index) => [line, index]))
        const lines = sourceLines.filter(
          (line) =>
            (params.start === undefined || line.end >= params.start) &&
            (params.end === undefined || line.start <= params.end)
        )
        const offset = params.offset ?? 0
        const limit = params.limit ?? 100
        let selected: AgentTranscriptPageLine[] = []
        const detailsBytes = Math.max(
          MIN_DOCUMENT_RESULT_BYTES,
          context.maxToolBytes ?? AGENT_TOOL_BYTES
        )
        const budget = documentPageBudget(detailsBytes)
        const documentBytes = Math.max(
          MIN_DOCUMENT_RESULT_BYTES,
          context.documentMaxBytes?.() ?? context.maxToolBytes ?? AGENT_TOOL_BYTES
        )
        let nextOffset = offset
        let nextTextOffset = params.textOffset ?? 0
        let document: string | undefined
        if (params.view === 'document') {
          const page = readAgentDocument({
            lines,
            globalIndices,
            offset,
            textOffset: nextTextOffset,
            maxBytes: documentPageBudget(documentBytes)
          })
          selected = page.selected
          nextOffset = page.nextOffset
          nextTextOffset = page.nextTextOffset
          document = page.document
        }
        while (document === undefined && nextOffset < lines.length && selected.length < limit) {
          const line = lines[nextOffset]
          if (nextTextOffset > line.text.length) {
            throw new Error('textOffset exceeds this line length')
          }
          let low = nextTextOffset
          let high = line.text.length
          /** Include only exactly aligned word timestamps for this text page. */
          const slice = (end: number): (typeof selected)[number] => {
            let cursor = 0
            let aligned = true
            const words = line.words?.filter((word) => {
              const index = line.text.indexOf(word.text, cursor)
              if (index < 0) {
                aligned = false
                return false
              }
              cursor = index + word.text.length
              return index < end && cursor > nextTextOffset
            })
            return {
              ...line,
              text: line.text.slice(nextTextOffset, end),
              words: aligned ? words : undefined,
              wordsOmitted: aligned ? undefined : true,
              lineOffset: nextOffset,
              globalLineOffset: globalIndices.get(line) ?? nextOffset,
              textOffset: nextTextOffset
            }
          }
          while (low < high) {
            const middle = Math.ceil((low + high) / 2)
            if (
              Buffer.byteLength(JSON.stringify(transcriptTable([...selected, slice(middle)]))) <=
              budget
            ) {
              low = middle
            } else {
              high = middle - 1
            }
          }
          if (low < line.text.length && /[\uD800-\uDBFF]/.test(line.text[low - 1] ?? '')) {
            low -= 1
          }
          if (low <= nextTextOffset && line.text.length > nextTextOffset) {
            if (!selected.length) {
              const end = Math.min(
                line.text.length,
                nextTextOffset + (/[\uD800-\uDBFF]/.test(line.text[nextTextOffset] ?? '') ? 2 : 1)
              )
              selected.push({
                ...line,
                text: line.text.slice(nextTextOffset, end),
                words: undefined,
                wordsOmitted: true,
                lineOffset: nextOffset,
                globalLineOffset: globalIndices.get(line) ?? nextOffset,
                textOffset: nextTextOffset
              })
              if (end < line.text.length) {
                nextTextOffset = end
                break
              }
              nextOffset += 1
              nextTextOffset = 0
              continue
            }
            break
          }
          selected.push(slice(low))
          if (low < line.text.length) {
            nextTextOffset = low
            break
          }
          nextOffset += 1
          nextTextOffset = 0
        }
        const newCharacters = selected.reduce(
          (sum, line) =>
            sum +
            (context.evidence?.record(
              source,
              line.globalLineOffset,
              line.textOffset,
              line.text.length
            ) ?? line.text.length),
          0
        )
        const details = {
          newCharacters,
          coverage: context.evidence?.describe(source, sourceLines),
          source:
            params.source === 'original' &&
            context.timingLines !== context.lines &&
            context.timingLines
              ? 'original'
              : 'edited',
          requestedSource: params.source ?? 'edited',
          fallback: params.source === 'original' && transcriptLines('original') === context.lines,
          requestedRange: { start: params.start ?? null, end: params.end ?? null },
          returnedRange: { start: selected[0]?.start ?? null, end: selected.at(-1)?.end ?? null },
          truncated: nextOffset < lines.length,
          lines: selected,
          nextOffset: nextOffset < lines.length ? nextOffset : null,
          nextTextOffset: nextTextOffset || undefined,
          total: lines.length
        }
        return textResult(
          details,
          document === undefined
            ? { ...details, ...transcriptTable(selected) }
            : {
                ...details,
                lines: undefined,
                document,
                references:
                  'L indices identify exact edited source lines. Resolve media timing with view=details around those indices.'
              }
        )
      },
      (params) =>
        params.view === 'document'
          ? Math.max(
              MIN_DOCUMENT_RESULT_BYTES,
              context.documentMaxBytes?.() ?? context.maxToolBytes ?? AGENT_TOOL_BYTES
            )
          : Math.max(MIN_DOCUMENT_RESULT_BYTES, context.maxToolBytes ?? AGENT_TOOL_BYTES)
    ),
    defineAgentTool(
      context,
      'search_transcript',
      'Search edited transcript by default; use source=original to locate precise subtitle cues for screenshots. Returns 10 matches per page with nextOffset. Pass nextOffset as offset with the same query and source to continue. Match lineOffset identifies the line for read_transcript; expand it for word timing and speaker details.',
      Type.Object(
        {
          query: Type.String({ minLength: 1, maxLength: 200 }),
          source: Type.Optional(Type.Union([Type.Literal('edited'), Type.Literal('original')])),
          offset: Type.Optional(Type.Integer({ minimum: 0 }))
        },
        { additionalProperties: false }
      ),
      async ({ query, source, offset = 0 }) => {
        const lines = transcriptLines(source)
        const matches = lines.flatMap((line, index) =>
          line.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
            ? [
                {
                  start: line.start,
                  end: line.end,
                  speakerId: line.speakerId,
                  speaker: line.speaker,
                  text: line.text.slice(
                    Math.max(
                      0,
                      line.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 100
                    ),
                    Math.max(
                      0,
                      line.text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()) - 100
                    ) + 250
                  ),
                  offset: index,
                  lineOffset: index,
                  before: lines[index - 1]?.text.slice(-100),
                  after: lines[index + 1]?.text.slice(0, 100)
                }
              ]
            : []
        )
        return textResult({
          source: source === 'original' && lines !== context.lines ? 'original' : 'edited',
          matches: matches.slice(offset, offset + 10),
          total: matches.length,
          nextOffset: offset + 10 < matches.length ? offset + 10 : null
        })
      }
    ),
    defineAgentTool(
      context,
      'capture_frames',
      'Extract real screenshots at source video times in seconds (maximum 6 per call, 12 per run). For topic-based screenshots, first search_transcript and read the matching original cue; pass a time within that cue. By default the tool captures its midpoint to avoid cue boundaries; timestamps in gaps or cues longer than 10 seconds remain unchanged. Use exact=true only for an explicitly requested instant or an inspected alternative frame. Avoid transitions, partial reveals and mismatched subjects; a cue midpoint does not guarantee the intended visual. Missing video is downloaded automatically. Check returned transcriptAtTimestamp against the intended topic before embedding. Cite each screenshot by copying the returned reference exactly: ![caption](artifact:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Never shorten the UUID, drop the artifact: prefix, or replace it with a timestamp. Recapture if the cue does not match. If vision is unavailable, captions must attribute claims to the transcript, not claim visual verification.',
      Type.Object(
        {
          exact: Type.Optional(
            Type.Boolean({
              description:
                'Keep the exact requested times instead of centering within short original subtitle cues.'
            })
          ),
          timestamps: Type.Array(Type.Number({ minimum: 0 }), {
            minItems: 1,
            maxItems: 6,
            uniqueItems: true
          })
        },
        { additionalProperties: false }
      ),
      async ({ timestamps, exact }, callId) => {
        const { validateAgentRange, readAgentArtifactImage } = await import('./agent-media')
        for (const time of timestamps) {
          validateAgentRange(time, time + 0.1, context.duration)
        }
        const selections = timestamps.map((time) => ({
          requestedTimestamp: time,
          timestamp: agentFrameTimestamp(time, context.timingLines ?? [], exact)
        }))
        timestamps = [...new Set(selections.map((selection) => selection.timestamp))]
        const newCount = timestamps.filter(
          (time) => !completed.has(`image:${time}:${time + 0.1}`)
        ).length
        if (frameCount + newCount > 12) {
          throw new Error('Screenshot limit reached (12 per run)')
        }
        for (const time of timestamps) {
          validateAgentRange(time, time + 0.1, context.duration)
        }
        frameCount += newCount
        const artifacts: AgentArtifact[] = []
        for (const time of timestamps) {
          artifacts.push(await media('image', time, time + 0.1, callId))
        }
        const result = textResult({
          selections,
          artifacts: artifacts.map(({ id, start }) => ({
            id,
            timestamp: start,
            reference: `artifact:${id}`,
            embed: `![caption](artifact:${id})`,
            transcriptAtTimestamp: transcriptLines('original').filter(
              (line) => line.start <= start && line.end > start
            )
          })),
          visionAvailable: context.vision
        })
        if (context.vision) {
          for (const artifact of artifacts) {
            result.content.push({
              type: 'text',
              text: `Image artifact:${artifact.id} at ${artifact.start} seconds. Embed it as ![caption](artifact:${artifact.id}) using that full UUID. Inspect this image before describing it; if it does not show the intended subject, search the transcript and capture again.`
            })
            result.content.push({
              type: 'image',
              data: await readAgentArtifactImage(artifact),
              mimeType: 'image/jpeg'
            })
          }
        }
        return result
      }
    ),
    defineAgentTool(
      context,
      'read_artifact',
      'Reopen an existing image from this conversation by artifact ID, including after context compaction. Returns its original source time and image when vision is available. Never infer unseen visual details from a caption.',
      Type.Object(
        { id: Type.String({ minLength: 1, maxLength: 128 }) },
        { additionalProperties: false }
      ),
      async ({ id }) => {
        const artifact = context.artifacts?.find(
          (item) => item.id === id && item.threadId === context.threadId && item.kind === 'image'
        )
        if (!artifact) {
          throw new Error('Image artifact is unavailable in this conversation')
        }
        const result = textResult({
          id,
          timestamp: artifact.start,
          reference: `artifact:${id}`,
          embed: `![caption](artifact:${id})`,
          visionAvailable: context.vision
        })
        if (context.vision) {
          const { readAgentArtifactImage } = await import('./agent-media')
          result.content.push({
            type: 'image',
            data: await readAgentArtifactImage(artifact),
            mimeType: 'image/jpeg'
          })
        }
        return result
      }
    ),
    ...(context.renameConversation
      ? [
          defineAgentTool(
            context,
            'rename_conversation',
            'Set a short title for this chat tab (a few words, same language as the user). Call once the topic is clear. Do not mention the rename in your reply.',
            Type.Object(
              { title: Type.String({ minLength: 1, maxLength: 80 }) },
              { additionalProperties: false }
            ),
            async ({ title }) => {
              const next = sanitizeAgentConversationTitle(title)
              if (!next) {
                throw new Error('Title is empty')
              }
              context.renameConversation?.(next)
              return textResult({ title: next })
            }
          )
        ]
      : []),
    ...(reviewArticle
      ? [
          defineAgentTool(
            context,
            'review_article',
            'Request an independent factual check of a drafted answer against this video transcript and metadata. This makes another model request and adds latency. Use when verification is requested or a consequential uncertainty warrants it; ordinary summaries and rewrites do not need it. Returns validated issues or an explicit unavailable status. A failed check is not evidence that the draft is wrong or verified.',
            Type.Object(
              { article: Type.String({ minLength: 1 }) },
              { additionalProperties: false }
            ),
            async ({ article }) => textResult(await reviewArticle(article))
          )
        ]
      : []),
    ...(writeArticle
      ? [
          defineAgentTool(
            context,
            'write_article',
            'Optionally hand off a detailed rewrite when the complete source cannot fit the available context. Section writers use the current user request, full source and existing screenshots, and deliver the assembled article directly. If illustrations are needed, capture them before calling this tool; section writers cannot call media tools. This makes multiple model requests; do not use for a summary or when the source is already available in context.',
            Type.Object({}, { additionalProperties: false }),
            async () => {
              writeArticle()
              return textResult({
                status: 'writing',
                detail: 'The requested article will be delivered from the supplied source sections.'
              })
            }
          )
        ]
      : []),
    defineAgentTool(
      context,
      'create_clip',
      'Cut an accurate MP4 clip from this video, using start/end source seconds. Maximum duration 120 seconds, 3 clips per run. Returns a playable attachment and poster. Cite it by copying the returned reference exactly: [caption](artifact:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Never shorten the UUID or drop the artifact: prefix.',
      Type.Object(
        { start: Type.Number({ minimum: 0 }), end: Type.Number({ exclusiveMinimum: 0 }) },
        { additionalProperties: false }
      ),
      async ({ start, end }, callId) => {
        const { validateAgentRange } = await import('./agent-media')
        validateAgentRange(start, end, context.duration)
        if (!completed.has(`video:${start}:${end}`) && ++clipCount > 3) {
          throw new Error('Clip limit reached (3 per run)')
        }
        const artifact = await media('video', start, end, callId)
        return textResult({
          artifact: {
            id: artifact.id,
            start,
            end,
            reference: `artifact:${artifact.id}`,
            embed: `[caption](artifact:${artifact.id})`
          }
        })
      }
    )
  ]
  if (context.mediaEnabled === false) {
    return [
      ...(context.managementEnabled ? createAgentManagementTools(context) : []),
      ...tools.filter((tool) =>
        [
          'list_transcripts',
          'select_transcript',
          'get_video_info',
          'read_transcript',
          'search_transcript',
          'read_history',
          'search_history',
          'read_notes',
          'write_notes',
          'rename_conversation'
        ].includes(tool.name)
      )
    ]
  }
  tools.push(...(context.managementEnabled ? createAgentManagementTools(context) : []))
  return context.mediaKind === 'audio'
    ? tools.filter(
        (tool) => !['capture_frames', 'create_clip', 'read_artifact'].includes(tool.name)
      )
    : tools
}
