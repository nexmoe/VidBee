import { sanitizeTemplateInput } from '@vidbee/subscriptions-core/form'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from './input'
import { Label } from './label'

interface FilenameTemplateOptionsProps {
  onChange: (value: string) => void
  value: string
}

/** Render the optional per-job filename template shared by Desktop and Web. */
export function FilenameTemplateOptions({ onChange, value }: FilenameTemplateOptionsProps) {
  const { t } = useTranslation()
  const fieldId = useId()
  const hintId = `${fieldId}-hint`

  return (
    <div className="min-w-0 space-y-1">
      <Label className="font-medium text-muted-foreground text-xs" htmlFor={fieldId}>
        {t('subscriptions.fields.namingTemplate')}
      </Label>
      <Input
        aria-describedby={hintId}
        autoComplete="off"
        className="h-7 min-w-0 font-mono text-xs"
        id={fieldId}
        onChange={(event) => onChange(sanitizeTemplateInput(event.target.value))}
        placeholder="%(upload_date)s_%(id)s_%(title)s.%(ext)s"
        spellCheck={false}
        value={value}
      />
      <p className="text-muted-foreground text-xs" id={hintId}>
        {t('advancedOptions.filenameTemplateHint')}
      </p>
    </div>
  )
}
