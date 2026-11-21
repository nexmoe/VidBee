import { Button } from '@renderer/components/ui/button'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { cookieSetupRequestAtom } from '@renderer/store/cookie-setup'
import { getCookieSetupFailureKind } from '@vidbee/downloader-core/cookie-setup'
import {
  DOWNLOAD_FEEDBACK_ISSUE_TITLE,
  FeedbackLinkButtons
} from '@vidbee/ui/components/ui/feedback-link-buttons'
import { useSetAtom } from 'jotai'
import { AlertCircle, FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getDownloadErrorGuidance } from '../../lib/download-error-guidance'
import { useAppInfo } from '../feedback/FeedbackLinks'

interface DownloadParseErrorBannerProps {
  title: string
  error: string
  sourceUrl?: string | null
  ytDlpCommand?: string
  showFeedback?: boolean
}

/**
 * Translate a classified cookie failure into setup-dialog copy.
 *
 * @param kind Cookie failure kind.
 * @param t i18n function.
 */
const cookieFailureCopy = (
  kind: NonNullable<ReturnType<typeof getCookieSetupFailureKind>>,
  t: (key: string) => string
): string => {
  switch (kind) {
    case 'macos-files-permission':
      return t('download.cookiesSetupMacFiles')
    case 'browser-locked':
      return t('download.cookiesSetupLocked')
    case 'browser-decrypt':
      return t('download.cookiesSetupDecrypt')
    case 'file-invalid':
      return t('download.cookiesSetupFileInvalid')
    case 'linux-keyring':
      return t('download.cookiesSetupKeyring')
    case 'stale':
      return t('download.cookiesSetupStale')
    default:
      return t('download.cookiesSetupNeeded')
  }
}

/**
 * Error banner for video/playlist info fetch failures, with cookie-permission actions.
 *
 * @param props Banner title, raw error, and optional feedback context.
 */
export function DownloadParseErrorBanner({
  title,
  error,
  sourceUrl,
  ytDlpCommand,
  showFeedback = false
}: DownloadParseErrorBannerProps) {
  const { t } = useTranslation()
  const appInfo = useAppInfo()
  const setCookieSetupRequest = useSetAtom(cookieSetupRequestAtom)
  const cookieFailureKind = getCookieSetupFailureKind(error)
  const guidance =
    (cookieFailureKind ? cookieFailureCopy(cookieFailureKind, t) : null) ??
    getDownloadErrorGuidance(error)
  const needsFilesPermission = cookieFailureKind === 'macos-files-permission'

  /**
   * Open macOS Privacy → Files & Folders so the user can grant browser access.
   */
  const handleOpenFilesSettings = async (): Promise<void> => {
    try {
      const opened = await ipcServices.fs.openMacFilesAndFoldersSettings()
      if (!opened) {
        toast.error(t('settings.openLinkError'))
      }
    } catch (openError) {
      logger.error('[DownloadParseErrorBanner] Failed to open Files & Folders settings:', openError)
      toast.error(t('settings.openLinkError'))
    }
  }

  return (
    <div className="mb-3 shrink-0 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-destructive text-sm">{title}</p>
          <p className="break-words text-muted-foreground text-xs">{guidance ?? error}</p>
          {guidance ? (
            <p className="break-words text-[11px] text-muted-foreground/70">{error}</p>
          ) : null}
        </div>
      </div>
      {cookieFailureKind ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {needsFilesPermission ? (
            <Button
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void handleOpenFilesSettings()}
              size="sm"
              variant="outline"
            >
              <FolderOpen className="h-3 w-3" />
              {t('download.cookiesSetupOpenFilesSettings')}
            </Button>
          ) : null}
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => {
              setCookieSetupRequest({ failureKind: cookieFailureKind })
            }}
            size="sm"
            variant="outline"
          >
            {t('download.cookiesSetupAction')}
          </Button>
        </div>
      ) : null}
      {showFeedback ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-[10px] text-muted-foreground/70">
            {t('download.feedback.title')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <FeedbackLinkButtons
              appInfo={appInfo}
              buttonClassName="h-5 gap-1 px-1.5 text-[10px]"
              buttonSize="sm"
              buttonVariant="outline"
              error={error}
              iconClassName="h-2.5 w-2.5"
              includeAppInfo
              issueTitle={DOWNLOAD_FEEDBACK_ISSUE_TITLE}
              sourceUrl={sourceUrl}
              stage="metadata"
              ytDlpCommand={ytDlpCommand}
              ytDlpLog={error}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
