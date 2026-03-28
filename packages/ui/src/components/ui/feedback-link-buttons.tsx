import { BookOpen, Bug, Github } from 'lucide-react'
import { type MouseEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button, type ButtonProps } from './button'

export const DOWNLOAD_FEEDBACK_ISSUE_TITLE = '[Bug]: Download error report'

const FEEDBACK_UNKNOWN_ERROR = 'Unknown error'
const FEEDBACK_UNKNOWN_VALUE = 'Unknown'
const FEEDBACK_SOURCE_LABEL = 'Source URL'
const FEEDBACK_ERROR_LABEL = 'Error'
const FEEDBACK_COMMAND_LABEL = 'yt-dlp command'
const FEEDBACK_MAX_GITHUB_URL_LENGTH = 7000
const FAQ_URL = 'https://docs.vidbee.org/faq/'

const normalizeErrorText = (value?: string | null): string =>
  value ? value.replace(/\s+/g, ' ').trim() : ''

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
  appInfo?: {
    appVersion?: string | null
    osVersion?: string | null
  }
  buttonVariant?: ButtonProps['variant']
  buttonSize?: ButtonProps['size']
  buttonClassName?: string
  iconClassName?: string
  onGlitchTipFeedback?: (event: MouseEvent<HTMLButtonElement>) => Promise<void> | void
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  ytDlpCommand?: string
  useSimpleGithubUrl?: boolean
  wrapperClassName?: string
  showGroupSeparator?: boolean
}

export const FeedbackLinkButtons = ({
  error,
  sourceUrl,
  issueTitle = '[Bug]: ',
  includeAppInfo = false,
  appInfo,
  buttonVariant = 'outline',
  buttonSize = 'sm',
  buttonClassName,
  iconClassName,
  onGlitchTipFeedback,
  onLinkClick,
  ytDlpCommand,
  useSimpleGithubUrl = false,
  wrapperClassName = 'flex flex-wrap gap-2',
  showGroupSeparator = false
}: FeedbackLinkButtonsProps) => {
  const { t } = useTranslation()
  const [isSubmittingToGlitchTip, setIsSubmittingToGlitchTip] = useState(false)
  const appVersion = appInfo?.appVersion ?? ''
  const osVersion = appInfo?.osVersion ?? ''

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
    error,
    includeAppInfo,
    issueTitle,
    osVersion,
    sourceUrl,
    t,
    ytDlpCommand,
    useSimpleGithubUrl
  ])

  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith('https://github.com') && href.length >= FEEDBACK_MAX_GITHUB_URL_LENGTH) {
      toast.info(t('download.feedback.githubUrlTooLong'))
    }
    onLinkClick?.(event)
  }

  const feedbackLinks = links.filter((link) => link.group === 'feedback')
  const utilityLinks = links.filter((link) => link.group === 'utility')

  const handleGlitchTipFeedback = async (event: MouseEvent<HTMLButtonElement>) => {
    if (!(onGlitchTipFeedback && !isSubmittingToGlitchTip)) {
      return
    }

    setIsSubmittingToGlitchTip(true)
    try {
      await onGlitchTipFeedback(event)
    } finally {
      setIsSubmittingToGlitchTip(false)
    }
  }

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
      {onGlitchTipFeedback && (
        <Button
          className={buttonClassName}
          disabled={isSubmittingToGlitchTip}
          onClick={(event) => void handleGlitchTipFeedback(event)}
          size={buttonSize}
          variant="secondary"
        >
          <Bug className={iconClassName} />
          {isSubmittingToGlitchTip
            ? t('download.feedback.reportingNow')
            : t('download.feedback.reportNow')}
        </Button>
      )}
    </div>
  )
}
