import { Button } from '@renderer/components/ui/button'
import { useEffect, useState } from 'react'
import IconFluentDismiss20Regular from '~icons/fluent/dismiss-20-regular'
import IconFluentMaximize20Regular from '~icons/fluent/maximize-20-regular'
import IconFluentSquareMultiple20Regular from '~icons/fluent/square-multiple-20-regular'
import IconFluentSubtract20Regular from '~icons/fluent/subtract-20-regular'
import { ipcEvents, ipcServices } from '../../lib/ipc'
import '../../assets/title-bar.css'

interface TitleBarProps {
  platform?: string
}

export function TitleBar({ platform }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Listen for window maximize state changes
    const handleMaximized = () => {
      setIsMaximized(true)
    }

    const handleUnmaximized = () => {
      setIsMaximized(false)
    }

    ipcEvents.on('window-maximized', handleMaximized)
    ipcEvents.on('window-unmaximized', handleUnmaximized)

    return () => {
      ipcEvents.removeListener('window-maximized', handleMaximized)
      ipcEvents.removeListener('window-unmaximized', handleUnmaximized)
    }
  }, [])

  const handleMinimize = () => {
    ipcServices.window.minimize()
  }

  const handleMaximize = () => {
    ipcServices.window.maximize()
  }

  const handleClose = () => {
    ipcServices.window.close()
  }

  const isMac = platform === 'darwin'
  const containerClass = `flex drag-region bg-background select-none ${
    isMac ? 'h-10 items-center px-4' : 'justify-end pt-4 px-5'
  }`

  if (isMac) {
    return <div className={containerClass} />
  }

  return (
    <div className={containerClass}>
      {/* Window controls */}
      <div className="no-drag flex items-center gap-1">
        <Button
          className="h-8 w-8 hover:bg-muted"
          onClick={handleMinimize}
          size="icon"
          variant="ghost"
        >
          <IconFluentSubtract20Regular className="h-4 w-4" />
        </Button>
        <Button
          className="h-8 w-8 hover:bg-muted"
          onClick={handleMaximize}
          size="icon"
          variant="ghost"
        >
          {isMaximized ? (
            <IconFluentSquareMultiple20Regular className="h-4 w-4" />
          ) : (
            <IconFluentMaximize20Regular className="h-4 w-4" />
          )}
        </Button>
        <Button
          className="h-8 w-8 hover:bg-red-500 hover:text-white"
          onClick={handleClose}
          size="icon"
          variant="ghost"
        >
          <IconFluentDismiss20Regular className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
