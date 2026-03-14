import { useCallback, useState } from 'react'

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
  canConfirmAddUrl: boolean
  hasAddUrlValue: boolean
  handleConfirmAddUrl: () => Promise<void>
  handleOpenAddUrlPopover: () => Promise<void>
  setAddUrlPopoverOpen: (open: boolean) => void
  setAddUrlValue: (value: string) => void
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
  const canConfirmAddUrl = hasAddUrlValue && isLikelyUrl(trimmedAddUrlValue)

  const handleOpenAddUrlPopover = useCallback(async () => {
    setAddUrlPopoverOpen(true)
    if (!navigator.clipboard?.readText) {
      setAddUrlValue('')
      return
    }

    try {
      const text = await navigator.clipboard.readText()
      const trimmedUrl = text.trim()
      setAddUrlValue(isLikelyUrl(trimmedUrl) ? trimmedUrl : '')
    } catch {
      setAddUrlValue('')
    }
  }, [])

  const handleConfirmAddUrl = useCallback(async () => {
    const trimmedUrl = addUrlValue.trim()
    if (!trimmedUrl) {
      onEmptyUrl()
      return
    }
    if (!isLikelyUrl(trimmedUrl)) {
      onInvalidUrl()
      return
    }

    setAddUrlPopoverOpen(false)

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
  }, [
    activeTab,
    addUrlValue,
    isOneClickDownloadEnabled,
    isPlaylistBusy,
    onEmptyUrl,
    onInvalidUrl,
    onOneClickDownload,
    onParsePlaylist,
    onParseSingle
  ])

  return {
    addUrlPopoverOpen,
    addUrlValue,
    canConfirmAddUrl,
    hasAddUrlValue,
    handleConfirmAddUrl,
    handleOpenAddUrlPopover,
    setAddUrlPopoverOpen,
    setAddUrlValue
  }
}
