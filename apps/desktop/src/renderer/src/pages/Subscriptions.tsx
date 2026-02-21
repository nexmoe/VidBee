import {
  type SubscriptionFormData,
  SubscriptionFormDialog
} from '@renderer/components/subscription/SubscriptionFormDialog'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { ScrollArea, ScrollBar } from '@renderer/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ipcServices } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { type DownloadRecord, downloadsArrayAtom } from '@renderer/store/downloads'
import {
  createSubscriptionAtom,
  refreshSubscriptionAtom,
  removeSubscriptionAtom,
  resolveFeedAtom,
  subscriptionsAtom,
  updateSubscriptionAtom
} from '@renderer/store/subscriptions'
import type { DownloadStatus, SubscriptionFeedItem, SubscriptionRule } from '@shared/types'
import { SUBSCRIPTION_DUPLICATE_FEED_ERROR } from '@shared/types'
import dayjs from 'dayjs'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Download, Edit, ExternalLink, Plus, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const statusStyles: Record<
  SubscriptionRule['status'],
  { dotClass: string; textClass: string; label: string }
> = {
  'up-to-date': {
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600',
    label: 'subscriptions.status.up-to-date'
  },
  checking: {
    dotClass: 'bg-sky-500',
    textClass: 'text-sky-600',
    label: 'subscriptions.status.checking'
  },
  failed: {
    dotClass: 'bg-red-500',
    textClass: 'text-red-600',
    label: 'subscriptions.status.failed'
  },
  idle: {
    dotClass: 'bg-muted-foreground',
    textClass: 'text-muted-foreground',
    label: 'subscriptions.status.idle'
  }
}

const disabledStatusStyle = {
  dotClass: 'bg-zinc-400',
  textClass: 'text-muted-foreground',
  label: 'subscriptions.fields.disabled'
}

type SubscriptionItemStatus = DownloadStatus | 'queued' | 'notQueued'

const subscriptionItemStatusLabels: Record<SubscriptionItemStatus, string> = {
  notQueued: 'subscriptions.items.status.notQueued',
  queued: 'subscriptions.items.status.queued',
  pending: 'subscriptions.items.status.pending',
  downloading: 'subscriptions.items.status.downloading',
  processing: 'subscriptions.items.status.processing',
  completed: 'subscriptions.items.status.completed',
  error: 'subscriptions.items.status.error',
  cancelled: 'subscriptions.items.status.cancelled'
}

const getErrorMessage = (error: unknown): string | undefined => {
  if (!error) {
    return undefined
  }
  if (typeof error === 'string') {
    return error
  }
  if (typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
    if ('code' in error && typeof error.code === 'string') {
      return error.code
    }
    if ('error' in error) {
      const nested = (error as { error?: unknown }).error
      if (typeof nested === 'string') {
        return nested
      }
      if (nested && typeof nested === 'object' && 'message' in nested) {
        const nestedMessage = (nested as { message?: unknown }).message
        if (typeof nestedMessage === 'string') {
          return nestedMessage
        }
      }
    }
  }
  return undefined
}

const isDuplicateFeedError = (error: unknown) => {
  const message = getErrorMessage(error)
  return Boolean(message?.includes(SUBSCRIPTION_DUPLICATE_FEED_ERROR))
}

