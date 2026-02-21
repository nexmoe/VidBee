import { useEffect, useMemo, useState } from 'react'
import './App.css'

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

const CACHE_TTL_MS = 60 * 60 * 1000

const isValidHttpUrl = (value?: string): boolean => {
  if (!value) {
    return false
  }
  return value.startsWith('http://') || value.startsWith('https://')
}

const formatDuration = (value?: number): string => {
  if (!value || value <= 0) {
    return 'Unknown'
  }
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes)
  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${minutes}:${paddedSeconds}`
}

const formatBytes = (value?: number): string => {
  if (!value || value <= 0) {
    return '-'
  }
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

interface VideoInfoCacheEntry {
  url: string
  status: 'pending' | 'ready' | 'error'
  fetchedAt: number
  info?: VideoInfo
  error?: string
}

interface VideoGroup {
  label: string
  height: number
  formats: VideoFormat[]
}

const loadCachedInfo = async (url: string): Promise<VideoInfoCacheEntry | null> => {
  const data = await browser.storage.local.get('videoInfoCacheByUrl')
  const map = data.videoInfoCacheByUrl as Record<string, VideoInfoCacheEntry> | undefined
  if (!map) {
    return null
  }
  const cached = map[url]
  if (!cached) {
    return null
  }
  if (Date.now() - cached.fetchedAt > CACHE_TTL_MS) {
    return null
  }
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

  useEffect(() => {
    let active = true
    const targetState = { url: '' }

    const handleStorageChange = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string
    ) => {
      if (!active || areaName !== 'local') {
        return
      }
      const change = changes.videoInfoCacheByUrl
      if (!change?.newValue) {
        return
      }

      const map = change.newValue as Record<string, VideoInfoCacheEntry>
      const next = map[targetState.url]
      if (!next) {
        return
      }

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
        return
      }

      const targetUrl = tab.url as string
      targetState.url = targetUrl
      setCurrentUrl(targetUrl)

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
    if (!raw.length) {
      return []
    }

    const groups: Record<number, VideoFormat[]> = {}
    const noHeight: VideoFormat[] = []

    for (const f of raw) {
      const h = f.height || f.resolution?.match(/x(\d+)/)?.[1]
      const heightVal = h ? Number(h) : 0

      if (heightVal > 0) {
        if (!groups[heightVal]) {
          groups[heightVal] = []
        }
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
    if (!currentUrl) {
      return
    }
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

  const renderStatus = () => {
    if (loading) {
      return (
        <span className="status-indicator">
          <div className="status-dot loading" /> Working
        </span>
      )
    }
    if (error) {
      return (
        <span className="status-indicator">
          <div className="status-dot error" /> Error
        </span>
      )
    }
    if (info) {
      return (
        <span className="status-indicator">
          <div className="status-dot ok" /> Ready
        </span>
      )
    }
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
        {renderStatus()}
      </header>
      {loading && (
        <div className="loading-container">
          <div className="spinner" />
          <div className="loading-text">Analyzing video...</div>
        </div>
      )}

      {!loading && error && (
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
                  className="secondary-button"
                  onClick={handleOpenClientAndRetry}
                  type="button"
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
                  className="secondary-button"
                  href="https://vidbee.app"
                  rel="noopener noreferrer"
                  target="_blank"
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
              <button className="secondary-button" onClick={handleRetry} type="button">
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {!(loading || error) && info && (
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
            {info.thumbnail && <img alt="" className="thumbnail" src={info.thumbnail} />}
          </section>

          <button className="primary-button" onClick={handleOpenClient} type="button">
            Download with VidBee
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
    </div>
  )
}

export default App
