import { UnifiedDownloadHistory } from '../components/download/UnifiedDownloadHistory'

interface HomeProps {
  onOpenSupportedSites?: () => void
  onOpenSettings?: () => void
}

export function Home({ onOpenSupportedSites, onOpenSettings }: HomeProps) {
  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div
        className="container mx-auto max-w-7xl p-6 w-full h-full flex flex-col min-h-0"
        style={{ maxWidth: '100%' }}
      >
        {/* Unified Download History */}
        <UnifiedDownloadHistory
          onOpenSupportedSites={onOpenSupportedSites}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </div>
  )
}
