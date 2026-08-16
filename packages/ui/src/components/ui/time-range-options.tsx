import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from './input'
import { Label } from './label'

interface TimeRangeOptionsProps {
  endTime: string
  onEndTimeChange: (value: string) => void
  onStartTimeChange: (value: string) => void
  startTime: string
}

/** Render accessible start/end timecode controls shared by Desktop and Web. */
export function TimeRangeOptions({
  endTime,
  onEndTimeChange,
  onStartTimeChange,
  startTime
}: TimeRangeOptionsProps) {
  const { t } = useTranslation()
  const fieldId = useId()
  const startId = `${fieldId}-start`
  const endId = `${fieldId}-end`

  return (
    <fieldset className="w-full space-y-1.5">
      <legend className="px-0.5 font-medium text-muted-foreground text-xs">
        {t('advancedOptions.timeRange')}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground" htmlFor={startId}>
            {t('advancedOptions.start')}
          </Label>
          <Input
            autoComplete="off"
            className="h-8 text-xs tabular-nums"
            id={startId}
            onChange={(event) => onStartTimeChange(event.target.value)}
            placeholder={t('advancedOptions.startPlaceholder')}
            title={t('advancedOptions.startHint')}
            value={startTime}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground" htmlFor={endId}>
            {t('advancedOptions.end')}
          </Label>
          <Input
            autoComplete="off"
            className="h-8 text-xs tabular-nums"
            id={endId}
            onChange={(event) => onEndTimeChange(event.target.value)}
            placeholder={t('advancedOptions.endPlaceholder')}
            title={t('advancedOptions.endHint')}
            value={endTime}
          />
        </div>
      </div>
    </fieldset>
  )
}
