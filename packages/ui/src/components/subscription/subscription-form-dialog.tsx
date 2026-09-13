import {
  buildDefaultSubscriptionDirectory,
  sanitizeCommaList,
  sanitizeTemplateInput
} from '@vidbee/subscriptions-core/form'
import {
  DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE,
  type SubscriptionRule
} from '@vidbee/subscriptions-core/types'
import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '../../lib/cn'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'

export interface SubscriptionFormData {
  url?: string
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  autoDownload?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

interface SubscriptionFormDialogProps {
  mode: 'add' | 'edit'
  subscription?: Pick<
    SubscriptionRule,
    | 'title'
    | 'feedUrl'
    | 'keywords'
    | 'tags'
    | 'onlyDownloadLatest'
    | 'autoDownload'
    | 'downloadDirectory'
    | 'namingTemplate'
  >
  open: boolean
  downloadPath: string
  onlyLatestDefault: boolean
  onSave: (data: SubscriptionFormData) => Promise<void>
  onClose: () => void
  onResolveFeed: (url: string) => Promise<unknown>
  onSelectDirectory?: () => Promise<string | null | undefined>
  onOpenRssDocs?: () => void | Promise<void>
}

/**
 * Add or edit an RSS subscription, including auto-download options.
 */
export function SubscriptionFormDialog({
  mode,
  subscription,
  open,
  downloadPath,
  onlyLatestDefault,
  onSave,
  onClose,
  onResolveFeed,
  onSelectDirectory,
  onOpenRssDocs
}: SubscriptionFormDialogProps) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [keywords, setKeywords] = useState('')
  const [tags, setTags] = useState('')
  const [onlyLatest, setOnlyLatest] = useState(false)
  const [autoDownload, setAutoDownload] = useState(true)
  const [downloadDirectory, setDownloadDirectory] = useState('')
  const [namingTemplate, setNamingTemplate] = useState('')
  const [detectingFeed, setDetectingFeed] = useState(false)
  const detectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevDefaultPathRef = useRef(buildDefaultSubscriptionDirectory(downloadPath))
  const urlInputId = useId()
  const advancedOptionsId = useId()
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setAdvancedOptionsOpen(false)

    if (mode === 'edit' && subscription) {
      setUrl(subscription.feedUrl)
      setKeywords(subscription.keywords.join(', '))
      setTags(subscription.tags.join(', '))
      setOnlyLatest(subscription.onlyDownloadLatest)
      setAutoDownload(subscription.autoDownload !== false)
      setDownloadDirectory(subscription.downloadDirectory || '')
      setNamingTemplate(subscription.namingTemplate || '')
      return
    }

