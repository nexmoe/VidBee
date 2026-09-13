const MIXED_CONTENT =
  /^Mixed Content: The page at '([^']+)' was loaded over HTTPS, but requested an insecure \w+ '([^']+)'/i

interface RendererConsoleEvent {
  level: string
  message: string
}

interface MixedContentBurst {
  count: number
  page: string
  scheme: string
}

/** True for Chromium mixed-content warnings against a custom protocol. */
export function parseMixedContentWarning(message: string): { page: string; scheme: string } | null {
  const match = MIXED_CONTENT.exec(message)
  if (!match) {
    return null
  }
  try {
    const resource = new URL(match[2] ?? '')
    if (resource.protocol === 'http:' || resource.protocol === 'https:') {
      return null
    }
    return { page: match[1] ?? '', scheme: resource.protocol.slice(0, -1) }
  } catch {
    return null
  }
}

/** Unpackaged Electron security banners are expected in development. */
export function shouldIgnoreRendererConsoleMessage(message: string): boolean {
  return message.includes('Electron Security Warning')
}

/** One-line mixed-content digest for a page and scheme. */
export function formatMixedContentSummary(page: string, scheme: string, count: number): string {
  return `mixed content ×${count}  ${scheme}://  ${page}`
}

/**
 * Collapse renderer console noise so mixed-content thumbnail floods become one line.
 */
export function createRendererConsoleLogGate(
  write: (line: string) => void,
  burstMs = 400
): { flush: () => void; handle: (event: RendererConsoleEvent) => void } {
  const bursts = new Map<string, MixedContentBurst>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    for (const burst of bursts.values()) {
      write(formatMixedContentSummary(burst.page, burst.scheme, burst.count))
    }
    bursts.clear()
  }

  const handle = (event: RendererConsoleEvent): void => {
    if (event.level !== 'warning' && event.level !== 'error') {
      return
    }
    if (shouldIgnoreRendererConsoleMessage(event.message)) {
      return
    }
    const mixed = parseMixedContentWarning(event.message)
    if (!mixed) {
      write(event.message.replace(/\s+/g, ' ').trim())
      return
    }
    const key = `${mixed.page}\0${mixed.scheme}`
    const current = bursts.get(key)
    if (current) {
      current.count += 1
    } else {
      bursts.set(key, { count: 1, page: mixed.page, scheme: mixed.scheme })
    }
    timer ??= setTimeout(flush, burstMs)
  }

  return { flush, handle }
}
