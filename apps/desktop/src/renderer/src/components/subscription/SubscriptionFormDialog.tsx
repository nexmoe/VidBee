import { ipcServices } from '@renderer/lib/ipc'
import { withDesktopUtm } from '@renderer/lib/url'
import { settingsAtom } from '@renderer/store/settings'
import { resolveFeedAtom } from '@renderer/store/subscriptions'
import type { SubscriptionRule } from '@shared/types'
import {
  SubscriptionFormDialog as SharedSubscriptionFormDialog,
  type SubscriptionFormData
} from '@vidbee/ui/components/subscription/subscription-form-dialog'
import { useAtom, useSetAtom } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { logger } from '../../lib/logger'

export type { SubscriptionFormData }

interface SubscriptionFormDialogProps {
  mode: 'add' | 'edit'
  subscription?: SubscriptionRule
  open: boolean
  onSave: (data: SubscriptionFormData) => Promise<void>
  onClose: () => void
}

/**
 * Desktop wrapper around the shared subscription form.
 */
export function SubscriptionFormDialog({
  mode,
  subscription,
  open,
  onSave,
  onClose
}: SubscriptionFormDialogProps) {
  const { t } = useTranslation()
  const [settings] = useAtom(settingsAtom)
  const resolveFeed = useSetAtom(resolveFeedAtom)

  const handleSelectDirectory = useCallback(async () => {
    try {
      return await ipcServices.fs.selectDirectory()
    } catch (error) {
      logger.error('Failed to select directory:', error)
      toast.error(t('subscriptions.notifications.directoryError'))
      return null
    }
  }, [t])

  const handleOpenRssDocs = useCallback(async () => {
    try {
      await ipcServices.fs.openExternal(withDesktopUtm('https://vidbee.org/docs/rss/'))
    } catch (error) {
      logger.error('Failed to open RSS documentation:', error)
      toast.error(t('subscriptions.notifications.openLinkError'))
    }
  }, [t])

  return (
    <SharedSubscriptionFormDialog
      downloadPath={settings.downloadPath}
      mode={mode}
      onClose={onClose}
      onlyLatestDefault={settings.subscriptionOnlyLatestDefault}
      onOpenRssDocs={handleOpenRssDocs}
      onResolveFeed={(url) => resolveFeed(url)}
      onSave={onSave}
      onSelectDirectory={handleSelectDirectory}
      open={open}
      subscription={subscription}
    />
  )
}
