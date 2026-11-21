import type { AgentMessage, AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { type Static, type TSchema, Type } from 'typebox'
import { z } from 'zod'
import type { AgentArtifact } from '../../shared/agent-chat'
import { sanitizeAgentConversationTitle } from '../../shared/agent-history'
import { type AgentSubtitleInput, agentSubtitleInputSchema } from '../../shared/agent-subtitles'
import type { AgentUiSpec } from '../../shared/agent-ui'
import { dubbingInputSchema, subtitleExportInputSchema } from '../../shared/video-localization'
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
import { createAgentUiTool } from './agent-ui-tool'

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
  /** Keep task provenance attached to the chat even when its selected media changes. */
  conversationDownloadId?: string
  threadId: string
  promptId?: string
  runId: string
  title: string
  duration: number
  lines: AgentTranscriptLine[]
  timingLines?: AgentTranscriptLine[]
  listTranscripts?: () => AgentTranscriptSource[]
  selectTranscript?: (key: string) => AgentTranscriptSource
  addSubtitles?: (input: AgentSubtitleInput) => { source: AgentTranscriptSource; added: number }
  selectVideo?: (id: string) => Promise<Record<string, unknown>>
  waitForTask?: (
    id: string,
    callId: string,
    signal: AbortSignal
  ) => Promise<Record<string, unknown>>
  /** Associate real tasks with this run, optionally leaving completion entirely in the background. */
  trackTasks?: (result: Record<string, unknown>, waitForCompletion?: boolean) => void
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
  hasSource?: boolean
  managementEnabled?: boolean
  mediaKind?: 'audio' | 'video'
  signal: AbortSignal
  onArtifact: (artifact: AgentArtifact) => void
  onProgress: (toolCallId: string, text: string) => void
  /** Save a presentation in the current run; never execute an application operation. */
  onUi?: (toolCallId: string, spec: AgentUiSpec) => void
  requestApproval?: (
    toolCallId: string,
    request: import('../../shared/agent-chat').AgentApprovalRequest,
    options?: { path?: boolean }
  ) => Promise<{ approved: boolean; approvedPath: boolean }>
  /** True only after the unified Pi permission gates authorized this exact tool call. */
  permissionApproved?: (toolCallId: string) => boolean
  downloadPath?: string
  pathApproved?: (toolCallId: string) => boolean
}

