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
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { type LanguageCode, languageList, normalizeLanguageCode } from '@shared/languages'
import type { OneClickQualityPreset } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import { loadSettingsAtom, saveSettingAtom, settingsAtom } from '../store/settings'

const normalizeProfileInput = (value: string) => value.trim().replace(/^['"]|['"]$/g, '')

const parseBrowserCookiesSetting = (value: string | undefined) => {
  if (!value || value === 'none') {
    return { browser: 'none', profile: '' }
  }

  const separatorIndex = value.indexOf(':')
  if (separatorIndex === -1) {
    return { browser: value, profile: '' }
  }

  const browser = value.slice(0, separatorIndex).trim()
  const profile = normalizeProfileInput(value.slice(separatorIndex + 1))
  return { browser: browser || 'none', profile }
}

const buildBrowserCookiesSetting = (browser: string, profile: string) => {
  const trimmedBrowser = browser.trim()
  if (!trimmedBrowser || trimmedBrowser === 'none') {
    return 'none'
  }

  const trimmedProfile = normalizeProfileInput(profile)
  return trimmedProfile ? `${trimmedBrowser}:${trimmedProfile}` : trimmedBrowser
}

export function Settings() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [settings, _setSettings] = useAtom(settingsAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const saveSetting = useSetAtom(saveSettingAtom)
  const [platform, setPlatform] = useState<string>('')
  const [activeTab, setActiveTab] = useState<string>('general')
  const [browserProfileValidation, setBrowserProfileValidation] = useState<{
    valid: boolean
    reason?: string
  }>({ valid: false })
  const lastAutoDetectBrowser = useRef<string | null>(null)

  useEffect(() => {
    try {
      loadSettings()
    } catch (error) {
      logger.error('[Settings] Failed to load settings:', error)
    }
  }, [loadSettings])

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

  const handleSettingChange = useCallback(
    async (key: keyof typeof settings, value: (typeof settings)[keyof typeof settings]) => {
      try {
        await saveSetting({ key, value })
      } catch (error) {
        logger.error('[Settings] Failed to change setting', { key, value, error })
        toast.error(t('settings.saveError') || 'Failed to save setting')
      }
    },
    [saveSetting, t]
  )

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
  const parsedBrowserCookies = parseBrowserCookiesSetting(settings.browserForCookies)
  const browserForCookiesValue = parsedBrowserCookies.browser
  const browserCookiesProfileValue = parsedBrowserCookies.profile
  const normalizedBrowserCookiesSetting = buildBrowserCookiesSetting(
    browserForCookiesValue,
    browserCookiesProfileValue
  )
  const hasBrowserProfileValue = browserCookiesProfileValue.trim().length > 0
  const showBrowserProfileCheck = hasBrowserProfileValue && browserProfileValidation.valid
  const showBrowserProfileWarning = hasBrowserProfileValue && !browserProfileValidation.valid
  const getBrowserProfileWarningMessage = (reason?: string) => {
    switch (reason) {
      case 'pathNotFound':
        return t('settings.browserForCookiesProfileInvalidPath')
      case 'profileNotFound':
        return t('settings.browserForCookiesProfileInvalidProfile')
      case 'browserUnsupported':
        return t('settings.browserForCookiesProfileInvalidUnsupported')
      case 'empty':
        return t('settings.browserForCookiesProfileInvalidEmpty')
      default:
        return t('settings.browserForCookiesProfileInvalid')
    }
  }

  useEffect(() => {
    if (settings.browserForCookies !== normalizedBrowserCookiesSetting) {
      void handleSettingChange('browserForCookies', normalizedBrowserCookiesSetting)
    }
  }, [handleSettingChange, normalizedBrowserCookiesSetting, settings.browserForCookies])

  useEffect(() => {
    const browserChanged = lastAutoDetectBrowser.current !== browserForCookiesValue
    const shouldAutoDetect =
      browserForCookiesValue !== 'none' && (browserChanged || !browserCookiesProfileValue)

    if (!shouldAutoDetect) {
      lastAutoDetectBrowser.current = browserForCookiesValue
      return
    }

    const detectProfilePath = async () => {
      try {
        const detectedPath =
          await ipcServices.browserCookies.getBrowserProfilePath(browserForCookiesValue)
        const nextProfileValue = detectedPath || ''
        if (nextProfileValue !== browserCookiesProfileValue) {
          const nextValue = buildBrowserCookiesSetting(browserForCookiesValue, nextProfileValue)
          await handleSettingChange('browserForCookies', nextValue)
        }
      } catch (error) {
        logger.error('[Settings] Failed to detect browser profile path:', error)
      } finally {
        lastAutoDetectBrowser.current = browserForCookiesValue
      }
    }

    void detectProfilePath()
  }, [browserForCookiesValue, browserCookiesProfileValue, handleSettingChange])

  useEffect(() => {
    if (browserForCookiesValue === 'none' || !hasBrowserProfileValue) {
      setBrowserProfileValidation({ valid: false, reason: 'empty' })
      return
    }

    let isActive = true

    const validateProfilePath = async () => {
      try {
        const result = await ipcServices.browserCookies.validateBrowserProfilePath(
          browserForCookiesValue,
          browserCookiesProfileValue
        )
        if (isActive) {
          setBrowserProfileValidation(result)
        }
      } catch (error) {
        if (isActive) {
          setBrowserProfileValidation({ valid: false, reason: 'pathNotFound' })
        }
        logger.error('[Settings] Failed to validate browser profile path:', error)
      }
    }

    void validateProfilePath()

    return () => {
      isActive = false
    }
  }, [browserForCookiesValue, browserCookiesProfileValue, hasBrowserProfileValue])

  const handleLanguageChange = async (value: LanguageCode) => {
    if (activeLanguageCode === value) {
      return
    }

    await saveSetting({ key: 'language', value })
    await i18nInstance.changeLanguage(value)
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
            setActiveTab(value)
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
                  <ItemTitle>{t('settings.embedSubs')}</ItemTitle>
                  <ItemDescription>{t('settings.embedSubsDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.embedSubs ?? false}
                    onCheckedChange={(value) => {
                      try {
                        handleSettingChange('embedSubs', value)
                      } catch (error) {
                        logger.error('[Settings] Error toggling embedSubs:', error)
                      }
                    }}
                  />
                </ItemActions>
              </Item>

              <ItemSeparator />

              {platform !== 'darwin' && (
                <>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.embedThumbnail')}</ItemTitle>
                      <ItemDescription>{t('settings.embedThumbnailDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.embedThumbnail ?? false}
                        onCheckedChange={(value) => {
                          try {
                            handleSettingChange('embedThumbnail', value)
                          } catch (error) {
                            logger.error('[Settings] Error toggling embedThumbnail:', error)
                          }
                        }}
                      />
                    </ItemActions>
                  </Item>

                  <ItemSeparator />
                </>
              )}

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.embedMetadata')}</ItemTitle>
                  <ItemDescription>{t('settings.embedMetadataDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.embedMetadata ?? false}
                    onCheckedChange={(value) => {
                      try {
                        handleSettingChange('embedMetadata', value)
                      } catch (error) {
                        logger.error('[Settings] Error toggling embedMetadata:', error)
                      }
                    }}
                  />
                </ItemActions>
              </Item>

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.embedChapters')}</ItemTitle>
                  <ItemDescription>{t('settings.embedChaptersDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.embedChapters ?? true}
                    onCheckedChange={(value) => {
                      try {
                        handleSettingChange('embedChapters', value)
                      } catch (error) {
                        logger.error('[Settings] Error toggling embedChapters:', error)
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
                      return (
                        <Select
                          value={maxConcurrentStr}
                          onValueChange={(value) => {
                            try {
                              const numValue = Number(value)
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
                      return (
                        <Input
                          placeholder={t('settings.proxyPlaceholder')}
                          value={proxyValue}
                          onChange={(e) => {
                            try {
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
            </ItemGroup>

            <ItemGroup>
              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.browserForCookies')}</ItemTitle>
                  <ItemDescription>{t('settings.browserForCookiesDescription')}</ItemDescription>
                  {platform === 'win32' && (
                    <ItemDescription>{t('settings.browserForCookiesWindowsNote')}</ItemDescription>
                  )}
                </ItemContent>
                <ItemActions>
                  {(() => {
                    try {
                      return (
                        <Select
                          value={browserForCookiesValue}
                          onValueChange={(value) => {
                            try {
                              const nextValue = buildBrowserCookiesSetting(value, '')
                              handleSettingChange('browserForCookies', nextValue)
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
                            <SelectItem value="opera">
                              {t('settings.browserOptions.opera')}
                            </SelectItem>
                            <SelectItem value="vivaldi">
                              {t('settings.browserOptions.vivaldi')}
                            </SelectItem>
                            <SelectItem value="whale">
                              {t('settings.browserOptions.whale')}
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
                <ItemContent className="basis-full">
                  <ItemTitle>{t('settings.browserForCookiesProfile')}</ItemTitle>
                  <ItemDescription>
                    {t('settings.browserForCookiesProfileDescription')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="basis-full">
                  {(() => {
                    try {
                      return (
                        <div className="relative w-full">
                          <Input
                            placeholder={t('settings.browserForCookiesProfilePlaceholder')}
                            value={browserCookiesProfileValue}
                            onChange={(event) => {
                              try {
                                const newProfileValue = event.target.value
                                const nextValue = buildBrowserCookiesSetting(
                                  browserForCookiesValue,
                                  newProfileValue
                                )
                                handleSettingChange('browserForCookies', nextValue)
                              } catch (error) {
                                logger.error(
                                  '[Settings] Error changing browser cookies profile:',
                                  error
                                )
                              }
                            }}
                            disabled={browserForCookiesValue === 'none'}
                            className="w-full pr-10"
                          />
                          {showBrowserProfileCheck ? (
                            <CheckCircle2
                              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500"
                              aria-hidden
                            />
                          ) : null}
                          {showBrowserProfileWarning ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="absolute right-3 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center text-amber-500">
                                  <AlertTriangle className="h-4 w-4" aria-hidden />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {getBrowserProfileWarningMessage(browserProfileValidation.reason)}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      )
                    } catch (error) {
                      logger.error(
                        '[Settings] Error rendering browser cookies profile input:',
                        error
                      )
                      return <div>Error loading browser cookies profile setting</div>
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
                  <ItemTitle>{t('settings.enableAnalytics')}</ItemTitle>
                  <ItemDescription>{t('settings.enableAnalyticsDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  {(() => {
                    try {
                      const analyticsValue = settings.enableAnalytics ?? true
                      return (
                        <Switch
                          checked={analyticsValue}
                          onCheckedChange={(value) => {
                            try {
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
