import * as Sentry from '@sentry/electron/renderer'

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
let rendererTelemetryEnabled = true

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
  return new Error(typeof error === 'string' ? error : 'Unknown renderer error')
}

export const initGlitchTipRenderer = (): void => {
  if (isInitialized || !__GLITCHTIP_DSN__) {
    return
  }

  Sentry.init({
    dsn: __GLITCHTIP_DSN__,
    enabled: true,
    environment: __GLITCHTIP_ENVIRONMENT__,
    beforeSend(event) {
      return rendererTelemetryEnabled ? event : null
    },
    initialScope(scope) {
      scope.setTag('process', 'renderer')
      scope.setTag('platform', navigator.platform)
      return scope
    },
    release: __GLITCHTIP_RELEASE__
  })

  isInitialized = true
}

export const setRendererTelemetryEnabled = (enabled: boolean): void => {
  rendererTelemetryEnabled = enabled
}

export const addRendererBreadcrumb = (
  category: string,
  message: string,
  data?: Record<string, unknown>,
  level: BreadcrumbLevel = 'info'
): void => {
  if (!(isInitialized && rendererTelemetryEnabled)) {
    return
  }

  Sentry.addBreadcrumb({
    category,
    data,
    level,
    message
  })
}

export const captureRendererException = (error: unknown, context?: TelemetryContext): void => {
  if (!(isInitialized && rendererTelemetryEnabled)) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setTag('process', 'renderer')
    applyScopeContext(scope, context)
    Sentry.captureException(toError(error))
  })
}

export const captureRendererMessage = (
  message: string,
  context?: TelemetryContext,
  level: SeverityLevel = 'info'
): void => {
  if (!(isInitialized && rendererTelemetryEnabled)) {
    return
  }

  Sentry.withScope((scope) => {
    scope.setLevel(level)
    scope.setTag('process', 'renderer')
    applyScopeContext(scope, context)
    Sentry.captureMessage(message)
  })
}
