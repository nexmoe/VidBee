export interface FeedbackAppInfo {
  appVersion?: string | null
  osVersion?: string | null
  diagnostics?: Record<string, string | number | boolean | null | undefined>
}

interface FeedbackTask {
  id: string
  title?: string
  type?: string
  status?: string
  createdAt?: number
  startedAt?: number
  completedAt?: number
  origin?: string
  taskKind?: string
  attempt?: number
  maxAttempts?: number
  internalStatus?: string
  statusReason?: string | null
  errorCategory?: string
  resolvedFormatId?: string
  selectedFormat?: {
    format_id?: string
    formatId?: string
    ext?: string
    width?: number
    height?: number
    fps?: number
    vcodec?: string
    acodec?: string
    protocol?: string
    language?: string
  }
}

export interface FeedbackDiagnostics {
  appInfo?: FeedbackAppInfo
  error?: string | null
  sourceUrl?: string | null
  ytDlpCommand?: string | null
  ytDlpLog?: string | null
  task?: FeedbackTask
  stage?: 'metadata' | 'download' | 'general'
  language?: string
  userAgent?: string
}

export const FEEDBACK_REPORT_FILENAME = 'vidbee-diagnostics.txt'
const MAILTO_PREFIX = 'mailto:team@vidbee.org?subject=VidBee%20feedback&body='
const MAX_MAILTO_LENGTH = 1900
const SENSITIVE_QUERY_KEY =
  /token|password|secret|signature|credential|api.?key|authorization|cookie|session|^(?:sig|key|jwt|auth)$/i

/** Remove credentials from diagnostic text while retaining useful error and command context. */
export function redactFeedbackText(value: string): string {
  return value
    .replace(/\b(?:https?|socks5h?):\/\/[^\s<>"'`]+/gi, (rawUrl) => {
      try {
        const url = new URL(rawUrl)
        if (url.username || url.password) {
          url.username = 'REDACTED'
          url.password = ''
        }
        for (const key of [...url.searchParams.keys()]) {
          if (SENSITIVE_QUERY_KEY.test(key)) {
            url.searchParams.set(key, 'REDACTED')
          }
        }
        return url.toString()
      } catch {
        return rawUrl
      }
    })
    .replace(
      /((?:proxy-authorization|authorization|set-cookie|cookie)\s*:\s*)[^\r\n]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /(--(?:username|password|video-password|ap-username|ap-password)(?:=|\s+))(?:"[^"]*"|'[^']*'|\S+)/gi,
      '$1[REDACTED]'
    )
    .replace(/(\/Users\/|\/home\/|[A-Z]:\\Users\\)[^/\\\s]+/gi, '$1[USER]')
}

/** Format recorded task timestamps without inventing values for older history records. */
function formatTimestamp(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Build a complete report from an explicit allowlist of task and runtime fields. */
export function buildFeedbackReport(options: FeedbackDiagnostics, now = new Date()): string {
  const { appInfo, task } = options
  const format = task?.selectedFormat
  const environment = {
    appVersion: appInfo?.appVersion || 'Unknown',
    osVersion: appInfo?.osVersion || 'Unknown',
    ...appInfo?.diagnostics,
    language: options.language,
    userAgent: options.userAgent
  }
  const taskDetails = task
    ? {
        id: task.id,
        title: task.title,
        type: task.type,
        status: task.status,
        createdAt: formatTimestamp(task.createdAt),
        startedAt: formatTimestamp(task.startedAt),
        completedAt: formatTimestamp(task.completedAt),
        origin: task.origin,
        taskKind: task.taskKind,
        attempt: task.attempt,
        maxAttempts: task.maxAttempts,
        internalStatus: task.internalStatus,
        statusReason: task.statusReason,
        errorCategory: task.errorCategory,
        resolvedFormatId: task.resolvedFormatId,
        selectedFormat: format
          ? {
              id: format.format_id ?? format.formatId,
              ext: format.ext,
              width: format.width,
              height: format.height,
              fps: format.fps,
              vcodec: format.vcodec,
              acodec: format.acodec,
              protocol: format.protocol,
              language: format.language
            }
          : undefined
      }
    : null

  return redactFeedbackText(
    [
      'VidBee diagnostic report',
      `Generated at: ${now.toISOString()}`,
      `Stage: ${options.stage ?? (task ? 'download' : 'general')}`,
      task ? `Task ID: ${task.id}` : null,
      `Error (original):\n${options.error?.trim() || 'Not provided'}`,
      `Source URL:\n${options.sourceUrl?.trim() || 'Not provided'}`,
      `Current environment:\n${JSON.stringify(environment, null, 2)}`,
      taskDetails ? `Task:\n${JSON.stringify(taskDetails, null, 2)}` : null,
      `yt-dlp command:\n${options.ytDlpCommand?.trim() || 'Not recorded for this task'}`,
      `Full yt-dlp log:\n${options.ytDlpLog?.trim() || 'Not recorded for this task'}`
    ]
      .filter(Boolean)
      .join('\n\n')
  )
}

/** Keep mail links within native handler limits and retain the full report for copy or export. */
export function buildFeedbackMail(report: string): { href: string; needsAttachment: boolean } {
  const intro = 'What happened and steps to reproduce:\n\n'
  /** Encode line breaks and reserved characters for a mail handler. */
  const encodeBody = (body: string): string =>
    MAILTO_PREFIX + encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))
  const fullHref = encodeBody(intro + report)
  if (fullHref.length <= MAX_MAILTO_LENGTH) {
    return { href: fullHref, needsAttachment: false }
  }

  const instructions = `${intro}Please paste the full diagnostic report below or attach ${FEEDBACK_REPORT_FILENAME} before sending.\n\nDiagnostic summary:\n`
  const suffix = '\n\n[Summary shortened. The complete report is available in VidBee.]'
  const characters = Array.from(report)
  let length = Math.min(characters.length, 1200)
  let href = encodeBody(instructions + characters.slice(0, length).join('') + suffix)
  while (href.length > MAX_MAILTO_LENGTH) {
    length = Math.floor(length * 0.8)
    href = encodeBody(instructions + characters.slice(0, length).join('') + suffix)
  }
  return { href, needsAttachment: true }
}
