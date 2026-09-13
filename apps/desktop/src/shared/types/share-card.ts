import type { AgentArtifact } from '../agent-chat'
/** CSS width of the branded share poster. */
export const SHARE_CARD_WIDTH = 540

/** Hash route that mounts the hidden capture page instead of the app shell. */
export const SHARE_CAPTURE_HASH = '/share-capture'

/** Main → hidden renderer: paint this card. */
export const SHARE_CAPTURE_RENDER_CHANNEL = 'share-capture:render'

/** Hidden renderer → main: card box is stable. */
export const SHARE_CAPTURE_READY_CHANNEL = 'share-capture:ready'

export interface ShareCaptionQuote {
  after: string
  before: string
  endMs: number
  quote: string
  startMs: number
}

export interface SharePromptCardPayload {
  artifacts?: AgentArtifact[]
  runId?: string
  coverSrc?: string | null
  kind: 'prompt'
  markdown: string
  promptTitle: string
  sourceByline?: string | null
  sourceTitle?: string | null
  tagline: string
  /** User-visible instruction that produced this reply, when it is not the prompt name. */
  userText?: string | null
}

export interface ShareCaptionCardPayload {
  coverSrc?: string | null
  durationMs?: number
  kind: 'caption'
  quote: ShareCaptionQuote
  sourceByline?: string | null
  sourceTitle?: string | null
  tagline: string
}

export type ShareCardPayload = ShareCaptionCardPayload | SharePromptCardPayload

/**
 * Join platform and channel for the line under the share-card title.
 *
 * @param platform Localized or brand platform name.
 * @param channel Uploader or channel name from the download.
 */
export const shareCardSourceByline = (
  platform?: string | null,
  channel?: string | null
): string => {
  const platformLabel = platform?.trim() || ''
  const channelLabel = channel?.trim() || ''
  if (platformLabel && channelLabel && platformLabel.toLowerCase() !== channelLabel.toLowerCase()) {
    return `${platformLabel} · ${channelLabel}`
  }
  return platformLabel || channelLabel
}

/**
 * User instruction printed on a prompt share card.
 *
 * Auto-started runs store the prompt name as the user bubble; skip that so the
 * card does not print the prompt name.
 *
 * @param messages Thread messages, including the shared assistant reply.
 * @param assistantId Shared assistant message id.
 * @param promptTitle Localized prompt name, omitted from the card.
 * @param promptName Unlocalized prompt title stored on the first user bubble.
 */
export const sharePromptUserText = (
  messages: Array<{ id: string; parentId: string | null; role: string; text: string }>,
  assistantId: string,
  promptTitle?: string | null,
  promptName?: string | null
): string | undefined => {
  const assistant = messages.find((message) => message.id === assistantId)
  const user = messages.find(
    (message) => message.id === assistant?.parentId && message.role === 'user'
  )
  const text = user?.text.trim() ?? ''
  if (!text) {
    return undefined
  }
  const aliases = new Set(
    [promptTitle, promptName]
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item))
  )
  if (aliases.has(text)) {
    return undefined
  }
  return text
}

export interface ShareCaptureRenderMessage {
  payload: ShareCardPayload
  requestId: number
}

export interface ShareImageLayout {
  width: number
  height: number
  padding: number
  safeBreaks: number[]
  preferredBreaks: number[]
}

export interface ShareCaptureReadyMessage {
  layout?: ShareImageLayout
  height: number
  requestId: number
  width: number
}

/**
 * True when the renderer URL is the hidden share-capture page.
 *
 * @param hash `location.hash`, with or without a leading `#`.
 */
export const isShareCaptureHash = (hash: string): boolean =>
  hash.replace(/^#/, '').split('?')[0] === SHARE_CAPTURE_HASH
