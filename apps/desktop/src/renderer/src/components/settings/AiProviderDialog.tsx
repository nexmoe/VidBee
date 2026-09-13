import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { ipcServices } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { type AgentThinkingLevel, PROVIDER_THINKING_EFFORT_LEVELS } from '@shared/agent-chat'
import {
  aiProviderNeedsApiKey,
  aiProviderRequiresBaseUrl,
  getAiProviderPreset
} from '@shared/ai-presets'
import type {
  AiProviderConfig,
  AiProviderPresetId,
  AiProviderTestResult,
  AiProviderWriteInput
} from '@shared/ai-types'
import {
  Combobox,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList
} from '@vidbee/ui/components/ui/combobox'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AiProviderIcon } from './ai-provider-icon'

/** Match Input / Test connection: same height, radius, border, and fill. */
const MODEL_COMBO_FIELD_CLASS =
  '!items-center min-h-9 w-full rounded-md border bg-background px-3 py-0 shadow-none !ring-0 !ring-transparent hover:!bg-background hover:!ring-transparent focus-within:!bg-background focus-within:!ring-1 focus-within:!ring-ring'

const REPLY_PREVIEW_MAX = 80
const INPUT_TOKEN_PRESETS = [
  { label: '32K', value: 32_000 },
  { label: '64K', value: 64_000 },
  { label: '128K', value: 128_000 },
  { label: '256K', value: 256_000 }
] as const
const OUTPUT_TOKEN_PRESETS = [
  { label: '8K', value: 8000 },
  { label: '16K', value: 16_000 },
  { label: '32K', value: 32_000 },
  { label: '64K', value: 64_000 }
] as const

interface CatalogModelItem {
  label: string
  value: string
}

interface AiProviderDialogProps {
  onOpenChange: (open: boolean) => void
  onSave: (inputs: AiProviderWriteInput[]) => Promise<void>
  onTest: (input: AiProviderWriteInput) => Promise<AiProviderTestResult>
  open: boolean
  presetId: AiProviderPresetId | null
  provider?: AiProviderConfig | null
  saving?: boolean
}

/**
 * Shared dialog for adding or editing an LLM provider.
 *
 * Preset providers hide the base URL. Custom keeps it so any OpenAI-compatible
 * endpoint can be wired in.
 */
