import { AccountPanel } from '@renderer/components/settings/AccountPanel'
import { AiPromptsPanel } from '@renderer/components/settings/AiPromptsPanel'
import { AiProvidersPanel } from '@renderer/components/settings/AiProvidersPanel'
import { AsrModelPicker } from '@renderer/components/settings/AsrModelPicker'
import { CookiesSetupPanel } from '@renderer/components/settings/CookiesSetupPanel'
import {
  SETTINGS_NAV_ITEMS,
  type SettingsNavTab,
  SettingsSectionNav
} from '@renderer/components/settings/SettingsSectionNav'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
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
import { TabItem, TabPanel, Tabs, TabsList } from '@renderer/components/ui/tabs'
import { TitleBar } from '@renderer/components/ui/title-bar'
import {
  type DownloadMirror,
  defaultSettings,
  type FilenameStyle,
  type OneClickContainerOption,
  type OneClickQualityPreset
} from '@shared/types'
import { useNavigate, useRouteContext, useSearch } from '@tanstack/react-router'
import {
  FILENAME_STYLE_PREVIEWS,
  FILENAME_STYLES,
  isFilenameStyle
} from '@vidbee/downloader-core/filename-style'
import {
  FOLLOW_INTERFACE_SUBTITLE_LANGUAGE,
  MAX_SUBTITLE_LANGUAGES
} from '@vidbee/downloader-core/subtitle-languages'
import { type LanguageCode, languageList, normalizeLanguageCode } from '@vidbee/i18n/languages'
import { DragRegion } from '@vidbee/ui/components/ui/drag-region'
import { SubtitleLanguagePicker } from '@vidbee/ui/components/ui/subtitle-language-picker'
import { WebmThumbnailNotice } from '@vidbee/ui/components/ui/webm-thumbnail-notice'
import { useAtom, useSetAtom } from 'jotai'
import { Film, Music } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import '../assets/title-bar.css'
import { ipcServices } from '../lib/ipc'
import { logger } from '../lib/logger'
import { loadSettingsAtom, saveSettingAtom, settingsAtom } from '../store/settings'

