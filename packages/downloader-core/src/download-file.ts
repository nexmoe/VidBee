export const normalizeSavedFileName = (fileName?: string): string | undefined => {
  if (!fileName) {
    return undefined
  }

  const trimmed = fileName.trim()
  if (!trimmed) {
    return undefined
  }

  // Remove yt-dlp format identifiers before the final extension, for example:
  // - .f123
  // - .fhls-audio-128000-Audio
  // - .fwebm-video-only
  return trimmed.replace(/\.f[a-z0-9-]+(?=\.[^.]+$)/gi, '')
}

export const buildFileNameCandidates = (
  title: string,
  format: string,
  savedFileName?: string
): string[] => {
  const safeTitle = title.trim() || 'Unknown'

  const savedNameCandidates: string[] = []
  const trimmedSavedFileName = savedFileName?.trim()
  if (trimmedSavedFileName) {
    const normalized = normalizeSavedFileName(trimmedSavedFileName)
    if (normalized) {
      savedNameCandidates.push(normalized)
    }
    if (!normalized || normalized !== trimmedSavedFileName) {
      savedNameCandidates.push(trimmedSavedFileName)
    }
  }

  return savedNameCandidates.length > 0
    ? savedNameCandidates
    : [`${safeTitle} via VidBee.${format}`, `${safeTitle}.${format}`]
}

export const buildFilePathCandidates = (
  downloadPath: string,
  title: string,
  format: string,
  savedFileName?: string
): string[] => {
  const normalizedDownloadPath = downloadPath.replace(/\\/g, '/')
  const candidateFileNames = buildFileNameCandidates(title, format, savedFileName)

  return Array.from(
    new Set(candidateFileNames.map((fileName) => `${normalizedDownloadPath}/${fileName}`))
  )
}
