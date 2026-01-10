import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Textarea } from '@renderer/components/ui/textarea'
import { logger } from '@renderer/lib/logger'
import { AlertTriangle, Copy, Home, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export interface ErrorInfo {
  error: Error
  errorInfo?: {
    componentStack?: string
  }
  timestamp: number
  context?: {
    url?: string
    userAgent?: string
    platform?: string
    version?: string
  }
}

interface ErrorPageProps {
  errorInfo: ErrorInfo
  onReload?: () => void
  onGoHome?: () => void
}

export function ErrorPage({ errorInfo, onReload, onGoHome }: ErrorPageProps) {
  const { t } = useTranslation()
  const [showDetails, setShowDetails] = useState(false)
  const [copied, setCopied] = useState(false)

  const errorReport = generateErrorReport(errorInfo)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorReport)
      setCopied(true)
      toast.success(t('error.copySuccess'))
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      logger.error('Failed to copy error report:', error)
      toast.error(t('error.copyFailed'))
    }
  }

  const handleReload = () => {
    if (onReload) {
      onReload()
    } else {
      window.location.reload()
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-2xl">{t('error.title')}</CardTitle>
              <CardDescription className="mt-2">{t('error.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error Message */}
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4">
            <p className="text-sm font-medium text-destructive mb-1">{t('error.message')}</p>
            <p className="text-sm text-foreground break-words">
              {errorInfo.error.message || t('error.unknownError')}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {onGoHome && (
              <Button variant="outline" onClick={onGoHome}>
                <Home className="h-4 w-4 mr-2" />
                {t('error.goHome')}
              </Button>
            )}
            <Button variant="outline" onClick={handleReload}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('error.reload')}
            </Button>
            <Button variant="outline" onClick={handleCopy}>
              <Copy className="h-4 w-4 mr-2" />
              {copied ? t('error.copied') : t('error.copyReport')}
            </Button>
            <Button variant="ghost" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? t('error.hideDetails') : t('error.showDetails')}
            </Button>
          </div>

          {/* Error Details */}
          {showDetails && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">{t('error.stackTrace')}</p>
                <ScrollArea className="h-48 rounded-md border bg-muted/50 p-4">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                    {errorInfo.error.stack || t('error.noStackTrace')}
                  </pre>
                </ScrollArea>
              </div>

              {errorInfo.errorInfo?.componentStack && (
                <div>
                  <p className="text-sm font-medium mb-2">{t('error.componentStack')}</p>
                  <ScrollArea className="h-32 rounded-md border bg-muted/50 p-4">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                      {errorInfo.errorInfo.componentStack}
                    </pre>
                  </ScrollArea>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-2">{t('error.fullReport')}</p>
                <Textarea
                  readOnly
                  value={errorReport}
                  className="font-mono text-xs min-h-48"
                  onClick={(e) => {
                    const target = e.target as HTMLTextAreaElement
                    target.select()
                  }}
                />
              </div>
            </div>
          )}

          {/* Help Text */}
          <div className="rounded-md bg-muted/50 border p-4">
            <p className="text-sm text-muted-foreground">{t('error.helpText')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function generateErrorReport(errorInfo: ErrorInfo): string {
  const lines: string[] = []

  lines.push('=== VidBee Error Report ===')
  lines.push(`Timestamp: ${new Date(errorInfo.timestamp).toISOString()}`)
  lines.push('')

  if (errorInfo.context) {
    lines.push('--- Context ---')
    if (errorInfo.context.version) {
      lines.push(`App Version: ${errorInfo.context.version}`)
    }
    if (errorInfo.context.platform) {
      lines.push(`Platform: ${errorInfo.context.platform}`)
    }
    if (errorInfo.context.url) {
      lines.push(`URL: ${errorInfo.context.url}`)
    }
    if (errorInfo.context.userAgent) {
      lines.push(`User Agent: ${errorInfo.context.userAgent}`)
    }
    lines.push('')
  }

  lines.push('--- Error ---')
  lines.push(`Name: ${errorInfo.error.name}`)
  lines.push(`Message: ${errorInfo.error.message}`)
  lines.push('')

  if (errorInfo.error.stack) {
    lines.push('--- Stack Trace ---')
    lines.push(errorInfo.error.stack)
    lines.push('')
  }

  if (errorInfo.errorInfo?.componentStack) {
    lines.push('--- Component Stack ---')
    lines.push(errorInfo.errorInfo.componentStack)
    lines.push('')
  }

  lines.push('=== End of Report ===')

  return lines.join('\n')
}
