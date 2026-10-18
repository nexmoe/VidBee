import { BookOpen, Copy, Download, Github, Mail } from 'lucide-react'
import { type MouseEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  buildFeedbackMail,
  buildFeedbackReport,
  FEEDBACK_REPORT_FILENAME,
  type FeedbackDiagnostics
} from '../../lib/feedback-diagnostics'
import { Button, type ButtonProps } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './dialog'
import { Textarea } from './textarea'

export type { FeedbackAppInfo } from '../../lib/feedback-diagnostics'

export const DOWNLOAD_FEEDBACK_ISSUE_TITLE = '[Bug]: Download error report'

const FEEDBACK_UNKNOWN_ERROR = 'Unknown error'
const FEEDBACK_UNKNOWN_VALUE = 'Unknown'
const FEEDBACK_SOURCE_LABEL = 'Source URL'
const FEEDBACK_ERROR_LABEL = 'Error'
const FEEDBACK_COMMAND_LABEL = 'yt-dlp command'
const FEEDBACK_MAX_GITHUB_URL_LENGTH = 7000
const FAQ_URL = 'https://vidbee.org/docs/faq/'

/** Normalize an error for feedback links. */
const normalizeErrorText = (value?: string | null): string =>
  value ? value.replace(/\s+/g, ' ').trim() : ''

/** Format the diagnostic snippet for the GitHub issue template. */
const buildIssueLogs = (
  errorText: string,
  sourceUrl: string | undefined,
  ytDlpCommand: string | undefined,
  urlLabel: string,
  errorLabel: string,
  commandLabel: string
): string => {
  const lines: string[] = []
  if (sourceUrl) {
    lines.push(`**${urlLabel}:**\n${sourceUrl}\n`)
  }
  if (ytDlpCommand) {
    lines.push(`**${commandLabel}:**\n\`\`\`bash\n${ytDlpCommand}\n\`\`\`\n`)
  }
  lines.push(`**${errorLabel}:**\n${errorText}`)
  return lines.join('\n')
}

interface FeedbackLinkButtonsProps {
  error?: string | null
  sourceUrl?: string | null
  issueTitle?: string
  includeAppInfo?: boolean
  appInfo?: FeedbackDiagnostics['appInfo']
  task?: FeedbackDiagnostics['task']
  stage?: FeedbackDiagnostics['stage']
  ytDlpLog?: string | null
  buttonVariant?: ButtonProps['variant']
  buttonSize?: ButtonProps['size']
  buttonClassName?: string
  iconClassName?: string
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  ytDlpCommand?: string
  useSimpleGithubUrl?: boolean
  wrapperClassName?: string
  showGroupSeparator?: boolean
}

