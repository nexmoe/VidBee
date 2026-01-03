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
  if (!value || value <= 0) return 'Unknown'
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

type VideoInfoCacheEntry = {
  url: string
  status: 'pending' | 'ready' | 'error'
  fetchedAt: number
  info?: VideoInfo
  error?: string
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

function App() {
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
        setError(next.error)
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
        setError('Open a video page in an http(s) tab first.')
        setLoading(false)
        return
      }

      const targetUrl = tab.url as string
      targetState.url = targetUrl
      const cached = await loadCachedInfo(targetUrl)
      if (cached) {
        if (cached.status === 'ready' && cached.info) {
          setInfo(cached.info)
          setLoading(false)
          return
        }
        if (cached.status === 'error' && cached.error) {
          setError(cached.error)
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
        setError(message)
        setLoading(false)
      }

      const latest = await loadCachedInfo(targetUrl)
      if (latest && latest.status === 'ready' && latest.info) {
        setInfo(latest.info)
        setError(null)
        setLoading(false)
      } else if (latest && latest.status === 'error' && latest.error) {
        setError(latest.error)
        setInfo(null)
        setLoading(false)
      }
    }

    void loadInfo()

    return () => {
      active = false
      browser.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

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

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-row">
          <div>
            <h1>VidBee Video Info</h1>
            <p className="subtitle">Data from the VidBee desktop app (yt-dlp).</p>
          </div>
          <span
            className={`status-icon ${loading ? 'status-icon--loading' : info ? 'status-icon--ok' : error ? 'status-icon--error' : ''}`}
            title={loading ? 'Loading' : info ? 'Loaded' : error ? 'Error' : 'Idle'}
          />
        </div>
      </header>

      {loading && <p className="status">Loading...</p>}
      {!loading && error && <pre className="status error status-pre">{error}</pre>}

      {!loading && !error && info && (
        <section className="info">
          <div className="info-main">
            <div className="info-text">
              <h2>{info.title || 'Untitled video'}</h2>
              <p>Duration: {formatDuration(info.duration)}</p>
              <p>Formats: {formats.length}</p>
            </div>
            {info.thumbnail && <img className="thumb" src={info.thumbnail} alt="Video thumbnail" />}
          </div>

          <div className="formats">
            {formats.length === 0 && <p className="status">No formats returned.</p>}
            {formats.length > 0 && (
              <>
                <div className="formats-group">
                  <h3>Video</h3>
                  {groupedFormats.video.length === 0 && <p className="status">No video formats.</p>}
                  {groupedFormats.video.length > 0 && (
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Ext</th>
                          <th>Resolution</th>
                          <th>Size</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedFormats.video.map((format, index) => (
                          <tr key={`video-${format.format_id ?? 'format'}-${index}`}>
                            <td>{format.format_id ?? '-'}</td>
                            <td>{format.ext ?? '-'}</td>
                            <td>
                              {format.resolution ||
                                (format.width && format.height
                                  ? `${format.width}x${format.height}`
                                  : '-')}
                            </td>
                            <td>{formatBytes(format.filesize ?? format.filesize_approx)}</td>
                            <td>{format.format_note ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="formats-group">
                  <h3>Audio</h3>
                  {groupedFormats.audio.length === 0 && <p className="status">No audio formats.</p>}
                  {groupedFormats.audio.length > 0 && (
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Ext</th>
                          <th>Codec</th>
                          <th>Size</th>
                          <th>Note</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedFormats.audio.map((format, index) => (
                          <tr key={`audio-${format.format_id ?? 'format'}-${index}`}>
                            <td>{format.format_id ?? '-'}</td>
                            <td>{format.ext ?? '-'}</td>
                            <td>{format.acodec ?? '-'}</td>
                            <td>{formatBytes(format.filesize ?? format.filesize_approx)}</td>
                            <td>{format.format_note ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {groupedFormats.other.length > 0 && (
                  <div className="formats-group">
                    <h3>Other</h3>
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Ext</th>
                          <th>Details</th>
                          <th>Size</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupedFormats.other.map((format, index) => (
                          <tr key={`other-${format.format_id ?? 'format'}-${index}`}>
                            <td>{format.format_id ?? '-'}</td>
                            <td>{format.ext ?? '-'}</td>
                            <td>{format.format_note ?? format.vcodec ?? format.acodec ?? '-'}</td>
                            <td>{formatBytes(format.filesize ?? format.filesize_approx)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default App