const SOURCE_TOOLS = new Set([
  'get_video_info',
  'read_transcript',
  'search_transcript',
  'list_transcripts',
  'select_transcript',
  'add_subtitles',
  'export_subtitles',
  'create_dubbed_video',
  'capture_frames',
  'create_clip',
  'review_article',
  'write_article'
])

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
    toolCallId: string,
    signal: AbortSignal
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
      const executionSignal = signal ? AbortSignal.any([context.signal, signal]) : context.signal
      executionSignal.throwIfAborted()
      if (SOURCE_TOOLS.has(name) && context.hasSource === false) {
        throw new Error('Select a completed video with select_video before using source tools')
      }
      if (['capture_frames', 'create_clip'].includes(name) && context.mediaKind === 'audio') {
        throw new Error('The selected source is audio-only and has no video frames')
      }
      const gate = requiredApproval(name, params)
      const pathGate = requiresInteractivePathApproval(name, params, context.downloadPath ?? '')
      if (context.permissionApproved && (gate || pathGate) && !context.permissionApproved(id)) {
        return APPROVAL_DENIED_RESULT
      }
      if (!context.permissionApproved && (gate || pathGate)) {
        if (!context.requestApproval) {
          return APPROVAL_DENIED_RESULT
        }
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
      const result = await execute(params, id, executionSignal)
      executionSignal.throwIfAborted()
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

/** Expose video-scoped evidence and media capabilities for content-driven tool use. */
export function createAgentTools(context: AgentToolContext): AgentTool[] {
  const addSubtitles = context.addSubtitles
  const reviewArticle = context.reviewArticle
  const writeArticle = context.writeArticle
  let historySnapshot: string | undefined
  /** Keep edited text and original timing explicitly addressable throughout pagination. */
  const transcriptLines = (source?: string): AgentTranscriptLine[] =>
    source === 'original' ? (context.timingLines ?? context.lines) : context.lines
  const downloadBudget = { used: 0 }
  const completed = new Map<string, AgentArtifact>()
  /** Reuse an identical immutable result rather than repeating work after a model retry. */
  async function media(
    kind: 'image' | 'video',
    start: number,
    end: number,
    callId: string,
    signal: AbortSignal
  ): Promise<AgentArtifact> {
    const { createAgentMedia } = await import('./agent-media')
    const key = `${context.downloadId}:${kind}:${start}:${end}`
    const cached =
      completed.get(key) ??
      context.artifacts?.find(
        (artifact) =>
          (artifact.sourceDownloadId ?? context.conversationDownloadId ?? context.downloadId) ===
            context.downloadId &&
          artifact.kind === kind &&
          artifact.start === start &&
          (kind === 'image' || artifact.end === end)
      )
    if (cached) {
      return cached
    }
    const artifact = await createAgentMedia(
      {
        ...context,
        signal,
        downloadBudget,
        onProgress: (text) => context.onProgress(callId, text)
      },
      kind,
      start,
      end
    )
    completed.set(key, artifact)
    context.onArtifact(artifact)
    return artifact
  }
  const tools: AgentTool[] = [
    ...(context.hasSource === false && !context.selectVideo
      ? []
      : [
          defineAgentTool(
            context,
            'export_subtitles',
            'Export a named subtitle source without switching the UI. sourceKey comes from list_transcripts or add_subtitles. srt/vtt save subtitle files, mkv muxes selectable subtitles, mp4 burns captions. bilingual=true includes the currently viewed original. Files are saved under library/Exports without dialogs or overwrites.',
            Type.Unsafe<z.input<typeof subtitleExportInputSchema>>(
              z.toJSONSchema(subtitleExportInputSchema, { io: 'input' })
            ),
            async (params, _id, signal) => {
              const { exportLocalizedSubtitles } = await import('./video-localization')
              return textResult(await exportLocalizedSubtitles(context.downloadId, params, signal))
            }
          ),
          defineAgentTool(
            context,
            'create_dubbed_video',
            'Generate synchronized local dubbing from a complete named subtitle track using any compatible model in the official sherpa-onnx catalog. Inspect manage_tts_model for models and languages; prepare a model to inspect its actual speaker range and bundled references. Optional modelId overrides the saved ttsModelId preference for this call only. Optional voice is that model speaker ID; omit it for its language default. Known incompatible choices fail before downloads; otherwise the native worker validates actual speaker bounds. Models and dependencies are prepared automatically on first use. Pocket and ZipVoice use reference.file from the selected model bundled WAV names; ZipVoice also requires reference.text to match that audio exactly. sourceKey comes from list_transcripts/add_subtitles. Optional speechOverrides change only spoken wording: cueIndex is the one-based complete saved track position (read_transcript globalLineOffset + 1), originalText is the exact display cue, and text is nonempty speech in the same language. Use them for contextual numeric readings, TTS cleanup or meaning-preserving shortening after a fitting error; display subtitles stay unchanged. Clip filtering never renumbers indices; stale text, duplicates and cues outside the clip fail before model preparation. background=separate removes original vocals and retains accompaniment; remove keeps only dubbed voice. Fits speech up to maxSpeed and rejects overflow; retain valid overrides when retrying an affected cue. Returns actual modelId and voice with a new MP4 or audio-only M4A in library/Exports. Never call before translation is complete.',
            Type.Unsafe<z.input<typeof dubbingInputSchema>>(
              z.toJSONSchema(dubbingInputSchema, { io: 'input' })
            ),
            async (params, id, signal) => {
              const { createDubbedVideo } = await import('./video-dubbing')
              return textResult(
                await createDubbedVideo(context.downloadId, params, signal, (text) =>
                  context.onProgress(id, text)
                )
              )
            }
          )
        ]),
    ...(addSubtitles
      ? [
          defineAgentTool(
            context,
            'add_subtitles',
            'Save user-requested subtitles on the current video, including your translation, as a new automatic-caption language visible in the transcript and bilingual menus. First list_transcripts and reuse existing suitable subtitles. language is a BCP-47 tag such as zh or en. cues must contain chronological start/end in original source SECONDS and text; preserve read_transcript timing. Send at most 500 cues / 100000 bytes per call; use append=true for later batches. Identical repeats are safe; conflicting text, earlier new cues and overwriting existing tracks are rejected. No other video or local path can be written. Saving does not switch the UI or this run source; call select_transcript with the returned source.key to read the saved track.',
            Type.Unsafe<AgentSubtitleInput>(z.toJSONSchema(agentSubtitleInputSchema)),
            async (params) => textResult(addSubtitles(params))
          )
        ]
      : []),
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
      'Extract real screenshots at source video times in seconds whenever they help the task, including during article writing. Choose the number and timing from the content; there is no fixed screenshot quota. Existing identical frames are reused. For topic-based screenshots, use a matching original subtitle cue; search_transcript and read_transcript can locate missing timing evidence. By default the tool captures its midpoint to avoid cue boundaries; timestamps in gaps or cues longer than 10 seconds remain unchanged. Use exact=true when a specific instant serves the task better. Avoid transitions, partial reveals and mismatched subjects; a cue midpoint does not guarantee the intended visual. Missing video is downloaded automatically. Check returned transcriptAtTimestamp against the intended topic before embedding. Cite each screenshot by copying the returned reference exactly: ![caption](artifact:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Never shorten the UUID, drop the artifact: prefix, or replace it with a timestamp. Recapture if the cue does not match. If vision is unavailable, captions must attribute claims to the transcript, not claim visual verification.',
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
            uniqueItems: true
          })
        },
        { additionalProperties: false }
      ),
      async ({ timestamps, exact }, callId, signal) => {
        const { validateAgentRange, readAgentArtifactImage } = await import('./agent-media')
        for (const time of timestamps) {
          validateAgentRange(time, time + 0.1, context.duration)
        }
        const selections = timestamps.map((time) => ({
          requestedTimestamp: time,
          timestamp: agentFrameTimestamp(time, context.timingLines ?? [], exact)
        }))
        timestamps = [...new Set(selections.map((selection) => selection.timestamp))]
        for (const time of timestamps) {
          validateAgentRange(time, time + 0.1, context.duration)
        }
        const artifacts: AgentArtifact[] = []
        for (const time of timestamps) {
          signal.throwIfAborted()
          artifacts.push(await media('image', time, time + 0.1, callId, signal))
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
            'Change this chat title when the user asks to rename it. Titles are otherwise derived automatically; do not call this tool just to name a new conversation.',
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
            'Optionally hand off a detailed rewrite when the complete source cannot fit the available context. Section writers use the current user request and full source, reuse relevant screenshots and can capture or inspect more frames while writing. They deliver the assembled article directly. This makes multiple model requests; do not use for a summary or when the source is already available in context.',
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
      'Cut an accurate MP4 clip from this video, using start/end source seconds. Each clip can last at most 120 seconds. Choose how many clips the content needs; there is no fixed clip count. Existing identical ranges are reused. Returns a playable attachment and poster. Cite it by copying the returned reference exactly: [caption](artifact:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Never shorten the UUID or drop the artifact: prefix.',
      Type.Object(
        { start: Type.Number({ minimum: 0 }), end: Type.Number({ exclusiveMinimum: 0 }) },
        { additionalProperties: false }
      ),
      async ({ start, end }, callId, signal) => {
        const { validateAgentRange } = await import('./agent-media')
        validateAgentRange(start, end, context.duration)
        const artifact = await media('video', start, end, callId, signal)
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
  if (context.onUi) {
    tools.push(createAgentUiTool(context))
  }
  if (context.hasSource === false && !context.selectVideo) {
    return [
      ...(context.managementEnabled ? createAgentManagementTools(context) : []),
      ...tools.filter((tool) =>
        [
          'read_history',
          'search_history',
          'read_notes',
          'write_notes',
          'rename_conversation',
          'show_ui',
          'read_artifact'
        ].includes(tool.name)
      )
    ]
  }
  if (context.mediaEnabled === false && !context.selectVideo) {
    return [
      ...(context.managementEnabled ? createAgentManagementTools(context) : []),
      ...tools.filter((tool) =>
        [
          'list_transcripts',
          'select_transcript',
          'get_video_info',
          'add_subtitles',
          'export_subtitles',
          'create_dubbed_video',
          'read_transcript',
          'search_transcript',
          'read_history',
          'search_history',
          'read_notes',
          'write_notes',
          'rename_conversation',
          'show_ui'
        ].includes(tool.name)
      )
    ]
  }
  tools.push(...(context.managementEnabled ? createAgentManagementTools(context) : []))
  return context.mediaKind === 'audio' && !context.selectVideo
    ? tools.filter(
        (tool) => !['capture_frames', 'create_clip', 'read_artifact'].includes(tool.name)
      )
    : tools
}
