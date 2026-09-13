import { Button } from '@renderer/components/ui/button'
import { trackDesktopEvent } from '@renderer/lib/rybbit-client'
import { openSettingsTab } from '@renderer/lib/settings-navigation'
import { aiPromptErrorNeedsProviderSettings, isIncompleteAiStreamError } from '@shared/ai-run'
import type { AiPromptErrorCode } from '@shared/ai-types'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

const GUIDE_KEY: Record<AiPromptErrorCode, string> = {
  'sign-in-required': 'transcript.promptGuide.signInRequired',
  'credits-exhausted': 'transcript.promptGuide.creditsExhausted',
  'no-provider': 'transcript.promptGuide.noProvider',
  'missing-api-key': 'transcript.promptGuide.missingApiKey',
  'missing-model': 'transcript.promptGuide.missingModel',
  'unknown-prompt': 'transcript.promptGuide.unknownPrompt',
  'empty-transcript': 'transcript.promptGuide.emptyTranscript',
  auth: 'transcript.promptGuide.auth',
  network: 'transcript.promptGuide.network',
  'empty-output': 'transcript.promptGuide.emptyOutput',
  unknown: 'transcript.promptGuide.unknown'
}

const SOLUTION_KEY: Record<AiPromptErrorCode, string> = {
  'sign-in-required': 'signInRequired',
  'credits-exhausted': 'creditsExhausted',
  'no-provider': 'noProvider',
  'missing-api-key': 'missingApiKey',
  'missing-model': 'missingModel',
  'unknown-prompt': 'unknownPrompt',
  'empty-transcript': 'emptyTranscript',
  auth: 'auth',
  network: 'network',
  'empty-output': 'emptyOutput',
  unknown: 'unknown'
}

/** Cloud-only headlines so BYOK steps never leak into VidBee Cloud failures. */
const CLOUD_GUIDE_KEY: Partial<Record<AiPromptErrorCode, string>> = {
  auth: 'transcript.promptGuide.authCloud',
  'empty-output': 'transcript.promptGuide.emptyOutputCloud',
  network: 'transcript.promptGuide.networkCloud',
  unknown: 'transcript.promptGuide.unknownCloud'
}

/** Cloud-only solution groups. Same codes as BYOK, without API key or Base URL steps. */
const CLOUD_SOLUTION_KEY: Partial<Record<AiPromptErrorCode, string>> = {
  auth: 'authCloud',
  'empty-output': 'emptyOutputCloud',
  network: 'networkCloud',
  unknown: 'unknownCloud'
}

interface TranscriptPromptGuidanceProps {
  error?: string | null
  errorCode: AiPromptErrorCode
  onRetry?: () => void
  providerLabel?: string | null
  /** True when this run used VidBee Cloud instead of a local key. */
  usingCloud?: boolean
}

const SOLUTION_STEP_KEYS = ['s1', 's2', 's3'] as const

const BYOK_LINK_CLASS =
  'inline cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-[length:inherit] text-blue-600 underline underline-offset-4 dark:text-blue-400'

/**
 * BYOK intro with an inline link to configure a local API key.
 *
 * @param props.onOpen Open Settings → Providers.
 */
function PromptByokHint({ onOpen }: { onOpen: () => void }) {
  return (
    <p>
      <Trans
        components={{
          byok: <button className={BYOK_LINK_CLASS} onClick={onOpen} type="button" />
        }}
        i18nKey="transcript.promptCreditsByok"
      />
    </p>
  )
}

/**
 * Headline i18n key for this failure, using Cloud copy when the run used Cloud.
 *
 * @param errorCode Guidance code.
 * @param usingCloud True when this run used VidBee Cloud.
 */
const promptGuideKey = (errorCode: AiPromptErrorCode, usingCloud: boolean): string =>
  (usingCloud ? CLOUD_GUIDE_KEY[errorCode] : undefined) ?? GUIDE_KEY[errorCode]

/**
 * Solution-group id for this failure, using Cloud copy when the run used Cloud.
 *
 * @param errorCode Guidance code.
 * @param usingCloud True when this run used VidBee Cloud.
 */
const promptSolutionId = (errorCode: AiPromptErrorCode, usingCloud: boolean): string =>
  (usingCloud ? CLOUD_SOLUTION_KEY[errorCode] : undefined) ?? SOLUTION_KEY[errorCode]

/**
 * Read the i18n solution list for an error code.
 *
 * @param t Translator.
 * @param errorCode Guidance code.
 * @param usingCloud True when this run used VidBee Cloud.
 */
const solutionSteps = (
  t: (key: string) => string,
  errorCode: AiPromptErrorCode,
  usingCloud: boolean
): string[] => {
  const solutionId = promptSolutionId(errorCode, usingCloud)
  return SOLUTION_STEP_KEYS.map((step) =>
    t(`transcript.promptSolutions.${solutionId}.${step}`)
  ).filter((step) => step.length > 0 && !step.startsWith('transcript.promptSolutions.'))
}

/**
 * Explain a prompt failure, list fixes, and show the raw provider error.
 */
