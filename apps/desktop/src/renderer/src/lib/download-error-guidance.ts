interface DownloadErrorGuidanceRule {
  message: string
  patterns: string[]
}

const DOWNLOAD_ERROR_GUIDANCE_RULES: DownloadErrorGuidanceRule[] = [
  {
    // GitHub issue #334 (YouTube age-restricted) and the bot-check variant
    // both require the user to provide signed-in cookies before yt-dlp can
    // continue. Keep this distinct from secretstorage so the message points
    // the user at the right setting.
    message:
      'This download needs signed-in cookies. Add browser cookies in Settings, or export a Netscape cookies file and select it there.',
    patterns: [
      'sign in to confirm your age',
      "sign in to confirm you're not a bot",
      'sign in to confirm you’re not a bot'
    ]
  },
  {
    // GitHub issue #273: the AppImage bundle on Linux has no python
    // `secretstorage` module, so reading Chromium-family cookies fails even
    // though the rest of the cookie pipeline works.
    message:
      'VidBee cannot read Chrome/Chromium cookies on this Linux build because the system keyring (secretstorage) is unavailable. Switch to Firefox cookies in Settings, or export a Netscape cookies file and select it there.',
    patterns: ['secretstorage not available']
  },
  {
    // macOS TCC Files & Folders: yt-dlp reports "could not find" when it
    // cannot stat another app's Cookies DB. The file is often present.
    message:
      "macOS is blocking VidBee from reading this browser's cookies. Open System Settings → Privacy & Security → Files & Folders, enable VidBee for this browser, then retry. If you already allowed it, quit VidBee fully and open it again.",
    patterns: ['macos files & folders permission is required']
  },
  {
    // GitHub issues #362, #364, #363, #361, #360 (and the older long tail of
    // #107 / #210 / #349 / #353) all surface as Chrome holding the cookies
    // database open on Windows.
    message:
      'VidBee could not copy the Chrome cookies database while Chrome is running. Quit Chrome completely (including background/tray processes) and retry, or switch to Firefox cookies or an exported Netscape cookies file in Settings.',
    patterns: [
      'could not copy chrome cookie database',
      'could not find chrome cookies database',
      'could not find chromium cookies database',
      'failed to decrypt with dpapi'
    ]
  },
  {
    // GitHub issue #348: users picked Chrome's binary `Cookies` SQLite file
    // instead of an exported Netscape cookies.txt, which yt-dlp surfaces as
    // a UTF-8 decode error.
    message:
      'The selected cookies file is not a valid Netscape cookies.txt export — it looks like a binary browser cookies database. Export cookies as a Netscape text file (e.g. with the "Get cookies.txt" extension) and select that file in Settings.',
    patterns: [
      "utf-8' codec can't decode byte",
      'cookies file must be netscape formatted',
      'does not look like a netscape format cookies file'
    ]
  },
  {
    // GitHub issue #359: YouTube 403 Forbidden. Most users land here because
    // their cookies have gone stale or the active player_client got blocked.
    message:
      'YouTube blocked this request (HTTP 403). Refresh your browser cookies or sign in again, then retry. If the issue persists, try a different network or proxy in Settings.',
    patterns: ['http error 403: forbidden']
  },
  {
    // GitHub issues #355 and #325: DNS resolution failures almost always
    // mean a proxy/DNS misconfiguration on the user's side.
    message:
      'VidBee could not resolve the host name for this download. Check your network connection, DNS, or proxy settings — if you have a proxy configured, verify it is reachable.',
    patterns: [
      'name or service not known',
      'name (or service) not known',
      'could not resolve host',
      'failed to resolve',
      'temporary failure in name resolution',
      'getaddrinfo failed',
      'errno -2'
    ]
  },
  {
    // GitHub issue #294 is usually a stale extractor/format selection mismatch.
    message:
      'This source no longer exposes the requested format. Refresh the video info and choose another available format.',
    patterns: ['requested format is not available']
  },
  {
    // GitHub issues #129, #207, and #347 are post-processing / merge
    // failures. yt-dlp keeps the raw streams on disk after a merge failure.
    message:
      'Post-processing or stream merge failed for this download. Retry with a different format or container (e.g. switch to MP4 or pick another quality preset). The raw video and audio files are kept in your download folder so you can merge them manually if needed.',
    patterns: ['invalid data found when processing input', 'postprocessing: conversion failed!']
  },
  {
    // GitHub issue #326: yt-dlp gave up after exhausting fragment retries.
    message:
      'The download failed after multiple retries. Check your network stability or proxy, then retry. For very large videos, choose a lower quality preset to avoid long-running fragment downloads.',
    patterns: ['more expected. giving up after', 'giving up after']
  },
  {
    // Bilibili (and similar) metadata probes can truncate the HTTP body.
    // `--retries` does not cover extractor webpage reads, so the UI should
    // tell the user to parse again instead of dumping the raw urllib error.
    message:
      'The site closed the connection before video info finished loading. Wait a moment and try again.',
    patterns: [
      'incompleteread',
      'error reading response',
      'read timed out',
      'connection reset',
      'connection aborted'
    ]
  },
  {
    // GitHub issue #352 is DRM protected and should be explained directly.
    message:
      'This source is DRM protected, so VidBee cannot download it with the current yt-dlp workflow.',
    patterns: ['this video is drm protected', 'requested site is known to use drm protection']
  },
  {
    message:
      'VidBee could not find downloadable media at this link. Check that it points to a public audio or video page, then try again.',
    patterns: ['unable to extract video info', 'unsupported url']
  }
]

/**
 * Normalize a raw download error string for stable pattern matching.
 *
 * @param rawError The raw yt-dlp or app error message.
 * @returns The normalized lowercase error text.
 */
const normalizeDownloadError = (rawError: string | undefined | null): string => {
  return rawError?.trim().toLowerCase() ?? ''
}

/**
 * Convert repeated raw download failures into short user guidance.
 *
 * @param rawError The raw download error captured from yt-dlp or the app.
 * @returns A concise recovery hint when the error matches a known issue class.
 */
export const getDownloadErrorGuidance = (rawError: string | undefined | null): string | null => {
  const normalizedError = normalizeDownloadError(rawError)
  if (!normalizedError) {
    return null
  }

  const macosCookieDbMissing =
    normalizedError.includes('could not find') &&
    normalizedError.includes('cookies database') &&
    (normalizedError.includes('/library/application support/') ||
      normalizedError.includes('/library/safari') ||
      normalizedError.includes('/library/cookies'))
  if (macosCookieDbMissing) {
    return (
      DOWNLOAD_ERROR_GUIDANCE_RULES.find((rule) =>
        rule.patterns.includes('macos files & folders permission is required')
      )?.message ?? null
    )
  }

  for (const rule of DOWNLOAD_ERROR_GUIDANCE_RULES) {
    if (rule.patterns.some((pattern) => normalizedError.includes(pattern))) {
      return rule.message
    }
  }

  return null
}
