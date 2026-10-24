import { useCallback, useRef, useState } from 'react'
import { classifyIngestText } from './ingest'
import { isPlaylistLikeUrl } from './url-kind'

const isLikelyUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

interface UseAddUrlInteractionOptions {
  activeTab: 'single' | 'playlist'
  sourceUrl: string
  isOneClickDownloadEnabled: boolean
  isPlaylistBusy: boolean
  onActiveTabChange: (tab: 'single' | 'playlist') => void
  onEmptyUrl: () => void
  onInvalidUrl: () => void
  onOneClickDownload: (url: string) => Promise<boolean> | boolean
  onParsePlaylist: (url: string) => Promise<void> | void
  onParseSingle: (url: string) => Promise<void> | void
}

interface UseAddUrlInteractionResult {
  isSubmitting: boolean
  addUrlPopoverOpen: boolean
  addUrlValue: string
  batchRequiresOneClick: boolean
  canConfirmAddUrl: boolean
  hasAddUrlValue: boolean
  handleActiveTabChange: (tab: 'single' | 'playlist') => Promise<void>
  handleConfirmAddUrl: () => Promise<void>
  handleOpenAddUrlPopover: () => Promise<void>
  setAddUrlPopoverOpen: (open: boolean) => void
  setAddUrlValue: (value: string) => void
  submitUrl: (rawUrl: string) => Promise<void>
}

export const useAddUrlInteraction = ({
  activeTab,
  sourceUrl,
  isOneClickDownloadEnabled,
  isPlaylistBusy,
  onActiveTabChange,
  onEmptyUrl,
  onInvalidUrl,
  onOneClickDownload,
  onParsePlaylist,
  onParseSingle
}: UseAddUrlInteractionOptions): UseAddUrlInteractionResult => {
  const [addUrlPopoverOpen, setAddUrlPopoverOpen] = useState(false)
  const [addUrlValue, setAddUrlValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const submittingRef = useRef(false)

  const trimmedAddUrlValue = addUrlValue.trim()
  const hasAddUrlValue = trimmedAddUrlValue.length > 0
  const addUrlValues = classifyIngestText(trimmedAddUrlValue).urls
  const batchRequiresOneClick = addUrlValues.length > 1 && !isOneClickDownloadEnabled
  const canConfirmAddUrl = addUrlValues.length > 0 && !batchRequiresOneClick

  /** Fetch the current source in the selected mode instead of exposing an empty tab. */
  const handleActiveTabChange = useCallback(
    async (tab: 'single' | 'playlist') => {
      if (tab === activeTab || isPlaylistBusy) {
        return
      }
      onActiveTabChange(tab)
      const trimmedUrl = sourceUrl.trim()
      if (!trimmedUrl) {
        return
      }
      if (tab === 'playlist') {
        await onParsePlaylist(trimmedUrl)
        return
      }
      await onParseSingle(trimmedUrl)
    },
    [activeTab, sourceUrl, isPlaylistBusy, onActiveTabChange, onParsePlaylist, onParseSingle]
  )

  /** Keep the source popover alive until the first accepted task can fly from it. */
  const submitOneClickUrls = useCallback(
    async (urls: string[]) => {
      if (submittingRef.current) {
        return
      }
      submittingRef.current = true
      setIsSubmitting(true)
      try {
        for (const nextUrl of urls) {
          const queued = await onOneClickDownload(nextUrl)
          if (queued !== false) {
            setAddUrlPopoverOpen(false)
          }
        }
        if (urls.length > 1) {
          setAddUrlValue('')
        }
      } finally {
        setAddUrlPopoverOpen(false)
        submittingRef.current = false
        setIsSubmitting(false)
      }
    },
    [onOneClickDownload]
  )

  const handleOpenAddUrlPopover = useCallback(async () => {
    setAddUrlPopoverOpen(true)
    if (!navigator.clipboard?.readText) {
      setAddUrlValue('')
      return
    }

    try {
      const text = await navigator.clipboard.readText()
      const trimmedText = text.trim()
      setAddUrlValue(classifyIngestText(trimmedText).urls.length > 0 ? trimmedText : '')
    } catch {
      setAddUrlValue('')
    }
  }, [])

  /**
   * Route a confirmed URL into one-click download or the parse dialog.
   */
  const submitUrl = useCallback(
    async (rawUrl: string) => {
      const trimmedUrl = rawUrl.trim()
      if (!trimmedUrl) {
        onEmptyUrl()
        return
      }
      if (!isLikelyUrl(trimmedUrl)) {
        onInvalidUrl()
        return
      }

      if (isOneClickDownloadEnabled && activeTab !== 'playlist' && !isPlaylistLikeUrl(trimmedUrl)) {
        await submitOneClickUrls([trimmedUrl])
        return
      }

      setAddUrlPopoverOpen(false)

      if (isPlaylistLikeUrl(trimmedUrl)) {
        if (isPlaylistBusy) {
          return
        }
        await onParsePlaylist(trimmedUrl)
        return
      }

      if (activeTab === 'playlist') {
        if (isPlaylistBusy) {
          return
        }
        await onParsePlaylist(trimmedUrl)
        return
      }

      await onParseSingle(trimmedUrl)
    },
    [
      activeTab,
      isOneClickDownloadEnabled,
      isPlaylistBusy,
      onEmptyUrl,
      onInvalidUrl,
      submitOneClickUrls,
      onParsePlaylist,
      onParseSingle
    ]
  )

  /** Queue multiline input in one-click mode, or route a single URL through the standard flow. */
  const handleConfirmAddUrl = useCallback(async () => {
    const urls = classifyIngestText(addUrlValue).urls
    if (urls.length === 0) {
      await submitUrl(addUrlValue)
      return
    }

    if (urls.length > 1) {
      if (!isOneClickDownloadEnabled) {
        return
      }
      await submitOneClickUrls(urls)
      return
    }

    await submitUrl(urls[0])
  }, [addUrlValue, isOneClickDownloadEnabled, submitOneClickUrls, submitUrl])

  return {
    isSubmitting,
    addUrlPopoverOpen,
    addUrlValue,
    batchRequiresOneClick,
    canConfirmAddUrl,
    hasAddUrlValue,
    handleActiveTabChange,
    handleConfirmAddUrl,
    handleOpenAddUrlPopover,
    setAddUrlPopoverOpen,
    setAddUrlValue,
    submitUrl
  }
}
