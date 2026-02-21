import { TitleBar as SharedTitleBar } from '@vidbee/ui/components/ui/title-bar'
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

  return (
    <SharedTitleBar
      icons={{
        close: IconFluentDismiss20Regular,
        maximize: IconFluentMaximize20Regular,
        minimize: IconFluentSubtract20Regular,
        restore: IconFluentSquareMultiple20Regular
      }}
      isMaximized={isMaximized}
      onClose={() => ipcServices.window.close()}
      onMaximize={() => ipcServices.window.maximize()}
      onMinimize={() => ipcServices.window.minimize()}
      platform={platform}
    />
  )
}
