import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { useAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcServices } from '../../lib/ipc'
import { settingsAtom } from '../../store/settings'

interface AdvancedOptionsProps {
  startTime: string
  endTime: string
  downloadSubs: boolean
  onStartTimeChange: (value: string) => void
  onEndTimeChange: (value: string) => void
  onDownloadSubsChange: (value: boolean) => void
  customDownloadPath: string
  onCustomDownloadPathChange: (value: string) => void
}

export function AdvancedOptions({
  startTime,
  endTime,
  downloadSubs,
  onStartTimeChange,
  onEndTimeChange,
  onDownloadSubsChange,
  customDownloadPath,
  onCustomDownloadPathChange
}: AdvancedOptionsProps) {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)

  const handleSelectLocation = async () => {
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        await ipcServices.settings.set('downloadPath', path)
        toast.success(t('notifications.settingsSaved'))
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
      toast.error(t('settings.directorySelectError'))
    }
  }

  const handleSelectCustomLocation = async () => {
    try {
      const path = await ipcServices.fs.selectDirectory()
      if (path) {
        onCustomDownloadPathChange(path)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
      toast.error(t('settings.directorySelectError'))
    }
  }

  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="advanced">
        <AccordionTrigger>{t('advancedOptions.title')}</AccordionTrigger>
        <AccordionContent className="space-y-4">
          {/* Time Range */}
          <div className="space-y-2">
            <Label>{t('advancedOptions.timeRange')}</Label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  placeholder={t('advancedOptions.startPlaceholder')}
                  value={startTime}
                  onChange={(e) => onStartTimeChange(e.target.value)}
                  title={t('advancedOptions.startHint')}
                />
              </div>
              <span className="text-muted-foreground">-</span>
              <div className="flex-1">
                <Input
                  placeholder={t('advancedOptions.endPlaceholder')}
                  value={endTime}
                  onChange={(e) => onEndTimeChange(e.target.value)}
                  title={t('advancedOptions.endHint')}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('advancedOptions.startHint')}</p>
          </div>

          {/* Subtitles */}
          <div className="flex items-center justify-between">
            <Label>{t('advancedOptions.downloadSubs')}</Label>
            <Switch checked={downloadSubs} onCheckedChange={onDownloadSubsChange} />
          </div>

          {/* Download Location */}
          <div className="space-y-2">
            <Label>{t('advancedOptions.downloadLocation')}</Label>
            <div className="flex items-center gap-2">
              <Input value={settings.downloadPath} readOnly className="flex-1" />
              <Button onClick={handleSelectLocation} variant="outline">
                {t('settings.selectPath')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>{t('download.customDownloadFolder')}</Label>
              {customDownloadPath.trim() && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCustomDownloadPathChange('')}
                >
                  {t('download.useAutoFolder')}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={customDownloadPath}
                readOnly
                className="flex-1"
                placeholder={t('download.autoFolderPlaceholder')}
              />
              <Button onClick={handleSelectCustomLocation} variant="outline">
                {t('settings.selectPath')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('download.autoFolderHint')}</p>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
