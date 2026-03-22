import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { ipcServices } from '@renderer/lib/ipc'
import { updateReadyAtom } from '@renderer/store/update'
import { useAtomValue } from 'jotai'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function UpdateRestartNotice() {
  const updateReady = useAtomValue(updateReadyAtom)
  const { t } = useTranslation()

  if (!updateReady.ready) {
    return null
  }

  const message = updateReady.version
    ? t('about.notifications.updateDownloadedVersion', {
        version: updateReady.version
      })
    : t('about.notifications.updateDownloaded')

  const handleRestart = () => {
    void ipcServices.update.quitAndInstall()
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 w-[calc(100%-2rem)] max-w-sm sm:right-6 sm:bottom-6">
      <Card className="pointer-events-auto border-primary/30 bg-background/95 shadow-xl backdrop-blur">
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="font-medium text-sm">{message}</p>
          <Button className="gap-2 self-end" onClick={handleRestart} size="sm">
            <RefreshCw className="h-4 w-4" />
            {t('about.notifications.restartNowAction')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
