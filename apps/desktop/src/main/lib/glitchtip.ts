import * as Sentry from '@sentry/electron/main'
import { app } from 'electron'
import { settingsManager } from '../settings'

declare const __GLITCHTIP_DSN__: string
declare const __GLITCHTIP_ENVIRONMENT__: string
declare const __GLITCHTIP_RELEASE__: string

type BreadcrumbLevel = 'debug' | 'error' | 'fatal' | 'info' | 'log' | 'warning'
type SeverityLevel = 'debug' | 'error' | 'fatal' | 'info' | 'log' | 'warning'

interface TelemetryContext {
  extra?: Record<string, unknown>
  fingerprint?: string[]
  tags?: Record<string, boolean | number | string | undefined>
}

interface TelemetryScope {
  setContext: (name: string, context: Record<string, unknown>) => void
  setFingerprint: (fingerprint: string[]) => void
  setLevel: (level: SeverityLevel) => void
  setTag: (key: string, value: string) => void
}

let isInitialized = false

const getRelease = (): string => {
  return __GLITCHTIP_RELEASE__ || `vidbee-desktop@${app.getVersion()}`
}

const isTelemetryEnabled = (): boolean => {
  return settingsManager.get('enableAnalytics') !== false
}

const applyScopeContext = (scope: TelemetryScope, context?: TelemetryContext): void => {
  if (!context) {
    return
  }

  if (context.tags) {
    for (const [key, value] of Object.entries(context.tags)) {
      if (value === undefined) {
        continue
      }
      scope.setTag(key, String(value))
    }
  }

  if (context.extra) {
    scope.setContext('details', context.extra)
  }

  if (context.fingerprint?.length) {
    scope.setFingerprint(context.fingerprint)
  }
}

const toError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }
  return new Error(typeof error === 'string' ? error : 'Unknown main process error')
}

export const initGlitchTipMain = (): void => {
  if (isInitialized || !__GLITCHTIP_DSN__) {
    return
  }

  Sentry.init({
    dsn: __GLITCHTIP_DSN__,
    enabled: true,
    environment: __GLITCHTIP_ENVIRONMENT__,
    beforeSend(event) {
      return isTelemetryEnabled() ? event : null
    },
    initialScope(scope) {
      scope.setTag('process', 'main')
      scope.setTag('platform', process.platform)
      scope.setTag('packaged', String(app.isPackaged))
      scope.setTag('app_version', app.getVersion())
      return scope
    },
    release: getRelease()
  })

  isInitialized = true
}

export const addMainBreadcrumb = (
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: BreadcrumbLevel = 'info'
): void => {
  if (!(isInitialized && isTelemetryEnabled())) {
    return
  }

  Sentry.addBreadcrumb({
    category,
    data,
    level,
    message
  })
}

export const captureMainException = (error: unknown, context?: TelemetryContext): void => {
  if (!(isInitialized && isTelemetryEnabled())) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setTag('process', 'main')
    applyScopeContext(scope, context)
    Sentry.captureException(toError(error))
  })
}

export const captureMainMessage = (
  message: string,
  context?: TelemetryContext,
  level: SeverityLevel = 'info'
): void => {
  if (!(isInitialized && isTelemetryEnabled())) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setLevel(level)
    scope.setTag('process', 'main')
    applyScopeContext(scope, context)
    Sentry.captureMessage(message)
  })
}
