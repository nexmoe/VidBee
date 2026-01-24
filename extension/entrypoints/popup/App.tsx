import { useEffect, useMemo, useState } from 'react'
import './App.css'

type VideoFormat = {
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

type VideoInfo = {
  title?: string
  thumbnail?: string
  duration?: number
  formats?: VideoFormat[]
}

const CACHE_TTL_MS = 60 * 60 * 1000
const PORT_RANGE_START = 27100
const PORT_RANGE_END = 27120
const STATUS_TIMEOUT_MS = 800
const SYNC_TIMEOUT_MS = 15000

const t = (key: string, fallback: string): string => {
  const message = browser.i18n?.getMessage(key)
  return message || fallback
}

const fetchJson = async <T,>(url: string, timeoutMs: number, options?: RequestInit): Promise<T> => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs)

  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
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

const isValidHttpUrl = (value?: string): boolean => {
  if (!value) return false
  return value.startsWith('http://') || value.startsWith('https://')
}

const formatDuration = (value?: number): string => {
  if (!value || value <= 0) return 'Unknown'
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${minutes}:${paddedSeconds}`
}

const formatBytes = (value?: number): string => {
  if (!value || value <= 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

const isVideoFormat = (format: VideoFormat): boolean => {
  if (format.vcodec && format.vcodec !== 'none') {
    return true
  }
  return Boolean(format.resolution || format.width || format.height)
}

const isAudioFormat = (format: VideoFormat): boolean => {
  return Boolean(format.acodec && format.acodec !== 'none' && !isVideoFormat(format))
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

const requestToken = async (baseUrl: string): Promise<string> => {
  const response = await fetchJson<{ token?: string }>(`${baseUrl}/token`, STATUS_TIMEOUT_MS)
  if (!response.token) {
    throw new Error('Failed to acquire token from VidBee.')
  }
  return response.token
}

const syncCookiesToClient = async (payload: {
  cookies: Array<{
    domain?: string
    name?: string
    value?: string
    path?: string
    secure?: boolean
    httpOnly?: boolean
    sameSite?: string
    expirationDate?: number
  }>
}): Promise<void> => {
  const port = await findAvailablePort()
  if (!port) {
    throw new Error('VidBee app not found on localhost.')
  }

  const baseUrl = `http://127.0.0.1:${port}`
  const token = await requestToken(baseUrl)

  await fetchJson<{ ok: boolean }>(
    `${baseUrl}/cookies-sync?token=${encodeURIComponent(token)}`,
    SYNC_TIMEOUT_MS,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  )
}

const getCurrentCookieStoreId = async (): Promise<string | undefined> => {
  if (browser.runtime.getManifest().incognito === 'split') return undefined

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  const tabStoreId = (tab as browser.tabs.Tab & { cookieStoreId?: string }).cookieStoreId
  if (tabStoreId) return tabStoreId

  if (!tab?.id) return undefined
  const stores = await browser.cookies.getAllCookieStores()
  return stores.find((store) => store.tabIds.includes(tab.id as number))?.id
}

const getAllCookies = async (
  details: browser.cookies.GetAllDetails = {} as browser.cookies.GetAllDetails
): Promise<browser.cookies.Cookie[]> => {
  const detailsWithStore = { ...details } as browser.cookies.GetAllDetails
  if (!detailsWithStore.storeId) {
    const storeId = await getCurrentCookieStoreId()
    if (storeId) detailsWithStore.storeId = storeId
  }

  const { partitionKey, ...detailsWithoutPartitionKey } = detailsWithStore
  const cookiesWithPartitionKey = partitionKey
    ? await Promise.resolve()
        .then(() => browser.cookies.getAll(detailsWithStore))
        .catch(() => [])
    : []
  const cookies = await browser.cookies.getAll(detailsWithoutPartitionKey)
  return [...cookies, ...cookiesWithPartitionKey]
}

const getCookiesForUrl = async (url: URL): Promise<browser.cookies.Cookie[]> => {
  return getAllCookies({
    url: url.href,
    partitionKey: { topLevelSite: url.origin }
  } as browser.cookies.GetAllDetails)
}

