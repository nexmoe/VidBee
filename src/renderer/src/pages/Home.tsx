import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'

interface HomeProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function Home({ onOpenSupportedSites, onOpenSettings }: HomeProps) {
  return (
    <UnifiedDownloadHistory
      onOpenSupportedSites={onOpenSupportedSites}
      onOpenSettings={onOpenSettings}
    />
  )
}
