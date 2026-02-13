interface VideoFormat {
  format_id?: string
  ext?: string
  format_note?: string
  resolution?: string
  width?: number
  height?: number
  fps?: number
  vcodec?: string
  acodec?: string
  filesize?: number
  filesize_approx?: number
  tbr?: number
}

interface VideoInfo {
  title?: string
  thumbnail?: string
  duration?: number
  formats?: VideoFormat[]
}

interface VideoInfoCacheEntry {
  url: string
  status: 'pending' | 'ready' | 'error'
  fetchedAt: number
  info?: VideoInfo
  error?: string
}

const PORT_RANGE_START = 27_100
const PORT_RANGE_END = 27_120
const STATUS_TIMEOUT_MS = 800
const INFO_TIMEOUT_MS = 60_000
const CACHE_TTL_MS = 5 * 60 * 1000

const pendingRequests = new Map<string, Promise<void>>()
const defaultIconPaths = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  128: 'icon/128.png'
}
const loadingIconPaths = {
  16: 'icon/icon-loading-16.png',
  32: 'icon/icon-loading-32.png',
  48: 'icon/icon-loading-48.png',
  128: 'icon/icon-loading-128.png'
}
const successIconPaths = {
  16: 'icon/icon-success-16.png',
  32: 'icon/icon-success-32.png',
  48: 'icon/icon-success-48.png',
  128: 'icon/icon-success-128.png'
}

const setActionIcon = (status: 'default' | 'loading' | 'success', tabId?: number): void => {
  const paths =
    status === 'loading'
      ? loadingIconPaths
      : status === 'success'
        ? successIconPaths
        : defaultIconPaths
  const options = tabId ? { path: paths, tabId } : { path: paths }
  void browser.action.setIcon(options)
}

const fetchJson = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'error' in data ? data.error : null
      const details = data && typeof data === 'object' && 'details' in data ? data.details : null
      const combined = [message, details].filter(Boolean).join('\n\n')
      throw new Error(combined || `Request failed: ${response.status}`)
    }
    return data as T
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out.')
    }
    if (error instanceof Error && error.message.includes('signal is aborted')) {
      throw new Error('Request timed out.')
    }
    if (error instanceof Error && error.message.includes('Failed to fetch')) {
      throw new Error('VidBee app not responding on this port.')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

const findAvailablePort = async (): Promise<number | null> => {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port += 1) {
    const baseUrl = `http://127.0.0.1:${port}`
    try {
      await fetchJson<{ ok: boolean }>(`${baseUrl}/status`, STATUS_TIMEOUT_MS)
      return port
    } catch {
      // Keep scanning.
    }
  }
  return null
}

const requestVideoInfo = async (targetUrl: string): Promise<VideoInfo> => {
  const port = await findAvailablePort()
  if (!port) {
    throw new Error('VidBee app not found on localhost.')
  }

  const baseUrl = `http://127.0.0.1:${port}`
  const tokenResponse = await fetchJson<{ token?: string }>(`${baseUrl}/token`, STATUS_TIMEOUT_MS)
  if (!tokenResponse.token) {
    throw new Error('Failed to acquire token from VidBee.')
  }

  return fetchJson<VideoInfo>(
    `${baseUrl}/video-info?url=${encodeURIComponent(targetUrl)}&token=${encodeURIComponent(
      tokenResponse.token
    )}`,
    INFO_TIMEOUT_MS
  )
}

const getCacheMap = async (): Promise<Record<string, VideoInfoCacheEntry>> => {
  const data = await browser.storage.local.get('videoInfoCacheByUrl')
  const map = data.videoInfoCacheByUrl as Record<string, VideoInfoCacheEntry> | undefined
  if (!map) {
    return {}
  }
  return map
}

const pruneCache = (map: Record<string, VideoInfoCacheEntry>): void => {
  const now = Date.now()
  for (const [key, entry] of Object.entries(map)) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      delete map[key]
    }
  }
}

const loadCache = async (url: string): Promise<VideoInfoCacheEntry | null> => {
  const map = await getCacheMap()
  pruneCache(map)
  const cache = map[url]
  if (!cache) {
    return null
  }
  return cache
}

const saveCacheEntry = async (cache: VideoInfoCacheEntry): Promise<void> => {
  const map = await getCacheMap()
  pruneCache(map)
  map[cache.url] = cache
  await browser.storage.local.set({ videoInfoCacheByUrl: map })
}

const fetchAndCache = async (url: string, tabId?: number): Promise<void> => {
  if (pendingRequests.has(url)) {
    return pendingRequests.get(url) as Promise<void>
  }

  const task = (async () => {
    const existing = await loadCache(url)
    if (existing?.status === 'ready') {
      setActionIcon('success', tabId)
      return
    }

    setActionIcon('loading', tabId)
    await saveCacheEntry({ url, status: 'pending', fetchedAt: Date.now() })

    try {
      const info = await requestVideoInfo(url)
      await saveCacheEntry({ url, status: 'ready', fetchedAt: Date.now(), info })
      setActionIcon('success', tabId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch video info.'
      await saveCacheEntry({ url, status: 'error', fetchedAt: Date.now(), error: message })
      setActionIcon('default', tabId)
    }
  })()

  pendingRequests.set(url, task)
  try {
    await task
  } finally {
    pendingRequests.delete(url)
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: { type?: string; url?: string }, sender) => {
    if (message.type !== 'video-info:fetch' || !message.url) {
      return
    }
    void fetchAndCache(message.url, sender.tab?.id)
  })
})