const mapCookiesToNetscapeRows = (cookies: browser.cookies.Cookie[]): string[][] => {
  return cookies.map((cookie) => {
    const domain = cookie.domain ?? ''
    const includeSubDomain = domain.startsWith('.')
    const path = cookie.path ?? '/'
    const secure = cookie.secure ?? false
    const expiry = typeof cookie.expirationDate === 'number' ? cookie.expirationDate.toFixed() : '0'
    const name = cookie.name ?? ''
    const value = cookie.value ?? ''
    return [
      domain,
      includeSubDomain ? 'TRUE' : 'FALSE',
      path,
      secure ? 'TRUE' : 'FALSE',
      expiry,
      name,
      value
    ]
  })
}

const serializeCookiesAsNetscape = (cookies: browser.cookies.Cookie[]): string => {
  const lines = mapCookiesToNetscapeRows(cookies).map((row) => row.join('\t'))

  return [
    '# Netscape HTTP Cookie File',
    '# https://curl.haxx.se/rfc/cookie_spec.html',
    '# This is a generated file! Do not edit.',
    '',
    ...lines,
    ''
  ].join('\n')
}

const downloadTextFile = async (text: string, filename: string): Promise<void> => {
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)

  try {
    const downloadId = await browser.downloads.download({ url, filename })
    const handleChange = (delta: browser.downloads.DownloadDelta) => {
      if (delta.id === downloadId && delta.state?.current !== 'in_progress') {
        browser.downloads.onChanged.removeListener(handleChange)
        URL.revokeObjectURL(url)
      }
    }
    browser.downloads.onChanged.addListener(handleChange)
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

type VideoInfoCacheEntry = {
  url: string
  status: 'pending' | 'ready' | 'error'
  fetchedAt: number
  info?: VideoInfo
  error?: string
}

type VideoGroup = {
  label: string
  height: number
  formats: VideoFormat[]
}

const loadCachedInfo = async (url: string): Promise<VideoInfoCacheEntry | null> => {
  const data = await browser.storage.local.get('videoInfoCacheByUrl')
  const map = data.videoInfoCacheByUrl as Record<string, VideoInfoCacheEntry> | undefined
  if (!map) return null
  const cached = map[url]
  if (!cached) return null
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) return null
  return cached
}

const sanitizeError = (error: string): string => {
  const message = error.toLowerCase()
  if (
    message.includes('localhost') ||
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('connect') ||
    message.includes('failed to request')
  ) {
    return 'Client connection failed'
  }
  return error
}

