import { LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

/** Render the shared all-subscriptions view selector. */
export function SubscriptionAllTab({
  isActive,
  onSelect
}: {
  isActive: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()

  return (
    <button
      aria-pressed={isActive}
      className={cn(
        'flex h-auto w-20 shrink-0 grow-0 flex-col items-center gap-1 rounded-2xl px-2 py-2 transition-all hover:opacity-80',
        isActive && 'bg-muted/45'
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted">
        <LayoutGrid aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
      </div>
      <span className="w-full truncate text-center font-medium text-xs">
        {t('subscriptions.all')}
      </span>
    </button>
  )
}