export function Settings() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { theme, setTheme } = useTheme()
  const { platform: chromePlatform } = useRouteContext({ from: '__root__' })
  const navigate = useNavigate({ from: '/settings' })
  const { tab: tabFromSearch } = useSearch({ from: '/settings' })
  const [settings, _setSettings] = useAtom(settingsAtom)
  const loadSettings = useSetAtom(loadSettingsAtom)
  const saveSetting = useSetAtom(saveSettingAtom)
  const [platform, setPlatform] = useState<string>('')
  const [activeTab, setActiveTab] = useState<string>('general')

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
  const subtitleLanguageOptions = [
    {
      label: t('settings.followInterfaceLanguage', { language: currentLanguage.name }),
      languageTag: currentLanguage.hreflang,
      value: FOLLOW_INTERFACE_SUBTITLE_LANGUAGE
    },
    ...languageOptions.map((option) => ({
      label: option.name,
      languageTag: option.hreflang,
      value: option.value
    }))
  ]

  useEffect(() => {
    if (tabFromSearch) {
      setActiveTab(tabFromSearch)
    }
  }, [tabFromSearch])

  /**
   * Switch the visible settings section and keep the URL tab in sync.
   *
   * @param tab Target settings section id.
   */
  const handleTabChange = useCallback(
    (tab: string) => {
      setActiveTab(tab)
      if (SETTINGS_NAV_ITEMS.some((item) => item.value === tab)) {
        void navigate({ search: { tab: tab as SettingsNavTab }, to: '/settings' })
      }
    },
    [navigate]
  )

  const handleLanguageChange = async (value: LanguageCode) => {
    if (activeLanguageCode === value) {
      return
    }

    await saveSetting({ key: 'language', value })
    await i18nInstance.changeLanguage(value)
  }

  const activeNavLabelKey =
    activeTab === 'account'
      ? 'settings.account.tab'
      : (SETTINGS_NAV_ITEMS.find((item) => item.value === activeTab)?.labelKey ??
        'settings.general')

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-border/60 border-r bg-muted/30">
        <DragRegion className="h-10 shrink-0" />
        <div className="px-6 pt-1 pb-4">
          <h1 className="pl-3 font-bold text-lg tracking-tight">{t('settings.title')}</h1>
        </div>
        <SettingsSectionNav activeTab={activeTab} onChange={handleTabChange} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {chromePlatform === 'darwin' ? (
          <DragRegion className="h-10 shrink-0" />
        ) : (
          <TitleBar className="h-10 shrink-0" platform={chromePlatform} />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 p-6">
            <div className="space-y-1">
              <h2 className="font-semibold text-2xl leading-tight">{t(activeNavLabelKey)}</h2>
            </div>
            <Tabs onValueChange={handleTabChange} value={activeTab}>
              <TabPanel className="space-y-4" value="account">
                <AccountPanel />
              </TabPanel>
              <TabPanel className="space-y-4" value="general">
                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.downloadPath')}</ItemTitle>
                      <ItemDescription>{t('settings.downloadPathDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <div className="flex w-full max-w-md gap-2">
                        <Input className="flex-1" readOnly value={settings.downloadPath} />
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
                        onValueChange={(value) =>
                          void handleThemeChange(value as 'light' | 'dark' | 'system')
                        }
                        value={theme ?? settings.theme ?? 'system'}
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
                        onValueChange={(value) => void handleLanguageChange(value as LanguageCode)}
                        value={currentLanguage.value}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder={currentLanguage.name}>
                            <span lang={currentLanguage.hreflang}>{currentLanguage.name}</span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {languageOptions.map((option) => {
                            const isActive = option.value === currentLanguage.value
                            return (
                              <SelectItem
                                className={isActive ? 'bg-muted font-semibold' : undefined}
                                key={option.value}
                                value={option.value}
                              >
                                <span lang={option.hreflang}>{option.name}</span>
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
                        label=""
                        onToggle={() =>
                          handleSettingChange('oneClickDownload', !settings.oneClickDownload)
                        }
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
                            onValueChange={(value) =>
                              handleSettingChange('oneClickDownloadType', value)
                            }
                            value={settings.oneClickDownloadType}
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
                            {t('settings.oneClickQualityDescription')}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Select
                            onValueChange={(value) =>
                              handleSettingChange('oneClickQuality', value as OneClickQualityPreset)
                            }
                            value={settings.oneClickQuality}
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
                      <ItemSeparator />
                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>{t('settings.oneClickContainer')}</ItemTitle>
                          <ItemDescription>
                            {t('settings.oneClickContainerDescription')}
                          </ItemDescription>
                          <WebmThumbnailNotice container={settings.oneClickContainer} />
                        </ItemContent>
                        <ItemActions>
                          <Select
                            onValueChange={(value) =>
                              handleSettingChange(
                                'oneClickContainer',
                                value as OneClickContainerOption
                              )
                            }
                            value={settings.oneClickContainer ?? 'auto'}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="auto">
                                {t('settings.oneClickContainerOptions.auto')}
                              </SelectItem>
                              <SelectItem value="mp4">
                                {t('settings.oneClickContainerOptions.mp4')}
                              </SelectItem>
                              <SelectItem value="mkv">
                                {t('settings.oneClickContainerOptions.mkv')}
                              </SelectItem>
                              <SelectItem value="webm">
                                {t('settings.oneClickContainerOptions.webm')}
                              </SelectItem>
                              <SelectItem value="original">
                                {t('settings.oneClickContainerOptions.original')}
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
                            label=""
                            onToggle={() =>
                              handleSettingChange('hideDockIcon', !settings.hideDockIcon)
                            }
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
                        disabled={!autoLaunchSupported}
                        label=""
                        onToggle={() =>
                          handleSettingChange('launchAtLogin', !settings.launchAtLogin)
                        }
                      />
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabPanel>

              <TabPanel className="space-y-4" value="metadata">
                <FilenameStylePicker
                  filenameViaVidBee={
                    settings.filenameViaVidBee ?? defaultSettings.filenameViaVidBee
                  }
                  onChange={(style) => handleSettingChange('filenameStyle', style)}
                  onFilenameViaVidBeeChange={(enabled) =>
                    handleSettingChange('filenameViaVidBee', enabled)
                  }
                  value={settings.filenameStyle}
                />

                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.downloadWithoutChannelSubfolders')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.downloadWithoutChannelSubfoldersDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.downloadWithoutChannelSubfolders ?? false}
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange(
                              'downloadWithoutChannelSubfolders',
                              !(settings.downloadWithoutChannelSubfolders ?? false)
                            )
                          } catch (error) {
                            logger.error(
                              '[Settings] Error changing downloadWithoutChannelSubfolders:',
                              error
                            )
                          }
                        }}
                      />
                    </ItemActions>
                  </Item>
                </ItemGroup>

                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.downloadSubtitles')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.downloadSubtitlesDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.downloadSubtitles}
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange('downloadSubtitles', !settings.downloadSubtitles)
                          } catch (error) {
                            logger.error('[Settings] Error toggling downloadSubtitles:', error)
                          }
                        }}
                      />
                    </ItemActions>
                  </Item>

                  {settings.downloadSubtitles && (
                    <>
                      <ItemSeparator />

                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>{t('settings.subtitleLanguages')}</ItemTitle>
                          <ItemDescription>
                            {t('settings.subtitleLanguagesDescription')}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <SubtitleLanguagePicker
                            ariaLabel={t('settings.subtitleLanguages')}
                            emptyLabel={t('settings.subtitleLanguageEmpty')}
                            limitLabel={t('settings.subtitleLanguageLimit', {
                              count: MAX_SUBTITLE_LANGUAGES
                            })}
                            maxSelections={MAX_SUBTITLE_LANGUAGES}
                            onValueChange={(values) =>
                              void handleSettingChange('subtitleLanguages', values)
                            }
                            options={subtitleLanguageOptions}
                            searchPlaceholder={t('settings.subtitleLanguageSearch')}
                            values={settings.subtitleLanguages}
                          />
                        </ItemActions>
                      </Item>

                      <ItemSeparator />

                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>{t('settings.writeAutoSubs')}</ItemTitle>
                          <ItemDescription>
                            {t('settings.writeAutoSubsDescription')}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Switch
                            checked={settings.writeAutoSubs ?? true}
                            label=""
                            onToggle={() => {
                              try {
                                handleSettingChange(
                                  'writeAutoSubs',
                                  !(settings.writeAutoSubs ?? true)
                                )
                              } catch (error) {
                                logger.error('[Settings] Error toggling writeAutoSubs:', error)
                              }
                            }}
                          />
                        </ItemActions>
                      </Item>

                      <ItemSeparator />

                      <Item variant="muted">
                        <ItemContent>
                          <ItemTitle>{t('settings.embedSubs')}</ItemTitle>
                          <ItemDescription>{t('settings.embedSubsDescription')}</ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Switch
                            checked={settings.embedSubs ?? false}
                            label=""
                            onToggle={() => {
                              try {
                                handleSettingChange('embedSubs', !(settings.embedSubs ?? false))
                              } catch (error) {
                                logger.error('[Settings] Error toggling embedSubs:', error)
                              }
                            }}
                          />
                        </ItemActions>
                      </Item>
                    </>
                  )}

                  <ItemSeparator />

                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.embedThumbnail')}</ItemTitle>
                      <ItemDescription>{t('settings.embedThumbnailDescription')}</ItemDescription>
                      <WebmThumbnailNotice container={settings.oneClickContainer} />
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.embedThumbnail ?? false}
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange(
                              'embedThumbnail',
                              !(settings.embedThumbnail ?? false)
                            )
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
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange('embedMetadata', !(settings.embedMetadata ?? false))
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
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange('embedChapters', !(settings.embedChapters ?? true))
                          } catch (error) {
                            logger.error('[Settings] Error toggling embedChapters:', error)
                          }
                        }}
                      />
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabPanel>

              <TabPanel className="space-y-4" value="providers">
                <AiProvidersPanel />
                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.agentManagementTools')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.agentManagementToolsDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Select
                        onValueChange={(value) => {
                          handleSettingChange(
                            'agentManagementTools',
                            value as 'off' | 'ask' | 'auto'
                          )
                        }}
                        value={settings.agentManagementTools ?? 'ask'}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(['off', 'ask', 'auto'] as const).map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {t(`settings.agentManagementToolsOptions.${mode}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ItemActions>
                  </Item>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.agentMaxConcurrentRuns')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.agentMaxConcurrentRunsDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Select
                        onValueChange={(value) => {
                          handleSettingChange('agentMaxConcurrentRuns', Number(value))
                        }}
                        value={String(settings.agentMaxConcurrentRuns ?? 2)}
                      >
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4].map((num) => (
                            <SelectItem key={num} value={num.toString()}>
                              {num}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabPanel>

              <TabPanel className="space-y-4" value="prompts">
                <AiPromptsPanel />
              </TabPanel>

              <TabPanel className="space-y-4" value="transcribe">
                <AsrModelPicker
                  activeTier={settings.asrTier ?? 'minimal'}
                  autoTranscribe={
                    settings.autoTranscribeAfterDownload ??
                    defaultSettings.autoTranscribeAfterDownload
                  }
                  concurrency={settings.maxConcurrentTranscriptions ?? 1}
                  onChangeConcurrency={(value) =>
                    handleSettingChange('maxConcurrentTranscriptions', value)
                  }
                  onSelectTier={(tier) => handleSettingChange('asrTier', tier)}
                  onToggleAutoTranscribe={() =>
                    handleSettingChange(
                      'autoTranscribeAfterDownload',
                      !(
                        settings.autoTranscribeAfterDownload ??
                        defaultSettings.autoTranscribeAfterDownload
                      )
                    )
                  }
                />
              </TabPanel>

              <TabPanel className="space-y-4" value="advanced">
                <ItemGroup>
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.shareWatermark')}</ItemTitle>
                      <ItemDescription>{t('settings.shareWatermarkDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.shareWatermark ?? false}
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange(
                              'shareWatermark',
                              !(settings.shareWatermark ?? false)
                            )
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
                              value={maxConcurrentStr}
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
                              className="w-64"
                              onChange={(e) => {
                                try {
                                  handleSettingChange('proxy', e.target.value)
                                } catch (error) {
                                  logger.error('[Settings] Error changing proxy:', error)
                                }
                              }}
                              placeholder={t('settings.proxyPlaceholder')}
                              value={proxyValue}
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
                      <ItemTitle>{t('settings.downloadMirror')}</ItemTitle>
                      <ItemDescription>{t('settings.downloadMirrorDescription')}</ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Select
                        onValueChange={(value) => {
                          handleSettingChange('downloadMirror', value as DownloadMirror)
                        }}
                        value={settings.downloadMirror ?? defaultSettings.downloadMirror}
                      >
                        <SelectTrigger className="w-52">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">{t('settings.downloadMirrorAuto')}</SelectItem>
                          <SelectItem value="cn">{t('settings.downloadMirrorChina')}</SelectItem>
                          <SelectItem value="global">
                            {t('settings.downloadMirrorGlobal')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
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
                            <div className="flex w-full max-w-md gap-2">
                              <Input className="flex-1" readOnly value={configPathValue} />
                              <Button onClick={handleSelectConfigFile}>
                                {t('settings.selectPath')}
                              </Button>
                              <Button
                                disabled={!configPathValue}
                                onClick={() => {
                                  try {
                                    void handleSettingChange('configPath', '')
                                  } catch (error) {
                                    logger.error('[Settings] Error clearing config path:', error)
                                  }
                                }}
                                variant="secondary"
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
                              label=""
                              onToggle={() => {
                                try {
                                  handleSettingChange('enableAnalytics', !analyticsValue)
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

                  <ItemSeparator />

                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.enableDownloadNotifications')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.enableDownloadNotificationsDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.enableDownloadNotifications ?? true}
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange(
                              'enableDownloadNotifications',
                              !(settings.enableDownloadNotifications ?? true)
                            )
                          } catch (error) {
                            logger.error(
                              '[Settings] Error changing enable download notifications:',
                              error
                            )
                          }
                        }}
                      />
                    </ItemActions>
                  </Item>

                  <ItemSeparator />

                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>{t('settings.rememberLastAudioLanguage')}</ItemTitle>
                      <ItemDescription>
                        {t('settings.rememberLastAudioLanguageDescription')}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={settings.rememberLastAudioLanguage ?? true}
                        label=""
                        onToggle={() => {
                          try {
                            handleSettingChange(
                              'rememberLastAudioLanguage',
                              !(settings.rememberLastAudioLanguage ?? true)
                            )
                          } catch (error) {
                            logger.error(
                              '[Settings] Error changing rememberLastAudioLanguage:',
                              error
                            )
                          }
                        }}
                      />
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabPanel>

              <TabPanel className="mt-2 space-y-4" value="cookies">
                <CookiesSetupPanel platform={platform} />
              </TabPanel>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Insert `via VidBee` before the preview file extension.
 *
 * @param fileName Preview filename with an extension.
 * @param enabled Whether the via VidBee suffix should be applied.
 * @returns The original preview, or the same name with `via VidBee` added.
 */
const formatFilenamePreview = (fileName: string, enabled: boolean): string => {
  if (!enabled || fileName.includes('via VidBee')) {
    return fileName
  }

  const lastDot = fileName.lastIndexOf('.')
  if (lastDot <= 0) {
    return `${fileName} via VidBee`
  }

  return `${fileName.slice(0, lastDot)} via VidBee${fileName.slice(lastDot)}`
}

/**
 * Segmented filename-style control with video and audio previews.
 *
 * @param props.value Current filename style from settings.
 * @param props.onChange Persist the selected style.
 * @param props.filenameViaVidBee Whether via VidBee is appended to filenames.
 * @param props.onFilenameViaVidBeeChange Persist the via VidBee toggle.
 */
const FilenameStylePicker = ({
  filenameViaVidBee,
  onChange,
  onFilenameViaVidBeeChange,
  value
}: {
  filenameViaVidBee: boolean
  onChange: (style: FilenameStyle) => void
  onFilenameViaVidBeeChange: (enabled: boolean) => void
  value?: FilenameStyle
}) => {
  const { t } = useTranslation()
  const selectedStyle = isFilenameStyle(value) ? value : 'pretty'
  const preview = FILENAME_STYLE_PREVIEWS[selectedStyle]

  return (
    <ItemGroup>
      <Item className="flex-col items-stretch gap-3" variant="muted">
        <ItemContent>
          <ItemTitle>{t('settings.filenameStyle')}</ItemTitle>
          <ItemDescription>{t('settings.filenameStyleDescription')}</ItemDescription>
        </ItemContent>
        <Tabs
          className="w-full"
          onValueChange={(style) => {
            if (isFilenameStyle(style)) {
              onChange(style)
            }
          }}
          value={selectedStyle}
        >
          <TabsList className="flex w-full">
            {FILENAME_STYLES.map((style) => (
              <TabItem
                className="flex-1 justify-center"
                key={style}
                label={t(`settings.filenameStyleOptions.${style}`)}
                value={style}
              />
            ))}
          </TabsList>
        </Tabs>
      </Item>

      <ItemSeparator />

      <Item variant="muted">
        <ItemMedia variant="icon">
          <Film />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="w-full min-w-0 max-w-full break-all font-medium">
            {formatFilenamePreview(preview.video, filenameViaVidBee)}
          </ItemTitle>
          <ItemDescription>{t('settings.filenameStylePreviewVideo')}</ItemDescription>
        </ItemContent>
      </Item>

      <ItemSeparator />

      <Item variant="muted">
        <ItemMedia variant="icon">
          <Music />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="w-full min-w-0 max-w-full break-all font-medium">
            {formatFilenamePreview(preview.audio, filenameViaVidBee)}
          </ItemTitle>
          <ItemDescription>{t('settings.filenameStylePreviewAudio')}</ItemDescription>
        </ItemContent>
      </Item>

      <ItemSeparator />

      <Item variant="muted">
        <ItemContent>
          <ItemTitle>{t('settings.filenameViaVidBee')}</ItemTitle>
          <ItemDescription>{t('settings.filenameViaVidBeeDescription')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={filenameViaVidBee}
            label=""
            onToggle={() => onFilenameViaVidBeeChange(!filenameViaVidBee)}
          />
        </ItemActions>
      </Item>

      <ItemSeparator />

      <Item variant="muted">
        <ItemContent>
          <ItemDescription className="line-clamp-none">
            {t('settings.filenameStyleNote')}
          </ItemDescription>
        </ItemContent>
      </Item>
    </ItemGroup>
  )
}
