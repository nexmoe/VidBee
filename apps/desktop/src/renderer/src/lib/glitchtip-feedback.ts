import * as BrowserSentry from '@sentry/browser'
import { toast } from 'sonner'

interface AppInfo {
  appVersion?: string | null
  osVersion?: string | null
}

interface SendGlitchTipFeedbackOptions {
  appInfo?: AppInfo
  error?: string | null
  sourceUrl?: string | null
  ytDlpCommand?: string | null
  ytDlpLog?: string | null
}

const MAX_LOG_LENGTH = 16_000

const clampLog = (value?: string | null): string => {
  const normalized = value?.trim() || ''
  if (!normalized) {
    return 'Unavailable'
  }
  if (normalized.length <= MAX_LOG_LENGTH) {
    return normalized
  }
  return normalized.slice(-MAX_LOG_LENGTH)
}

const buildFeedbackMessage = ({
  appInfo,
  error,
  sourceUrl,
  ytDlpCommand,
  ytDlpLog
}: SendGlitchTipFeedbackOptions): string => {
  const lines = [
    `Error: ${error?.trim() || 'Unknown error'}`,
    `Source URL: ${sourceUrl?.trim() || 'Unknown'}`,
    `App version: ${appInfo?.appVersion?.trim() || 'Unknown'}`,
    `OS version: ${appInfo?.osVersion?.trim() || 'Unknown'}`,
    `yt-dlp log:\n${clampLog(ytDlpLog)}`
  ]

  if (ytDlpCommand?.trim()) {
    lines.push(`yt-dlp command: ${ytDlpCommand.trim()}`)
  }

  return lines.join('\n')
}

export const sendGlitchTipFeedback = async (
  options: SendGlitchTipFeedbackOptions
): Promise<void> => {
  if (!BrowserSentry.isInitialized()) {
    toast.error('GlitchTip is not configured.')
    return
  }

  const feedbackMessage = buildFeedbackMessage(options)
  const associatedEventId = BrowserSentry.withScope((scope) => {
    scope.setLevel('error')
    scope.setTag('feedback_source', 'manual')
    scope.setContext('download_feedback', {
      appVersion: options.appInfo?.appVersion || 'Unknown',
      osVersion: options.appInfo?.osVersion || 'Unknown',
      sourceUrl: options.sourceUrl?.trim() || 'Unknown',
      ytDlpCommand: options.ytDlpCommand?.trim() || 'Unknown',
      ytDlpLog: clampLog(options.ytDlpLog)
    })
    return BrowserSentry.captureMessage('Manual download feedback submitted', 'error')
  })

  BrowserSentry.captureFeedback({
    associatedEventId,
    message: feedbackMessage,
    name: 'VidBee user',
    source: 'desktop-feedback'
  })

  toast.success('Feedback sent to GlitchTip.')
}
