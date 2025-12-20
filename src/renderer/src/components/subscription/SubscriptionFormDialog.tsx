import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'
import { Button } from '@renderer/components/ui/button'
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
import { Switch } from '@renderer/components/ui/switch'
import { ipcServices } from '@renderer/lib/ipc'
import { settingsAtom } from '@renderer/store/settings'
import { resolveFeedAtom } from '@renderer/store/subscriptions'
import { DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE, type SubscriptionRule } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const sanitizeCommaList = (value: string) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)

const sanitizeTemplateInput = (value: string) => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/')

export interface SubscriptionFormData {
  url?: string
  keywords?: string[]
  tags?: string[]
  onlyDownloadLatest?: boolean
  downloadDirectory?: string
  namingTemplate?: string
  enabled?: boolean
}

interface SubscriptionFormDialogProps {
  mode: 'add' | 'edit'
  subscription?: SubscriptionRule
  open: boolean
  onSave: (data: SubscriptionFormData) => Promise<void>
  onClose: () => void
}

export function SubscriptionFormDialog({
  mode,
  subscription,
  open,
  onSave,
  onClose
}: SubscriptionFormDialogProps) {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)
  const resolveFeed = useSetAtom(resolveFeedAtom)

  // Form state
  const [url, setUrl] = useState('')
  const [keywords, setKeywords] = useState('')
  const [tags, setTags] = useState('')
  const [onlyLatest, setOnlyLatest] = useState(false)
  const [downloadDirectory, setDownloadDirectory] = useState('')
  const [namingTemplate, setNamingTemplate] = useState('')

  // Feed detection state
  const [detectingFeed, setDetectingFeed] = useState(false)

  const detectTimeout = useRef<NodeJS.Timeout | null>(null)
  const prevDefaultPathRef = useRef(settings.downloadPath)
  const urlInputId = useId()

  // Initialize form values based on mode
  useEffect(() => {
    if (!open) {
      return
    }

    if (mode === 'edit' && subscription) {
      setUrl(subscription.feedUrl)
      setKeywords(subscription.keywords.join(', '))
      setTags(subscription.tags.join(', '))
      setOnlyLatest(subscription.onlyDownloadLatest)
      setDownloadDirectory(subscription.downloadDirectory || '')
      setNamingTemplate(subscription.namingTemplate || '')
    } else {
      // Add mode - use defaults from settings
      setUrl('')
      setKeywords('')
      setTags('')
      setOnlyLatest(settings.subscriptionOnlyLatestDefault)
      setDownloadDirectory(settings.downloadPath)
      setNamingTemplate(DEFAULT_SUBSCRIPTION_FILENAME_TEMPLATE)
    }
  }, [open, mode, subscription, settings.subscriptionOnlyLatestDefault, settings.downloadPath])

  // Sync download directory with settings changes (only in add mode)
  useEffect(() => {
    if (mode === 'add') {
      const newPath = settings.downloadPath
      setDownloadDirectory((prev) => {
        if (!prev || prev === prevDefaultPathRef.current) {
          return newPath
        }
        return prev
      })
      prevDefaultPathRef.current = newPath
    }
  }, [settings.downloadPath, mode])

  // Sync onlyLatest with settings changes (only in add mode)
  useEffect(() => {
    if (mode === 'add') {
      setOnlyLatest(settings.subscriptionOnlyLatestDefault)
    }
  }, [settings.subscriptionOnlyLatestDefault, mode])

  // Feed detection logic
  useEffect(() => {
    if (!url.trim()) {
      return
    }

    // In edit mode, don't detect if URL hasn't changed
    if (mode === 'edit' && subscription && url.trim() === subscription.feedUrl) {
      return
    }

    if (detectTimeout.current) {
      clearTimeout(detectTimeout.current)
    }

    detectTimeout.current = setTimeout(async () => {
      setDetectingFeed(true)
      try {
        await resolveFeed(url.trim())
      } catch (error) {
        console.error('Failed to resolve feed:', error)
      } finally {
        setDetectingFeed(false)
      }
    }, 500)

    return () => {
      if (detectTimeout.current) {
        clearTimeout(detectTimeout.current)
      }
    }
  }, [url, resolveFeed, mode, subscription])

  const handleSelectDirectory = async () => {
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        setDownloadDirectory(path)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
      toast.error(t('subscriptions.notifications.directoryError'))
    }
  }

  const handleOpenRSSHubDocs = async () => {
    try {
      await ipcServices.fs.openExternal('https://docs.rsshub.app/routes/social-media#youtube')
    } catch (error) {
      console.error('Failed to open RSSHub documentation:', error)
      toast.error(t('subscriptions.notifications.openLinkError'))
    }
  }

  const handleSave = async () => {
    // Validate URL for add mode
    if (mode === 'add' && !url.trim()) {
      toast.error(t('subscriptions.notifications.missingUrl'))
      return
    }

    const formData: SubscriptionFormData = {
      keywords: sanitizeCommaList(keywords),
      tags: sanitizeCommaList(tags),
      onlyDownloadLatest: onlyLatest,
      downloadDirectory: downloadDirectory || undefined,
      namingTemplate: namingTemplate || undefined
    }

    // Include URL if it's provided and different from current (for edit mode)
    if (url.trim()) {
      if (
        mode === 'add' ||
        (mode === 'edit' && subscription && url.trim() !== subscription.feedUrl)
      ) {
        try {
          await resolveFeed(url.trim())
          formData.url = url.trim()
        } catch (error) {
          console.error('Failed to resolve feed:', error)
          toast.error(t('subscriptions.notifications.resolveError'))
          return
        }
      }
    }

    await onSave(formData)
  }

  const titleKey = mode === 'add' ? 'subscriptions.add.title' : 'subscriptions.edit.title'
  const descriptionKey =
    mode === 'add' ? 'subscriptions.add.description' : 'subscriptions.edit.description'
  const saveButtonKey = mode === 'add' ? 'subscriptions.actions.add' : 'subscriptions.actions.save'

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
              value={url}
              placeholder={t('subscriptions.placeholders.url')}
              onChange={(event) => setUrl(event.target.value)}
            />
            {detectingFeed && (
              <p className="text-xs text-muted-foreground">{t('subscriptions.detecting')}</p>
            )}
            {mode === 'add' && !url.trim() && (
              <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2">
                <p className="text-xs text-muted-foreground flex-1">
                  {t('subscriptions.rssHub.hint')}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleOpenRSSHubDocs()}
                  className="h-5 w-5 p-0 shrink-0"
                  title={t('subscriptions.rssHub.openDocs')}
                >
                  <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
            )}
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
          <Accordion type="single" collapsible>
            <AccordionItem value="advanced">
              <AccordionTrigger>{t('advancedOptions.title')}</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div className="space-y-2">
                  <Label>{t('subscriptions.fields.keywords')}</Label>
                  <Input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('subscriptions.fields.tags')}</Label>
                  <Input value={tags} onChange={(event) => setTags(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t('subscriptions.fields.namingTemplate')}</Label>
                  <Input
                    value={namingTemplate}
                    onChange={(event) =>
                      setNamingTemplate(sanitizeTemplateInput(event.target.value))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <p className="text-sm">{t('subscriptions.fields.onlyLatest')}</p>
                  <Switch checked={onlyLatest} onCheckedChange={setOnlyLatest} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <DialogFooter>
          {mode === 'add' && (
            <Button variant="outline" onClick={onClose}>
              {t('download.cancel')}
            </Button>
          )}
          <Button onClick={() => void handleSave()}>{t(saveButtonKey)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
