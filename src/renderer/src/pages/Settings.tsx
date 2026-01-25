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
import type { CookiesSource, OneClickQualityPreset, SyncedCookiesSnapshot } from '@shared/types'
import dayjs from 'dayjs'
import { useAtom, useSetAtom } from 'jotai'
import { AlertTriangle, FileUp, Gem, Lock, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { toast } from 'sonner'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import { cn } from '../lib/utils'
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

const formatTimestamp = (value?: number) => {
  if (!value) return '-'
  return dayjs(value).format('YYYY-MM-DD HH:mm')
}

const extractMainDomain = (domain: string): string => {
  if (!domain) return ''

  // Remove leading dot
  domain = domain.replace(/^\./, '')

  // Split by dots
  const parts = domain.split('.')

  // Handle IP addresses
  if (/^\d+$/.test(parts[parts.length - 1])) {
    return domain
  }

  // Return the last two parts (e.g., example.com from www.example.com)
  if (parts.length > 2) {
    return parts.slice(-2).join('.')
  }

  return domain
}

export function Settings() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { theme, setTheme } = useTheme()
  const location = useLocation()
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

  // Cookie management state
  const [cookiesSnapshot, setCookiesSnapshot] = useState<SyncedCookiesSnapshot | null>(null)
  const [cookiesLoading, setCookiesLoading] = useState(false)
  const [cookiesImporting, setCookiesImporting] = useState(false)
  const [cookiesError, setCookiesError] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

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

  const handleOpenCookiesGuide = async () => {
    try {
      await ipcServices.fs.openExternal('https://docs.vidbee.org/cookies')
    } catch (error) {
      logger.error('Failed to open cookies guide:', error)
      toast.error(t('settings.openLinkError'))
    }
  }

  const handleOpenExtensionGuide = async () => {
    try {
      await ipcServices.fs.openExternal('https://docs.vidbee.org/extension')
    } catch (error) {
      logger.error('Failed to open extension guide:', error)
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

  // Cookie management functions
  const loadCookiesEntries = useCallback(async () => {
    setCookiesLoading(true)
    setCookiesError(null)
    try {
      const list = await ipcServices.syncedCookies.list()
      setCookiesSnapshot(list[0] ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cookiesPage.error')
      setCookiesError(message)
    } finally {
      setCookiesLoading(false)
    }
  }, [t])

  const handleImportCookies = useCallback(async () => {
    setCookiesImporting(true)
    try {
      const result = await ipcServices.syncedCookies.import()
      if (result) {
        toast.success(t('cookiesPage.import.success'), {
          description: t('cookiesPage.import.successDescription', { count: result.cookieCount })
        })
        setCookiesSnapshot(result)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cookiesPage.import.error')
      toast.error(t('cookiesPage.import.error'), {
        description: message
      })
    } finally {
      setCookiesImporting(false)
    }
  }, [t])

  const handleClearCookies = useCallback(() => {
    setShowClearConfirm(true)
  }, [])

  const handleConfirmClear = useCallback(async () => {
    try {
      await ipcServices.syncedCookies.clear()
      toast.success(t('cookiesPage.clear.success'))
      setCookiesSnapshot(null)
      setShowClearConfirm(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('cookiesPage.clear.error')
      toast.error(t('cookiesPage.clear.error'), {
        description: message
      })
    }
  }, [t])

  const languageOptions = languageList
  const activeLanguageCode = normalizeLanguageCode(i18nInstance.language)
  const currentLanguage =
    languageOptions.find((option) => option.value === activeLanguageCode) ?? languageOptions[0]
  const parsedBrowserCookies = parseBrowserCookiesSetting(settings.browserForCookies)
  const browserForCookiesValue = parsedBrowserCookies.browser
  const browserCookiesProfileValue = parsedBrowserCookies.profile
  const cookiesSource = settings.cookiesSource ?? 'browser'
  const normalizedBrowserCookiesSetting = buildBrowserCookiesSetting(
    browserForCookiesValue,
    browserCookiesProfileValue
  )
  const hasBrowserProfileValue = browserCookiesProfileValue.trim().length > 0
  const showBrowserProfileWarning =
    cookiesSource === 'browser' &&
    hasBrowserProfileValue &&
    !browserProfileValidation.valid &&
    browserProfileValidation.reason !== 'empty'
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
    const searchParams = new URLSearchParams(location.search)
    const tab = searchParams.get('tab')
    if (tab === 'general' || tab === 'advanced' || tab === 'cookies') {
      setActiveTab(tab)
    }
  }, [location.search])

  // Load cookies when switching to cookies tab
  useEffect(() => {
    if (activeTab === 'cookies' && cookiesSource === 'extension') {
      void loadCookiesEntries()
    }
  }, [activeTab, cookiesSource, loadCookiesEntries])

  useEffect(() => {
    if (cookiesSource !== 'browser') {
      lastAutoDetectBrowser.current = browserForCookiesValue
      return
    }

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
  }, [browserForCookiesValue, browserCookiesProfileValue, cookiesSource, handleSettingChange])

  useEffect(() => {
    if (cookiesSource !== 'browser') {
      setBrowserProfileValidation({ valid: false, reason: 'empty' })
      return
    }

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
  }, [browserForCookiesValue, browserCookiesProfileValue, cookiesSource, hasBrowserProfileValue])

  const handleLanguageChange = async (value: LanguageCode) => {
    if (activeLanguageCode === value) {
      return
    }

    await saveSetting({ key: 'language', value })
    await i18nInstance.changeLanguage(value)
  }

  const cookiesTotalSites = useMemo(() => {
    if (!cookiesSnapshot) return 0
    const domains = new Set<string>()
    for (const cookie of cookiesSnapshot.cookies) {
      const domain = extractMainDomain(cookie.domain ?? '')
      if (domain) {
        domains.add(domain)
      }
    }
    return domains.size
  }, [cookiesSnapshot])

  const cookiesIsEmpty =
    !cookiesLoading && !cookiesError && (!cookiesSnapshot || cookiesTotalSites === 0)

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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">{t('settings.general')}</TabsTrigger>
            <TabsTrigger value="cookies">{t('settings.cookiesTab')}</TabsTrigger>
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

              <ItemSeparator />

              <Item variant="muted">
                <ItemContent>
                  <ItemTitle>{t('settings.shareWatermark')}</ItemTitle>
                  <ItemDescription>{t('settings.shareWatermarkDescription')}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Switch
                    checked={settings.shareWatermark ?? false}
                    onCheckedChange={(value) => {
                      try {
                        handleSettingChange('shareWatermark', value)
                      } catch (error) {
                        logger.error('[Settings] Error toggling shareWatermark:', error)
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

          <TabsContent value="cookies" className="space-y-4 mt-2">
            {/* User Value Section */}
            <div className="rounded-lg bg-muted/40 p-4 border border-border/50">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/80 mb-3">
                {t('cookiesPage.valueTitle').replace(/[:：]\s*$/, '')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    key: 'private',
                    text: t('cookiesPage.valueList.privateVideos'),
                    desc: t('cookiesPage.valueList.privateVideosDescription'),
                    icon: <Lock className="h-4 w-4 text-muted-foreground/60" />
                  },
                  {
                    key: 'success',
                    text: t('cookiesPage.valueList.higherSuccess'),
                    desc: t('cookiesPage.valueList.higherSuccessDescription'),
                    icon: <ShieldCheck className="h-4 w-4 text-muted-foreground/60" />
                  },
                  {
                    key: 'unlock',
                    text: t('cookiesPage.valueList.unlockQuality'),
                    desc: t('cookiesPage.valueList.unlockQualityDescription'),
                    icon: <Gem className="h-4 w-4 text-muted-foreground/60" />
                  }
                ].map((item) => (
                  <div key={item.key} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {item.icon}
                      <h4 className="font-semibold text-xs uppercase tracking-tight text-foreground/90">
                        {item.text}
                      </h4>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-semibold">{t('settings.cookiesUsage')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('settings.cookiesUsageDescription')}
              </p>
            </div>

            <Tabs
              value={cookiesSource}
              onValueChange={(value) => {
                void handleSettingChange('cookiesSource', value as CookiesSource)
              }}
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="off">{t('settings.cookiesUsageOff')}</TabsTrigger>
                <TabsTrigger value="browser">{t('settings.cookiesUsageBrowser')}</TabsTrigger>
                <TabsTrigger value="extension">{t('settings.cookiesUsageExtension')}</TabsTrigger>
              </TabsList>

              <TabsContent value="off" className="space-y-4 mt-2">
                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.cookiesUsageOffTitle')}</ItemTitle>
                      <ItemDescription>{t('settings.cookiesUsageOffDescription')}</ItemDescription>
                    </ItemContent>
                  </Item>
                </ItemGroup>
              </TabsContent>

              <TabsContent value="browser" className="space-y-4 mt-2">
                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.browserForCookies')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.browserForCookiesDescription')}
                      </ItemDescription>
                      {platform === 'win32' && (
                        <ItemDescription className="text-red-500">
                          {t('settings.browserForCookiesWindowsNote')}
                        </ItemDescription>
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
                                  logger.error(
                                    '[Settings] Error changing browser for cookies:',
                                    error
                                  )
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
                          logger.error(
                            '[Settings] Error rendering browser for cookies select:',
                            error
                          )
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
                              {showBrowserProfileWarning ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="absolute right-3 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center text-amber-500">
                                      <AlertTriangle className="h-4 w-4" aria-hidden />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {getBrowserProfileWarningMessage(
                                      browserProfileValidation.reason
                                    )}
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
                </ItemGroup>

                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.cookiesHelpTitle')}</ItemTitle>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground text-sm leading-normal">
                        <li>{t('settings.cookiesHelpBrowser')}</li>
                        <li>{t('settings.cookiesHelpFile')}</li>
                      </ul>
                    </ItemContent>
                  </Item>

                  <ItemSeparator />

                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.cookiesGuideTitle')}</ItemTitle>
                      <ItemDescription>{t('settings.cookiesGuideDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="link" className="px-0" onClick={handleOpenCookiesGuide}>
                        {t('settings.cookiesGuideLink')}
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabsContent>

              <TabsContent value="extension" className="space-y-4 mt-2">
                {/* Synced Cookies Section */}
                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.syncedCookies') || 'Synced Cookies'}</ItemTitle>
                      {cookiesSnapshot ? (
                        <ItemDescription>
                          {t('cookiesPage.lastSyncedAt', {
                            time: formatTimestamp(cookiesSnapshot.createdAt)
                          })}
                          {' • '}
                          {cookiesTotalSites} {t('cookiesPage.labels.sites') || 'sites'}
                        </ItemDescription>
                      ) : (
                        <ItemDescription>{t('cookiesPage.empty')}</ItemDescription>
                      )}
                    </ItemContent>
                    <ItemActions className="gap-1 flex-wrap">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleImportCookies}
                            disabled={cookiesImporting || cookiesLoading}
                            className="h-8 px-2"
                          >
                            <FileUp className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('settings.syncedCookiesImportTooltip')}</TooltipContent>
                      </Tooltip>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadCookiesEntries}
                        disabled={cookiesLoading}
                        className={cn('h-8 px-2', cookiesLoading && 'animate-pulse')}
                      >
                        <RefreshCw
                          className={cn('h-3.5 w-3.5', cookiesLoading && 'animate-spin')}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearCookies}
                        disabled={cookiesLoading || cookiesIsEmpty}
                        className="h-8 px-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>

                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.syncedCookiesGuideTitle')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.syncedCookiesGuideDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="link" className="px-0" onClick={handleOpenExtensionGuide}>
                        {t('settings.syncedCookiesGuideLink')}
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>

                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.cookiesGuideTitle')}</ItemTitle>
                      <ItemDescription>{t('settings.cookiesGuideDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button variant="link" className="px-0" onClick={handleOpenCookiesGuide}>
                        {t('settings.cookiesGuideLink')}
                      </Button>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </div>

      {/* Clear Cookies Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cookiesPage.clear.confirmTitle')}</DialogTitle>
            <DialogDescription>{t('cookiesPage.clear.confirmMessage')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClearConfirm(false)}>
              {t('cookiesPage.clear.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleConfirmClear}>
              {t('cookiesPage.clear.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
