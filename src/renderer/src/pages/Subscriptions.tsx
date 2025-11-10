import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@renderer/components/ui/dialog'
import { ImageWithPlaceholder } from '@renderer/components/ui/image-with-placeholder'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { ipcServices } from '@renderer/lib/ipc'
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
  SubscriptionFeedItem,
  SubscriptionResolvedFeed,
  SubscriptionRule
} from '@shared/types'
import dayjs from 'dayjs'
import { useAtom, useSetAtom } from 'jotai'
import { ExternalLink, Plus } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const statusStyles: Record<SubscriptionRule['status'], { color: string }> = {
  'up-to-date': { color: 'text-emerald-600' },
  checking: { color: 'text-blue-600' },
  failed: { color: 'text-amber-600' },
  idle: { color: 'text-muted-foreground' }
}

const sanitizeCommaList = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)

const sanitizeTemplateInput = (value: string) => value.replace(/[/\\]+/g, '-')

export function Subscriptions() {
  const { t } = useTranslation()
  const [subscriptions] = useAtom(subscriptionsAtom)
  const updateSubscription = useSetAtom(updateSubscriptionAtom)
  const removeSubscription = useSetAtom(removeSubscriptionAtom)
  const refreshSubscription = useSetAtom(refreshSubscriptionAtom)

  const [addDialogOpen, setAddDialogOpen] = useState(false)

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

  const renderStatus = (subscription: SubscriptionRule) => {
    const meta = statusStyles[subscription.status]
    return (
      <span className={`text-xs ${meta.color}`}>
        {t(`subscriptions.status.${subscription.status}`)}
      </span>
    )
  }

  return (
    <div className="relative space-y-8 p-6">
      <section className="space-y-4">
        {sortedSubscriptions.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t('subscriptions.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                onRefresh={() => refreshSubscription(subscription.id)}
                onRemove={() => removeSubscription(subscription.id)}
                onUpdate={(data) => handleUpdateSubscription(subscription.id, data)}
                renderStatus={() => renderStatus(subscription)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Floating Action Button */}
      <Button
        className="fixed bottom-8 right-8 h-14 w-14 rounded-full shadow-lg z-50"
        size="icon"
        onClick={() => setAddDialogOpen(true)}
      >
        <Plus className="h-6 w-6" />
        <span className="sr-only">{t('subscriptions.add.title')}</span>
      </Button>

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

interface SubscriptionCardProps {
  subscription: SubscriptionRule
  renderStatus: () => React.ReactNode
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

function SubscriptionCard({
  subscription,
  renderStatus,
  onRefresh,
  onRemove,
  onUpdate
}: SubscriptionCardProps) {
  const { t } = useTranslation()
  const [editOpen, setEditOpen] = useState(false)
  const feedItems: SubscriptionFeedItem[] = subscription.items ?? []

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

  const handleOpenItem = async (url: string) => {
    try {
      await ipcServices.fs.openExternal(url)
    } catch (error) {
      console.error('Failed to open subscription item link:', error)
      toast.error(t('subscriptions.notifications.openLinkError'))
    }
  }

  const thumbnail = subscription.coverUrl
  const lastCheckedLabel = subscription.lastCheckedAt
    ? dayjs(subscription.lastCheckedAt).format('YYYY-MM-DD HH:mm')
    : t('subscriptions.never')

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex w-full items-start gap-3">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">
              <ImageWithPlaceholder
                src={thumbnail}
                alt={subscription.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-medium leading-tight">
                  {subscription.title || t('subscriptions.labels.unknown')}
                </h3>
                {(subscription.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
              {subscription.latestVideoTitle && (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {subscription.latestVideoTitle}
                </p>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{t('subscriptions.lastChecked', { time: lastCheckedLabel })}</span>
                {renderStatus()}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('subscriptions.fields.enabled')}</span>
              <Switch
                checked={subscription.enabled}
                onCheckedChange={(checked) => void handleToggleEnabled(checked)}
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => void handleRefresh()}>
              {t('subscriptions.actions.refresh')}
            </Button>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm">
                  {t('subscriptions.actions.edit')}
                </Button>
              </DialogTrigger>
              <SubscriptionEditDialog
                subscription={subscription}
                onSave={async (data) => {
                  await onUpdate(data)
                  toast.success(t('subscriptions.notifications.updated'))
                  setEditOpen(false)
                }}
              />
            </Dialog>
            <Button variant="ghost" size="sm" onClick={() => void handleRemove()}>
              {t('subscriptions.actions.remove')}
            </Button>
          </div>
        </div>
      </div>
      {feedItems.length > 0 && (
        <div className="space-y-1.5 p-4">
          {feedItems.map((item) => (
            <div
              key={`${subscription.id}-${item.id}`}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={item.title}>
                  {item.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {dayjs(item.publishedAt).format('YYYY-MM-DD HH:mm')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={item.addedToQueue ? 'default' : 'outline'} className="text-xs">
                  {item.addedToQueue
                    ? t('subscriptions.items.queued')
                    : t('subscriptions.items.notQueued')}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => void handleOpenItem(item.url)}
                  title={t('subscriptions.items.actions.open')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
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
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('subscriptions.fields.keywords')}</Label>
            <Input
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="AI, tutorial"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('subscriptions.fields.tags')}</Label>
            <Input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="YouTube, AI"
            />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
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
              placeholder="%(uploader)s - %(title)s.%(ext)s"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
          <div>
            <p className="text-sm">{t('subscriptions.fields.onlyLatest')}</p>
          </div>
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
