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
import { type LanguageCode, languageList, normalizeLanguageCode } from '@shared/languages'
import type { OneClickQualityPreset } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import { loadSettingsAtom, saveSettingAtom, settingsAtom } from '../store/settings'

export function Settings() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [settings, _setSettings] = useAtom(settingsAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const saveSetting = useSetAtom(saveSettingAtom)
  const [platform, setPlatform] = useState<string>('')
  const [activeTab, setActiveTab] = useState<string>('general')

  useEffect(() => {
    logger.info('[Settings] Component mounted, loading settings...')
    try {
      loadSettings()
      // Note: settings will be logged in the next useEffect after it's loaded
    } catch (error) {
      logger.error('[Settings] Failed to load settings:', error)
    }
  }, [loadSettings])

  useEffect(() => {
    logger.info('[Settings] Settings state updated', {
      settingsKeys: Object.keys(settings),
      settingsValues: settings
    })
  }, [settings])

  useEffect(() => {
    const fetchPlatform = async () => {
      try {
        const platformInfo = await ipcServices.app.getPlatform()
        setPlatform(platformInfo)
      } catch (error) {
        logger.error('Failed to get platform info:', error)
      }
    }

    fetchPlatform()
  }, [])

  const autoLaunchSupported = platform === 'darwin' || platform === 'win32'

  const handleSettingChange = async (
    key: keyof typeof settings,
    value: (typeof settings)[keyof typeof settings]
  ) => {
    try {
      logger.info('[Settings] Changing setting', { key, value, currentValue: settings[key] })
      await saveSetting({ key, value })
      toast.success(t('notifications.settingsSaved'))
      logger.info('[Settings] Setting changed successfully', { key, value })
    } catch (error) {
      logger.error('[Settings] Failed to change setting', { key, value, error })
      toast.error(t('settings.saveError') || 'Failed to save setting')
    }
  }

  const handleSelectPath = async () => {
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        await handleSettingChange('downloadPath', path)
      }
    } catch (error) {
      logger.error('Failed to select directory:', error)
      toast.error(t('settings.directorySelectError'))
    }
  }

  const handleSelectConfigFile = async () => {
    try {
      const path = await ipcServices.fs.selectFile()
      if (path) {
        await handleSettingChange('configPath', path)
      }
    } catch (error) {
      logger.error('Failed to select file:', error)
      toast.error(t('settings.fileSelectError'))
    }
  }

  const handleSelectCookiesFile = async () => {
    try {
      const path = await ipcServices.fs.selectFile()
      if (path) {
        await handleSettingChange('cookiesPath', path)
      }
    } catch (error) {
      logger.error('Failed to select cookies file:', error)
      toast.error(t('settings.fileSelectError'))
    }
  }

  const handleOpenCookiesFaq = async () => {
    try {
      await ipcServices.fs.openExternal(
        'https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp'
      )
    } catch (error) {
      logger.error('Failed to open cookies FAQ:', error)
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

  const languageOptions = languageList
  const activeLanguageCode = normalizeLanguageCode(i18nInstance.language)
  const currentLanguage =
    languageOptions.find((option) => option.value === activeLanguageCode) ?? languageOptions[0]

  const handleLanguageChange = async (value: LanguageCode) => {
    if (activeLanguageCode === value) {
      return
    }

    await saveSetting({ key: 'language', value })
    await i18nInstance.changeLanguage(value)
    toast.success(t('notifications.settingsSaved'))
  }

  return (
    <div className="h-full bg-background">
      <div className="container mx-auto max-w-4xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
          <p className="text-muted-foreground">{t('settings.description')}</p>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            logger.info('[Settings] Tab changed', { from: activeTab, to: value })
            setActiveTab(value)
            try {
              if (value === 'advanced') {
                logger.info('[Settings] Entering advanced tab', {
                  settings: settings,
                  settingsKeys: Object.keys(settings),
                  maxConcurrentDownloads: settings.maxConcurrentDownloads,
                  browserForCookies: settings.browserForCookies,
                  cookiesPath: settings.cookiesPath,
                  proxy: settings.proxy,
                  configPath: settings.configPath,
                  enableAnalytics: settings.enableAnalytics
                })
              }
            } catch (error) {
              logger.error('[Settings] Error when entering advanced tab:', error)
            }
          }}
        >
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

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.language')}</ItemTitle>
                  <ItemDescription>{t('settings.languageDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select
                    value={currentLanguage.value}
                    onValueChange={(value) => void handleLanguageChange(value as LanguageCode)}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder={currentLanguage.name}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`${currentLanguage.flag} rounded-xs text-base`}
                            aria-hidden="true"
                          />
                          <span lang={currentLanguage.hreflang}>{currentLanguage.name}</span>
                        </div>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {languageOptions.map((option) => {
                        const isActive = option.value === currentLanguage.value
                        return (
                          <SelectItem
                            key={option.value}
                            value={option.value}
                            className={isActive ? 'font-semibold bg-muted' : undefined}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`${option.flag} rounded-xs text-base`}
                                aria-hidden="true"
                              />
                              <span lang={option.hreflang}>{option.name}</span>
                            </div>
                          </SelectItem>
                        )
                      })}
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
              {platform === 'darwin' && (
                <>
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
                  <ItemSeparator />
                </>
              )}

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.launchAtLogin')}</ItemTitle>
                  <ItemDescription>
                    {autoLaunchSupported
                      ? t('settings.launchAtLoginDescription')
                      : t('settings.launchAtLoginUnsupported')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.launchAtLogin}
                    onCheckedChange={(value) => handleSettingChange('launchAtLogin', value)}
                    disabled={!autoLaunchSupported}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 mt-2">
            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.showMoreFormats')}</ItemTitle>
                  <ItemDescription>{t('settings.showMoreFormatsDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.showMoreFormats ?? false}
                    onCheckedChange={(value) => {
                      try {
                        logger.info('[Settings] Toggling showMoreFormats', { value })
                        handleSettingChange('showMoreFormats', value)
                      } catch (error) {
                        logger.error('[Settings] Error toggling showMoreFormats:', error)
                      }
                    }}
                  />
                </ItemActions>
              </Item>
            </ItemGroup>

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.maxConcurrentDownloads')}</ItemTitle>
                  <ItemDescription>
                    {t('settings.maxConcurrentDownloadsDescription')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  {(() => {
                    try {
                      const maxConcurrent = settings.maxConcurrentDownloads ?? 5
                      const maxConcurrentStr = maxConcurrent.toString()
                      logger.info('[Settings] Rendering max concurrent downloads select', {
                        maxConcurrent,
                        maxConcurrentStr,
                        type: typeof maxConcurrent
                      })
                      return (
                        <Select
                          value={maxConcurrentStr}
                          onValueChange={(value) => {
                            try {
                              const numValue = Number(value)
                              logger.info('[Settings] Max concurrent downloads changed', {
                                oldValue: maxConcurrent,
                                newValue: numValue,
                                stringValue: value
                              })
                              handleSettingChange('maxConcurrentDownloads', numValue)
                            } catch (error) {
                              logger.error(
                                '[Settings] Error changing max concurrent downloads:',
                                error
                              )
                            }
                          }}
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
                      )
                    } catch (error) {
                      logger.error(
                        '[Settings] Error rendering max concurrent downloads select:',
                        error
                      )
                      return <div>Error loading max concurrent downloads setting</div>
                    }
                  })()}
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.proxy')}</ItemTitle>
                  <ItemDescription>{t('settings.proxyDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {(() => {
                    try {
                      const proxyValue = settings.proxy ?? ''
                      logger.info('[Settings] Rendering proxy input', { proxyValue })
                      return (
                        <Input
                          placeholder={t('settings.proxyPlaceholder')}
                          value={proxyValue}
                          onChange={(e) => {
                            try {
                              logger.info('[Settings] Proxy value changed', {
                                oldValue: proxyValue,
                                newValue: e.target.value
                              })
                              handleSettingChange('proxy', e.target.value)
                            } catch (error) {
                              logger.error('[Settings] Error changing proxy:', error)
                            }
                          }}
                          className="w-64"
                        />
                      )
                    } catch (error) {
                      logger.error('[Settings] Error rendering proxy input:', error)
                      return <div>Error loading proxy setting</div>
                    }
                  })()}
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.configFile')}</ItemTitle>
                  <ItemDescription>{t('settings.configFileDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {(() => {
                    try {
                      const configPathValue = settings.configPath ?? ''
                      logger.info('[Settings] Rendering config file input', { configPathValue })
                      return (
                        <div className="flex gap-2 w-full max-w-md">
                          <Input value={configPathValue} readOnly className="flex-1" />
                          <Button onClick={handleSelectConfigFile}>
                            {t('settings.selectPath')}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              try {
                                logger.info('[Settings] Clearing config path')
                                void handleSettingChange('configPath', '')
                              } catch (error) {
                                logger.error('[Settings] Error clearing config path:', error)
                              }
                            }}
                            disabled={!configPathValue}
                          >
                            {t('settings.clearConfigFile')}
                          </Button>
                        </div>
                      )
                    } catch (error) {
                      logger.error('[Settings] Error rendering config file input:', error)
                      return <div>Error loading config file setting</div>
                    }
                  })()}
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
                  {(() => {
                    try {
                      const browserValue = settings.browserForCookies ?? 'none'
                      logger.info('[Settings] Rendering browser for cookies select', {
                        browserValue
                      })
                      return (
                        <Select
                          value={browserValue}
                          onValueChange={(value) => {
                            try {
                              logger.info('[Settings] Browser for cookies changed', {
                                oldValue: browserValue,
                                newValue: value
                              })
                              handleSettingChange('browserForCookies', value)
                            } catch (error) {
                              logger.error('[Settings] Error changing browser for cookies:', error)
                            }
                          }}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t('settings.none')}</SelectItem>
                            <SelectItem value="chrome">
                              {t('settings.browserOptions.chrome')}
                            </SelectItem>
                            <SelectItem value="chromium">
                              {t('settings.browserOptions.chromium')}
                            </SelectItem>
                            <SelectItem value="firefox">
                              {t('settings.browserOptions.firefox')}
                            </SelectItem>
                            <SelectItem value="edge">
                              {t('settings.browserOptions.edge')}
                            </SelectItem>
                            <SelectItem value="safari">
                              {t('settings.browserOptions.safari')}
                            </SelectItem>
                            <SelectItem value="brave">
                              {t('settings.browserOptions.brave')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )
                    } catch (error) {
                      logger.error('[Settings] Error rendering browser for cookies select:', error)
                      return <div>Error loading browser for cookies setting</div>
                    }
                  })()}
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.cookiesFile')}</ItemTitle>
                  <ItemDescription>{t('settings.cookiesFileDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {(() => {
                    try {
                      const cookiesPathValue = settings.cookiesPath ?? ''
                      logger.info('[Settings] Rendering cookies file input', { cookiesPathValue })
                      return (
                        <div className="flex gap-2 w-full max-w-md">
                          <Input value={cookiesPathValue} readOnly className="flex-1" />
                          <Button onClick={handleSelectCookiesFile}>
                            {t('settings.selectPath')}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              try {
                                logger.info('[Settings] Clearing cookies path')
                                void handleSettingChange('cookiesPath', '')
                              } catch (error) {
                                logger.error('[Settings] Error clearing cookies path:', error)
                              }
                            }}
                            disabled={!cookiesPathValue}
                          >
                            {t('settings.clearCookiesFile')}
                          </Button>
                        </div>
                      )
                    } catch (error) {
                      logger.error('[Settings] Error rendering cookies file input:', error)
                      return <div>Error loading cookies file setting</div>
                    }
                  })()}
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.cookiesHelpTitle')}</ItemTitle>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground text-sm leading-normal">
                    <li>{t('settings.cookiesHelpBrowser')}</li>
                    <li>{t('settings.cookiesHelpFile')}</li>
                  </ul>
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
                  {(() => {
                    try {
                      const analyticsValue = settings.enableAnalytics ?? true
                      logger.info('[Settings] Rendering enable analytics switch', {
                        analyticsValue
                      })
                      return (
                        <Switch
                          checked={analyticsValue}
                          onCheckedChange={(value) => {
                            try {
                              logger.info('[Settings] Enable analytics changed', {
                                oldValue: analyticsValue,
                                newValue: value
                              })
                              handleSettingChange('enableAnalytics', value)
                            } catch (error) {
                              logger.error('[Settings] Error changing enable analytics:', error)
                            }
                          }}
                        />
                      )
                    } catch (error) {
                      logger.error('[Settings] Error rendering enable analytics switch:', error)
                      return <div>Error loading enable analytics setting</div>
                    }
                  })()}
                </ItemActions>
              </Item>
            </ItemGroup>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