export function TranscriptPromptGuidance({
  error,
  errorCode,
  onRetry,
  providerLabel,
  usingCloud = false
}: TranscriptPromptGuidanceProps) {
  const { t } = useTranslation()
  const cloudServiceError =
    usingCloud &&
    /Cloud AI provider (?:rejected|does not support)|configured Cloud AI model is unavailable/i.test(
      error ?? ''
    )
  const interrupted =
    isIncompleteAiStreamError(error ?? '') ||
    /connection stopped before the response finished|reached its output limit/i.test(error ?? '')
  const steps = interrupted || cloudServiceError ? [] : solutionSteps(t, errorCode, usingCloud)
  let guideKey = promptGuideKey(errorCode, usingCloud)
  if (cloudServiceError) {
    guideKey = 'transcript.promptGuide.serviceErrorCloud'
  } else if (interrupted) {
    guideKey = 'transcript.promptGuide.interrupted'
  }
  const [authWorking, setAuthWorking] = useState(false)
  const [authFailed, setAuthFailed] = useState(false)
  const isCloudSignIn = errorCode === 'sign-in-required'
  const isCreditsExhausted = errorCode === 'credits-exhausted'
  const showByokHint = isCloudSignIn || isCreditsExhausted
  const showProviderSettings =
    Boolean(providerLabel) &&
    !usingCloud &&
    !showByokHint &&
    aiPromptErrorNeedsProviderSettings(errorCode)

  useEffect(() => {
    if (!isCloudSignIn) {
      return
    }
    const removeAuthenticated = window.onAuthenticated((nextUser) => {
      setAuthWorking(false)
      setAuthFailed(false)
      trackDesktopEvent('cloud_sign_in_completed', {
        source: 'prompt_guidance',
        user_present: Boolean(nextUser)
      })
      onRetry?.()
    })
    const removeError = window.onAuthError(() => {
      setAuthWorking(false)
      setAuthFailed(true)
    })
    return () => {
      removeAuthenticated()
      removeError()
    }
  }, [isCloudSignIn, onRetry])

  /** Start the browser-based GitHub handoff from contextual prompt guidance. */
  const signInForCloud = async (): Promise<void> => {
    setAuthWorking(true)
    setAuthFailed(false)
    trackDesktopEvent('cloud_sign_in_started', { source: 'prompt_guidance' })
    try {
      await window.requestAuth()
    } catch {
      setAuthWorking(false)
      setAuthFailed(true)
    }
  }

  /** Open the advanced bring-your-own-provider settings. */
  const openProviderSettings = (): void => {
    openSettingsTab('providers')
  }

  /** Open the contextual account screen where invitation credits are available. */
  const openInvitationSettings = (): void => {
    openSettingsTab('account')
  }

  return (
    <div className="flex flex-col items-start gap-3" data-testid="transcript-prompt-guidance">
      <p className="font-medium text-sm">{t(guideKey)}</p>
      {cloudServiceError ? (
        <p className="text-muted-foreground text-sm">
          {t('transcript.promptCloudServiceErrorDetail')}
        </p>
      ) : null}
      {isCloudSignIn ? (
        <div className="space-y-2 text-muted-foreground text-sm">
          <p>
            {t('settings.ai.vidbeeCloudDescription')} {t('settings.ai.vidbeeCloudPrivacy')}
          </p>
          <PromptByokHint onOpen={openProviderSettings} />
        </div>
      ) : null}
      {isCreditsExhausted ? (
        <div className="space-y-2 text-muted-foreground text-sm">
          <p>{t('settings.account.inviteDescription')}</p>
          <PromptByokHint onOpen={openProviderSettings} />
        </div>
      ) : null}
      {providerLabel ? (
        <p className="text-muted-foreground text-xs">
          {t('transcript.promptUsingProvider', { name: providerLabel })}
        </p>
      ) : null}
      {steps.length > 0 && !(isCloudSignIn || isCreditsExhausted) ? (
        <div className="w-full">
          <p className="mb-1 font-medium text-muted-foreground text-xs">
            {t('transcript.promptWhatToDo')}
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-sm">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {error ? (
        <div className="w-full min-w-0">
          <p className="mb-1 font-medium text-muted-foreground text-xs">
            {t('transcript.promptErrorDetails')}
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-muted-foreground text-xs">
            {error}
          </pre>
        </div>
      ) : null}
      {authFailed ? (
        <p className="text-destructive text-sm" role="alert">
          {t('settings.account.error')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {isCloudSignIn ? (
          <Button
            disabled={authWorking}
            onClick={() => void signInForCloud()}
            size="sm"
            type="button"
          >
            {authWorking ? t('settings.account.signingIn') : t('settings.account.signIn')}
          </Button>
        ) : null}
        {isCreditsExhausted ? (
          <Button onClick={openInvitationSettings} size="sm" type="button">
            {t('settings.account.inviteTitle')}
          </Button>
        ) : null}
        {showProviderSettings ? (
          <Button onClick={openProviderSettings} size="sm" type="button">
            {t('transcript.promptOpenSettings')}
          </Button>
        ) : null}
        {onRetry && !cloudServiceError ? (
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            {t('transcript.promptTryAgain')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
