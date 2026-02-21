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
        <Label className="ml-1 font-medium text-muted-foreground text-xs">
          {t('advancedOptions.timeRange')}
        </Label>
        <div className="flex items-center gap-4">
          <div className="group relative flex-1">
            <Input
              className="h-9 text-center"
              onChange={(e) => onStartTimeChange(e.target.value)}
              placeholder={t('advancedOptions.startPlaceholder')}
              title={t('advancedOptions.startHint')}
              value={startTime}
            />
          </div>
          <span className="text-muted-foreground text-xs">-</span>
          <div className="group relative flex-1">
            <Input
              className="h-9 text-center"
              onChange={(e) => onEndTimeChange(e.target.value)}
              placeholder={t('advancedOptions.endPlaceholder')}
              title={t('advancedOptions.endHint')}
              value={endTime}
            />
          </div>
        </div>
      </div>

      {/* Subtitles */}
      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="space-y-0.5">
          <Label className="font-semibold text-sm">{t('advancedOptions.downloadSubs')}</Label>
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
    <Accordion className="w-full" collapsible type="single">
      <AccordionItem className="border-b" value="advanced">
        <AccordionTrigger className="flex items-center gap-2 py-4 font-semibold text-sm hover:no-underline">
          <span className="flex-1 text-left">{t('advancedOptions.title')}</span>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-6">{content}</AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
