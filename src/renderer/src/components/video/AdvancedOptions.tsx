import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Switch } from '@renderer/components/ui/switch'
import { useTranslation } from 'react-i18next'

interface AdvancedOptionsProps {
  startTime: string
  endTime: string
  downloadSubs: boolean
  onStartTimeChange: (value: string) => void
  onEndTimeChange: (value: string) => void
  onDownloadSubsChange: (value: boolean) => void
  showAccordion?: boolean
}

export function AdvancedOptions({
  startTime,
  endTime,
  downloadSubs,
  onStartTimeChange,
  onEndTimeChange,
  onDownloadSubsChange,
  showAccordion = true
}: AdvancedOptionsProps) {
  const { t } = useTranslation()

  const content = (
    <div className="space-y-6">
      {/* Time Range */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground ml-1">
          {t('advancedOptions.timeRange')}
        </Label>
        <div className="flex items-center gap-4">
          <div className="flex-1 relative group">
            <Input
              placeholder={t('advancedOptions.startPlaceholder')}
              value={startTime}
              onChange={(e) => onStartTimeChange(e.target.value)}
              className="h-9 text-center"
              title={t('advancedOptions.startHint')}
            />
          </div>
          <span className="text-muted-foreground text-xs">-</span>
          <div className="flex-1 relative group">
            <Input
              placeholder={t('advancedOptions.endPlaceholder')}
              value={endTime}
              onChange={(e) => onEndTimeChange(e.target.value)}
              className="h-9 text-center"
              title={t('advancedOptions.endHint')}
            />
          </div>
        </div>
      </div>

      {/* Subtitles */}
      <div className="flex items-center justify-between p-3 border rounded-md bg-muted/30">
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">{t('advancedOptions.downloadSubs')}</Label>
          <p className="text-[11px] text-muted-foreground">
            {t('advancedOptions.downloadSubsHint')}
          </p>
        </div>
        <Switch checked={downloadSubs} onCheckedChange={onDownloadSubsChange} />
      </div>
    </div>
  )

  if (!showAccordion) {
    return content
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="advanced" className="border-b">
        <AccordionTrigger className="flex items-center gap-2 py-4 text-sm font-semibold hover:no-underline">
          <span className="flex-1 text-left">{t('advancedOptions.title')}</span>
        </AccordionTrigger>
        <AccordionContent className="pb-6 pt-2">{content}</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
