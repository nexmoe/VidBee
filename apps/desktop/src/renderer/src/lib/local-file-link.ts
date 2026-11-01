interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
}

/** Decode a Markdown destination once, retaining literal invalid percent sequences. */
function decodeFilePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Resolve absolute local destinations without treating web URLs as filesystem paths. */
export function parseLocalFileLink(href: string | undefined): {
  path: string
  href: string
  markdownHref: string
} | null {
  if (!href) {
    return null
  }
  try {
    let url: URL
    if (/^file:/i.test(href)) {
      url = new URL(href)
    } else {
      const windowsPath = /^\/?[a-z]:[\\/]/i.test(href)
      if (!(windowsPath || (href.startsWith('/') && !href.startsWith('//')))) {
        return null
      }
      const decoded = decodeFilePath(href)
      const normalized = windowsPath ? decoded.replace(/\\/g, '/') : decoded
      const encoded = encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')
      url = new URL(`${normalized.startsWith('/') ? 'file://' : 'file:///'}${encoded}`)
    }
    if (url.hostname) {
      return null
    }
    return {
      path: decodeFilePath(url.pathname).replace(/^\/([a-z]:\/)/i, '$1'),
      href: url.href,
      markdownHref: url.pathname
    }
  } catch {
    return null
  }
}

/** Preserve local Markdown links through the standard web URL sanitizer. */
export function remarkDesktopFileLinks() {
  /** Normalize link destinations and reference definitions before HTML conversion. */
  function transform(node: MarkdownNode): void {
    if ((node.type === 'link' || node.type === 'definition') && node.url) {
      const local = parseLocalFileLink(node.url)
      if (local) {
        node.url = local.markdownHref
      } else if (node.url.startsWith('//')) {
        node.url = `https:${node.url}`
      }
    }
    for (const child of node.children ?? []) {
      transform(child)
    }
  }
  return transform
}
