import { Copy, Maximize2, Minus, X } from 'lucide-react'
import type * as React from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'

interface TitleBarProps {
  platform?: string
  isMaximized?: boolean
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
  className?: string
  icons?: {
    minimize?: React.ComponentType<{ className?: string }>
    maximize?: React.ComponentType<{ className?: string }>
    restore?: React.ComponentType<{ className?: string }>
    close?: React.ComponentType<{ className?: string }>
  }
}

export function TitleBar({
  platform,
  isMaximized = false,
  onMinimize,
  onMaximize,
  onClose,
  className,
  icons
}: TitleBarProps) {
  const MinimizeIcon = icons?.minimize ?? Minus
  const MaximizeIcon = icons?.maximize ?? Maximize2
  const RestoreIcon = icons?.restore ?? Copy
  const CloseIcon = icons?.close ?? X

  const isMac = platform === 'darwin'
  const containerClass = cn(
    'flex drag-region bg-background select-none',
    isMac ? 'h-10 items-center px-4' : 'justify-end px-5 pt-4',
    className
  )

  if (isMac) {
    return <div className={containerClass} />
  }

  return (
    <div className={containerClass}>
      <div className="no-drag flex items-center gap-1">
        <Button
          className="h-8 w-8 hover:bg-muted"
          disabled={!onMinimize}
          onClick={onMinimize}
          size="icon"
          variant="ghost"
        >
          <MinimizeIcon className="h-4 w-4" />
        </Button>
        <Button
          className="h-8 w-8 hover:bg-muted"
          disabled={!onMaximize}
          onClick={onMaximize}
          size="icon"
          variant="ghost"
        >
          {isMaximized ? <RestoreIcon className="h-4 w-4" /> : <MaximizeIcon className="h-4 w-4" />}
        </Button>
        <Button
          className="h-8 w-8 hover:bg-red-500 hover:text-white"
          disabled={!onClose}
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export type { TitleBarProps }
