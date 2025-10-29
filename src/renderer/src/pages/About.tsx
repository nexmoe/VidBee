import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@renderer/components/ui/card'
import { Switch } from '@renderer/components/ui/switch'
import { useAtom, useSetAtom } from 'jotai'
import type { LucideIcon } from 'lucide-react'
import {
  Facebook,
  FileText,
  Github,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Twitter
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcServices } from '../lib/ipc'
import { saveSettingAtom, settingsAtom } from '../store/settings'

interface AboutResource {
  icon: LucideIcon
  label: string
  description?: string
  actionLabel: string
  href?: string
  onClick?: () => void
}

type LatestVersionState =
  | { status: 'available'; version: string }
  | { status: 'uptodate'; version: string }
  | { status: 'error'; error?: string }
  | null

export function About() {
  const { t } = useTranslation()
  const [settings, _setSettings] = useAtom(settingsAtom)
  const [appVersion, setAppVersion] = useState<string>('—')
  const [latestVersionState, setLatestVersionState] = useState<LatestVersionState>(null)
  const saveSetting = useSetAtom(saveSettingAtom)
  const shareTargetUrl = 'https://github.com/nexmoe/VidBee'

  useEffect(() => {
    let isActive = true

    const fetchAppVersion = async () => {
      try {
        const version = await ipcServices.app.getVersion()
        if (isActive) {
          setAppVersion(version)
        }
      } catch (error) {
        console.error('Failed to get app version:', error)
      }
    }

    void fetchAppVersion()

    return () => {
      isActive = false
    }
  }, [])

  const handleSettingChange = async (
    key: keyof typeof settings,
    value: (typeof settings)[keyof typeof settings]
  ) => {
    await saveSetting({ key, value })
    toast.success(t('notifications.settingsSaved'))
  }

  const handleCheckForUpdates = async () => {
    try {
      toast.info(t('about.notifications.checkingUpdates'))
      const result = await ipcServices.update.checkForUpdates()

      if (result.available) {
        toast.success(t('about.notifications.updateAvailable', { version: result.version }))
        setLatestVersionState({
          status: 'available',
          version: result.version ?? ''
        })
      } else if (result.error) {
        toast.error(t('about.notifications.updateError', { error: result.error }))
        setLatestVersionState({
          status: 'error',
          error: result.error
        })
      } else {
        toast.success(t('about.notifications.noUpdatesAvailable'))
        setLatestVersionState({
          status: 'uptodate',
          version: result.version ?? appVersion
        })
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error(t('about.notifications.updateError', { error: 'Unknown error' }))
      setLatestVersionState({
        status: 'error'
      })
    }
  }

  const shareLinks = useMemo(() => {
    const encodedUrl = encodeURIComponent(shareTargetUrl)
    const encodedText = encodeURIComponent(t('about.description'))

    return {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`
    }
  }, [t])

  const openShareUrl = (url: string) => {
    if (typeof window === 'undefined') {
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleShareTwitter = () => {
    openShareUrl(shareLinks.twitter)
  }

  const handleShareFacebook = () => {
    openShareUrl(shareLinks.facebook)
  }

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareTargetUrl)
      toast.success(t('notifications.urlCopied'))
    } catch (error) {
      console.error('Failed to copy share link:', error)
      toast.error(t('notifications.copyFailed'))
    }
  }

  const latestVersionBadgeText =
    latestVersionState && latestVersionState.status !== 'error' && latestVersionState.version
      ? t('about.latestVersionBadge', { version: latestVersionState.version })
      : null
  const latestVersionStatusKey = latestVersionState
    ? `about.latestVersionStatus.${latestVersionState.status}`
    : null
  const latestVersionStatusClass =
    latestVersionState?.status === 'available'
      ? 'text-primary'
      : latestVersionState?.status === 'error'
        ? 'text-destructive'
        : 'text-muted-foreground'
  const latestVersionStatusText = latestVersionStatusKey ? t(latestVersionStatusKey) : null

  const aboutResources = useMemo<AboutResource[]>(
    () => [
      {
        icon: LinkIcon,
        label: t('about.resources.website'),
        description: t('about.resources.websiteDescription'),
        actionLabel: t('about.actions.visit'),
        href: 'https://vidbee.org/'
      },
      {
        icon: FileText,
        label: t('about.resources.changelog'),
        description: t('about.resources.changelogDescription'),
        actionLabel: t('about.actions.view'),
        href: 'https://github.com/nexmoe/VidBee/releases'
      },
      {
        icon: MessageCircle,
        label: t('about.resources.feedback'),
        description: t('about.resources.feedbackDescription'),
        actionLabel: t('about.actions.feedback'),
        href: 'https://github.com/nexmoe/VidBee/issues/new/choose'
      },
      {
        icon: ShieldCheck,
        label: t('about.resources.license'),
        description: t('about.resources.licenseDescription'),
        actionLabel: t('about.actions.view'),
        href: 'https://github.com/nexmoe/VidBee/blob/main/LICENSE'
      },
      {
        icon: Mail,
        label: t('about.resources.contact'),
        description: t('about.resources.contactDescription'),
        actionLabel: t('about.actions.email'),
        href: 'mailto:nexmoex@gmail.com'
      }
    ],
    [t]
  )

  return (
    <div className="h-full bg-background">
      <div className="container mx-auto max-w-5xl p-6 space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <img src="./app-icon.png" alt="VidBee" className="h-16 w-16 rounded-2xl" />
                <div className="space-y-2">
                  <div>
                    <h2 className="text-2xl font-semibold leading-tight">{t('about.appName')}</h2>
                    <p className="text-sm text-muted-foreground">{t('about.description')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {t('about.versionLabel', { version: appVersion })}
                    </Badge>
                    {latestVersionState ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {latestVersionBadgeText ? (
                          <Badge variant="outline">{latestVersionBadgeText}</Badge>
                        ) : null}
                        {latestVersionStatusText ? (
                          <span className={`text-sm ${latestVersionStatusClass}`}>
                            {latestVersionStatusText}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" asChild>
                  <a
                    href="https://github.com/nexmoe/vidbee"
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('about.actions.openRepo')}
                  >
                    <Github className="h-4 w-4" />
                  </a>
                </Button>
                <Button onClick={handleCheckForUpdates} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  {t('about.actions.checkUpdates')}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 pt-6">
              <div className="space-y-1">
                <p className="font-medium leading-none">{t('about.autoUpdateTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('about.autoUpdateDescription')}</p>
              </div>
              <Switch
                checked={settings.autoUpdate}
                onCheckedChange={(value) => handleSettingChange('autoUpdate', value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('about.followAuthorTitle')}</CardTitle>
            <CardDescription>{t('about.followAuthorDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground md:max-w-md">
              {t('about.followAuthorSupport')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openShareUrl('https://x.com/nexmoex')}
                className="gap-2"
              >
                <Twitter className="h-4 w-4" />
                {t('about.followAuthorActions.follow')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('about.shareTitle')}</CardTitle>
            <CardDescription>{t('about.shareDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-muted-foreground md:max-w-md">{t('about.shareSupport')}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleShareTwitter} className="gap-2">
                <Twitter className="h-4 w-4" />
                {t('about.shareActions.twitter')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleShareFacebook} className="gap-2">
                <Facebook className="h-4 w-4" />
                {t('about.shareActions.facebook')}
              </Button>
              <Button variant="secondary" size="sm" onClick={handleCopyShareLink} className="gap-2">
                <LinkIcon className="h-4 w-4" />
                {t('about.shareActions.copy')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('about.resourcesTitle')}</CardTitle>
            <CardDescription>{t('about.resourcesDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="flex flex-col divide-y">
              {aboutResources.map((resource) => {
                const Icon = resource.icon
                return (
                  <div
                    key={resource.label}
                    className="flex items-center justify-between gap-4 px-6 py-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
                        <Icon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-medium leading-none">{resource.label}</p>
                        {resource.description ? (
                          <p className="text-sm text-muted-foreground">{resource.description}</p>
                        ) : null}
                      </div>
                    </div>
                    {resource.href ? (
                      <Button variant="outline" size="sm" asChild>
                        <a href={resource.href} target="_blank" rel="noreferrer">
                          {resource.actionLabel}
                        </a>
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={resource.onClick}>
                        {resource.actionLabel}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
