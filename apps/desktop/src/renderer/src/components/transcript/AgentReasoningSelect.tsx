import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import type { AgentThinkingLevel } from '@shared/agent-chat'
import type { AgentComposerOptions } from '@shared/extension-chat'
import { AgentModelSelect } from '@vidbee/ui/components/agent-model-select'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Adapt Desktop IPC to the shared Composer model and reasoning menus. */
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
  const pending = useRef(0)
  const changed = useRef(onProviderChange)
  changed.current = onProviderChange
  const [options, setOptions] = useState<AgentComposerOptions | null>(null)
  /** Repair model labels after either client changes Desktop settings. */
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++pending.current
    try {
      const next = await ipcServices.ai.getAgentComposerOptions()
      if (request === pending.current) {
        setOptions(next)
      }
    } catch {
      if (request === pending.current) {
        setOptions(null)
      }
    }
  }, [])
  useEffect(() => {
    void refresh()
    const listener = ipcEvents.on('ai:settings-changed', () => {
      void refresh()
      changed.current?.()
    })
    return () => ipcEvents.removeListener('ai:settings-changed', listener)
  }, [refresh])
  return (
    <AgentModelSelect
      levels={levels}
      models={options?.models ?? []}
      onChange={onChange}
      onModelChange={async (model) => {
        await ipcServices.ai.selectAgentComposerModel(model)
        await refresh()
        onProviderChange?.()
      }}
      onOpen={() => void refresh()}
      selectedModel={options?.selected ?? 'cloud'}
      t={t}
      value={value}
    />
  )
}
