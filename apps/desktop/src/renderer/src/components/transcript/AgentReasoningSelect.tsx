import { aiModelIconComponent } from '@renderer/components/settings/ai-provider-icon'
import { ipcServices } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import type { AgentThinkingLevel } from '@shared/agent-chat'
import type { AiProviderConfig, AiSettingsSnapshot } from '@shared/ai-types'
import {
  CommandMenu,
  CommandMenuEmpty,
  CommandMenuInput,
  CommandMenuItem,
  type CommandMenuItemData,
  CommandMenuList
} from '@vidbee/ui/components/ui/command-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@vidbee/ui/components/ui/popover'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const CLOUD_PROVIDER_VALUE = 'cloud'

/** Hide the default Command Menu icon so the row can center a brand mark. */
function HiddenCommandIcon() {
  return null
}

/** Select the next-message model and thinking budget without changing an active run. */
export function AgentReasoningSelect({
  value,
  levels,
  onChange,
  onProviderChange
}: {
  value: AgentThinkingLevel
  levels: AgentThinkingLevel[]
  onChange: (value: AgentThinkingLevel) => void
  onProviderChange?: () => void
}) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const selectedProviderId = snapshot?.activeProviderId ?? null
  const selectedProvider = (snapshot?.providers ?? []).find(
    (provider) => provider.id === selectedProviderId
  )
  const selectedLabel = providerMenuLabel(selectedProviderId, snapshot?.providers ?? [], t)
  const SelectedIcon = aiModelIconComponent({
    isCloud: !selectedProvider,
    modelId: selectedProvider?.modelId,
    name: selectedProvider?.name,
    presetId: selectedProvider?.presetId
  })
  const thinkingLabel = t(`agentChat.thinking.${value}`)
  const triggerLabel = `${selectedLabel}: ${t('agentChat.thinking.label')}: ${thinkingLabel}`
  const modelItems = useMemo<CommandMenuItemData[]>(
    () => [
      {
        icon: aiModelIconComponent({ isCloud: true }),
        keywords: ['vidbee', 'cloud'],
        label: t('agentChat.cloud'),
        value: CLOUD_PROVIDER_VALUE
      },
      ...(snapshot?.providers ?? []).map((provider) => ({
        description: provider.modelId,
        icon: aiModelIconComponent({
          modelId: provider.modelId,
          name: provider.name,
          presetId: provider.presetId
        }),
        keywords: [provider.modelId, provider.presetId, provider.name],
        label: provider.name,
        value: provider.id
      }))
    ],
    [snapshot, t]
  )

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await ipcServices.ai.getSnapshot())
    } catch {
      setSnapshot(null)
    }
  }, [])

  useEffect(() => {
    void refreshSnapshot()
  }, [refreshSnapshot])

  /** Persist the Composer model and reload thinking options for the next send. */
  const selectProvider = async (nextValue: string): Promise<void> => {
    const nextId = nextValue === CLOUD_PROVIDER_VALUE ? null : nextValue
    setModelsOpen(false)
    if (nextId === selectedProviderId) {
      return
    }
    try {
      setSnapshot(await ipcServices.ai.setActiveProvider(nextId))
      onProviderChange?.()
    } catch {
      await refreshSnapshot()
    }
  }

  return (
    <Popover
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          void refreshSnapshot()
        } else {
          setModelsOpen(false)
          setThinkingOpen(false)
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={triggerLabel}
          className="clipii-capture-menu"
          data-testid="agent-thinking-select"
          title={triggerLabel}
          type="button"
        >
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 overflow-visible rounded-lg p-1.5 shadow-lg"
        data-testid="agent-model-menu"
        side="top"
        sideOffset={8}
      >
        <Popover
          modal={false}
          onOpenChange={(open) => {
            setModelsOpen(open)
            if (open) {
              setThinkingOpen(false)
            }
          }}
          open={modelsOpen}
        >
          <PopoverTrigger asChild>
            <button
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/60"
              data-testid="agent-model-submenu-trigger"
              type="button"
            >
              <span className="shrink-0 font-medium">{t('agentChat.model')}</span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <SelectedIcon aria-hidden className="block size-4" />
                </span>
                <span className="min-w-0 truncate text-left">{selectedLabel}</span>
                <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-72 overflow-hidden rounded-lg p-0 shadow-lg"
            data-testid="agent-model-command-menu"
            side="left"
            sideOffset={8}
          >
            <CommandMenu
              className="max-h-80"
              items={modelItems}
              onSelect={(item) => void selectProvider(item.value)}
            >
              <CommandMenuInput placeholder={t('agentChat.searchModels')} />
              <CommandMenuList
                renderItem={(item) => {
                  const Icon = item.icon
                  return (
                    <CommandMenuItem
                      className="h-auto min-h-12 items-center gap-2.5 py-1.5 pr-2 pl-3"
                      icon={HiddenCommandIcon}
                      value={item.value}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center self-center">
                        {Icon ? (
                          <Icon className="block size-4 shrink-0 object-contain" size={16} />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col items-start justify-center text-left leading-tight">
                        <span className="w-full truncate">{item.label}</span>
                        {item.description ? (
                          <span className="w-full truncate text-muted-foreground text-xs">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                    </CommandMenuItem>
                  )
                }}
              />
              <CommandMenuEmpty>{t('agentChat.noModels')}</CommandMenuEmpty>
            </CommandMenu>
          </PopoverContent>
        </Popover>
        {levels.length > 1 ? (
          <Popover
            modal={false}
            onOpenChange={(open) => {
              setThinkingOpen(open)
              if (open) {
                setModelsOpen(false)
              }
            }}
            open={thinkingOpen}
          >
            <PopoverTrigger asChild>
              <button
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted/60"
                data-testid="agent-thinking-submenu-trigger"
                type="button"
              >
                <span className="shrink-0 font-medium">{t('agentChat.reasoningEffort')}</span>
                <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
                  <span className="truncate">{thinkingLabel}</span>
                  <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-44 overflow-hidden rounded-lg p-1 shadow-lg"
              data-testid="agent-thinking-submenu"
              side="left"
              sideOffset={8}
            >
              {levels.map((level) => {
                const selected = level === value
                return (
                  <button
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm',
                      selected ? 'bg-muted' : 'hover:bg-muted/60'
                    )}
                    key={level}
                    onClick={() => {
                      onChange(level)
                      setThinkingOpen(false)
                    }}
                    type="button"
                  >
                    <span>{t(`agentChat.thinking.${level}`)}</span>
                    {selected ? <Check aria-hidden="true" className="size-4" /> : null}
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Strip an org prefix so `Z-AI/GLM-5.3-Flash` becomes `GLM-5.3-Flash`.
 *
 * @param modelId Provider model id.
 */
function shortModelId(modelId: string): string {
  const separator = modelId.lastIndexOf('/')
  return separator >= 0 ? modelId.slice(separator + 1) : modelId
}

/**
 * Composer trigger label: Cloud, or the selected model id.
 *
 * @param activeProviderId Enabled own-key provider, or null for Cloud.
 * @param providers Saved providers from settings.
 * @param t Translator.
 */
function providerMenuLabel(
  activeProviderId: string | null,
  providers: AiProviderConfig[],
  t: (key: string) => string
): string {
  if (!activeProviderId) {
    return t('agentChat.cloud')
  }
  const provider = providers.find((entry) => entry.id === activeProviderId)
  if (!provider) {
    return t('agentChat.cloud')
  }
  return provider.modelId ? shortModelId(provider.modelId) : provider.name
}
