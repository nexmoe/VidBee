import logoSrc from '../assets/vidbee-logo.png?inline'

/** Shared attribution artwork and proportions for share cards and standalone diagram exports. */
export const EXPORT_BRAND = {
  prefix: 'Made with',
  name: 'VidBee',
  logoSrc,
  fontSize: 20,
  fontWeight: 600,
  logoSize: 28,
  gap: 8,
  prefixOpacity: 0.65,
  nameOpacity: 0.85,
  dividerWidth: 48,
  dividerOpacity: 0.3,
  dividerGap: 20
} as const
