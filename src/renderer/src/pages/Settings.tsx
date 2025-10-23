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
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { loadSettingsAtom, saveSettingAtom, settingsAtom } from '../store/settings'

export function Settings() {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [settings, _setSettings] = useAtom(settingsAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const saveSetting = useSetAtom(saveSettingAtom)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

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
      toast.error('Failed to select directory')
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
      toast.error('Failed to select file')
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
                  <ItemDescription>Choose where to save downloaded files</ItemDescription>
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
                  <ItemDescription>
                    Choose a light, dark, or system theme for VidBee
                  </ItemDescription>
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
                        Choose the default download type for one-click downloads. Quality uses the
                        preset below.
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
                      <ItemDescription>
                        Select the quality preset used for one-click downloads
                      </ItemDescription>
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
                          <SelectItem value="auto">
                            {t('settings.oneClickQualityOptions.auto')}
                          </SelectItem>
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
                  <ItemDescription>
                    Display additional format options in the interface
                  </ItemDescription>
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
            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.maxConcurrentDownloads')}</ItemTitle>
                  <ItemDescription>Maximum number of simultaneous downloads</ItemDescription>
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
                  <ItemTitle>{t('settings.browserForCookies')}</ItemTitle>
                  <ItemDescription>
                    Browser to extract cookies from for authentication
                  </ItemDescription>
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
                      <SelectItem value="chrome">Chrome</SelectItem>
                      <SelectItem value="firefox">Firefox</SelectItem>
                      <SelectItem value="edge">Edge</SelectItem>
                      <SelectItem value="safari">Safari</SelectItem>
                      <SelectItem value="brave">Brave</SelectItem>
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.proxy')}</ItemTitle>
                  <ItemDescription>Proxy server for network requests</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Input
                    placeholder="http://proxy:port"
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
                  <ItemDescription>Custom configuration file for yt-dlp</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <div className="flex gap-2 w-full max-w-md">
                    <Input value={settings.configPath} readOnly className="flex-1" />
                    <Button onClick={handleSelectConfigFile}>{t('settings.selectPath')}</Button>
                  </div>
                </ItemActions>
              </Item>
            </ItemGroup>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
