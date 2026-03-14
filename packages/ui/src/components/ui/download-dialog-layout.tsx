import { List, Rocket, Video } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './button'
import { Dialog, DialogContent, DialogFooter, DialogHeader } from './dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

interface DownloadDialogLayoutProps {
  open: boolean
  lockDialogHeight: boolean
  oneClickDownloadEnabled: boolean
  oneClickTooltip: string
  activeTab: 'single' | 'playlist'
  singleTabLabel: string
  playlistTabLabel: string
  addUrlPopover: ReactNode
  singleTabContent: ReactNode
  playlistTabContent: ReactNode
  footer: ReactNode
  onOpenChange: (open: boolean) => void
  onToggleOneClickDownload: () => void
  onActiveTabChange: (tab: 'single' | 'playlist') => void
}

export const DownloadDialogLayout = ({
  open,
  lockDialogHeight,
  oneClickDownloadEnabled,
  oneClickTooltip,
  activeTab,
  singleTabLabel,
  playlistTabLabel,
  addUrlPopover,
  singleTabContent,
  playlistTabContent,
  footer,
  onOpenChange,
  onToggleOneClickDownload,
  onActiveTabChange
}: DownloadDialogLayoutProps) => {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <div className="flex items-center gap-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative">
              <Button
                className="rounded-full"
                onClick={onToggleOneClickDownload}
                size="icon"
                variant="ghost"
              >
                <Rocket className="h-4 w-4 text-muted-foreground" />
              </Button>
              <span
                className={`absolute top-0 -right-2 inline-flex h-3.5 items-center justify-center whitespace-nowrap rounded-full px-1 font-semibold text-xs leading-none ${oneClickDownloadEnabled ? 'bg-being-green-400 text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}
              >
                {oneClickDownloadEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs" side="bottom">
            {oneClickTooltip}
          </TooltipContent>
        </Tooltip>
        {addUrlPopover}
      </div>
      <DialogContent
        className={cn(
          'flex max-h-[90vh] flex-col gap-0 overflow-hidden p-5 sm:max-w-xl',
          lockDialogHeight && 'h-[90vh]'
        )}
      >
        <Tabs
          className="flex min-h-0 w-full flex-1 flex-col gap-0"
          defaultValue="single"
          onValueChange={(value) => onActiveTabChange(value as 'single' | 'playlist')}
          value={activeTab}
        >
          <DialogHeader>
            <TabsList>
              <TabsTrigger onClick={() => onActiveTabChange('single')} value="single">
                <Video className="h-3.5 w-3.5" />
                {singleTabLabel}
              </TabsTrigger>
              <TabsTrigger onClick={() => onActiveTabChange('playlist')} value="playlist">
                <List className="h-3.5 w-3.5" />
                {playlistTabLabel}
              </TabsTrigger>
            </TabsList>
          </DialogHeader>
          <TabsContent className="mt-0 flex min-h-0 flex-1 flex-col" value="single">
            {singleTabContent}
          </TabsContent>
          <TabsContent className="mt-0 flex min-h-0 flex-1 flex-col" value="playlist">
            {playlistTabContent}
          </TabsContent>
        </Tabs>
        <DialogFooter className="relative z-10 shrink-0 border-t bg-background pt-3">
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