    setUrl('')
    setKeywords('')
    setTags('')
    setOnlyLatest(onlyLatestDefault)
    setAutoDownload(true)
    setDownloadDirectory(buildDefaultSubscriptionDirectory(downloadPath))
    setNamingTemplate(DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE)
  }, [open, mode, subscription, onlyLatestDefault, downloadPath])

  useEffect(() => {
    if (mode !== 'add') {
      return
    }
    const newPath = buildDefaultSubscriptionDirectory(downloadPath)
    setDownloadDirectory((prev) => {
      if (!prev || prev === prevDefaultPathRef.current) {
        return newPath
      }
      return prev
    })
    prevDefaultPathRef.current = newPath
  }, [downloadPath, mode])

  useEffect(() => {
    if (mode === 'add') {
      setOnlyLatest(onlyLatestDefault)
    }
  }, [onlyLatestDefault, mode])

  useEffect(() => {
    if (!url.trim()) {
      return
    }

    if (mode === 'edit' && subscription && url.trim() === subscription.feedUrl) {
      return
    }

    if (detectTimeout.current) {
      clearTimeout(detectTimeout.current)
    }

    detectTimeout.current = setTimeout(async () => {
      setDetectingFeed(true)
      try {
        await onResolveFeed(url.trim())
      } catch {
        // Detection is best-effort; save still validates.
      } finally {
        setDetectingFeed(false)
      }
    }, 500)

    return () => {
      if (detectTimeout.current) {
        clearTimeout(detectTimeout.current)
      }
    }
  }, [url, onResolveFeed, mode, subscription])

  const handleSelectDirectory = async () => {
    if (!onSelectDirectory) {
      return
    }
    try {
      const path = await onSelectDirectory()
      if (path) {
        setDownloadDirectory(path)
      }
    } catch {
      toast.error(t('subscriptions.notifications.directoryError'))
    }
  }

  const handleOpenRSSHubDocs = async () => {
    if (!onOpenRssDocs) {
      return
    }
    try {
      await onOpenRssDocs()
    } catch {
      toast.error(t('subscriptions.notifications.openLinkError'))
    }
  }

  const handleSave = async () => {
    if (mode === 'add' && !url.trim()) {
      toast.error(t('subscriptions.notifications.missingUrl'))
      return
    }

    const formData: SubscriptionFormData = {
      keywords: sanitizeCommaList(keywords),
      tags: sanitizeCommaList(tags),
      onlyDownloadLatest: onlyLatest,
      autoDownload,
      downloadDirectory: downloadDirectory || undefined,
      namingTemplate: namingTemplate || undefined
    }

    if (
      url.trim() &&
      (mode === 'add' || (mode === 'edit' && subscription && url.trim() !== subscription.feedUrl))
    ) {
      try {
        await onResolveFeed(url.trim())
        formData.url = url.trim()
      } catch {
        toast.error(t('subscriptions.notifications.resolveError'))
        return
      }
    }

    await onSave(formData)
  }

  const titleKey = mode === 'add' ? 'subscriptions.add.title' : 'subscriptions.edit.title'
  const descriptionKey =
    mode === 'add' ? 'subscriptions.add.description' : 'subscriptions.edit.description'
  const saveButtonKey = mode === 'add' ? 'subscriptions.actions.add' : 'subscriptions.actions.save'

  return (
    <Dialog onOpenChange={(isOpen) => !isOpen && onClose()} open={open}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' && subscription
              ? t(titleKey, { name: subscription.title })
              : t(titleKey)}
          </DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={urlInputId}>{t('subscriptions.fields.url')}</Label>
            <Input
              id={urlInputId}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://docs.rsshub.app/routes/youtube/user/@FKJ"
              value={url}
            />
            {detectingFeed && (
              <p className="text-muted-foreground text-xs">{t('subscriptions.detecting')}</p>
            )}
            {mode === 'add' && !url.trim() && (
              <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2">
                <p className="flex-1 text-muted-foreground text-xs">
                  {t('subscriptions.rssHub.hint')}
                </p>
                <Button
                  className="h-5 w-5 shrink-0 p-0"
                  onClick={() => void handleOpenRSSHubDocs()}
                  size="sm"
                  title={t('subscriptions.rssHub.openDocs')}
                  variant="ghost"
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>{t('subscriptions.fields.customDirectory')}</Label>
            <div className="flex gap-2">
              <Input readOnly value={downloadDirectory} />
              <Button
                disabled={!onSelectDirectory}
                onClick={() => void handleSelectDirectory()}
                variant="secondary"
              >
                {t('subscriptions.actions.selectDirectory')}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
              <p className="text-sm">{t('subscriptions.fields.autoDownload')}</p>
              <Switch
                checked={autoDownload}
                label=""
                onToggle={() => setAutoDownload((current) => !current)}
              />
            </div>
            {autoDownload ? (
              <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                <p className="text-sm">{t('subscriptions.fields.onlyLatest')}</p>
                <Switch
                  checked={onlyLatest}
                  label=""
                  onToggle={() => setOnlyLatest((current) => !current)}
                />
              </div>
            ) : null}
          </div>
          <div
            aria-hidden={!advancedOptionsOpen}
            className={cn(
              'grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out',
              advancedOptionsOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            )}
            data-state={advancedOptionsOpen ? 'open' : 'closed'}
          >
            <div className={cn('min-h-0', !advancedOptionsOpen && 'pointer-events-none')}>
              <div className="space-y-3 border-t pt-4">
                <div className="space-y-2">
                  <Label>{t('subscriptions.fields.keywords')}</Label>
                  <Input onChange={(event) => setKeywords(event.target.value)} value={keywords} />
                </div>
                <div className="space-y-2">
                  <Label>{t('subscriptions.fields.tags')}</Label>
                  <Input onChange={(event) => setTags(event.target.value)} value={tags} />
                </div>
                <div className="space-y-2">
                  <Label>{t('subscriptions.fields.namingTemplate')}</Label>
                  <Input
                    onChange={(event) =>
                      setNamingTemplate(sanitizeTemplateInput(event.target.value))
                    }
                    value={namingTemplate}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={advancedOptionsOpen}
                id={advancedOptionsId}
                onCheckedChange={(checked) => setAdvancedOptionsOpen(checked === true)}
              />
              <Label className="cursor-pointer" htmlFor={advancedOptionsId}>
                {t('advancedOptions.title')}
              </Label>
            </div>
            <div className="ml-auto flex gap-2">
              {mode === 'add' && (
                <Button onClick={onClose} variant="outline">
                  {t('download.cancel')}
                </Button>
              )}
              <Button onClick={() => void handleSave()}>{t(saveButtonKey)}</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
