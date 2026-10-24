import { RemoteImage } from '@renderer/components/ui/remote-image'
import { AgentResponse, type ResponseProps } from '@vidbee/ui/components/agent-response'
import { useTheme } from 'next-themes'
import { type ComponentProps, memo } from 'react'
import type { ExtraProps } from 'streamdown'

export type { ResponseProps } from '@vidbee/ui/components/agent-response'

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
export const Response = memo(function Response({ plugins, components, ...props }: ResponseProps) {
  const { resolvedTheme } = useTheme()
  return (
    <AgentResponse
      {...props}
      components={{ img: MarkdownImg, ...components }}
      plugins={plugins}
      theme={resolvedTheme}
    />
  )
})