function SubscriptionTab({
  subscription,
  onRefresh,
  onRemove,
  onUpdate,
  isActive
}: SubscriptionTabProps) {
  const { t } = useTranslation()
  const [editOpen, setEditOpen] = useState(false)
  const isDisabled = !subscription.enabled
  const statusMeta = isDisabled ? disabledStatusStyle : statusStyles[subscription.status]
  const statusDescription =
    subscription.status === 'failed' && subscription.lastError
      ? subscription.lastError
      : t(statusStyles[subscription.status].label)
  const lastUpdatedTimestamp =
    subscription.lastCheckedAt ?? subscription.updatedAt ?? subscription.createdAt ?? null
  const lastUpdatedLabel = lastUpdatedTimestamp
    ? dayjs(lastUpdatedTimestamp).format('YYYY-MM-DD HH:mm')
    : t('subscriptions.never')

  const handleToggleEnabled = async (checked: boolean) => {
    await onUpdate({ enabled: checked })
  }

  const handleRefresh = async () => {
    await onRefresh()
    toast.success(t('subscriptions.notifications.refreshStarted'))
  }

  const handleRemove = async () => {
    await onRemove()
    toast.success(t('subscriptions.notifications.removed'))
  }

  const handleEdit = () => {
    setEditOpen(true)
  }

  return (
    <>
      <ContextMenu>
        <HoverCard closeDelay={0} openDelay={0}>
          <ContextMenuTrigger asChild>
            <HoverCardTrigger asChild>
              <TabsTrigger
                className={cn(
                  'flex h-auto w-20 shrink-0 grow-0 flex-col items-center gap-1 rounded-2xl px-2 py-2 transition-all hover:opacity-80',
                  isActive && 'bg-muted/45'
                )}
                value={subscription.id}
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden transition-colors">
                  <RemoteImage
                    alt={subscription.title || t('subscriptions.labels.unknown')}
                    className="h-full w-full overflow-hidden rounded-full object-cover"
                    src={subscription.coverUrl}
                  />
                  <span
                    className={cn(
                      'absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-background transition-colors',
                      statusMeta.dotClass
                    )}
                  />
                </div>
                <div className="flex w-full flex-col items-center text-center">
                  <span className="w-full truncate font-medium text-xs">
                    {subscription.title || t('subscriptions.labels.unknown')}
                  </span>
                </div>
              </TabsTrigger>
            </HoverCardTrigger>
          </ContextMenuTrigger>
          <HoverCardContent className="max-w-xs space-y-1">
            <p className="font-semibold text-sm">
              {subscription.title || t('subscriptions.labels.unknown')}
            </p>
            <p className="text-xs">{statusDescription}</p>
            <p className="text-xs">
              {t('subscriptions.status.tooltip.updatedAt', { time: lastUpdatedLabel })}
            </p>
          </HoverCardContent>
        </HoverCard>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
            {t('subscriptions.actions.refresh')}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleEdit}>
            <Edit className="h-4 w-4" />
            {t('subscriptions.actions.edit')}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void handleToggleEnabled(!subscription.enabled)}>
            <Power className="h-4 w-4" />
            {subscription.enabled
              ? t('subscriptions.actions.disable')
              : t('subscriptions.actions.enable')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void handleRemove()} variant="destructive">
            <Trash2 className="h-4 w-4" />
            {t('subscriptions.actions.remove')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <SubscriptionFormDialog
        mode="edit"
        onClose={() => setEditOpen(false)}
        onSave={async (data) => {
          await onUpdate(data)
          toast.success(t('subscriptions.notifications.updated'))
          setEditOpen(false)
        }}
        open={editOpen}
        subscription={subscription}
      />
    </>
  )
}

