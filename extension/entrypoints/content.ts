import '../assets/content.css'

const CONTAINER_ID = 'vidbee-download-btn'
const SUPPORTED_HOSTS = [
  /(^|\.)youtube\.com$/,
  /(^|\.)youtu\.be$/,
  /(^|\.)bilibili\.com$/,
  /(^|\.)b23\.tv$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)douyin\.com$/,
  /(^|\.)kuaishou\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)fb\.watch$/,
  /(^|\.)x\.com$/,
  /(^|\.)twitter\.com$/,
  /(^|\.)vimeo\.com$/,
  /(^|\.)dailymotion\.com$/,
  /(^|\.)twitch\.tv$/,
  /(^|\.)nicovideo\.jp$/,
  /(^|\.)acfun\.cn$/,
  /(^|\.)weibo\.com$/
]

function getMessage(key: string, fallback: string): string {
  const message = browser.i18n?.getMessage(key)
  return message || fallback
}

function getVideoUrl(): string {
  return window.location.href
}

function isSupportedSite(hostname: string): boolean {
  return SUPPORTED_HOSTS.some((pattern) => pattern.test(hostname))
}

function hideButtonTemporarily(): void {
  const container = document.getElementById(CONTAINER_ID)
  if (!container) return

  container.classList.add('vidbee-hidden')
  window.setTimeout(() => {
    container.classList.remove('vidbee-hidden')
  }, 5000)
}

function createVidBeeButton(): void {
  if (document.getElementById(CONTAINER_ID)) return

  if (!document.body) return

  if (!isSupportedSite(window.location.hostname)) return

  void browser.runtime.sendMessage({
    type: 'video-info:fetch',
    url: getVideoUrl()
  })

  const videoUrl = getVideoUrl()
  if (!videoUrl) return

  const downloadLabel = getMessage('downloadWithVidBee', 'Download with VidBee')
  const hideLabel = getMessage('hideButton', 'Hide')

  const container = document.createElement('div')
  container.id = CONTAINER_ID
  container.className = 'vidbee-download-container'

  const button = document.createElement('button')
  button.className = 'vidbee-download-button'
  button.setAttribute('aria-label', downloadLabel)
  button.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span class="vidbee-tooltip">${downloadLabel}</span>
  `

  const closeButton = document.createElement('button')
  closeButton.className = 'vidbee-close-button'
  closeButton.setAttribute('aria-label', hideLabel)
  closeButton.innerHTML = `
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
    <span class="vidbee-tooltip">${hideLabel}</span>
  `

  closeButton.addEventListener('click', (event) => {
    event.stopPropagation()
    hideButtonTemporarily()
  })

  let clickTimer: number | null = null
  let clickCount = 0

  button.addEventListener('click', () => {
    clickCount += 1

    if (clickCount === 1) {
      clickTimer = window.setTimeout(() => {
        const vidbeeUrl = `vidbee://download?url=${encodeURIComponent(videoUrl)}`
        window.location.href = vidbeeUrl
        clickCount = 0
      }, 300)
      return
    }

    if (clickCount === 2) {
      if (clickTimer !== null) {
        clearTimeout(clickTimer)
      }
      clickCount = 0
      hideButtonTemporarily()
    }
  })

  container.appendChild(button)
  container.appendChild(closeButton)
  document.body.appendChild(container)
}

function handleUrlChange(lastUrl: { value: string }): void {
  const currentUrl = window.location.href
  if (currentUrl === lastUrl.value) return

  lastUrl.value = currentUrl
  const oldButton = document.getElementById(CONTAINER_ID)
  oldButton?.remove()

  if (!isSupportedSite(window.location.hostname)) return

  void browser.runtime.sendMessage({
    type: 'video-info:fetch',
    url: currentUrl
  })

  const hostname = window.location.hostname
  const delay = hostname.includes('bilibili.com') ? 800 : 500
  window.setTimeout(createVidBeeButton, delay)
}

function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createVidBeeButton)
  } else {
    createVidBeeButton()
  }

  if (!document.body) return

  const lastUrl = { value: window.location.href }
  let urlCheckTimer: number | null = null

  const scheduleUrlCheck = () => {
    if (urlCheckTimer !== null) {
      clearTimeout(urlCheckTimer)
    }
    urlCheckTimer = window.setTimeout(() => handleUrlChange(lastUrl), 100)
  }

  new MutationObserver(scheduleUrlCheck).observe(document.body, {
    childList: true,
    subtree: true
  })

  window.addEventListener('popstate', () => {
    window.setTimeout(() => handleUrlChange(lastUrl), 300)
  })
}

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    init()
  }
})
