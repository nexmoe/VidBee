import { useCallback, useState } from 'react'
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
  isOneClickDownloadEnabled: boolean
  isPlaylistBusy: boolean
  onEmptyUrl: () => void
  onInvalidUrl: () => void
  onOneClickDownload: (url: string) => Promise<void> | void
  onParsePlaylist: (url: string) => Promise<void> | void
  onParseSingle: (url: string) => Promise<void> | void
}

interface UseAddUrlInteractionResult {
  addUrlPopoverOpen: boolean
  addUrlValue: string
  batchRequiresOneClick: boolean
  canConfirmAddUrl: boolean
  hasAddUrlValue: boolean
  handleConfirmAddUrl: () => Promise<void>
  handleOpenAddUrlPopover: () => Promise<void>
  setAddUrlPopoverOpen: (open: boolean) => void
  setAddUrlValue: (value: string) => void
  submitUrl: (rawUrl: string) => Promise<void>
}

export const useAddUrlInteraction = ({
  activeTab,
  isOneClickDownloadEnabled,
  isPlaylistBusy,
  onEmptyUrl,
  onInvalidUrl,
  onOneClickDownload,
  onParsePlaylist,
  onParseSingle
}: UseAddUrlInteractionOptions): UseAddUrlInteractionResult => {
  const [addUrlPopoverOpen, setAddUrlPopoverOpen] = useState(false)
  const [addUrlValue, setAddUrlValue] = useState('')

  const trimmedAddUrlValue = addUrlValue.trim()
  const hasAddUrlValue = trimmedAddUrlValue.length > 0
  const addUrlValues = classifyIngestText(trimmedAddUrlValue).urls
  const batchRequiresOneClick = addUrlValues.length > 1 && !isOneClickDownloadEnabled
  const canConfirmAddUrl = addUrlValues.length > 0 && !batchRequiresOneClick

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

      if (isOneClickDownloadEnabled) {
        await onOneClickDownload(trimmedUrl)
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
      onOneClickDownload,
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
      setAddUrlPopoverOpen(false)
      setAddUrlValue('')
      for (const url of urls) {
        await onOneClickDownload(url)
      }
      return
    }

    await submitUrl(urls[0])
  }, [addUrlValue, isOneClickDownloadEnabled, onOneClickDownload, submitUrl])

  return {
    addUrlPopoverOpen,
    addUrlValue,
    batchRequiresOneClick,
    canConfirmAddUrl,
    hasAddUrlValue,
    handleConfirmAddUrl,
    handleOpenAddUrlPopover,
    setAddUrlPopoverOpen,
    setAddUrlValue,
    submitUrl
  }
}
