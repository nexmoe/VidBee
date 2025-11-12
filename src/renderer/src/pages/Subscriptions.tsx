import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
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
import { RemoteImage } from '@renderer/components/ui/remote-image'
import { Switch } from '@renderer/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ipcServices } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { type DownloadRecord, downloadsArrayAtom } from '@renderer/store/downloads'
import { settingsAtom } from '@renderer/store/settings'
import {
  createSubscriptionAtom,
  refreshSubscriptionAtom,
  removeSubscriptionAtom,
  resolveFeedAtom,
  subscriptionsAtom,
  updateSubscriptionAtom
} from '@renderer/store/subscriptions'
import type {
  DownloadStatus,
  SubscriptionFeedItem,
  SubscriptionResolvedFeed,
  SubscriptionRule
} from '@shared/types'
import dayjs from 'dayjs'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Edit, ExternalLink, Plus, Power, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const sanitizeCommaList = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)

const sanitizeTemplateInput = (value: string) => value.replace(/[/\\]+/g, '-')

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
        <ContextMenuTrigger asChild>
          <TabsTrigger
            value={subscription.id}
            className={cn(
              'flex h-auto w-20 flex-col rounded-sm! items-center gap-1 px-2 py-2 transition-all hover:opacity-80 shrink-0 grow-0',
              isActive && 'bg-muted/45'
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative h-12 w-12 shrink-0 overflow-hidden transition-colors">
                  <RemoteImage
                    src={subscription.coverUrl}
                    alt={subscription.title || t('subscriptions.labels.unknown')}
                    className="h-full w-full object-cover rounded-full overflow-hidden"
                  />
                  <span
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background transition-colors',
                      statusMeta.dotClass
                    )}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs space-y-1">
                <p className="text-xs">{statusDescription}</p>
                <p className="text-xs">
                  {t('subscriptions.status.tooltip.updatedAt', { time: lastUpdatedLabel })}
                </p>
              </TooltipContent>
            </Tooltip>
            <div className="flex w-full flex-col items-center text-center">
              <span className="w-full truncate text-xs font-medium">
                {subscription.title || t('subscriptions.labels.unknown')}
              </span>
            </div>
          </TabsTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('subscriptions.actions.refresh')}
          </ContextMenuItem>
          <ContextMenuItem onClick={handleEdit}>
            <Edit className="mr-2 h-4 w-4" />
            {t('subscriptions.actions.edit')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem
            checked={subscription.enabled}
            onCheckedChange={(checked) => void handleToggleEnabled(checked)}
          >
            <Power className="mr-2 h-4 w-4" />
            {t('subscriptions.fields.enabled')}
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void handleRemove()} variant="destructive">
            <Trash2 className="mr-2 h-4 w-4" />
            {t('subscriptions.actions.remove')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <SubscriptionEditDialog
          subscription={subscription}
          onSave={async (data) => {
            await onUpdate(data)
            toast.success(t('subscriptions.notifications.updated'))
            setEditOpen(false)
          }}
        />
      </Dialog>
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

      // If URL is provided, resolve it and include sourceUrl, feedUrl, and platform
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

      await updateSubscription({ id, data: updatePayload })
      await refreshSubscription(id)
    },
    [refreshSubscription, updateSubscription, resolveFeed, t]
  )

  const handleCreateSubscription = useCallback(async () => {
    setAddDialogOpen(false)
  }, [])

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
    <div className="relative">
      {/* Channel Tabs Header */}
      <div className="">
        <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-auto">
            <TabsList className="h-auto w-auto justify-start rounded-none border-none bg-transparent p-0 px-6">
              {/* Subscription Channel Tabs */}
              {sortedSubscriptions.map((subscription) => (
                <SubscriptionTab
                  key={subscription.id}
                  subscription={subscription}
                  isActive={subscription.id === selectedTab}
                  onRefresh={() => refreshSubscription(subscription.id)}
                  onRemove={() => removeSubscription(subscription.id)}
                  onUpdate={(data) => handleUpdateSubscription(subscription.id, data)}
                />
              ))}
              {/* Add RSS Button */}
              <Button
                className="flex h-auto w-20 flex-col items-center gap-1 rounded-sm! px-2 py-2 transition-all hover:opacity-80 bg-transparent hover:bg-neutral-100 shrink-0 grow-0"
                variant="ghost"
                onClick={() => setAddDialogOpen(true)}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/40 transition-colors">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex w-full flex-col items-center text-center">
                  <span className="w-full truncate text-xs font-medium">
                    {t('subscriptions.add.title')}
                  </span>
                </div>
              </Button>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Content Area */}
      <div className="relative space-y-8 p-6">
        <section className="space-y-4">
          {sortedSubscriptions.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('subscriptions.empty')}
            </div>
          ) : !selectedTab ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t('subscriptions.empty')}
            </div>
          ) : (
            <div className="space-y-3">
              {displayedSubscriptions.map((subscription) => (
                <SubscriptionCard key={subscription.id} subscription={subscription} />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <SubscriptionAddDialog
          open={addDialogOpen}
          onCreate={handleCreateSubscription}
          onClose={() => setAddDialogOpen(false)}
        />
      </Dialog>
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

interface SubscriptionRuleUpdateForm {
  url?: string
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

function SubscriptionCard({ subscription }: { subscription: SubscriptionRule }) {
  const { t } = useTranslation()
  const feedItems: SubscriptionFeedItem[] = subscription.items ?? []
  const downloads = useAtomValue(downloadsArrayAtom)
  const downloadLookup = useMemo(() => {
    const map = new Map<string, DownloadRecord>()
    downloads.forEach((record) => {
      map.set(record.id, record)
    })
    return map
  }, [downloads])

  const resolveItemStatus = (item: SubscriptionFeedItem): SubscriptionItemStatus => {
    if (!item.addedToQueue) {
      return 'notQueued'
    }
    if (!item.downloadId) {
      return 'queued'
    }
    const matchedDownload = downloadLookup.get(item.downloadId)
    if (!matchedDownload) {
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

  if (feedItems.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {t('subscriptions.items.empty')}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {feedItems.map((item) => {
        const itemStatus = resolveItemStatus(item)
        const badgeLabel = item.addedToQueue
          ? t('subscriptions.items.status.queued')
          : t('subscriptions.items.status.notQueued')
        const tooltipLabel = item.addedToQueue
          ? t('subscriptions.items.tooltip.downloadStatus', {
              status: t(subscriptionItemStatusLabels[itemStatus])
            })
          : t('subscriptions.items.tooltip.notQueued')
        const badgeClass = item.addedToQueue ? 'bg-emerald-500' : 'bg-black/70'
        return (
          <article key={`${subscription.id}-${item.id}`} className="group  transition-all">
            <div className="relative w-full overflow-hidden bg-muted aspect-video overflow-hidden rounded-2xl">
              {item.thumbnail ? (
                <RemoteImage
                  src={item.thumbnail}
                  alt={item.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                  {t('subscriptions.labels.noThumbnail')}
                </div>
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent" />
              <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-black/60 pr-3 pl-1 py-1 text-xs font-medium text-white backdrop-blur">
                {subscription.coverUrl ? (
                  <div className="h-6 w-6 overflow-hidden rounded-full border border-white/40">
                    <RemoteImage
                      src={subscription.coverUrl}
                      alt={subscription.title || t('subscriptions.labels.unknown')}
                      className="h-full w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full border border-white/40 bg-white/10 text-[10px] font-semibold uppercase text-white">
                    {(subscription.title || t('subscriptions.labels.unknown')).slice(0, 1)}
                  </div>
                )}
                <span className="max-w-[10rem] truncate text-xs">
                  {subscription.title || t('subscriptions.labels.unknown')}
                </span>
              </div>
              <div className="absolute bottom-3 left-3 text-xs font-medium text-white">
                {dayjs(item.publishedAt).format('YYYY-MM-DD HH:mm')}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'absolute bottom-3 right-3 rounded-full text-xs text-white backdrop-blur',
                      badgeClass
                    )}
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
                  className="text-base font-semibold leading-snug text-card-foreground"
                  title={item.title}
                >
                  {item.title}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full px-4"
                  onClick={() => void handleOpenItem(item.url)}
                  title={t('subscriptions.items.actions.open')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

interface SubscriptionAddDialogProps {
  open: boolean
  onCreate: () => Promise<void>
  onClose: () => void
}

function SubscriptionAddDialog({ open, onCreate, onClose }: SubscriptionAddDialogProps) {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)
  const createSubscription = useSetAtom(createSubscriptionAtom)
  const resolveFeed = useSetAtom(resolveFeedAtom)

  const [url, setUrl] = useState('')
  const [keywords, setKeywords] = useState('')
  const [tags, setTags] = useState('')
  const [onlyLatest, setOnlyLatest] = useState(settings.subscriptionOnlyLatestDefault)
  const [customDownloadDirectory, setCustomDownloadDirectory] = useState(settings.downloadPath)
  const [namingTemplate, setNamingTemplate] = useState(settings.subscriptionFilenameTemplate)
  const [detectedFeed, setDetectedFeed] = useState<SubscriptionResolvedFeed | null>(null)
  const [detectingFeed, setDetectingFeed] = useState(false)

  const detectTimeout = useRef<NodeJS.Timeout | null>(null)
  const prevDefaultPathRef = useRef(settings.downloadPath)
  const urlInputId = useId()

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setUrl('')
      setKeywords('')
      setTags('')
      setDetectedFeed(null)
      setOnlyLatest(settings.subscriptionOnlyLatestDefault)
      setCustomDownloadDirectory(settings.downloadPath)
      setNamingTemplate(settings.subscriptionFilenameTemplate)
    }
  }, [
    open,
    settings.subscriptionOnlyLatestDefault,
    settings.downloadPath,
    settings.subscriptionFilenameTemplate
  ])

  useEffect(() => {
    const newPath = settings.downloadPath
    setCustomDownloadDirectory((prev) => {
      if (!prev || prev === prevDefaultPathRef.current) {
        return newPath
      }
      return prev
    })
    prevDefaultPathRef.current = newPath
  }, [settings.downloadPath])

  useEffect(() => {
    setNamingTemplate(settings.subscriptionFilenameTemplate)
  }, [settings.subscriptionFilenameTemplate])

  useEffect(() => {
    setOnlyLatest(settings.subscriptionOnlyLatestDefault)
  }, [settings.subscriptionOnlyLatestDefault])

  useEffect(() => {
    if (!url.trim()) {
      setDetectedFeed(null)
      return
    }

    if (detectTimeout.current) {
      clearTimeout(detectTimeout.current)
    }

    detectTimeout.current = setTimeout(async () => {
      setDetectingFeed(true)
      try {
        const result = await resolveFeed(url.trim())
        setDetectedFeed(result)
      } catch (error) {
        console.error('Failed to resolve feed:', error)
        setDetectedFeed(null)
      } finally {
        setDetectingFeed(false)
      }
    }, 500)

    return () => {
      if (detectTimeout.current) {
        clearTimeout(detectTimeout.current)
      }
    }
  }, [url, resolveFeed])

  const handleSelectDirectory = async () => {
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        setCustomDownloadDirectory(path)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
      toast.error(t('subscriptions.notifications.directoryError'))
    }
  }

  const handleCreateSubscription = async () => {
    if (!url.trim()) {
      toast.error(t('subscriptions.notifications.missingUrl'))
      return
    }

    try {
      await createSubscription({
        url: url.trim(),
        keywords,
        tags,
        onlyDownloadLatest: onlyLatest,
        downloadDirectory: customDownloadDirectory,
        namingTemplate
      })
      toast.success(t('subscriptions.notifications.created'))
      setUrl('')
      setKeywords('')
      setTags('')
      setDetectedFeed(null)
      await onCreate()
    } catch (error) {
      console.error('Failed to create subscription:', error)
      toast.error(t('subscriptions.notifications.createError'))
    }
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t('subscriptions.add.title')}</DialogTitle>
        <DialogDescription>{t('subscriptions.add.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor={urlInputId}>{t('subscriptions.fields.url')}</Label>
          <Input
            id={urlInputId}
            value={url}
            placeholder={t('subscriptions.placeholders.url')}
            onChange={(event) => setUrl(event.target.value)}
          />
          {detectedFeed && (
            <Badge variant="outline" className="w-fit text-xs">
              {t('subscriptions.detectedFeed', {
                platform: detectedFeed.platform,
                feed: detectedFeed.feedUrl
              })}
            </Badge>
          )}
          {detectingFeed && (
            <p className="text-xs text-muted-foreground">{t('subscriptions.detecting')}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.keywords')}</Label>
          <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.tags')}</Label>
          <Input value={tags} onChange={(event) => setTags(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.customDirectory')}</Label>
          <div className="flex gap-2">
            <Input value={customDownloadDirectory} readOnly />
            <Button variant="secondary" onClick={() => void handleSelectDirectory()}>
              {t('subscriptions.actions.selectDirectory')}
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.namingTemplate')}</Label>
          <Input
            value={namingTemplate}
            onChange={(event) => setNamingTemplate(sanitizeTemplateInput(event.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
          <p className="text-sm">{t('subscriptions.fields.onlyLatest')}</p>
          <Switch checked={onlyLatest} onCheckedChange={setOnlyLatest} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('download.cancel')}
        </Button>
        <Button onClick={() => void handleCreateSubscription()}>
          {t('subscriptions.actions.add')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

interface SubscriptionEditDialogProps {
  subscription: SubscriptionRule
  onSave: (data: SubscriptionRuleUpdateForm) => Promise<void>
}

function SubscriptionEditDialog({ subscription, onSave }: SubscriptionEditDialogProps) {
  const { t } = useTranslation()
  const resolveFeed = useSetAtom(resolveFeedAtom)
  const [url, setUrl] = useState(subscription.feedUrl)
  const [keywords, setKeywords] = useState(subscription.keywords.join(', '))
  const [tags, setTags] = useState(subscription.tags.join(', '))
  const [downloadDirectory, setDownloadDirectory] = useState(subscription.downloadDirectory || '')
  const [namingTemplate, setNamingTemplate] = useState(subscription.namingTemplate || '')
  const [onlyDownloadLatest, setOnlyDownloadLatest] = useState(subscription.onlyDownloadLatest)
  const [detectedFeed, setDetectedFeed] = useState<SubscriptionResolvedFeed | null>(null)
  const [detectingFeed, setDetectingFeed] = useState(false)

  const detectTimeout = useRef<NodeJS.Timeout | null>(null)
  const urlInputId = useId()

  useEffect(() => {
    if (!url.trim() || url.trim() === subscription.feedUrl) {
      setDetectedFeed(null)
      return
    }

    if (detectTimeout.current) {
      clearTimeout(detectTimeout.current)
    }

    detectTimeout.current = setTimeout(async () => {
      setDetectingFeed(true)
      try {
        const result = await resolveFeed(url.trim())
        setDetectedFeed(result)
      } catch (error) {
        console.error('Failed to resolve feed:', error)
        setDetectedFeed(null)
      } finally {
        setDetectingFeed(false)
      }
    }, 500)

    return () => {
      if (detectTimeout.current) {
        clearTimeout(detectTimeout.current)
      }
    }
  }, [url, resolveFeed, subscription.feedUrl])

  const handleSelectDirectory = async () => {
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        setDownloadDirectory(path)
      }
    } catch (error) {
      console.error('Failed to update directory:', error)
      toast.error(t('subscriptions.notifications.directoryError'))
    }
  }

  const handleSave = async () => {
    const updateData: SubscriptionRuleUpdateForm = {
      keywords: sanitizeCommaList(keywords),
      tags: sanitizeCommaList(tags),
      downloadDirectory: downloadDirectory || undefined,
      namingTemplate: namingTemplate || undefined,
      onlyDownloadLatest
    }

    // If feed URL changed, resolve it to validate and include in update
    if (url.trim() && url.trim() !== subscription.feedUrl) {
      try {
        await resolveFeed(url.trim())
        updateData.url = url.trim()
      } catch (error) {
        console.error('Failed to resolve feed:', error)
        toast.error(t('subscriptions.notifications.resolveError'))
        return
      }
    }

    await onSave(updateData)
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{t('subscriptions.edit.title', { name: subscription.title })}</DialogTitle>
        <DialogDescription>{t('subscriptions.edit.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label htmlFor={urlInputId}>{t('subscriptions.fields.url')}</Label>
          <Input
            id={urlInputId}
            value={url}
            placeholder={t('subscriptions.placeholders.url')}
            onChange={(event) => setUrl(event.target.value)}
          />
          {detectedFeed && (
            <Badge variant="outline" className="w-fit text-xs">
              {t('subscriptions.detectedFeed', {
                platform: detectedFeed.platform,
                feed: detectedFeed.feedUrl
              })}
            </Badge>
          )}
          {detectingFeed && (
            <p className="text-xs text-muted-foreground">{t('subscriptions.detecting')}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.keywords')}</Label>
          <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.tags')}</Label>
          <Input value={tags} onChange={(event) => setTags(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.customDirectory')}</Label>
          <div className="flex gap-2">
            <Input value={downloadDirectory} readOnly />
            <Button variant="secondary" onClick={() => void handleSelectDirectory()}>
              {t('subscriptions.actions.selectDirectory')}
            </Button>
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t('subscriptions.fields.namingTemplate')}</Label>
          <Input
            value={namingTemplate}
            onChange={(event) => setNamingTemplate(sanitizeTemplateInput(event.target.value))}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
          <p className="text-sm">{t('subscriptions.fields.onlyLatest')}</p>
          <Switch checked={onlyDownloadLatest} onCheckedChange={setOnlyDownloadLatest} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => void handleSave()}>{t('subscriptions.actions.save')}</Button>
      </DialogFooter>
    </DialogContent>
  )
}
