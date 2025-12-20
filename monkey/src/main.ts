import './style.css'

// Get current video URL
// yt-dlp can handle all URLs directly, so we just return the current URL
function getVideoUrl(): string | null {
  return window.location.href
}

// Temporarily hide button
function hideButtonTemporarily(): void {
  const container = document.getElementById('vidbee-download-btn')
  if (container) {
    container.classList.add('vidbee-hidden')
    // Auto restore after 5 seconds
    setTimeout(() => {
      if (container) {
        container.classList.remove('vidbee-hidden')
      }
    }, 5000)
  }
}

// Create VidBee download button
function createVidBeeButton(): void {
  // Check if button already exists
  if (document.getElementById('vidbee-download-btn')) {
    return
  }

  const videoUrl = getVideoUrl()
  if (!videoUrl) {
    return
  }

  // Create button container
  const container = document.createElement('div')
  container.id = 'vidbee-download-btn'
  container.className = 'vidbee-download-container'

  // Create main download button
  const button = document.createElement('button')
  button.className = 'vidbee-download-button'
  button.setAttribute('aria-label', 'Download with VidBee')
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span class="vidbee-tooltip">Download with VidBee</span>
  `

  // Create close button
  const closeButton = document.createElement('button')
  closeButton.className = 'vidbee-close-button'
  closeButton.setAttribute('aria-label', 'Hide button')
  closeButton.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
    <span class="vidbee-tooltip">Hide</span>
  `

  // Handle close button click - temporarily hide
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation()
    hideButtonTemporarily()
  })

  let clickTimer: number | null = null
  let clickCount = 0

  // Handle main button click event - single click for download
  button.addEventListener('click', () => {
    clickCount++

    if (clickCount === 1) {
      clickTimer = window.setTimeout(() => {
        // Single click - trigger download
        const vidbeeUrl = `vidbee://download?url=${encodeURIComponent(videoUrl)}`
        window.location.href = vidbeeUrl
        clickCount = 0
      }, 300)
    } else if (clickCount === 2) {
      // Double click - temporarily hide
      if (clickTimer !== null) {
        clearTimeout(clickTimer)
      }
      clickCount = 0
      hideButtonTemporarily()
    }
  })

  // Assemble container
  container.appendChild(button)
  container.appendChild(closeButton)

  // Insert container directly to body (fixed position)
  document.body.appendChild(container)
}

// Initialize when page loads
function init(): void {
  // Wait for page to fully load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createVidBeeButton)
  } else {
    createVidBeeButton()
  }

  // Handle SPA navigation (when navigating between videos on sites like YouTube, Bilibili, etc.)
  let lastUrl = location.href
  let urlCheckTimer: number | null = null

  const checkUrlChange = () => {
    const currentUrl = location.href
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl
      // Remove old button and create new one
      const oldButton = document.getElementById('vidbee-download-btn')
      if (oldButton) {
        oldButton.remove()
      }
      // Wait a bit for the page to update (different sites have different update speeds)
      const hostname = window.location.hostname
      const delay = hostname.includes('bilibili.com') ? 800 : 500
      setTimeout(createVidBeeButton, delay)
    }
  }

  // Use MutationObserver for DOM changes (works for most SPA sites)
  new MutationObserver(() => {
    if (urlCheckTimer !== null) {
      clearTimeout(urlCheckTimer)
    }
    urlCheckTimer = window.setTimeout(checkUrlChange, 100)
  }).observe(document.body, { childList: true, subtree: true })

  // Also listen to popstate for browser navigation
  window.addEventListener('popstate', () => {
    setTimeout(checkUrlChange, 300)
  })
}

init()
