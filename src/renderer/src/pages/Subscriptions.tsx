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
import { ExternalLink } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const statusStyles: Record<
  SubscriptionRule['status'],
  { label: string; emoji: string; color: string }
> = {
  'up-to-date': { label: 'Up to date', emoji: '✅', color: 'text-emerald-500' },
  checking: { label: 'Checking', emoji: '🔄', color: 'text-blue-500' },
  failed: { label: 'Failed', emoji: '⚠️', color: 'text-amber-500' },
  idle: { label: 'Idle', emoji: '⏸️', color: 'text-muted-foreground' }
}

const sanitizeCommaList = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)

const sanitizeTemplateInput = (value: string) => value.replace(/[/\\]+/g, '-')

export function Subscriptions() {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)
  const [subscriptions] = useAtom(subscriptionsAtom)
  const createSubscription = useSetAtom(createSubscriptionAtom)
  const updateSubscription = useSetAtom(updateSubscriptionAtom)
  const removeSubscription = useSetAtom(removeSubscriptionAtom)
  const refreshSubscription = useSetAtom(refreshSubscriptionAtom)
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

  const sortedSubscriptions = useMemo(
    () =>
      [...subscriptions].sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0)
      ),
    [subscriptions]
  )

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
    } catch (error) {
      console.error('Failed to create subscription:', error)
      toast.error(t('subscriptions.notifications.createError'))
    }
  }

  const renderStatus = (subscription: SubscriptionRule) => {
    const meta = statusStyles[subscription.status]
    return (
      <div className="flex items-center gap-2">
        <span className={meta.color}>{meta.emoji}</span>
        <span className="text-sm text-muted-foreground">
          {t(`subscriptions.status.${subscription.status}`)}
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('subscriptions.title')}</h1>
        <p className="text-muted-foreground">{t('subscriptions.description')}</p>
      </div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>{t('subscriptions.add.title')}</CardTitle>
          <CardDescription>{t('subscriptions.add.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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
          <div className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{t('subscriptions.fields.onlyLatest')}</p>
              <p className="text-xs text-muted-foreground">
                {t('subscriptions.fields.onlyLatestDescription')}
              </p>
            </div>
            <Switch checked={onlyLatest} onCheckedChange={setOnlyLatest} />
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void handleCreateSubscription()}>
              {t('subscriptions.actions.add')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{t('subscriptions.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('subscriptions.description')}</p>
        </div>
        {sortedSubscriptions.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {t('subscriptions.empty')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sortedSubscriptions.map((subscription) => (
              <SubscriptionCard
                key={subscription.id}
                subscription={subscription}
                onRefresh={() => refreshSubscription(subscription.id)}
                onRemove={() => removeSubscription(subscription.id)}
                onUpdate={(data) => updateSubscription({ id: subscription.id, data })}
                renderStatus={() => renderStatus(subscription)}
              />
            ))}
          </div>
        )}
      </section>
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

  const handleToggleMode = async (checked: boolean) => {
    await onUpdate({ onlyDownloadLatest: checked })
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
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex w-full items-start gap-4">
            <div className="h-14 w-14 overflow-hidden rounded-md bg-muted">
              <ImageWithPlaceholder
                src={thumbnail}
                alt={subscription.title}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg leading-tight">
                  {subscription.title || t('subscriptions.labels.unknown')}
                </CardTitle>
                {(subscription.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
              {subscription.latestVideoTitle && (
                <CardDescription className="text-sm">
                  {t('subscriptions.latestVideo', { title: subscription.latestVideoTitle })}
                </CardDescription>
              )}
              <p className="text-xs text-muted-foreground">
                {t('subscriptions.lastChecked', { time: lastCheckedLabel })}
              </p>
              <div>{renderStatus()}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              <span>{t('subscriptions.fields.enabled')}</span>
              <Switch
                checked={subscription.enabled}
                onCheckedChange={(checked) => void handleToggleEnabled(checked)}
              />
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
              <span>{t('subscriptions.fields.onlyLatestShort')}</span>
              <Switch
                checked={subscription.onlyDownloadLatest}
                onCheckedChange={(checked) => void handleToggleMode(checked)}
              />
            </div>
            <Button variant="secondary" onClick={() => void handleRefresh()}>
              {t('subscriptions.actions.refresh')}
            </Button>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">{t('subscriptions.actions.edit')}</Button>
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
            <Button variant="destructive" onClick={() => void handleRemove()}>
              {t('subscriptions.actions.remove')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 border-t pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{t('subscriptions.items.title')}</p>
        </div>
        {feedItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('subscriptions.items.empty')}</p>
        ) : (
          <div className="space-y-2">
            {feedItems.map((item) => (
              <div
                key={`${subscription.id}-${item.id}`}
                className="flex flex-col gap-2 rounded-lg border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={item.title}>
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dayjs(item.publishedAt).format('YYYY-MM-DD HH:mm')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={item.addedToQueue ? 'default' : 'outline'}>
                    {item.addedToQueue
                      ? t('subscriptions.items.queued')
                      : t('subscriptions.items.notQueued')}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleOpenItem(item.url)}
                    title={t('subscriptions.items.actions.open')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface SubscriptionEditDialogProps {
  subscription: SubscriptionRule
  onSave: (data: SubscriptionRuleUpdateForm) => Promise<void>
}

function SubscriptionEditDialog({ subscription, onSave }: SubscriptionEditDialogProps) {
  const { t } = useTranslation()
  const [keywords, setKeywords] = useState(subscription.keywords.join(', '))
  const [tags, setTags] = useState(subscription.tags.join(', '))
  const [downloadDirectory, setDownloadDirectory] = useState(subscription.downloadDirectory || '')
  const [namingTemplate, setNamingTemplate] = useState(subscription.namingTemplate || '')

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
    await onSave({
      keywords: sanitizeCommaList(keywords),
      tags: sanitizeCommaList(tags),
      downloadDirectory: downloadDirectory || undefined,
      namingTemplate: namingTemplate || undefined
    })
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t('subscriptions.edit.title', { name: subscription.title })}</DialogTitle>
        <DialogDescription>{t('subscriptions.edit.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
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
      </div>
      <DialogFooter>
        <Button onClick={() => void handleSave()}>{t('subscriptions.actions.save')}</Button>
      </DialogFooter>
    </DialogContent>
  )
}