function App() {
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string>('')
  const [retryTrigger, setRetryTrigger] = useState(0)
  const [activeTab, setActiveTab] = useState<'video' | 'cookies'>('video')
  const [cookieExportStatus, setCookieExportStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [cookieExportMessage, setCookieExportMessage] = useState<string>('')
  const [cookieSyncStatus, setCookieSyncStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle')
  const [cookieSyncMessage, setCookieSyncMessage] = useState<string>('')

  useEffect(() => {
    let active = true
    const targetState = { url: '' }

    const handleStorageChange = (
      changes: Record<string, browser.storage.StorageChange>,
      areaName: string
    ) => {
      if (!active || areaName !== 'local') return
      const change = changes.videoInfoCacheByUrl
      if (!change?.newValue) return

      const map = change.newValue as Record<string, VideoInfoCacheEntry>
      const next = map[targetState.url]
      if (!next) return

      if (next.status === 'ready' && next.info) {
        setInfo(next.info)
        setError(null)
        setLoading(false)
      } else if (next.status === 'error' && next.error) {
        setError(sanitizeError(next.error))
        setInfo(null)
        setLoading(false)
      } else if (next.status === 'pending') {
        setLoading(true)
      }
    }

    browser.storage.onChanged.addListener(handleStorageChange)

    const loadInfo = async () => {
      setLoading(true)
      setError(null)
      setInfo(null)

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (!isValidHttpUrl(tab?.url)) {
        setError('Please open a valid video page first.')
        setLoading(false)
        setCurrentUrl('')
        setCookieExportStatus('idle')
        setCookieExportMessage('')
        setCookieSyncStatus('idle')
        setCookieSyncMessage('')
        return
      }

      const targetUrl = tab.url as string
      targetState.url = targetUrl
      setCurrentUrl(targetUrl)
      setCookieExportStatus('idle')
      setCookieExportMessage('')
      setCookieSyncStatus('idle')
      setCookieSyncMessage('')

      const cached = await loadCachedInfo(targetUrl)
      const shouldBypassCache = retryTrigger > 0
      if (cached && !shouldBypassCache) {
        if (cached.status === 'ready' && cached.info) {
          setInfo(cached.info)
          setLoading(false)
          return
        }
        if (cached.status === 'error' && cached.error) {
          setError(sanitizeError(cached.error))
          setLoading(false)
          return
        }
      }

      try {
        await browser.runtime.sendMessage({
          type: 'video-info:fetch',
          url: targetUrl
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to request video info.'
        setError(sanitizeError(message))
        setLoading(false)
      }

      const latest = await loadCachedInfo(targetUrl)
      if (latest && latest.status === 'ready' && latest.info) {
        setInfo(latest.info)
        setError(null)
        setLoading(false)
      } else if (latest && latest.status === 'error' && latest.error) {
        setError(sanitizeError(latest.error))
        setInfo(null)
        setLoading(false)
      }
    }

    void loadInfo()

    return () => {
      active = false
      browser.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [retryTrigger])

  const formats = useMemo(() => info?.formats ?? [], [info])
  const groupedFormats = useMemo(() => {
    const video: VideoFormat[] = []
    const audio: VideoFormat[] = []
    const other: VideoFormat[] = []

    for (const format of formats) {
      if (isVideoFormat(format)) {
        video.push(format)
      } else if (isAudioFormat(format)) {
        audio.push(format)
      } else {
        other.push(format)
      }
    }

    return { video, audio, other }
  }, [formats])

  const groupedVideoFormats = useMemo(() => {
    const raw = groupedFormats.video
    if (!raw.length) return []

    const groups: Record<number, VideoFormat[]> = {}
    const noHeight: VideoFormat[] = []

    for (const f of raw) {
      const h = f.height || f.resolution?.match(/x(\d+)/)?.[1]
      const heightVal = h ? Number(h) : 0

      if (heightVal > 0) {
        if (!groups[heightVal]) groups[heightVal] = []
        groups[heightVal].push(f)
      } else {
        noHeight.push(f)
      }
    }

    const sortedLabels = Object.keys(groups)
      .map(Number)
      .sort((a, b) => b - a)

    const result: VideoGroup[] = sortedLabels.map((h) => ({
      label: `${h}p`,
      height: h,
      formats: groups[h].sort((a, b) => {
        const sa = a.filesize || a.filesize_approx || 0
        const sb = b.filesize || b.filesize_approx || 0
        return sb - sa
      })
    }))

    if (noHeight.length > 0) {
      result.push({
        label: 'Other',
        height: 0,
        formats: noHeight
      })
    }

    return result
  }, [groupedFormats.video])

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const clientLaunchDelayMs = 2000

  const openClientApp = async () => {
    window.location.href = 'vidbee://'
    await wait(clientLaunchDelayMs)
  }

  const handleOpenClient = () => {
    if (!currentUrl) return
    const deepLink = `vidbee://download?url=${encodeURIComponent(currentUrl)}`
    window.location.href = deepLink
  }

  const handleOpenClientAndRetry = async () => {
    await openClientApp()
    setRetryTrigger((count) => count + 1)
  }

  const handleRetry = () => {
    setRetryTrigger((count) => count + 1)
  }

  const handleExportCookies = async () => {
    if (!isValidHttpUrl(currentUrl)) {
      setCookieExportStatus('error')
      setCookieExportMessage(t('exportCookiesInvalidPage', 'Open a valid page to export cookies.'))
      return
    }

    setCookieExportStatus('loading')
    setCookieExportMessage(t('exportCookiesLoading', 'Exporting cookies...'))

    try {
      const url = new URL(currentUrl)
      const cookies = await getCookiesForUrl(url)
      if (cookies.length === 0) {
        setCookieExportStatus('error')
        setCookieExportMessage(t('exportCookiesEmpty', 'No cookies found for this site.'))
        return
      }

      const text = serializeCookiesAsNetscape(cookies)
      const filename = `${url.hostname}_cookies.txt`
      await downloadTextFile(text, filename)
      setCookieExportStatus('success')
      setCookieExportMessage(t('exportCookiesSuccess', 'Saved cookies.txt to your downloads.'))
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('exportCookiesError', 'Failed to export cookies.')
      setCookieExportStatus('error')
      setCookieExportMessage(message)
    }
  }

  const handleExportAllCookies = async () => {
    setCookieExportStatus('loading')
    setCookieExportMessage(t('exportAllCookiesLoading', 'Exporting all cookies...'))

    try {
      const cookies = await getAllCookies({
        partitionKey: {}
      } as browser.cookies.GetAllDetails)
      if (cookies.length === 0) {
        setCookieExportStatus('error')
        setCookieExportMessage(
          t('exportAllCookiesEmpty', 'No cookies found in this browser profile.')
        )
        return
      }

      const text = serializeCookiesAsNetscape(cookies)
      await downloadTextFile(text, 'cookies.txt')
      setCookieExportStatus('success')
      setCookieExportMessage(t('exportAllCookiesSuccess', 'Saved all cookies to your downloads.'))
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('exportAllCookiesError', 'Failed to export all cookies.')
      setCookieExportStatus('error')
      setCookieExportMessage(message)
    }
  }

  const handleSyncCookies = async () => {
    setCookieSyncStatus('loading')
    setCookieSyncMessage(t('syncCookiesLoading', 'Syncing all cookies...'))

    try {
      const cookies = await getAllCookies({
        partitionKey: {}
      } as browser.cookies.GetAllDetails)
      if (cookies.length === 0) {
        setCookieSyncStatus('error')
        setCookieSyncMessage(
          t('exportAllCookiesEmpty', 'No cookies found in this browser profile.')
        )
        return
      }

      await syncCookiesToClient({
        cookies: cookies.map((cookie) => ({
          domain: cookie.domain,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.expirationDate
        }))
      })

      setCookieSyncStatus('success')
      setCookieSyncMessage(t('syncCookiesSuccess', 'Synced all cookies to VidBee.'))
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('syncCookiesError', 'Failed to sync cookies.')
      setCookieSyncStatus('error')
      setCookieSyncMessage(message)
    }
  }

  const isInvalidPageError = error === 'Please open a valid video page first.'
  const isClientConnectionError = Boolean(error?.includes('Client connection failed'))
  const errorTitle = isInvalidPageError
    ? 'Open a video page'
    : isClientConnectionError
      ? 'Connect the VidBee app'
      : 'Something went wrong'
  const errorDescription = isInvalidPageError
    ? 'Navigate to a supported video page, then try again.'
    : isClientConnectionError
      ? 'The extension needs the VidBee desktop app to be running.'
      : 'Try again in a moment.'
  const canExportCookies = isValidHttpUrl(currentUrl)

  const renderHeaderStatus = () => {
    if (activeTab === 'video') {
      return renderStatus()
    }
    return (
      <span className="status-indicator">
        <div className="status-dot" />
        {t('tabCookies', 'Cookies')}
      </span>
    )
  }

  const renderStatus = () => {
    if (loading)
      return (
        <span className="status-indicator">
          <div className="status-dot loading" /> Working
        </span>
      )
    if (error)
      return (
        <span className="status-indicator">
          <div className="status-dot error" /> Error
        </span>
      )
    if (info)
      return (
        <span className="status-indicator">
          <div className="status-dot ok" /> Ready
        </span>
      )
    return (
      <span className="status-indicator">
        <div className="status-dot" /> Idle
      </span>
    )
  }

  return (
    <div className="app">
      <header>
        <h1>VidBee</h1>
        {renderHeaderStatus()}
      </header>
      <div className="tabs" role="tablist" aria-label="Popup sections">
        <button
          type="button"
          className={`tab-button ${activeTab === 'video' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'video'}
          onClick={() => setActiveTab('video')}
        >
          {t('tabVideo', 'Video')}
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === 'cookies' ? 'active' : ''}`}
          role="tab"
          aria-selected={activeTab === 'cookies'}
          onClick={() => setActiveTab('cookies')}
        >
          {t('tabCookies', 'Cookies')}
        </button>
      </div>

      {activeTab === 'video' && loading && (
        <div className="loading-container">
          <div className="spinner" />
          <div className="loading-text">Analyzing video...</div>
        </div>
      )}

      {activeTab === 'video' && !loading && error && (
        <div className="error-container">
          <div className="error-header">
            <h2 className="error-title">{errorTitle}</h2>
            <p className="error-description">{errorDescription}</p>
          </div>
          <div className="error-banner">{error}</div>
          {isClientConnectionError ? (
            <div className="action-grid">
              <div className="action-card">
                <p className="action-title">Client installed</p>
                <p className="action-text">
                  Start VidBee and keep it running, then we will retry automatically.
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleOpenClientAndRetry}
                >
                  Open Client
                </button>
              </div>
              <div className="action-card">
                <p className="action-title">Need the app?</p>
                <p className="action-text">
                  Download VidBee once, install it, then come back here to try again.
                </p>
                <a
                  href="https://vidbee.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="secondary-button"
                >
                  Download VidBee
                </a>
              </div>
            </div>
          ) : (
            <div className="action-card">
              <p className="action-title">Try again</p>
              <p className="action-text">
                {isInvalidPageError
                  ? 'Open a supported video page, then retry.'
                  : 'Retry after a moment.'}
              </p>
              <button type="button" className="secondary-button" onClick={handleRetry}>
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'video' && !loading && !error && info && (
        <>
          <section className="video-info">
            <div className="video-details">
              <h2>{info.title || 'Untitled video'}</h2>
              <div className="meta-row">
                <span>{formatDuration(info.duration)}</span>
                <span>•</span>
                <span>{formats.length} formats</span>
              </div>
            </div>
            {info.thumbnail && <img className="thumbnail" src={info.thumbnail} alt="" />}
          </section>

          <button type="button" className="primary-button" onClick={handleOpenClient}>
            {t('downloadWithVidBee', 'Download with VidBee')}
          </button>

          <section className="formats-section">
            {groupedVideoFormats.map((group) => (
              <div className="format-group" key={group.label}>
                <div className="group-title sticky-title">{group.label}</div>
                <table className="format-table">
                  <thead>
                    <tr>
                      <th className="col-id">ID</th>
                      <th className="col-ext">Ext</th>
                      <th className="col-size">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.formats.map((f) => (
                      <tr key={`vg-${group.label}-${f.format_id ?? f.ext ?? 'video'}`}>
                        <td className="col-id">{f.format_id || '-'}</td>
                        <td className="col-ext">{f.ext || '-'}</td>
                        <td className="col-size">{formatBytes(f.filesize || f.filesize_approx)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {groupedVideoFormats.length === 0 && groupedFormats.audio.length === 0 && (
              <div className="empty-state">No compatible formats.</div>
            )}

            {groupedFormats.audio.length > 0 && (
              <div className="format-group">
                <div className="group-title">Audio Only</div>
                <table className="format-table">
                  <thead>
                    <tr>
                      <th className="col-id">ID</th>
                      <th className="col-ext">Ext</th>
                      <th className="col-size">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedFormats.audio.map((f) => (
                      <tr key={`a-${f.format_id ?? f.ext ?? 'audio'}`}>
                        <td className="col-id">{f.format_id || '-'}</td>
                        <td className="col-ext">{f.ext || '-'}</td>
                        <td className="col-size">{formatBytes(f.filesize || f.filesize_approx)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === 'cookies' && (
        <section className="cookie-export">
          <div className="cookie-export-header">
            <h3 className="cookie-export-title">{t('cookieSectionTitle', 'Cookies')}</h3>
            <p className="cookie-export-text">
              {t('exportCookiesDescription', 'Download cookies.txt for this site.')}
            </p>
          </div>
          <div className="cookie-export-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleExportCookies}
              disabled={!canExportCookies || cookieExportStatus === 'loading'}
            >
              {t('exportCookies', 'Export cookies.txt')}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleExportAllCookies}
              disabled={cookieExportStatus === 'loading'}
            >
              {t('exportAllCookies', 'Export all cookies')}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleSyncCookies}
              disabled={cookieSyncStatus === 'loading'}
            >
              {t('syncCookies', 'Sync all cookies to VidBee')}
            </button>
          </div>
          {(cookieExportStatus !== 'idle' || cookieSyncStatus !== 'idle') && (
            <div className="cookie-export-status-group">
              {cookieExportStatus !== 'idle' && (
                <p className={`cookie-export-status ${cookieExportStatus}`}>
                  {cookieExportMessage}
                </p>
              )}
              {cookieSyncStatus !== 'idle' && (
                <p className={`cookie-export-status ${cookieSyncStatus}`}>{cookieSyncMessage}</p>
              )}
            </div>
          )}
          {cookieExportStatus === 'idle' && !canExportCookies && (
            <p className="cookie-export-status error">
              {t('exportCookiesInvalidPage', 'Open a valid page to export cookies.')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

export default App
