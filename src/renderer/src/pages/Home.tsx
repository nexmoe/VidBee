import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'

interface HomeProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
  onOpenCookiesSettings?: () => void
}

export function Home({ onOpenSupportedSites, onOpenSettings, onOpenCookiesSettings }: HomeProps) {
  return (
    <UnifiedDownloadHistory
      onOpenSupportedSites={onOpenSupportedSites}
      onOpenSettings={onOpenSettings}
      onOpenCookiesSettings={onOpenCookiesSettings}
    />
  )
}
