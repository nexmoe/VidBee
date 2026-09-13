/**
 * Host-neutral helpers for the add/edit subscription form.
 */

/**
 * Split a comma-separated string into unique trimmed entries.
 *
 * @param value Raw comma-separated input.
 * @returns Deduplicated non-empty entries.
 */
export const sanitizeCommaList = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)

/**
 * Normalize a filename template to use single forward slashes.
 *
 * @param value Raw template input.
 * @returns Sanitized template.
 */
export const sanitizeTemplateInput = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/{2,}/g, '/')

/**
 * Build the default Subscriptions folder under the user's download path.
 *
 * @param downloadPath Configured download directory.
 * @returns Subscriptions directory path.
 */
export const buildDefaultSubscriptionDirectory = (downloadPath: string): string => {
  const trimmed = downloadPath.trim().replace(/[\\/]+$/, '')
  if (!trimmed) {
    return 'Subscriptions'
  }
  return `${trimmed}/Subscriptions`
}
