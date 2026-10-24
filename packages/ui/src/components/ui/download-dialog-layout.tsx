import { List, Video } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import { cn } from '../../lib/cn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './dialog'
import { TabItem, TabPanel, Tabs, TabsList } from './tabs'

/** Chip/list/button radius for the download dialog — never larger than rounded-md. */
export const downloadDialogRadius = 'rounded-md'

interface DownloadDialogLayoutProps {
  contentRef?: Ref<HTMLDivElement>
  open: boolean
  lockDialogHeight: boolean
  tabsDisabled?: boolean
  activeTab: 'single' | 'playlist'
  dialogTitle: string
  dialogSubtitle: string
  singleTabLabel: string
  playlistTabLabel: string
  addUrlPopover: ReactNode
  singleTabContent: ReactNode
  playlistTabContent: ReactNode
  footer: ReactNode
  onOpenChange: (open: boolean) => void
  onActiveTabChange: (tab: 'single' | 'playlist') => void
}

/**
 * Download dialog chrome modeled on a title / chips / preview / footer card.
 */
export const DownloadDialogLayout = ({
  contentRef,
  open,
  lockDialogHeight,
  tabsDisabled,
  activeTab,
  dialogTitle,
  dialogSubtitle,
  singleTabLabel,
  playlistTabLabel,
  addUrlPopover,
  singleTabContent,
  playlistTabContent,
  footer,
  onOpenChange,
  onActiveTabChange
}: DownloadDialogLayoutProps) => {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {addUrlPopover}
      <DialogContent
        className={cn(
          'flex max-h-[90vh] flex-col gap-0 overflow-hidden rounded-md p-6 sm:max-w-lg',
          lockDialogHeight && 'min-h-[24rem]'
        )}
        ref={contentRef}
      >
        <DialogHeader className="items-start space-y-1.5 pr-8 text-left">
          <DialogTitle className="text-xl leading-tight">{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogSubtitle}</DialogDescription>
        </DialogHeader>

        <Tabs
          className="flex min-h-0 w-full flex-col"
          defaultValue="single"
          onValueChange={(value) => onActiveTabChange(value as 'single' | 'playlist')}
          size="compact"
          value={activeTab}
        >
          <div className="mt-3 border-border/60 border-t pt-3">
            <TabsList className={cn('w-fit', downloadDialogRadius, '[&>div]:rounded-md')}>
              <TabItem disabled={tabsDisabled} icon={Video} label={singleTabLabel} value="single" />
              <TabItem
                disabled={tabsDisabled}
                icon={List}
                label={playlistTabLabel}
                value="playlist"
              />
            </TabsList>
          </div>
          <TabPanel className="min-h-0 pt-3 [&[hidden]]:hidden" value="single">
            {singleTabContent}
          </TabPanel>
          <TabPanel className="min-h-0 pt-3 [&[hidden]]:hidden" value="playlist">
            {playlistTabContent}
          </TabPanel>
        </Tabs>
        <DialogFooter className="relative z-10 mt-3 shrink-0 border-border/60 border-t pt-3">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
