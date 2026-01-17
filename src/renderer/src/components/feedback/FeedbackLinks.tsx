import { Button, type ButtonProps } from '@renderer/components/ui/button'
import { ipcServices } from '@renderer/lib/ipc'
import { Github, MessageCircle, Twitter } from 'lucide-react'
import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type AppInfo = {
  appVersion: string
  osVersion: string
}

const DEFAULT_APP_INFO: AppInfo = { appVersion: '', osVersion: '' }
const FEEDBACK_TWEET_PREFIX = '@nexmoex VidBee'
export const DOWNLOAD_FEEDBACK_ISSUE_TITLE = '[Bug]: Download error report'
const FEEDBACK_UNKNOWN_ERROR = 'Unknown error'
const FEEDBACK_UNKNOWN_VALUE = 'Unknown'
const FEEDBACK_SOURCE_LABEL = 'Source URL'
const FEEDBACK_ERROR_LABEL = 'Error'
const FEEDBACK_COMMAND_LABEL = 'yt-dlp command'
const FEEDBACK_MAX_GITHUB_URL_LENGTH = 7000

let cachedAppInfo: AppInfo | null = null
let appInfoPromise: Promise<AppInfo> | null = null

const normalizeErrorText = (value?: string | null): string =>
  value ? value.replace(/\s+/g, ' ').trim() : ''

const clampText = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value

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

const loadAppInfo = async (): Promise<AppInfo> => {
  if (cachedAppInfo) {
    return cachedAppInfo
  }
  if (appInfoPromise) {
    return appInfoPromise
  }

  appInfoPromise = (async () => {
    try {
      const [version, osRelease] = await Promise.all([
        ipcServices.app.getVersion(),
        ipcServices.app.getOsVersion()
      ])
      cachedAppInfo = { appVersion: version, osVersion: osRelease }
    } catch (error) {
      console.error('Failed to load app info for feedback links:', error)
      cachedAppInfo = DEFAULT_APP_INFO
    }
    return cachedAppInfo
  })()

  return appInfoPromise
}

export const useAppInfo = (): AppInfo => {
  const [appInfo, setAppInfo] = useState<AppInfo>(DEFAULT_APP_INFO)

  useEffect(() => {
    let isActive = true

    const loadInfo = async () => {
      const info = await loadAppInfo()
      if (isActive) {
        setAppInfo(info)
      }
    }

    void loadInfo()

    return () => {
      isActive = false
    }
  }, [])

  return appInfo
}

type FeedbackLinkButtonsProps = {
  error?: string | null
  sourceUrl?: string | null
  issueTitle?: string
  includeAppInfo?: boolean
  appInfo?: AppInfo
  buttonVariant?: ButtonProps['variant']
  buttonSize?: ButtonProps['size']
  buttonClassName?: string
  iconClassName?: string
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>) => void
  ytDlpCommand?: string
  useSimpleGithubUrl?: boolean
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
  onLinkClick,
  ytDlpCommand,
  useSimpleGithubUrl = false
}: FeedbackLinkButtonsProps) => {
  const { t } = useTranslation()
  const fallbackAppInfo = useAppInfo()
  const { appVersion, osVersion } = appInfo ?? fallbackAppInfo

  const links = useMemo(() => {
    const compactError = normalizeErrorText(error)
    const tweetError = compactError ? clampText(compactError, 160) : ''
    const versionLabels = [
      appVersion ? `v${appVersion}` : null,
      osVersion ? osVersion : null
    ].filter(Boolean)
    const tweetPrefix = versionLabels.length
      ? `${FEEDBACK_TWEET_PREFIX} ${versionLabels.join(' ')}`
      : FEEDBACK_TWEET_PREFIX
    const tweetText = encodeURIComponent(
      tweetError ? `${tweetPrefix} - ${tweetError}` : tweetPrefix
    )
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

    return [
      {
        icon: Github,
        label: t('about.resources.githubIssues'),
        href: githubUrl
      },
      {
        icon: Twitter,
        label: t('about.resources.xFeedback'),
        href: `https://x.com/intent/tweet?text=${tweetText}`
      },
      {
        icon: MessageCircle,
        label: t('about.resources.discord'),
        href: 'https://discord.gg/uBqXV6QPdm'
      }
    ]
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

  return (
    <>
      {links.map((resource) => {
        const Icon = resource.icon
        return (
          <Button
            key={resource.label}
            variant={buttonVariant}
            size={buttonSize}
            className={buttonClassName}
            asChild
          >
            <a
              href={resource.href}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => handleLinkClick(event, resource.href)}
            >
              <Icon className={iconClassName} />
              {resource.label}
            </a>
          </Button>
        )
      })}
    </>
  )
}
