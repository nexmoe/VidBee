import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import { useCloudAccount } from '@renderer/hooks/use-cloud-account'
import { formatAiCredits } from '@renderer/lib/ai-credits'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import { trackDesktopEvent } from '@renderer/lib/rybbit-client'
import { AI_PROVIDER_PRESETS } from '@shared/ai-presets'
import type {
  AiProviderConfig,
  AiProviderPreset,
  AiProviderPresetId,
  AiProviderTestResult,
  AiProviderWriteInput,
  AiSettingsSnapshot,
  CloudModelOption
} from '@shared/ai-types'
import { Check, Plus, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AiProviderDialog } from './AiProviderDialog'
import { AiProviderIcon } from './ai-provider-icon'

/**
 * Secondary text for a catalog provider: the public website, not a model id.
 *
 * @param preset Catalog entry.
 */
const catalogHint = (preset: AiProviderPreset): string => preset.website ?? ''

/**
 * Settings page for built-in LLM providers and the shared add/edit dialog.
 */
export function AiProvidersPanel() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [cloudModels, setCloudModels] = useState<CloudModelOption[]>([])
  const [defaultCloudModelId, setDefaultCloudModelId] = useState('default')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogPresetId, setDialogPresetId] = useState<AiProviderPresetId | null>(null)
  const [editing, setEditing] = useState<AiProviderConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [cloudSignInWorking, setCloudSignInWorking] = useState(false)
  const { credits, user } = useCloudAccount()

  /**
   * Load providers from the main process.
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const nextSnapshot = await ipcServices.ai.getSnapshot()
      setSnapshot(nextSnapshot)
    } catch (error) {
      logger.error('Failed to load AI providers', error)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const listener = window.api.on('settings:changed', () => {
      void refresh()
    })
    return () => window.api.removeListener('settings:changed', listener)
  }, [refresh])

  useEffect(() => {
    let disposed = false
    if (user) {
      void ipcServices.ai
        .getCloudModels()
        .then((catalog) => {
          if (!disposed) {
            setCloudModels(catalog.models)
            setDefaultCloudModelId(catalog.defaultModelId)
          }
        })
        .catch(() => {
          if (!disposed) {
            setCloudModels([])
          }
        })
    } else {
      setCloudModels([])
    }
    return () => {
      disposed = true
    }
  }, [user])

  /** Persist the Cloud selection and show request failures in the existing settings feedback. */
  const selectCloudModel = async (id: string): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.setCloudModel(id))
    } catch {
      toast.error(t('settings.ai.saveError'))
    }
  }

  useEffect(() => {
    if (!(user && cloudSignInWorking)) {
      return
    }
    setCloudSignInWorking(false)
    trackDesktopEvent('cloud_sign_in_completed', { source: 'provider_settings' })
  }, [cloudSignInWorking, user])

  useEffect(() => {
    if (typeof window.onAuthError !== 'function') {
      return
    }
    return window.onAuthError(() => {
      setCloudSignInWorking(false)
      toast.error(t('settings.account.error'))
    })
  }, [t])

  /**
   * Open the unified dialog for a catalog provider.
   *
   * @param presetId Built-in provider id.
   */
  const openCreate = (presetId: AiProviderPresetId): void => {
    setEditing(null)
    setDialogPresetId(presetId)
    setDialogOpen(true)
  }

  /**
   * Open the unified dialog for an existing provider.
   *
   * @param provider Saved provider.
   */
  const openEdit = (provider: AiProviderConfig): void => {
    setEditing(provider)
    setDialogPresetId(provider.presetId)
    setDialogOpen(true)
  }

  /**
   * Ping the model with the dialog values without saving first.
   *
   * @param input Dialog payload.
   */
  const handleTest = (input: AiProviderWriteInput): Promise<AiProviderTestResult> =>
    ipcServices.ai.testProvider(input)

  /**
   * Persist dialog values and refresh the list.
   *
   * @param input Dialog payload.
   */
  const handleSave = async (inputs: AiProviderWriteInput[]): Promise<void> => {
    setSaving(true)
    try {
      let snapshot: AiSettingsSnapshot | null = null
      for (const input of inputs) {
        snapshot = await ipcServices.ai.upsertProvider(input)
      }
      if (snapshot) {
        setSnapshot(snapshot)
      }
      setDialogOpen(false)
      trackDesktopEvent('ai_provider_configured', {
        preset_id: inputs[0]?.presetId ?? 'custom',
        source: 'provider_settings'
      })
    } catch (error) {
      logger.error('Failed to save AI provider', error)
      toast.error(error instanceof Error ? error.message : t('settings.ai.saveError'))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Enable a provider for transcript prompts.
   *
   * @param id Provider id.
   */
  const handleUse = async (id: string): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.setActiveProvider(id))
      trackDesktopEvent('ai_provider_selected', {
        provider_type: 'byok',
        source: 'provider_settings'
      })
    } catch (error) {
      logger.error('Failed to enable AI provider', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  /** Clear the local selection so signed-in prompts use VidBee Cloud. */
  const handleUseCloud = async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.setActiveProvider(null))
      trackDesktopEvent('ai_provider_selected', {
        provider_type: 'cloud',
        source: 'provider_settings'
      })
    } catch (error) {
      logger.error('Failed to enable VidBee Cloud', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  /** Open the GitHub flow required by the managed cloud provider. */
  const handleCloudSignIn = async (): Promise<void> => {
    setCloudSignInWorking(true)
    trackDesktopEvent('cloud_sign_in_started', { source: 'provider_settings' })
    try {
      await window.requestAuth()
    } catch (error) {
      setCloudSignInWorking(false)
      logger.error('Failed to start VidBee Cloud sign in', error)
      toast.error(t('settings.account.error'))
    }
  }

  /**
   * Activate a catalog card with Enter or Space.
   *
   * @param event Keyboard event from the card.
   * @param presetId Built-in provider id.
   */
  const handleCatalogKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    presetId: AiProviderPresetId
  ): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }
    event.preventDefault()
    openCreate(presetId)
  }

  /**
   * Remove a configured provider.
   *
   * @param id Provider id.
   */
  const handleDelete = async (id: string): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.deleteProvider(id))
    } catch (error) {
      logger.error('Failed to delete AI provider', error)
      toast.error(t('settings.ai.saveError'))
    }
  }

  const providers = snapshot?.providers ?? []
  const activeProviderId = snapshot?.activeProviderId ?? null
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="px-1 font-medium text-muted-foreground text-sm">
          {t('settings.ai.vidbeeCloudSection')}
        </h3>
        <ItemGroup>
          <Item variant="muted">
            <ItemContent>
              <ItemTitle>
                {t('settings.ai.vidbeeCloud')}
                <Badge variant="outline">{t('settings.ai.recommended')}</Badge>
                {activeProviderId === null && user ? (
                  <Badge variant="secondary">
                    <Check aria-hidden className="size-3" />
                    {t('settings.ai.inUse')}
                  </Badge>
                ) : null}
              </ItemTitle>
              <ItemDescription>{t('settings.ai.vidbeeCloudDescription')}</ItemDescription>
              <ItemDescription>{t('settings.ai.vidbeeCloudPrivacy')}</ItemDescription>
              {user && cloudModels.length ? (
                <label className="flex flex-col gap-1 text-sm">
                  {t('agentChat.model')}
                  <select
                    className="rounded-md border bg-background px-2 py-1.5"
                    onChange={(event) => void selectCloudModel(event.target.value)}
                    value={snapshot?.cloudModelId ?? defaultCloudModelId}
                  >
                    {snapshot?.cloudModelId &&
                    !cloudModels.some((model) => model.id === snapshot.cloudModelId) ? (
                      <option disabled value={snapshot.cloudModelId}>
                        {snapshot.cloudModelId}
                      </option>
                    ) : null}
                    {cloudModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name} · {model.multiplier}×
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {credits ? (
                <p className="font-medium text-foreground text-xs tabular-nums">
                  {t('settings.account.creditsRemaining', {
                    remaining: formatAiCredits(credits.remainingCredits)
                  })}
                </p>
              ) : null}
            </ItemContent>
            <ItemActions>
              {user ? (
                activeProviderId === null ? null : (
                  <Button onClick={() => void handleUseCloud()} size="sm" variant="outline">
                    {t('settings.ai.useVidbeeCloud')}
                  </Button>
                )
              ) : (
                <Button
                  disabled={cloudSignInWorking}
                  onClick={() => void handleCloudSignIn()}
                  size="sm"
                >
                  {cloudSignInWorking
                    ? t('settings.account.signingIn')
                    : t('settings.account.signIn')}
                </Button>
              )}
            </ItemActions>
          </Item>
        </ItemGroup>
      </div>

      <div className="space-y-4" data-testid="ai-own-provider-section">
        {providers.length > 0 ? (
          <div className="space-y-2">
            <h3 className="px-1 font-medium text-muted-foreground text-sm">
              {t('settings.ai.configured')}
            </h3>
            <ItemGroup>
              {providers.map((provider, index) => {
                const inUse = provider.id === activeProviderId
                return (
                  <div key={provider.id}>
                    {index > 0 ? <ItemSeparator /> : null}
                    <Item data-testid={`ai-configured-provider-${provider.id}`} variant="muted">
                      <ItemMedia className="border-border bg-background" variant="icon">
                        <AiProviderIcon presetId={provider.presetId} />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>
                          {provider.name}
                          {inUse ? (
                            <Badge variant="secondary">
                              <Check aria-hidden className="size-3" />
                              {t('settings.ai.inUse')}
                            </Badge>
                          ) : null}
                        </ItemTitle>
                        <ItemDescription>{provider.modelId}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        {inUse ? null : (
                          <Button
                            onClick={() => void handleUse(provider.id)}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            {t('settings.ai.useProvider')}
                          </Button>
                        )}
                        <Button
                          onClick={() => openEdit(provider)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {t('settings.ai.edit')}
                        </Button>
                        <Button
                          aria-label={t('settings.ai.deleteProvider')}
                          className="size-8"
                          onClick={() => void handleDelete(provider.id)}
                          size="icon"
                          title={t('settings.ai.deleteProvider')}
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </ItemActions>
                    </Item>
                  </div>
                )
              })}
            </ItemGroup>
          </div>
        ) : null}

        <div className="space-y-2">
          <h3 className="px-1 font-medium text-muted-foreground text-sm">
            {t('settings.ai.allServices')}
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {AI_PROVIDER_PRESETS.map((preset) => {
              const name = t(`settings.ai.presets.${preset.id}`)
              const hint = catalogHint(preset)
              return (
                <Item
                  aria-label={t('settings.ai.addProvider', { name })}
                  className="cursor-pointer hover:bg-accent/50"
                  data-testid={`ai-provider-preset-${preset.id}`}
                  key={preset.id}
                  onClick={() => openCreate(preset.id)}
                  onKeyDown={(event) => handleCatalogKeyDown(event, preset.id)}
                  role="button"
                  rounded="both"
                  size="sm"
                  tabIndex={0}
                  variant="muted"
                >
                  <ItemMedia className="border-border bg-background" variant="icon">
                    <AiProviderIcon presetId={preset.id} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{name}</ItemTitle>
                    {hint ? (
                      <ItemDescription className="line-clamp-1">{hint}</ItemDescription>
                    ) : null}
                  </ItemContent>
                  <ItemActions>
                    <Plus aria-hidden className="size-4 text-muted-foreground" />
                  </ItemActions>
                </Item>
              )
            })}
          </div>
        </div>
      </div>

      <AiProviderDialog
        onOpenChange={setDialogOpen}
        onSave={handleSave}
        onTest={handleTest}
        open={dialogOpen}
        presetId={dialogPresetId}
        provider={editing}
        saving={saving}
      />
    </div>
  )
}