export function Subscriptions() {
  const { t } = useTranslation()
  const [subscriptions] = useAtom(subscriptionsAtom)
  const updateSubscription = useSetAtom(updateSubscriptionAtom)
  const removeSubscription = useSetAtom(removeSubscriptionAtom)
  const refreshSubscription = useSetAtom(refreshSubscriptionAtom)

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [selectedTab, setSelectedTab] = useState<string>('')

  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
      ),
    [subscriptions]
  )

  const resolveFeed = useSetAtom(resolveFeedAtom)
  const handleUpdateSubscription = useCallback(
    async (id: string, data: SubscriptionRuleUpdateForm) => {
      const updatePayload: Parameters<typeof updateSubscription>[0]['data'] = {
        keywords: data.keywords,
        tags: data.tags,
        onlyDownloadLatest: data.onlyDownloadLatest,
        downloadDirectory: data.downloadDirectory,
        namingTemplate: data.namingTemplate,
        enabled: data.enabled
      }

      // If feed URL is provided, resolve it and include sourceUrl, feedUrl, and platform
      if (data.url) {
        try {
          const resolved = await resolveFeed(data.url)
          updatePayload.sourceUrl = resolved.sourceUrl
          updatePayload.feedUrl = resolved.feedUrl
          updatePayload.platform = resolved.platform
        } catch (error) {
          console.error('Failed to resolve feed URL:', error)
          toast.error(t('subscriptions.notifications.resolveError'))
          return
        }
      }

      try {
        await updateSubscription({ id, data: updatePayload })
        await refreshSubscription(id)
      } catch (error) {
        console.error('Failed to update subscription:', error)
        toast.error(
          isDuplicateFeedError(error)
            ? t('subscriptions.notifications.duplicateUrl')
            : t('subscriptions.notifications.createError')
        )
      }
    },
    [refreshSubscription, updateSubscription, resolveFeed, t]
  )

  const createSubscription = useSetAtom(createSubscriptionAtom)

  const handleCreateSubscription = useCallback(
    async (data: SubscriptionFormData) => {
      if (!data.url) {
        toast.error(t('subscriptions.notifications.missingUrl'))
        return
      }

      try {
        await createSubscription({
          url: data.url,
          keywords: data.keywords?.join(', '),
          tags: data.tags?.join(', '),
          onlyDownloadLatest: data.onlyDownloadLatest,
          downloadDirectory: data.downloadDirectory,
          namingTemplate: data.namingTemplate,
          enabled: data.enabled
        })
        toast.success(t('subscriptions.notifications.created'))
        setAddDialogOpen(false)
      } catch (error) {
        console.error('Failed to create subscription:', error)
        toast.error(
          isDuplicateFeedError(error)
            ? t('subscriptions.notifications.duplicateUrl')
            : t('subscriptions.notifications.createError')
        )
      }
    },
    [createSubscription, t]
  )

  const handleOpenRSSHubDocs = useCallback(async () => {
    try {
      await ipcServices.fs.openExternal('https://docs.vidbee.org/rss')
    } catch (error) {
      console.error('Failed to open RSS documentation:', error)
      toast.error(t('subscriptions.notifications.openLinkError'))
    }
  }, [t])

  // Filter subscriptions based on selected tab
  const displayedSubscriptions = useMemo(() => {
    if (!selectedTab) {
      return []
    }
    return sortedSubscriptions.filter((sub) => sub.id === selectedTab)
  }, [selectedTab, sortedSubscriptions])

  // Set default tab to first subscription if available
  useEffect(() => {
    if (!selectedTab && sortedSubscriptions.length > 0) {
      // Set to first subscription if no tab is selected
      setSelectedTab(sortedSubscriptions[0].id)
    } else if (selectedTab && !sortedSubscriptions.find((s) => s.id === selectedTab)) {
      // If selected subscription no longer exists, switch to first available
      if (sortedSubscriptions.length > 0) {
        setSelectedTab(sortedSubscriptions[0].id)
      } else {
        setSelectedTab('')
      }
    }
  }, [selectedTab, sortedSubscriptions])

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Channel Tabs Header */}
      <div className="flex flex-row pr-6 pb-6 pl-6">
        <ScrollArea className="w-auto overflow-y-auto">
          <Tabs className="w-auto" onValueChange={setSelectedTab} value={selectedTab}>
            <TabsList className="h-auto w-auto justify-start rounded-none border-none bg-transparent p-0">
              {/* Subscription Channel Tabs */}
              {sortedSubscriptions.map((subscription) => (
                <SubscriptionTab
                  isActive={subscription.id === selectedTab}
                  key={subscription.id}
                  onRefresh={() => refreshSubscription(subscription.id)}
                  onRemove={() => removeSubscription(subscription.id)}
                  onUpdate={(data) => handleUpdateSubscription(subscription.id, data)}
                  subscription={subscription}
                />
              ))}
            </TabsList>
          </Tabs>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {/* Add RSS Button */}
        <Button
          className="flex h-auto w-20 shrink-0 grow-0 flex-col items-center gap-1 rounded-2xl bg-transparent px-2 py-2 transition-all hover:bg-neutral-100 hover:opacity-80"
          onClick={() => setAddDialogOpen(true)}
          variant="ghost"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 border-dashed transition-colors">
            <Plus className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex w-full flex-col items-center text-center">
            <span className="w-full truncate font-medium text-xs">
              {t('subscriptions.add.title')}
            </span>
          </div>
        </Button>
      </div>

      <ScrollArea className="overflow-y-auto">
        {/* Content Area */}
        <div className="relative space-y-8 p-6 pt-0">
          <section className="space-y-4">
            {sortedSubscriptions.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                {t('subscriptions.empty')}
              </div>
            ) : selectedTab ? (
              <div className="space-y-3">
                {displayedSubscriptions.map((subscription) => (
                  <SubscriptionCard key={subscription.id} subscription={subscription} />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-sm">
                {t('subscriptions.empty')}
              </div>
            )}
          </section>

          {/* RSSHub Info Card */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t('subscriptions.rssHub.title')}
              </CardTitle>
              <CardDescription>{t('subscriptions.rssHub.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="gap-2"
                onClick={() => void handleOpenRSSHubDocs()}
                size="sm"
                variant="secondary"
              >
                {t('subscriptions.rssHub.openDocs')}
              </Button>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      <SubscriptionFormDialog
        mode="add"
        onClose={() => setAddDialogOpen(false)}
        onSave={handleCreateSubscription}
        open={addDialogOpen}
      />
    </div>
  )
}

interface SubscriptionTabProps {
  subscription: SubscriptionRule
  isActive: boolean
  onRefresh: () => Promise<void>
  onRemove: () => Promise<void>
  onUpdate: (data: SubscriptionRuleUpdateForm) => Promise<void>
}

type SubscriptionRuleUpdateForm = SubscriptionFormData

function SubscriptionCard({ subscription }: { subscription: SubscriptionRule }) {
  const { t } = useTranslation()
  const feedItems: SubscriptionFeedItem[] = subscription.items ?? []
  const downloads = useAtomValue(downloadsArrayAtom)
  const [historyStatusMap, setHistoryStatusMap] = useState<Record<string, DownloadStatus | null>>(
    {}
  )
  const downloadLookup = useMemo(() => {
    const map = new Map<string, DownloadRecord>()
    downloads.forEach((record) => {
      map.set(record.id, record)
    })
    return map
  }, [downloads])

  useEffect(() => {
    const queuedDownloadIds = Array.from(
      new Set(
        feedItems
          .filter((item) => item.addedToQueue && item.downloadId)
          .map((item) => item.downloadId as string)
      )
    )

    const missingIds = queuedDownloadIds.filter(
      (downloadId) => !downloadLookup.has(downloadId) && historyStatusMap[downloadId] === undefined
    )

    if (missingIds.length === 0) {
      return
    }

    let cancelled = false

    const fetchHistoryStatuses = async () => {
      try {
        const results = await Promise.all(
          missingIds.map(async (downloadId) => {
            try {
              const historyItem = await ipcServices.history.getHistoryById(downloadId)
              return { downloadId, status: historyItem?.status ?? null }
            } catch (error) {
              console.error('Failed to fetch download history entry:', error)
              return { downloadId, status: null }
            }
          })
        )

        if (cancelled) {
          return
        }

        setHistoryStatusMap((prev) => {
          let changed = false
          const next = { ...prev }

          for (const { downloadId, status } of results) {
            if (next[downloadId] === status) {
              continue
            }
            next[downloadId] = status
            changed = true
          }

          return changed ? next : prev
        })
      } catch (error) {
        console.error('Failed to resolve download history statuses:', error)
      }
    }

    void fetchHistoryStatuses()

    return () => {
      cancelled = true
    }
  }, [feedItems, downloadLookup, historyStatusMap])

  const resolveItemStatus = (item: SubscriptionFeedItem): SubscriptionItemStatus => {
    if (!item.addedToQueue) {
      return 'notQueued'
    }
    if (!item.downloadId) {
      return 'queued'
    }
    const matchedDownload = downloadLookup.get(item.downloadId)
    if (!matchedDownload) {
      const cachedHistoryStatus = historyStatusMap[item.downloadId]
      if (cachedHistoryStatus) {
        return cachedHistoryStatus
      }
      return 'queued'
    }
    return matchedDownload.status
  }

  const handleOpenItem = async (url: string) => {
    try {
      await ipcServices.fs.openExternal(url)
    } catch (error) {
      console.error('Failed to open subscription item link:', error)
      toast.error(t('subscriptions.notifications.openLinkError'))
    }
  }

  const handleQueueItem = useCallback(
    async (item: SubscriptionFeedItem) => {
      if (item.addedToQueue) {
        toast.info(t('subscriptions.notifications.itemAlreadyQueued'))
        return
      }
      try {
        const queued = await ipcServices.subscriptions.queueItem(subscription.id, item.id)
        if (queued) {
          toast.success(t('subscriptions.notifications.itemQueued'))
          return
        }
        toast.info(t('subscriptions.notifications.itemAlreadyQueued'))
      } catch (error) {
        console.error('Failed to queue subscription item:', error)
        toast.error(t('subscriptions.notifications.queueError'))
      }
    },
    [subscription.id, t]
  )

  if (feedItems.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground text-sm">
        {t('subscriptions.items.empty')}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {feedItems.map((item) => {
        const itemStatus = resolveItemStatus(item)
        const hasResolvedDownloadStatus =
          item.addedToQueue && itemStatus !== 'queued' && itemStatus !== 'notQueued'
        const badgeLabel = item.addedToQueue
          ? t('subscriptions.items.status.queued')
          : t('subscriptions.items.status.notQueued')
        const tooltipLabel = item.addedToQueue
          ? hasResolvedDownloadStatus
            ? t('subscriptions.items.tooltip.downloadStatus', {
                status: t(subscriptionItemStatusLabels[itemStatus])
              })
            : t('subscriptions.items.tooltip.downloadPending')
          : t('subscriptions.items.tooltip.notQueued')
        const badgeClass = item.addedToQueue ? 'bg-emerald-500' : 'bg-black/70'
        return (
          <ContextMenu key={`${subscription.id}-${item.id}`}>
            <ContextMenuTrigger asChild>
              <article className="group transition-all">
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-muted">
                  {item.thumbnail ? (
                    <RemoteImage
                      alt={item.title}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      src={item.thumbnail}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                      {t('subscriptions.labels.noThumbnail')}
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/70 via-black/5 to-transparent" />
                  <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 py-1 pr-3 pl-1 font-medium text-white text-xs backdrop-blur">
                    {subscription.coverUrl ? (
                      <div className="h-6 w-6 overflow-hidden rounded-full border border-white/40">
                        <RemoteImage
                          alt={subscription.title || t('subscriptions.labels.unknown')}
                          className="h-full w-full object-cover"
                          src={subscription.coverUrl}
                        />
                      </div>
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/40 bg-white/10 font-semibold text-[10px] text-white uppercase">
                        {(subscription.title || t('subscriptions.labels.unknown')).slice(0, 1)}
                      </div>
                    )}
                    <span className="max-w-40 truncate text-xs">
                      {subscription.title || t('subscriptions.labels.unknown')}
                    </span>
                  </div>
                  <div className="absolute bottom-3 left-3 font-medium text-white text-xs">
                    {dayjs(item.publishedAt).format('YYYY-MM-DD HH:mm')}
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        className={cn(
                          'absolute right-3 bottom-3 rounded-full text-white text-xs backdrop-blur',
                          badgeClass
                        )}
                        variant="secondary"
                      >
                        {badgeLabel}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{tooltipLabel}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex flex-col gap-4 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p
                      className="font-semibold text-base text-card-foreground leading-snug"
                      title={item.title}
                    >
                      {item.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="rounded-full px-4"
                      onClick={() => void handleOpenItem(item.url)}
                      size="sm"
                      title={t('subscriptions.items.actions.open')}
                      variant="secondary"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </article>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                disabled={item.addedToQueue}
                onClick={() => void handleQueueItem(item)}
              >
                <Download className="h-4 w-4" />
                {t('subscriptions.items.actions.queue')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => void handleOpenItem(item.url)}>
                <ExternalLink className="h-4 w-4" />
                {t('subscriptions.items.actions.open')}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}
