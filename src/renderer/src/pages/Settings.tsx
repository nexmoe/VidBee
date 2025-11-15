import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs'
import type { OneClickQualityPreset } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { loadSettingsAtom, saveSettingAtom, settingsAtom } from '../store/settings'

const clampSubscriptionInterval = (value: string) => {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return 3
  }
  return Math.min(24, Math.max(1, parsed))
}

export function Settings() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [settings, _setSettings] = useAtom(settingsAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const saveSetting = useSetAtom(saveSettingAtom)
  const [platform, setPlatform] = useState<string>('')

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    const fetchPlatform = async () => {
      try {
        const { ipcServices } = await import('../lib/ipc')
        const platformInfo = await ipcServices.app.getPlatform()
        setPlatform(platformInfo)
      } catch (error) {
        console.error('Failed to get platform info:', error)
      }
    }

    fetchPlatform()
  }, [])

  const handleSettingChange = async (
    key: keyof typeof settings,
    value: (typeof settings)[keyof typeof settings]
  ) => {
    await saveSetting({ key, value })
    toast.success(t('notifications.settingsSaved'))
  }

  const handleSelectPath = async () => {
    try {
      const { ipcServices } = await import('../lib/ipc')
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        await handleSettingChange('downloadPath', path)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
      toast.error(t('settings.directorySelectError'))
    }
  }

  const handleSelectConfigFile = async () => {
    try {
      const { ipcServices } = await import('../lib/ipc')
      const path = await ipcServices.fs.selectFile()
      if (path) {
        await handleSettingChange('configPath', path)
      }
    } catch (error) {
      console.error('Failed to select file:', error)
      toast.error(t('settings.fileSelectError'))
    }
  }

  const handleSelectCookiesFile = async () => {
    try {
      const { ipcServices } = await import('../lib/ipc')
      const path = await ipcServices.fs.selectFile()
      if (path) {
        await handleSettingChange('cookiesPath', path)
      }
    } catch (error) {
      console.error('Failed to select cookies file:', error)
      toast.error(t('settings.fileSelectError'))
    }
  }

  const handleOpenCookiesFaq = async () => {
    try {
      const { ipcServices } = await import('../lib/ipc')
      await ipcServices.fs.openExternal(
        'https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp'
      )
    } catch (error) {
      console.error('Failed to open cookies FAQ:', error)
      toast.error(t('settings.openLinkError'))
    }
  }

  const handleThemeChange = async (value: 'light' | 'dark' | 'system') => {
    const currentTheme = (theme ?? settings.theme ?? 'system') as 'light' | 'dark' | 'system'
    if (currentTheme === value) {
      return
    }

    setTheme(value)
    await handleSettingChange('theme', value)
  }

  return (
    <div className="h-full bg-background">
      <div className="container mx-auto max-w-4xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
          <p className="text-muted-foreground">{t('settings.description')}</p>
        </div>

        <Tabs defaultValue="general">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">{t('settings.general')}</TabsTrigger>
            <TabsTrigger value="advanced">{t('settings.advanced')}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-2">
            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.downloadPath')}</ItemTitle>
                  <ItemDescription>{t('settings.downloadPathDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <div className="flex gap-2 w-full max-w-md">
                    <Input value={settings.downloadPath} readOnly className="flex-1" />
                    <Button onClick={handleSelectPath}>{t('settings.selectPath')}</Button>
                  </div>
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.theme')}</ItemTitle>
                  <ItemDescription>{t('settings.themeDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select
                    value={theme ?? settings.theme ?? 'system'}
                    onValueChange={(value) =>
                      void handleThemeChange(value as 'light' | 'dark' | 'system')
                    }
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">{t('settings.light')}</SelectItem>
                      <SelectItem value="dark">{t('settings.dark')}</SelectItem>
                      <SelectItem value="system">{t('settings.system')}</SelectItem>
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>
            </ItemGroup>

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.oneClickDownload')}</ItemTitle>
                  <ItemDescription>{t('settings.oneClickDownloadDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.oneClickDownload}
                    onCheckedChange={(value) => handleSettingChange('oneClickDownload', value)}
                  />
                </ItemActions>
              </Item>

              {settings.oneClickDownload && (
                <>
                  <ItemSeparator />
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.oneClickDownloadType')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.oneClickDownloadTypeDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Select
                        value={settings.oneClickDownloadType}
                        onValueChange={(value) =>
                          handleSettingChange('oneClickDownloadType', value)
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="video">{t('download.video')}</SelectItem>
                          <SelectItem value="audio">{t('download.audio')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </ItemActions>
                  </Item>
                  <ItemSeparator />
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.oneClickQuality')}</ItemTitle>
                      <ItemDescription>{t('settings.oneClickQualityDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Select
                        value={settings.oneClickQuality}
                        onValueChange={(value) =>
                          handleSettingChange('oneClickQuality', value as OneClickQualityPreset)
                        }
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="best">
                            {t('settings.oneClickQualityOptions.best')}
                          </SelectItem>
                          <SelectItem value="good">
                            {t('settings.oneClickQualityOptions.good')}
                          </SelectItem>
                          <SelectItem value="normal">
                            {t('settings.oneClickQualityOptions.normal')}
                          </SelectItem>
                          <SelectItem value="bad">
                            {t('settings.oneClickQualityOptions.bad')}
                          </SelectItem>
                          <SelectItem value="worst">
                            {t('settings.oneClickQualityOptions.worst')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </ItemActions>
                  </Item>
                </>
              )}
            </ItemGroup>

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.showMoreFormats')}</ItemTitle>
                  <ItemDescription>{t('settings.showMoreFormatsDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.showMoreFormats}
                    onCheckedChange={(value) => handleSettingChange('showMoreFormats', value)}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 mt-2">
            {platform === 'darwin' && (
              <ItemGroup>
                <Item variant="muted">
                  <ItemContent>
                    <ItemTitle>{t('settings.hideDockIcon')}</ItemTitle>
                    <ItemDescription>{t('settings.hideDockIconDescription')}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={settings.hideDockIcon}
                      onCheckedChange={(value) => handleSettingChange('hideDockIcon', value)}
                    />
                  </ItemActions>
                </Item>
              </ItemGroup>
            )}

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('subscriptions.defaults.checkInterval')}</ItemTitle>
                  <ItemDescription>
                    {t('settings.subscriptionDefaults.intervalDescription')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    defaultValue={settings.subscriptionCheckIntervalHours}
                    key={`subscription-interval-${settings.subscriptionCheckIntervalHours}`}
                    onBlur={(event) =>
                      void handleSettingChange(
                        'subscriptionCheckIntervalHours',
                        clampSubscriptionInterval(event.target.value)
                      )
                    }
                    className="w-24"
                  />
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.maxConcurrentDownloads')}</ItemTitle>
                  <ItemDescription>
                    {t('settings.maxConcurrentDownloadsDescription')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select
                    value={settings.maxConcurrentDownloads.toString()}
                    onValueChange={(value) =>
                      handleSettingChange('maxConcurrentDownloads', Number(value))
                    }
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.proxy')}</ItemTitle>
                  <ItemDescription>{t('settings.proxyDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Input
                    placeholder={t('settings.proxyPlaceholder')}
                    value={settings.proxy}
                    onChange={(e) => handleSettingChange('proxy', e.target.value)}
                    className="w-64"
                  />
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.configFile')}</ItemTitle>
                  <ItemDescription>{t('settings.configFileDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <div className="flex gap-2 w-full max-w-md">
                    <Input value={settings.configPath} readOnly className="flex-1" />
                    <Button onClick={handleSelectConfigFile}>{t('settings.selectPath')}</Button>
                    <Button
                      variant="secondary"
                      onClick={() => void handleSettingChange('configPath', '')}
                      disabled={!settings.configPath}
                    >
                      {t('settings.clearConfigFile')}
                    </Button>
                  </div>
                </ItemActions>
              </Item>
            </ItemGroup>

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.browserForCookies')}</ItemTitle>
                  <ItemDescription>{t('settings.browserForCookiesDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select
                    value={settings.browserForCookies}
                    onValueChange={(value) => handleSettingChange('browserForCookies', value)}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('settings.none')}</SelectItem>
                      <SelectItem value="chrome">{t('settings.browserOptions.chrome')}</SelectItem>
                      <SelectItem value="firefox">
                        {t('settings.browserOptions.firefox')}
                      </SelectItem>
                      <SelectItem value="edge">{t('settings.browserOptions.edge')}</SelectItem>
                      <SelectItem value="safari">{t('settings.browserOptions.safari')}</SelectItem>
                      <SelectItem value="brave">{t('settings.browserOptions.brave')}</SelectItem>
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.cookiesFile')}</ItemTitle>
                  <ItemDescription>{t('settings.cookiesFileDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <div className="flex gap-2 w-full max-w-md">
                    <Input value={settings.cookiesPath ?? ''} readOnly className="flex-1" />
                    <Button onClick={handleSelectCookiesFile}>{t('settings.selectPath')}</Button>
                    <Button
                      variant="secondary"
                      onClick={() => void handleSettingChange('cookiesPath', '')}
                      disabled={!settings.cookiesPath}
                    >
                      {t('settings.clearCookiesFile')}
                    </Button>
                  </div>
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.cookiesHelpTitle')}</ItemTitle>
                  <ItemDescription>
                    <ul className="list-disc list-inside space-y-1">
                      <li>{t('settings.cookiesHelpBrowser')}</li>
                      <li>{t('settings.cookiesHelpFile')}</li>
                    </ul>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="link" className="px-0" onClick={handleOpenCookiesFaq}>
                    {t('settings.cookiesHelpFaq')}
                  </Button>
                </ItemActions>
              </Item>
            </ItemGroup>

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.enableAnalytics')}</ItemTitle>
                  <ItemDescription>{t('settings.enableAnalyticsDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.enableAnalytics}
                    onCheckedChange={(value) => handleSettingChange('enableAnalytics', value)}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
