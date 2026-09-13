/**
 * Host only: drop paths and keep a lowercase DNS name.
 */
function normalizeSiteDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase()
  const host = trimmed.split('/')[0]?.trim()
  return host || trimmed
}

/**
 * Origin favicon for a site domain (`https://example.com/favicon.ico`).
 */
export function buildSiteIconUrl(domain: string): string {
  return `https://${normalizeSiteDomain(domain)}/favicon.ico`
}

/**
 * Third-party lookup used only when the origin favicon cannot be loaded.
 */
export function buildSiteIconFallbackUrl(domain: string): string {
  return `https://favicon.im/${encodeURIComponent(normalizeSiteDomain(domain))}`
}
