import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react'
import { DownloadItem } from '@renderer/components/download/DownloadItem'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Progress } from '@renderer/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ipcEvents, ipcServices } from '@renderer/lib/ipc'
import type { AgentArtifact, AgentChatRun } from '@shared/agent-chat'
import { agentProgressTaskIds } from '@shared/agent-progress'
import {
  type AgentUiResponse,
  type AgentUiSpec,
  type AgentUiTask,
  agentUiCatalog,
  agentUiSpecSchema
} from '@shared/agent-ui'
import { Check, CircleAlert, FileAudio, FileVideo, Loader2 } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'
import { AgentProgress } from './AgentProgress'

interface AgentUiActions {
  activeMessageId?: string
  disabled: boolean
  respond: (text: string, response?: AgentUiResponse) => Promise<boolean>
  stop?: () => Promise<void>
}

const Actions = createContext<AgentUiActions>({ disabled: true, respond: async () => false })
const ToolId = createContext('')
const Run = createContext<{ run?: AgentChatRun; artifacts: AgentArtifact[] }>({ artifacts: [] })
const Tasks = createContext<{ loading: boolean; failed: boolean; items: AgentUiTask[] }>({
  loading: true,
  failed: false,
  items: []
})

/** Share conversation admission and busy state with cards in both Agent Chat entry points. */
export function AgentUiProvider({
  children,
  ...actions
}: AgentUiActions & { children: ReactNode }) {
  return <Actions.Provider value={actions}>{children}</Actions.Provider>
}

/** Keep task cards current only while mounted, with no background requests in a hidden document. */
function useCardTasks(ids: string[]) {
  const key = JSON.stringify(ids)
  const [snapshot, setSnapshot] = useState({
    key,
    loading: true,
    failed: false,
    items: [] as AgentUiTask[]
  })
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let eventTimer: ReturnType<typeof setTimeout> | undefined
    let reading = false
    let pending = false
    const taskIds = new Set<string>(JSON.parse(key))
    /** Refresh a bounded task group and stop polling once all tasks have settled. */
    async function refresh(): Promise<void> {
      if (disposed || document.hidden) {
        return
      }
      if (reading) {
        pending = true
        return
      }
      clearTimeout(timer)
      reading = true
      let retry = false
      try {
        const items = await ipcServices.ai.getAgentUiTasks(JSON.parse(key))
        if (disposed) {
          return
        }
        setSnapshot({ key, loading: false, failed: false, items })
        retry = items.some((task) => !['completed', 'failed', 'cancelled'].includes(task.status))
      } catch {
        if (!disposed) {
          setSnapshot({ key, loading: false, failed: true, items: [] })
          retry = true
        }
      } finally {
        reading = false
        if (!disposed && (pending || retry)) {
          timer = setTimeout(() => void refresh(), pending ? 0 : 2000)
        }
        pending = false
      }
    }
    if (ids.length) {
      void refresh()
    } else {
      setSnapshot({ key, loading: false, failed: false, items: [] })
    }
    /** Resume fresh reads when the user returns to this document. */
    function visible(): void {
      if (!document.hidden && ids.length) {
        void refresh()
      }
    }
    /** Share Home's queue notifications, including retries of previously terminal tasks. */
    function changed(raw: unknown): void {
      const id = typeof raw === 'string' ? raw : (raw as { id?: string } | null)?.id
      if (!(id && taskIds.has(id)) || document.hidden) {
        return
      }
      if (eventTimer === undefined) {
        eventTimer = setTimeout(() => {
          eventTimer = undefined
          void refresh()
        }, 80)
      }
    }
    const subscriptions = [
      'download:queued',
      'download:updated',
      'download:started',
      'download:progress',
      'download:completed',
      'download:error',
      'download:cancelled',
      'download:removed'
    ].map((channel) => [channel, ipcEvents.on(channel, changed)] as const)
    document.addEventListener('visibilitychange', visible)
    return () => {
      disposed = true
      clearTimeout(timer)
      clearTimeout(eventTimer)
      document.removeEventListener('visibilitychange', visible)
      for (const [channel, listener] of subscriptions) {
        ipcEvents.removeListener(channel, listener)
      }
    }
  }, [key, ids.length])
  return snapshot.key === key ? snapshot : { loading: true, failed: false, items: [] }
}

