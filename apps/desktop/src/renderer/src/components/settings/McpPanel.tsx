import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle
} from '@renderer/components/ui/item'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { ipcServices } from '@renderer/lib/ipc'
import { logger } from '@renderer/lib/logger'
import type { DesktopMcpCapabilityGroup, DesktopMcpStatus } from '@shared/mcp'
import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { McpCapabilities } from './McpCapabilities'

/** Configure external access with the same settings rows and controls as the rest of Desktop. */
export function McpPanel() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<DesktopMcpStatus | null>(null)
  const [capabilities, setCapabilities] = useState<DesktopMcpCapabilityGroup[]>([])
  const [transport, setTransport] = useState('http')
  const [configOpen, setConfigOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let disposed = false
    void Promise.all([ipcServices.mcp.getStatus(), ipcServices.mcp.getCapabilities()])
      .then(([next, groups]) => {
        if (!disposed) {
          setStatus(next)
          setCapabilities(groups)
        }
      })
      .catch((error) => {
        logger.error('Failed to load MCP settings:', error)
        if (!disposed) {
          toast.error(t('settings.mcp.error'))
        }
      })
    return () => {
      disposed = true
    }
  }, [t])

  /** Persist an explicit access change or revoke the current token. */
  async function update(enabled?: boolean) {
    setBusy(true)
    try {
      const next =
        enabled === undefined
          ? await ipcServices.mcp.rotateToken()
          : await ipcServices.mcp.setEnabled(enabled)
      setStatus(next)
    } catch (error) {
      logger.error('Failed to update MCP access:', error)
      toast.error(t('settings.mcp.error'))
    } finally {
      setBusy(false)
    }
  }

  const config = (transport === 'http' ? status?.httpConfig : status?.stdioConfig) ?? ''
  const transportLabel = transport === 'http' ? 'Streamable HTTP' : 'stdio'

  /** Copy the selected connection configuration only after an explicit user action. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(config)
      toast.success(t('settings.mcp.copied'))
    } catch (error) {
      logger.error('Failed to copy MCP configuration:', error)
      toast.error(t('settings.mcp.error'))
    }
  }

  return (
    <div className="space-y-6" data-testid="mcp-settings">
      <ItemGroup>
        <Item variant="muted">
          <ItemContent className="min-w-0">
            <ItemTitle>
              {t('settings.mcp.enable')}
              {status && (
                <Badge aria-live="polite" data-testid="mcp-status" variant="secondary">
                  {status.running
                    ? t('settings.mcp.running', { count: status.toolCount })
                    : t('settings.mcp.stopped')}
                </Badge>
              )}
            </ItemTitle>
            <ItemDescription>{t('settings.mcp.description')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch
              checked={status?.enabled ?? false}
              className="p-0 [&>span:last-child]:sr-only"
              disabled={!status || busy}
              label={t('settings.mcp.enable')}
              onToggle={() => void update(!status?.enabled)}
            />
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t('settings.mcp.transport')}</ItemTitle>
            <ItemDescription>{t('settings.mcp.transportDescription')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Select onValueChange={setTransport} value={transport}>
              <SelectTrigger aria-label={t('settings.mcp.transport')} className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">{t('settings.mcp.httpRecommended')}</SelectItem>
                <SelectItem value="stdio">stdio</SelectItem>
              </SelectContent>
            </Select>
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t('settings.mcp.configuration')}</ItemTitle>
            <ItemDescription>{t(`settings.mcp.${transport}Description`)}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              disabled={!status || busy}
              onClick={() => setConfigOpen(true)}
              variant="outline"
            >
              {t('settings.mcp.viewConfig')}
            </Button>
            <Button
              aria-label={t('settings.mcp.copy', { transport: transportLabel })}
              disabled={!status?.running || busy}
              onClick={() => void copy()}
            >
              <Copy aria-hidden className="size-4" />
              {t('settings.mcp.copy', { transport: transportLabel })}
            </Button>
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t('settings.mcp.endpoint')}</ItemTitle>
            <ItemDescription>{t('settings.mcp.endpointDescription')}</ItemDescription>
          </ItemContent>
          <ItemActions className="w-full sm:w-auto">
            <Input
              aria-label={t('settings.mcp.endpoint')}
              className="sm:w-72"
              readOnly
              value={status?.url ?? ''}
            />
          </ItemActions>
        </Item>
        <ItemSeparator />
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{t('settings.mcp.accessToken')}</ItemTitle>
            <ItemDescription>{t('settings.mcp.rotateDescription')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button disabled={!status || busy} onClick={() => void update()} variant="outline">
              {t('settings.mcp.rotate')}
            </Button>
          </ItemActions>
        </Item>
      </ItemGroup>
      <McpCapabilities groups={capabilities} loading={!status} />
      <Dialog onOpenChange={setConfigOpen} open={configOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('settings.mcp.configuration')}</DialogTitle>
            <DialogDescription>{t('settings.mcp.configDescription')}</DialogDescription>
          </DialogHeader>
          <pre
            className="max-h-[50vh] overflow-auto rounded-md bg-muted/40 p-4 font-mono text-xs leading-relaxed"
            data-testid={`mcp-${transport}-config`}
          >
            {config}
          </pre>
          <p className="text-muted-foreground text-sm">{t('settings.mcp.accessNote')}</p>
          <DialogFooter>
            <Button disabled={!status?.running || busy} onClick={() => void copy()}>
              <Copy aria-hidden className="size-4" />
              {t('settings.mcp.copy', { transport: transportLabel })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
