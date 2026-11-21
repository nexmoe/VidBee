import { RemoteImage } from '@renderer/components/ui/remote-image'
import { ipcServices } from '@renderer/lib/ipc'
import { parseLocalFileLink, remarkDesktopFileLinks } from '@renderer/lib/local-file-link'
import { cn } from '@renderer/lib/utils'
import { AgentResponse, type ResponseProps } from '@vidbee/ui/components/agent-response'
import { useTheme } from 'next-themes'
import { type ComponentProps, type MouseEvent, memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { defaultRemarkPlugins, type ExtraProps } from 'streamdown'

export type { ResponseProps } from '@vidbee/ui/components/agent-response'

/** Open local Markdown destinations with the system app while retaining ordinary web links. */
function MarkdownLink({
  children,
  className,
  href,
  node: _node,
  onClick,
  ...props
}: ComponentProps<'a'> & ExtraProps) {
  const { t } = useTranslation()
  const local = parseLocalFileLink(href)

  /** Prevent browser navigation and report missing files or native open failures. */
  async function openFile(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
    onClick?.(event)
    if (event.defaultPrevented || event.button > 1 || !local) {
      return
    }
    event.preventDefault()
    try {
      if (await ipcServices.fs.openFile(local.path)) {
        return
      }
    } catch {
      // Native IPC failures use the same translated notification as missing files.
    }
    toast.error(t('notifications.openFileFailed'))
  }

  return (
    <a
      {...props}
      className={cn('wrap-anywhere font-medium text-primary underline', className)}
      data-streamdown="link"
      href={local?.href ?? href}
      onAuxClick={local ? openFile : props.onAuxClick}
      onClick={local ? openFile : onClick}
      rel="noopener noreferrer"
      target={local ? undefined : '_blank'}
    >
      {children}
    </a>
  )
}

/** Cache remote Markdown images through Desktop's native image proxy. */
function MarkdownImg({ alt, className, node: _node, src }: ComponentProps<'img'> & ExtraProps) {
  return (
    <RemoteImage
      alt={alt ?? ''}
      className={className}
      src={typeof src === 'string' ? src : undefined}
    />
  )
}

/** Bind the shared Markdown renderer to Desktop's image cache, theme and diagram plugins. */
export const Response = memo(function Response({
  plugins,
  components,
  remarkPlugins,
  ...props
}: ResponseProps) {
  const { resolvedTheme } = useTheme()
  const desktopRemarkPlugins = useMemo(
    () => [...(remarkPlugins ?? Object.values(defaultRemarkPlugins)), remarkDesktopFileLinks],
    [remarkPlugins]
  )
  return (
    <AgentResponse
      {...props}
      components={{ a: MarkdownLink, img: MarkdownImg, ...components }}
      plugins={plugins}
      remarkPlugins={desktopRemarkPlugins}
      theme={resolvedTheme}
    />
  )
})
