import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '../lib/cn'
import { aiModelIconComponent } from './ai-provider-icon'
import {
  CommandMenu,
  CommandMenuEmpty,
  CommandMenuInput,
  CommandMenuItem,
  type CommandMenuItemData,
  CommandMenuList
} from './ui/command-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

export interface AgentModelOption {
  value: string
  label: string
  description?: string
  presetId?: string
  modelId?: string
}

/** Hide the default menu icon so a brand mark stays centered. */
function HiddenCommandIcon() {
  return null
}

/** Shared model and reasoning menus; platform adapters persist the selection in Desktop. */
export function AgentModelSelect<T extends string>({
  value,
  levels,
  onChange,
  models,
  selectedModel,
  onModelChange,
  onOpen,
  t
}: {
  value: T
  levels: T[]
  onChange: (value: T) => void
  models: AgentModelOption[]
  selectedModel: string
  onModelChange: (value: string) => Promise<void>
  onOpen?: () => void
  t: (key: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [changing, setChanging] = useState(false)
  const [failed, setFailed] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const selected = models.find((model) => model.value === selectedModel)
  const cloud = selectedModel === 'cloud' || selectedModel.startsWith('cloud:')
  const label =
    selectedModel === 'cloud' ? t('agentChat.cloud') : (selected?.label ?? t('agentChat.cloud'))
  const selectedLabel =
    cloud && selected?.description
      ? `${label} · ${selected.description}`
      : label.slice(label.lastIndexOf('/') + 1)
  const SelectedIcon = aiModelIconComponent({
    isCloud: cloud,
    modelId: selected?.modelId,
    name: selected?.label,
    presetId: selected?.presetId
  })
  const thinkingLabel = t(`agentChat.thinking.${value}`)
  const triggerLabel = `${selectedLabel}: ${t('agentChat.thinking.label')}: ${thinkingLabel}`
  const modelItems = useMemo<CommandMenuItemData[]>(
    () =>
      models.map((model) => ({
        ...model,
        label: model.value === 'cloud' ? t('agentChat.cloud') : model.label,
        keywords: [model.label, model.description ?? '', model.modelId ?? ''],
        icon: aiModelIconComponent({
          isCloud: model.value === 'cloud' || model.value.startsWith('cloud:'),
          modelId: model.modelId,
          name: model.label,
          presetId: model.presetId
        })
      })),
    [models, t]
  )
  /** Close the submenu before applying a next-message model choice. */
  async function selectProvider(next: string): Promise<void> {
    if (changing) {
      return
    }
    setModelsOpen(false)
    setFailed(false)
    if (next === selectedModel) {
      setOpen(false)
      return
    }
    setChanging(true)
    try {
      await onModelChange(next)
      setOpen(false)
    } catch {
      setFailed(true)
      setOpen(true)
    } finally {
      setChanging(false)
    }
  }
  return (
    <Popover
      modal={false}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setFailed(false)
          onOpen?.()
        } else {
          setModelsOpen(false)
          setThinkingOpen(false)
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          aria-label={triggerLabel}
          className="clipii-capture-menu"
          data-testid="agent-thinking-select"
          disabled={changing}
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
              className="max-h-80 [&_[data-slot=command-menu-input]>svg]:size-4 [&_[data-slot=command-menu-input]]:h-9 [&_[data-slot=command-menu-input]]:gap-2.5 [&_[data-slot=command-menu-input]]:px-4"
              items={modelItems}
              onSelect={(item) => void selectProvider(item.value)}
              size="compact"
            >
              <CommandMenuInput placeholder={t('agentChat.searchModels')} />
              <CommandMenuList
                renderItem={(item) => {
                  const Icon = item.icon
                  return (
                    <CommandMenuItem
                      className="h-9 items-center gap-2.5 py-1.5 pr-2 pl-3"
                      icon={HiddenCommandIcon}
                      value={item.value}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center self-center">
                        {Icon ? (
                          <Icon className="block size-4 shrink-0 object-contain" size={16} />
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="min-w-0 flex-1 truncate" title={item.label}>
                          {item.label}
                        </span>
                        {item.description ? (
                          <span
                            className="max-w-[30%] shrink-0 truncate text-muted-foreground text-xs tabular-nums"
                            title={item.description}
                          >
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
        {failed ? (
          <p className="px-2 py-1 text-destructive text-xs" role="alert">
            {t('settings.account.error')}
          </p>
        ) : null}
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
                      setOpen(false)
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
