const PRIVATE_IPV4 =
  /^(?:127|10|0)\.\d+\.\d+\.\d+$|^192\.168\.\d+\.\d+$|^172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+$/

/**
 * True when the extension may send this watch URL to Desktop over loopback.
 *
 * @param value Candidate video page URL.
 */
export function isExtensionSourceUrl(value: string): boolean {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) {
    return false
  }
  try {
    const url = new URL(value)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return false
    }
    const host = url.hostname.toLowerCase()
    if (!host || host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
      return false
    }
    if (
      host === '0.0.0.0' ||
      host === '127.0.0.1' ||
      host.includes(':') ||
      PRIVATE_IPV4.test(host)
    ) {
      return false
    }
    return true
  } catch {
    return false
  }
}
