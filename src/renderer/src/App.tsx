import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { Sidebar } from '@renderer/components/ui/sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { TitleBar } from '@renderer/components/ui/title-bar'
import { ThemeProvider } from 'next-themes'
import { useState } from 'react'
import { About } from './pages/About'
import { Home } from './pages/Home'
import { Settings } from './pages/Settings'
import { SupportedSites } from './pages/SupportedSites'

type Page = 'home' | 'settings' | 'about' | 'sites'

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>('home')

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <Home onOpenSupportedSites={() => setCurrentPage('sites')} />
      case 'settings':
        return <Settings />
      case 'about':
        return <About />
      case 'sites':
        return <SupportedSites />
      default:
        return <Home onOpenSupportedSites={() => setCurrentPage('sites')} />
    }
  }

  return (
    <div className="flex flex-row h-screen">
      {/* Sidebar Navigation */}
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      {/* Main Content */}
      <main className="flex flex-col flex-1 min-h-0 overflow-hidden bg-background">
        {/* Custom Title Bar */}
        <TitleBar />

        <ScrollArea
          className="flex-1 w-full overflow-y-auto overflow-x-hidden"
          style={{ maxWidth: '100%' }}
        >
          <div className="w-full overflow-hidden" style={{ maxWidth: '100%' }}>
            {renderPage()}
          </div>
        </ScrollArea>
      </main>

      <Toaster />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AppContent />
    </ThemeProvider>
  )
}

export default App
