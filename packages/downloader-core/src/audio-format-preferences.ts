export interface AudioFormatLike {
  formatId?: string
  format_id?: string
  language?: string
}

const formatIdOf = (format: AudioFormatLike): string | undefined =>
  format.formatId ?? format.format_id

/**
 * Pick the best matching audio format id for a saved language preference.
 *
 * @param formats Available audio formats.
 * @param preferredLanguage Last language the user picked, if any.
 * @returns A format id, or undefined when the list is empty.
 */
export const pickPreferredAudioFormatId = (
  formats: AudioFormatLike[],
  preferredLanguage?: string
): string | undefined => {
  if (formats.length === 0) {
    return undefined
  }

  const firstId = formatIdOf(formats[0])
  const normalizedPreferredLanguage = preferredLanguage?.trim().toLowerCase()
  if (!normalizedPreferredLanguage) {
    return firstId
  }

  const exactMatch = formats.find(
    (format) => format.language?.trim().toLowerCase() === normalizedPreferredLanguage
  )
  if (exactMatch) {
    return formatIdOf(exactMatch)
  }

  const baseLanguageMatch = formats.find((format) => {
    const normalizedLanguage = format.language?.trim().toLowerCase()
    if (!normalizedLanguage) {
      return false
    }
    return (
      normalizedLanguage.startsWith(`${normalizedPreferredLanguage}-`) ||
      normalizedPreferredLanguage.startsWith(`${normalizedLanguage}-`)
    )
  })

  return formatIdOf(baseLanguageMatch ?? formats[0])
}
