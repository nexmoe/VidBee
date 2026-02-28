import { History as HistoryIcon } from 'lucide-react'
import { cn } from '../../lib/cn'

interface DownloadEmptyStateProps {
  message: string
  className?: string
}

export const DownloadEmptyState = ({ message, className }: DownloadEmptyStateProps) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-border/60 border-dashed px-6 py-10 text-center text-muted-foreground',
        className
      )}
    >
      <HistoryIcon className="h-10 w-10 opacity-50" />
      <p className="font-medium text-sm">{message}</p>
    </div>
  )
}