/** Keep card typography and spacing consistent in the page and narrow transcript sidebar. */
function CardFrame({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-border/60 bg-surface-2 p-4">
      <div className="space-y-1">
        <h3 className="break-words font-medium text-sm">{title}</h3>
        {description ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/** Confirm a card once, keeping errors recoverable and preserving the user's composer draft. */
function Confirm({ disabled, submit }: { disabled: boolean; submit: () => Promise<boolean> }) {
  const { t } = useTranslation()
  const actions = useContext(Actions)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)
  /** Wait for durable admission before marking this card answered. */
  async function confirm(): Promise<void> {
    if (pending || sent || disabled || actions.disabled) {
      return
    }
    setPending(true)
    setFailed(false)
    try {
      const accepted = await submit()
      setSent(accepted)
      setFailed(!accepted)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        disabled={disabled || actions.disabled || pending || sent}
        onClick={() => void confirm()}
        size="sm"
        type="button"
      >
        {pending ? <Loader2 className="animate-spin" /> : sent ? <Check /> : null}
        {t(sent ? 'agentChat.ui.sent' : 'agentChat.ui.continue')}
      </Button>
      {failed ? (
        <p className="text-destructive text-xs" role="alert">
          {t('agentChat.ui.sendFailed')}
        </p>
      ) : null}
    </div>
  )
}

type ChoiceProps = z.infer<typeof agentUiCatalog.data.components.ChoiceCard.props>

/** Reuse native accessible selection controls for preferences and completed media. */
function Choices({
  title,
  description,
  options,
  multiple,
  unavailable = []
}: ChoiceProps & { unavailable?: string[] }) {
  const { t } = useTranslation()
  const actions = useContext(Actions)
  const [values, setValues] = useState<string[]>([])
  const group = useId()
  const toolCallId = useContext(ToolId)
  const valid = values.filter(
    (value) => !unavailable.includes(value) && options.some((item) => item.value === value)
  )
  /** Send an explicit selection as an ordinary user turn; tool mutations retain their existing approvals. */
  async function submit(): Promise<boolean> {
    const selected = options.filter((item) => valid.includes(item.value))
    return await actions.respond(`${title}: ${selected.map((item) => item.label).join(', ')}`, {
      toolCallId,
      title,
      values: selected.map((item) => item.value)
    })
  }
  return (
    <CardFrame description={description} title={title}>
      <fieldset
        aria-label={title}
        className="max-h-64 space-y-2 overflow-y-auto"
        disabled={actions.disabled}
      >
        {options.map((item) => (
          <label
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-3 py-2.5 has-disabled:cursor-default has-checked:border-primary/50 has-checked:bg-primary/5 has-disabled:opacity-50"
            key={item.value}
          >
            <input
              checked={valid.includes(item.value)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
              disabled={unavailable.includes(item.value)}
              name={group}
              onChange={() =>
                setValues((current) =>
                  multiple
                    ? current.includes(item.value)
                      ? current.filter((value) => value !== item.value)
                      : [...current, item.value]
                    : [item.value]
                )
              }
              type={multiple ? 'checkbox' : 'radio'}
              value={item.value}
            />
            <span className="min-w-0 space-y-1">
              <span className="block break-words text-sm">{item.label}</span>
              {item.description ? (
                <span className="block text-muted-foreground text-xs">{item.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <Confirm disabled={!valid.length} submit={submit} />
      {actions.disabled ? (
        <p className="text-muted-foreground text-xs">{t('agentChat.ui.inactive')}</p>
      ) : null}
    </CardFrame>
  )
}

/** Show actual task facts, including terminal failures, without trusting model-authored status. */
function TaskCard({ taskId }: { taskId: string }) {
  const { t } = useTranslation()
  const { items, loading, failed } = useContext(Tasks)
  const task = items.find((item) => item.id === taskId)
  if (!task) {
    return (
      <p
        className="flex items-center gap-2 rounded-xl border p-4 text-muted-foreground text-sm"
        role="status"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <CircleAlert className="size-4" />}
        {t(
          loading
            ? 'agentChat.ui.loading'
            : failed
              ? 'agentChat.ui.loadFailed'
              : 'agentChat.ui.taskUnavailable'
        )}
      </p>
    )
  }
  if (task.download && task.progress !== null) {
    return (
      <section className="min-w-0 overflow-hidden rounded-xl border border-border/60 bg-surface-2">
        <DownloadItem
          compact
          download={{
            ...task.download,
            entryType: ['completed', 'failed', 'cancelled'].includes(task.status)
              ? 'history'
              : 'active',
            error: task.error
              ? t(task.error, { defaultValue: t('agentChat.ui.taskFailed') })
              : undefined
          }}
        />
      </section>
    )
  }
  const Icon = task.kind === 'audio' ? FileAudio : FileVideo
  const percent = task.status === 'completed' ? 100 : task.progress
  return (
    <CardFrame title={task.title === task.id ? t(`agentChat.ui.kinds.${task.kind}`) : task.title}>
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <Icon aria-hidden className="size-4" />
        <span>{t(`agentChat.ui.kinds.${task.kind}`)}</span>
        <Badge variant="outline">{t(`agentChat.ui.status.${task.status}`)}</Badge>
      </div>
      {percent === null ? null : (
        <div className="flex items-center gap-3">
          <Progress
            aria-label={t('agentChat.ui.progress')}
            className="h-1.5 flex-1"
            value={percent}
          />
          <span className="text-muted-foreground text-xs tabular-nums">{Math.round(percent)}%</span>
        </div>
      )}
      {task.error ? (
        <p className="break-words text-destructive text-xs" role="status">
          {t(task.error, { defaultValue: t('agentChat.ui.taskFailed') })}
        </p>
      ) : null}
    </CardFrame>
  )
}

/** Bind the generated component to its owning reply and reuse live queue cards for real tasks. */
function RunProgress({
  title,
  steps
}: z.infer<typeof agentUiCatalog.data.components.AgentProgress.props>) {
  const { t } = useTranslation()
  const { run, artifacts } = useContext(Run)
  const actions = useContext(Actions)
  const ids = agentProgressTaskIds(run)
  const tasks = useCardTasks(ids)
  if (!run) {
    return null
  }
  return (
    <AgentProgress
      artifacts={artifacts}
      current={actions.activeMessageId === run.messageId}
      onStop={actions.stop}
      run={run}
      steps={steps}
      title={title}
    >
      {ids.length ? (
        <Tasks.Provider value={tasks}>
          <div className="space-y-2">
            <h4 className="font-medium text-muted-foreground text-xs">
              {t('agentChat.progress.tasks')}
            </h4>
            {ids.map((taskId) => (
              <TaskCard key={taskId} taskId={taskId} />
            ))}
            {(run.taskIds?.length ?? 0) > ids.length ? (
              <p className="text-muted-foreground text-xs">
                {t('agentChat.progress.showingTasks', {
                  count: ids.length,
                  total: run.taskIds?.length
                })}
              </p>
            ) : null}
          </div>
        </Tasks.Provider>
      ) : null}
    </AgentProgress>
  )
}

/** Offer only real completed files, leaving missing or removed files visibly unavailable. */
function TaskPicker({
  title,
  taskIds,
  multiple
}: z.infer<typeof agentUiCatalog.data.components.TaskPicker.props>) {
  const { t } = useTranslation()
  const { items, loading, failed } = useContext(Tasks)
  if (loading || failed) {
    return (
      <CardFrame title={title}>
        <p className="text-muted-foreground text-sm" role="status">
          {t(loading ? 'agentChat.ui.loading' : 'agentChat.ui.loadFailed')}
        </p>
      </CardFrame>
    )
  }
  const available = items.filter((task) => taskIds.includes(task.id))
  if (!available.length) {
    return (
      <CardFrame title={title}>
        <p className="text-muted-foreground text-sm">{t('agentChat.ui.taskUnavailable')}</p>
      </CardFrame>
    )
  }
  return (
    <Choices
      multiple={multiple}
      options={available.map((task) => ({
        label: task.title,
        value: task.id,
        description: task.selectable
          ? t(`agentChat.ui.kinds.${task.kind}`)
          : t('agentChat.ui.fileUnavailable')
      }))}
      title={title}
      unavailable={available.filter((task) => !task.selectable).map((task) => task.id)}
    />
  )
}

/** Collect supported conversion settings and send them back to the same conversation. */
function MediaSettings({
  title,
  formats,
  heights = []
}: z.infer<typeof agentUiCatalog.data.components.MediaSettings.props>) {
  const { t } = useTranslation()
  const actions = useContext(Actions)
  const [format, setFormat] = useState<string>(formats[0])
  const toolCallId = useContext(ToolId)
  const [height, setHeight] = useState(String(heights[0] ?? ''))
  const video = ['mp4', 'mkv', 'webm'].includes(format)
  /** Confirm preferences without creating a conversion or changing global settings. */
  async function submit(): Promise<boolean> {
    const settings = { format, ...(video && height ? { height: Number(height) } : {}) }
    return await actions.respond(
      `${title}: ${format.toUpperCase()}${settings.height ? ` · ${settings.height}p` : ''}`,
      {
        toolCallId,
        title,
        values: [format, ...(settings.height ? [String(settings.height)] : [])]
      }
    )
  }
  return (
    <CardFrame title={title}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-muted-foreground text-xs">{t('agentChat.ui.format')}</span>
          <Select disabled={actions.disabled} onValueChange={setFormat} value={format}>
            <SelectTrigger aria-label={t('agentChat.ui.format')} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {formats.map((item) => (
                <SelectItem key={item} value={item}>
                  {item.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {video && heights.length ? (
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs">{t('agentChat.ui.resolution')}</span>
            <Select disabled={actions.disabled} onValueChange={setHeight} value={height}>
              <SelectTrigger aria-label={t('agentChat.ui.resolution')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {heights.map((item) => (
                  <SelectItem key={item} value={String(item)}>
                    {item}p
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <Confirm disabled={!formats.includes(format as (typeof formats)[number])} submit={submit} />
    </CardFrame>
  )
}

const { registry } = defineRegistry(agentUiCatalog, {
  components: {
    Stack: ({ children }) => <div className="space-y-3">{children}</div>,
    AgentProgress: ({ props }) => <RunProgress {...props} />,
    TaskCard: ({ props }) => <TaskCard {...props} />,
    TaskPicker: ({ props }) => <TaskPicker {...props} />,
    ChoiceCard: ({ props }) => <Choices {...props} />,
    MediaSettings: ({ props }) => <MediaSettings {...props} />,
    InfoCard: ({ props }) => (
      <CardFrame title={props.title}>
        <dl className="space-y-2 text-sm">
          {props.items.map((item) => (
            <div className="space-y-0.5" key={`${item.label}-${item.value}`}>
              <dt className="text-muted-foreground text-xs">{item.label}</dt>
              <dd className="whitespace-pre-wrap break-words">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardFrame>
    )
  }
})

/** Resolve a persisted presentation defensively before handing it to the json-render registry. */
function Presentation({
  spec,
  messageId,
  toolCallId
}: {
  spec: AgentUiSpec
  messageId: string
  toolCallId: string
}) {
  const { t } = useTranslation()
  const actions = useContext(Actions)
  const parsed = useMemo(() => agentUiSpecSchema.safeParse(spec), [spec])
  const taskIds = useMemo(
    () => [
      ...new Set(
        Object.values(parsed.success ? parsed.data.elements : {}).flatMap((element) =>
          element.type === 'TaskCard'
            ? [element.props.taskId as string]
            : element.type === 'TaskPicker'
              ? (element.props.taskIds as string[])
              : []
        )
      )
    ],
    [parsed]
  )
  const tasks = useCardTasks(taskIds)
  if (!parsed.success) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t('agentChat.ui.invalid')}
      </p>
    )
  }
  return (
    <Actions.Provider
      value={{ ...actions, disabled: actions.disabled || actions.activeMessageId !== messageId }}
    >
      <ToolId.Provider value={toolCallId}>
        <Tasks.Provider value={tasks}>
          <JSONUIProvider registry={registry}>
            <Renderer registry={registry} spec={parsed.data} />
          </JSONUIProvider>
        </Tasks.Provider>
      </ToolId.Provider>
    </Actions.Provider>
  )
}

/** Render cards from the selected reply in both standalone Chat and transcript conversations. */
export function AgentUiCards({
  run,
  messageId,
  artifacts = []
}: {
  run?: AgentChatRun
  messageId: string
  artifacts?: AgentArtifact[]
}) {
  const tools =
    run?.tools.filter((tool) => tool.ui && ['running', 'completed'].includes(tool.status)) ?? []
  if (!tools.length) {
    return null
  }
  return (
    <Run.Provider value={{ run, artifacts: artifacts.filter((item) => item.runId === run?.id) }}>
      <div className="my-3 min-w-0 space-y-3 empty:hidden" data-testid="agent-ui-cards">
        {tools.map((tool) =>
          tool.ui ? (
            <Presentation key={tool.id} messageId={messageId} spec={tool.ui} toolCallId={tool.id} />
          ) : null
        )}
      </div>
    </Run.Provider>
  )
}