/** Render feedback and help links with the available diagnostic context. */
export const FeedbackLinkButtons = ({
  error,
  sourceUrl,
  issueTitle = '[Bug]: ',
  includeAppInfo = false,
  appInfo,
  task,
  stage,
  ytDlpLog,
  buttonVariant = 'outline',
  buttonSize = 'sm',
  buttonClassName,
  iconClassName,
  onLinkClick,
  ytDlpCommand,
  useSimpleGithubUrl = false,
  wrapperClassName = 'flex flex-wrap gap-2',
  showGroupSeparator = false
}: FeedbackLinkButtonsProps) => {
  const { t, i18n } = useTranslation()
  const [reportOpen, setReportOpen] = useState(false)
  const appVersion = appInfo?.appVersion ?? ''
  const osVersion = appInfo?.osVersion ?? ''
  const report = useMemo(
    () =>
      buildFeedbackReport({
        appInfo,
        task,
        stage,
        error,
        sourceUrl,
        ytDlpCommand,
        ytDlpLog,
        language: i18n.language,
        userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent
      }),
    [appInfo, task, stage, error, sourceUrl, ytDlpCommand, ytDlpLog, i18n.language]
  )
  const email = useMemo(() => buildFeedbackMail(report), [report])

  const links = useMemo(() => {
    const compactError = normalizeErrorText(error)
    const issueError = compactError || FEEDBACK_UNKNOWN_ERROR
    const resolvedSourceUrl = sourceUrl?.trim() || undefined
    const normalizedCommand = ytDlpCommand?.trim() || undefined
    const shouldIncludeLogs = Boolean(compactError || resolvedSourceUrl || normalizedCommand)
    const issueLogs = shouldIncludeLogs
      ? buildIssueLogs(
          issueError,
          resolvedSourceUrl,
          normalizedCommand,
          FEEDBACK_SOURCE_LABEL,
          FEEDBACK_ERROR_LABEL,
          FEEDBACK_COMMAND_LABEL
        )
      : null
    const appVersionValue = appVersion ? `VidBee v${appVersion}` : FEEDBACK_UNKNOWN_VALUE
    const osVersionValue = osVersion || FEEDBACK_UNKNOWN_VALUE

    let githubUrl: string
    if (useSimpleGithubUrl) {
      githubUrl = 'https://github.com/nexmoe/VidBee/issues/new/choose'
    } else {
      const issueParams = new URLSearchParams({
        template: 'bug_report.yml',
        title: issueTitle
      })

      if (issueLogs) {
        issueParams.set('logs', issueLogs)
      }
      if (includeAppInfo) {
        issueParams.set('app_version', appVersionValue)
        issueParams.set('os_version', osVersionValue)
      }

      githubUrl = `https://github.com/nexmoe/VidBee/issues/new?${issueParams.toString()}`
    }

    const feedbackLinks = [
      {
        icon: Github,
        label: t('about.resources.githubIssues'),
        href: githubUrl,
        group: 'feedback'
      },
      {
        icon: Mail,
        label: t('download.feedback.email'),
        href: email.href,
        group: 'feedback'
      }
    ]

    if (error) {
      feedbackLinks.push({
        icon: BookOpen,
        label: t('about.resources.faq') ?? 'FAQ',
        href: FAQ_URL,
        group: 'utility'
      })
    }

    return feedbackLinks
  }, [
    appVersion,
    email.href,
    error,
    includeAppInfo,
    issueTitle,
    osVersion,
    sourceUrl,
    t,
    ytDlpCommand,
    useSimpleGithubUrl
  ])

  /** Warn about oversized GitHub links and preserve caller click handling. */
  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith('mailto:')) {
      event.preventDefault()
      setReportOpen(true)
    }
    if (href.startsWith('https://github.com') && href.length >= FEEDBACK_MAX_GITHUB_URL_LENGTH) {
      toast.info(t('download.feedback.githubUrlTooLong'))
    }
    onLinkClick?.(event)
  }

  /** Copy the complete report rather than the shortened mail link body. */
  const handleCopyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(report)
      toast.success(t('error.copySuccess'))
    } catch {
      toast.error(t('error.copyFailed'))
    }
  }

  /** Export every diagnostic line as a text attachment using the platform download handler. */
  const handleDownloadReport = (): void => {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = FEEDBACK_REPORT_FILENAME
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const feedbackLinks = links.filter((link) => link.group === 'feedback')
  const utilityLinks = links.filter((link) => link.group === 'utility')

  return (
    <div className={wrapperClassName}>
      {utilityLinks.length > 0 && (
        <>
          {utilityLinks.map((resource) => {
            return (
              <Button
                asChild
                className={buttonClassName}
                key={resource.label}
                size={buttonSize}
                variant={buttonVariant}
              >
                <a
                  href={resource.href}
                  onClick={(event) => handleLinkClick(event, resource.href)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {resource.label}
                </a>
              </Button>
            )
          })}
          {showGroupSeparator && <div className="mx-1 h-4 border-border/40 border-l" />}
        </>
      )}
      {feedbackLinks.map((resource) => {
        const Icon = resource.icon
        return (
          <Button
            asChild
            className={buttonClassName}
            key={resource.label}
            size={buttonSize}
            variant={buttonVariant}
          >
            <a
              href={resource.href}
              onClick={(event) => handleLinkClick(event, resource.href)}
              rel="noreferrer"
              target="_blank"
            >
              <Icon className={iconClassName} />
              {resource.label}
            </a>
          </Button>
        )
      })}
      <Dialog onOpenChange={setReportOpen} open={reportOpen}>
        <DialogContent className="sm:max-w-2xl" onClick={(event) => event.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t('download.feedback.diagnosticReport')}</DialogTitle>
            <DialogDescription>
              {t(
                email.needsAttachment
                  ? 'download.feedback.attachReportDescription'
                  : 'download.feedback.reportDescription'
              )}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label={t('download.feedback.diagnosticReport')}
            className="h-72 resize-none overflow-auto font-mono [field-sizing:fixed]"
            readOnly
            value={report}
          />
          <DialogFooter className="flex-wrap gap-2">
            <Button onClick={() => void handleCopyReport()} variant="outline">
              <Copy className="h-4 w-4" />
              {t('error.copyReport')}
            </Button>
            <Button onClick={handleDownloadReport} variant="outline">
              <Download className="h-4 w-4" />
              {t('download.feedback.downloadReport')}
            </Button>
            <Button asChild>
              <a href={email.href} rel="noreferrer" target="_blank">
                <Mail className="h-4 w-4" />
                {t('download.feedback.openEmail')}
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