export function AiProviderDialog({
  onOpenChange,
  onSave,
  onTest,
  open,
  presetId,
  provider,
  saving = false
}: AiProviderDialogProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const baseUrlId = useId()
  const apiKeyId = useId()
  const modelId = useId()
  const contextWindowId = useId()
  const maxTokensId = useId()
  const thinkingLevelIdPrefix = useId()
  const toolsId = useId()
  const visionId = useId()
  const reasoningId = useId()
  const thinkingOnlyId = useId()
  const allowDisableThinkingId = useId()
  const openRef = useRef(open)
  const resolvedPresetId = provider?.presetId ?? presetId ?? 'custom'
  const preset = getAiProviderPreset(resolvedPresetId)
  const showBaseUrl = aiProviderRequiresBaseUrl(resolvedPresetId)
  const needsKey = aiProviderNeedsApiKey(resolvedPresetId)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [catalogItems, setCatalogItems] = useState<CatalogModelItem[]>([])
  const [remoteItems, setRemoteItems] = useState<CatalogModelItem[]>([])
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'looking' | 'ready' | 'empty'>('idle')
  const [createdItems, setCreatedItems] = useState<CatalogModelItem[]>([])
  const [contextWindow, setContextWindow] = useState('')
  const [tools, setTools] = useState(true)
  const [vision, setVision] = useState(true)
  const [reasoning, setReasoning] = useState(false)
  const [thinkingOnly, setThinkingOnly] = useState(false)
  const [allowDisableThinking, setAllowDisableThinking] = useState(true)
  const [thinkingLevels, setThinkingLevels] = useState<AgentThinkingLevel[]>([])
  const [maxTokens, setMaxTokens] = useState('')
  const [catalogStatus, setCatalogStatus] = useState<'idle' | 'looking' | 'matched' | 'missing'>(
    'idle'
  )
  const [catalogName, setCatalogName] = useState<string | null>(null)
  const [justFilled, setJustFilled] = useState(false)
  const keepSavedCapabilities = useRef(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AiProviderTestResult | null>(null)
  openRef.current = open
  useEffect(() => {
    if (!open) {
      return
    }
    setName(provider?.name ?? '')
    setBaseUrl(provider?.baseUrl ?? '')
    setApiKey('')
    setContextWindow(provider?.contextWindow ? String(provider.contextWindow) : '')
    setTools(provider?.tools ?? true)
    setVision(provider?.vision ?? true)
    setReasoning(provider?.reasoning ?? Boolean(provider))
    setThinkingOnly(provider?.thinkingOnly ?? false)
    setAllowDisableThinking(provider?.allowDisableThinking ?? true)
    setThinkingLevels(provider?.thinkingLevels ?? [])
    setMaxTokens(provider?.maxTokens ? String(provider.maxTokens) : '')
    setModels(
      [provider?.modelId ?? preset?.defaultModel ?? ''].map((id) => id.trim()).filter(Boolean)
    )
    setCreatedItems([])
    setCatalogItems([])
    setRemoteItems([])
    setRemoteStatus('idle')
    setCatalogStatus('idle')
    setCatalogName(null)
    setJustFilled(false)
    keepSavedCapabilities.current = Boolean(
      provider &&
        (provider.contextWindow !== undefined ||
          provider.vision !== undefined ||
          provider.tools !== undefined ||
          provider.reasoning !== undefined ||
          provider.thinkingOnly !== undefined ||
          provider.allowDisableThinking !== undefined ||
          provider.thinkingLevels !== undefined ||
          provider.defaultThinkingLevel !== undefined ||
          provider.maxTokens !== undefined)
    )
    setTesting(false)
    setTestResult(null)
  }, [open, preset?.defaultModel, provider])

  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    void ipcServices.ai
      .listCatalogModels(resolvedPresetId)
      .then((options) => {
        if (!cancelled && openRef.current) {
          setCatalogItems(options)
        }
      })
      .catch(() => {
        if (!cancelled && openRef.current) {
          setCatalogItems([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, resolvedPresetId])

  useEffect(() => {
    if (!open) {
      return
    }
    const canFetch =
      (!showBaseUrl || baseUrl.trim().length > 0) &&
      (!needsKey || apiKey.trim().length > 0 || Boolean(provider?.hasApiKey))
    if (!canFetch) {
      setRemoteItems([])
      setRemoteStatus('idle')
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setRemoteStatus('looking')
      void ipcServices.ai
        .listRemoteModels({
          apiKey: apiKey.trim() || undefined,
          baseUrl: showBaseUrl ? baseUrl.trim() : undefined,
          id: provider?.id,
          presetId: resolvedPresetId
        })
        .then((options) => {
          if (cancelled || !openRef.current) {
            return
          }
          setRemoteItems(options)
          setRemoteStatus(options.length > 0 ? 'ready' : 'empty')
        })
        .catch(() => {
          if (cancelled || !openRef.current) {
            return
          }
          setRemoteItems([])
          setRemoteStatus('empty')
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    apiKey,
    baseUrl,
    needsKey,
    open,
    provider?.hasApiKey,
    provider?.id,
    resolvedPresetId,
    showBaseUrl
  ])

  const lastModel = models.at(-1)?.trim() ?? ''
  // Live GET /models is this provider's list; the local catalog is only a fallback.
  const modelItems = useMemo(
    () =>
      mergeModelItems(
        remoteItems.length > 0 ? [remoteItems, createdItems] : [catalogItems, createdItems],
        models
      ),
    [catalogItems, createdItems, models, remoteItems]
  )

  useEffect(() => {
    if (!open) {
      return
    }
    const modelId = lastModel
    if (!modelId) {
      setCatalogStatus('idle')
      setCatalogName(null)
      setJustFilled(false)
      return
    }
    setCatalogStatus('looking')
    setCatalogName(null)
    setJustFilled(false)
    let cancelled = false
    const timer = window.setTimeout(() => {
      void ipcServices.ai
        .lookupCatalogModel({ modelId, presetId: resolvedPresetId })
        .then((caps) => {
          if (cancelled || !openRef.current) {
            return
          }
          if (!caps) {
            setCatalogStatus('missing')
            setCatalogName(null)
            if (keepSavedCapabilities.current) {
              keepSavedCapabilities.current = false
              return
            }
            setContextWindow('')
            setTools(true)
            setVision(true)
            setReasoning(false)
            setThinkingOnly(false)
            setAllowDisableThinking(true)
            setThinkingLevels([])
            setMaxTokens('')
            return
          }
          setCatalogStatus('matched')
          setCatalogName(caps.name)
          if (keepSavedCapabilities.current) {
            keepSavedCapabilities.current = false
            return
          }
          setContextWindow(String(caps.contextWindow))
          setVision(caps.vision)
          setReasoning(caps.reasoning)
          setThinkingOnly(caps.thinkingOnly)
          setAllowDisableThinking(caps.allowDisableThinking)
          setThinkingLevels(caps.thinkingLevels)
          setMaxTokens(caps.maxTokens ? String(caps.maxTokens) : '')
          setJustFilled(true)
        })
        .catch(() => {
          if (cancelled || !openRef.current) {
            return
          }
          setCatalogStatus('missing')
          setCatalogName(null)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [lastModel, open, resolvedPresetId])

  useEffect(() => {
    if (!justFilled) {
      return
    }
    const timer = window.setTimeout(() => {
      setJustFilled(false)
    }, 1600)
    return () => {
      window.clearTimeout(timer)
    }
  }, [justFilled])

  const title = provider
    ? t('settings.ai.editProvider')
    : t('settings.ai.addProvider', { name: t(`settings.ai.presets.${resolvedPresetId}`) })
  const parsedContextWindow = Number(contextWindow)
  const parsedMaxTokens = maxTokens.trim() === '' ? undefined : Number(maxTokens)
  const canSave =
    models.length > 0 &&
    Number.isSafeInteger(parsedContextWindow) &&
    parsedContextWindow >= 4096 &&
    parsedContextWindow <= 2_000_000 &&
    (parsedMaxTokens === undefined ||
      (Number.isSafeInteger(parsedMaxTokens) &&
        parsedMaxTokens >= 256 &&
        parsedMaxTokens < parsedContextWindow)) &&
    (!showBaseUrl || baseUrl.trim().length > 0) &&
    (!needsKey || apiKey.trim().length > 0 || Boolean(provider?.hasApiKey))

  /**
   * Collect one write payload per selected model, sharing credentials.
   */
  const writeInputs = (): AiProviderWriteInput[] =>
    models.map((modelId, index) => ({
      id: index === 0 ? provider?.id : undefined,
      presetId: resolvedPresetId,
      name: providerDisplayName(name, modelId, models.length > 1),
      baseUrl: showBaseUrl ? baseUrl.trim() : undefined,
      modelId,
      contextWindow: parsedContextWindow,
      vision,
      tools,
      reasoning,
      thinkingOnly: reasoning && thinkingOnly,
      allowDisableThinking: !reasoning || allowDisableThinking,
      thinkingLevels: reasoning && thinkingLevels.length > 0 ? thinkingLevels : undefined,
      defaultThinkingLevel: reasoning ? 'auto' : undefined,
      maxTokens: parsedMaxTokens,
      apiKey: apiKey.trim() || undefined,
      copyApiKeyFromId: index > 0 && provider?.id && !apiKey.trim() ? provider.id : undefined
    }))

  /**
   * Persist every selected model through the parent.
   */
  const handleSave = async (): Promise<void> => {
    if (!canSave || saving || testing) {
      return
    }
    await onSave(writeInputs())
  }

  /**
   * Keep created ids in the list so chips stay labeled after onCreate.
   *
   * @param query Trimmed model id the user typed.
   */
  const handleCreateModel = (query: string): CatalogModelItem => {
    const item = { label: query, value: query }
    setCreatedItems((current) =>
      current.some((entry) => entry.value === query) ? current : [...current, item]
    )
    return item
  }

  /**
   * Accept the Combobox pick list, including a single string from the typed API.
   *
   * @param value Selected model ids.
   */
  const handleModelsChange = (value: string | string[]): void => {
    setModels((Array.isArray(value) ? value : [value]).map((id) => id.trim()).filter(Boolean))
  }

  /**
   * Send a short prompt with the current fields to check that the model works.
   */
  const handleTest = async (): Promise<void> => {
    if (!canSave || saving || testing) {
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const input = writeInputs().at(-1)
      if (!input) {
        return
      }
      const result = await onTest(input)
      if (openRef.current) {
        setTestResult(result)
      }
    } catch (error) {
      if (openRef.current) {
        setTestResult({
          ok: false,
          text: '',
          error: error instanceof Error ? error.message : t('settings.ai.testFailed'),
          errorCode: 'unknown'
        })
      }
    } finally {
      if (openRef.current) {
        setTesting(false)
      }
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[min(90vh,44rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AiProviderIcon presetId={resolvedPresetId} />
            {title}
          </DialogTitle>
          <DialogDescription>{t('settings.ai.providerDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={nameId}>{t('settings.ai.name')}</Label>
            <Input
              id={nameId}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={t(`settings.ai.presets.${resolvedPresetId}`)}
              value={name}
            />
          </div>
          {showBaseUrl ? (
            <div className="grid gap-2">
              <Label htmlFor={baseUrlId}>{t('settings.ai.baseUrl')}</Label>
              <Input
                id={baseUrlId}
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
                placeholder="https://api.example.com/v1"
                value={baseUrl}
              />
            </div>
          ) : null}
          {needsKey ? (
            <div className="grid gap-2">
              <Label htmlFor={apiKeyId}>{t('settings.ai.apiKey')}</Label>
              <Input
                autoComplete="off"
                id={apiKeyId}
                onChange={(event) => setApiKey(event.currentTarget.value)}
                placeholder={provider?.hasApiKey ? t('settings.ai.apiKeyKept') : 'sk-...'}
                type="password"
                value={apiKey}
              />
            </div>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor={modelId}>{t('settings.ai.modelId')}</Label>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Combobox
                  createLabel={(query) => t('settings.ai.createModel', { query })}
                  filter={matchModelItem}
                  hideSelected
                  items={modelItems}
                  multiple
                  onCreate={handleCreateModel}
                  onValueChange={handleModelsChange}
                  value={models}
                >
                  <ComboboxChips
                    className={MODEL_COMBO_FIELD_CLASS}
                    id={modelId}
                    placeholder={preset?.defaultModel || t('settings.ai.modelIdPlaceholder')}
                  />
                  <ComboboxContent>
                    <ComboboxEmpty allSelected={t('settings.ai.allModelsSelected')}>
                      {t('settings.ai.noModelFound')}
                    </ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={itemValue(item)} value={itemValue(item)}>
                          {itemLabel(item)}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              <Button
                className="h-9 shrink-0 rounded-md border bg-background"
                data-testid="ai-provider-test"
                disabled={!canSave || saving || testing}
                onClick={() => void handleTest()}
                type="button"
                variant="outline"
              >
                {testing ? <Loader2 className="size-4 animate-spin" /> : null}
                {t('settings.ai.testConnection')}
              </Button>
            </div>
            {remoteStatus === 'looking' ? (
              <p
                aria-live="polite"
                className="flex items-center gap-2 text-muted-foreground text-xs"
                data-testid="ai-provider-remote-models-hint"
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t('settings.ai.loadingModels')}
              </p>
            ) : null}
            {catalogStatus === 'looking' ? (
              <p
                aria-live="polite"
                className="flex items-center gap-2 text-muted-foreground text-xs"
                data-testid="ai-provider-catalog-hint"
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t('agentChat.catalogLooking')}
              </p>
            ) : null}
            {testing || testResult ? (
              <div aria-live="polite" data-testid="ai-provider-test-result">
                {testing ? (
                  <p className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('settings.ai.testingConnection')}
                  </p>
                ) : null}
                {testResult?.ok ? (
                  <p className="text-emerald-700 text-sm dark:text-emerald-400">
                    {t('settings.ai.testSuccess', {
                      reply: testResult.text.trim().slice(0, REPLY_PREVIEW_MAX)
                    })}
                  </p>
                ) : null}
                {testResult && !testResult.ok ? (
                  <div className="grid gap-1">
                    <p className="text-destructive text-sm">{t('settings.ai.testFailed')}</p>
                    {testResult.error ? (
                      <p className="break-all text-muted-foreground text-xs">{testResult.error}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div
            className={cn(
              'grid gap-2 rounded-md border p-3',
              catalogStatus === 'matched' && justFilled
                ? 'border-primary/40 bg-primary/5'
                : catalogStatus === 'matched'
                  ? 'border-border bg-muted/40'
                  : 'border-transparent p-0'
            )}
          >
            {catalogStatus === 'matched' ? (
              <div className="flex items-start gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                <p aria-live="polite" className="text-sm" data-testid="ai-provider-catalog-hint">
                  {t('agentChat.catalogMatched', { name: catalogName ?? lastModel })}
                </p>
                <Badge className="ml-auto shrink-0" variant="secondary">
                  {t('agentChat.catalogBadge')}
                </Badge>
              </div>
            ) : null}
            <p className="font-medium text-sm">{t('agentChat.modelCapabilities')}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <CapabilityCheckbox
                checked={tools}
                id={toolsId}
                label={t('agentChat.toolCalling')}
                onCheckedChange={(checked) => {
                  setJustFilled(false)
                  setTools(checked)
                }}
                testId="ai-provider-tools"
              />
              <CapabilityCheckbox
                checked={vision}
                id={visionId}
                label={t('agentChat.vision')}
                onCheckedChange={(checked) => {
                  setJustFilled(false)
                  setVision(checked)
                }}
                testId="ai-provider-vision"
              />
              <CapabilityCheckbox
                checked={reasoning}
                id={reasoningId}
                label={t('agentChat.reasoning')}
                onCheckedChange={(checked) => {
                  setJustFilled(false)
                  setReasoning(checked)
                }}
                testId="ai-provider-reasoning"
              />
              {reasoning ? (
                <>
                  <CapabilityCheckbox
                    checked={thinkingOnly}
                    id={thinkingOnlyId}
                    label={t('agentChat.thinkingOnly')}
                    onCheckedChange={(checked) => {
                      setJustFilled(false)
                      setThinkingOnly(checked)
                    }}
                    testId="ai-provider-thinking-only"
                  />
                  <CapabilityCheckbox
                    checked={allowDisableThinking}
                    id={allowDisableThinkingId}
                    label={t('agentChat.allowDisableThinking')}
                    onCheckedChange={(checked) => {
                      setJustFilled(false)
                      setAllowDisableThinking(checked)
                    }}
                    testId="ai-provider-allow-disable-thinking"
                  />
                </>
              ) : null}
            </div>
            {reasoning ? (
              <>
                <p className="text-muted-foreground text-xs">
                  {t('agentChat.thinkingCapabilitiesHint')}
                </p>
                <p className="text-sm">{t('agentChat.supportedThinkingLevels')}</p>
                <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                  {PROVIDER_THINKING_EFFORT_LEVELS.map((level) => (
                    <CapabilityCheckbox
                      checked={thinkingLevels.includes(level)}
                      id={`${thinkingLevelIdPrefix}-${level}`}
                      key={level}
                      label={t(`agentChat.thinking.${level}`)}
                      onCheckedChange={(checked) => {
                        setJustFilled(false)
                        setThinkingLevels((current) => {
                          const next = checked
                            ? [...current, level]
                            : current.filter((item) => item !== level)
                          return PROVIDER_THINKING_EFFORT_LEVELS.filter((item) =>
                            next.includes(item)
                          )
                        })
                      }}
                      testId={`ai-provider-thinking-level-${level}`}
                    />
                  ))}
                </div>
              </>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor={contextWindowId}>{t('agentChat.inputTokens')}</Label>
                <Input
                  className={justFilled ? 'border-primary/50' : undefined}
                  data-testid="ai-provider-context-window"
                  id={contextWindowId}
                  max={2_000_000}
                  min={4096}
                  onChange={(event) => {
                    setJustFilled(false)
                    setContextWindow(event.target.value)
                  }}
                  placeholder={t('agentChat.providerDefault')}
                  type="number"
                  value={contextWindow}
                />
                <TokenPresetRow
                  onSelect={(value) => {
                    setJustFilled(false)
                    setContextWindow(String(value))
                  }}
                  presets={INPUT_TOKEN_PRESETS}
                  value={parsedContextWindow}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={maxTokensId}>{t('agentChat.outputTokens')}</Label>
                <Input
                  className={justFilled ? 'border-primary/50' : undefined}
                  data-testid="ai-provider-max-tokens"
                  id={maxTokensId}
                  max={2_000_000}
                  min={256}
                  onChange={(event) => {
                    setJustFilled(false)
                    setMaxTokens(event.target.value)
                  }}
                  placeholder={t('agentChat.providerDefault')}
                  type="number"
                  value={maxTokens}
                />
                <TokenPresetRow
                  onSelect={(value) => {
                    setJustFilled(false)
                    setMaxTokens(String(value))
                  }}
                  presets={OUTPUT_TOKEN_PRESETS}
                  value={parsedMaxTokens}
                />
              </div>
            </div>
            {catalogStatus === 'matched' ? (
              <p className="text-muted-foreground text-xs">{t('agentChat.catalogFilled')}</p>
            ) : (
              <p
                className="text-muted-foreground text-xs"
                data-testid={catalogStatus === 'looking' ? undefined : 'ai-provider-catalog-hint'}
              >
                {catalogStatus === 'missing'
                  ? t('agentChat.catalogMissing')
                  : t('agentChat.contextWindowHint')}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t('settings.ai.cancel')}
          </Button>
          <Button
            disabled={!canSave || saving || testing}
            onClick={() => void handleSave()}
            type="button"
          >
            {t('settings.ai.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Merge remote, catalog, and created rows. Earlier groups win on id clashes.
 *
 * @param groups Model lists in display order.
 * @param selected Currently selected model ids.
 */
function mergeModelItems(groups: CatalogModelItem[][], selected: string[]): CatalogModelItem[] {
  const seen = new Set<string>()
  const items: CatalogModelItem[] = []
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.value)) {
        continue
      }
      seen.add(item.value)
      items.push(item)
    }
  }
  for (const value of selected) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    items.push({ label: value, value })
  }
  return items
}

/**
 * Name written for one selected model. Multiple picks keep the typed name
 * and append the model id so the composer can tell them apart.
 *
 * @param name Dialog name field.
 * @param modelId Selected model id.
 * @param many Whether more than one model will be saved.
 */
function providerDisplayName(name: string, modelId: string, many: boolean): string | undefined {
  const typed = name.trim()
  if (many) {
    return typed ? `${typed} · ${modelId}` : modelId
  }
  return typed || undefined
}

/**
 * Read a Combobox item's value whether it is a string or `{ value, label }`.
 *
 * @param item Combobox row data.
 */
function itemValue(item: string | { value: string }): string {
  return typeof item === 'string' ? item : item.value
}

/**
 * Read a Combobox item's visible label.
 *
 * @param item Combobox row data.
 */
function itemLabel(item: string | { label: string; value: string }): string {
  return typeof item === 'string' ? item : item.label
}

/**
 * Match a catalog or created model against the typed query on id or label.
 *
 * @param item Combobox row data.
 * @param query Text in the chips field.
 */
function matchModelItem(item: string | { label: string; value: string }, query: string): boolean {
  const needle = query.toLocaleLowerCase()
  return (
    itemLabel(item).toLocaleLowerCase().includes(needle) ||
    itemValue(item).toLocaleLowerCase().includes(needle)
  )
}

/**
 * One labeled capability switch in the provider dialog.
 *
 * @param props.checked Whether the capability is enabled.
 * @param props.id Input id paired with the visible label.
 * @param props.label Visible capability name.
 * @param props.testId Stable test id for the checkbox.
 * @param props.onCheckedChange Persist the next boolean value.
 */
function CapabilityCheckbox({
  checked,
  id,
  label,
  testId,
  onCheckedChange
}: {
  checked: boolean
  id: string
  label: string
  testId: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        data-testid={testId}
        id={id}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      />
      <Label className="cursor-pointer font-normal" htmlFor={id}>
        {label}
      </Label>
    </div>
  )
}

/**
 * Clickable token shortcuts under an input or output field.
 *
 * @param props.presets Labelled token sizes.
 * @param props.value Current numeric value, if any.
 * @param props.onSelect Apply a preset.
 */
function TokenPresetRow({
  presets,
  value,
  onSelect
}: {
  presets: readonly { label: string; value: number }[]
  value: number | undefined
  onSelect: (value: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {presets.map((preset) => (
        <button
          className={cn(
            'text-xs',
            value === preset.value
              ? 'font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
          key={preset.label}
          onClick={() => onSelect(preset.value)}
          type="button"
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
