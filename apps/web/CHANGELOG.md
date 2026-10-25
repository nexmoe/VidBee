# VidBee Web Changelog

Changes to the self-hosted VidBee web app. Dated versions follow the web app's own recorded version changes and are independent of Desktop releases. Later changes remain under Unreleased.

## [Unreleased]

### Improvements
- Keep high-resolution video streams and separate audio languages available when choosing download formats. ([#488](https://github.com/nexmoe/VidBee/pull/488))
- Let long downloads finish merging or converting instead of failing after one minute. ([#488](https://github.com/nexmoe/VidBee/pull/488))
- Keep downloaded WebM videos when their cover art cannot be saved. ([#487](https://github.com/nexmoe/VidBee/pull/487))
- Queue an RSS video again after its previous download is removed, including when the removal happens in another connected app. ([#485](https://github.com/nexmoe/VidBee/pull/485))
- Show clearer confirmation as a newly submitted download moves into the download list.

## [2.1.0] - 2026-09-13

### What's New
- Manage RSS subscriptions in the browser and choose which new videos to download automatically.
- Pause and resume active downloads without starting over. (by @Gani-SMA, [#414](https://github.com/nexmoe/VidBee/pull/414))
- Choose MP4, MKV, WebM, or the original format for one-click and subscription downloads.
- Choose up to five subtitle languages, or follow the interface language.
- Upload browser cookies and custom download settings from the Settings page.
- Browse download folders on your server when choosing where to save files.
- Choose the video container for playlist downloads. (by @jabrailkhalil, [#469](https://github.com/nexmoe/VidBee/pull/469))

### Improvements
- Keep downloads running when subtitles are unavailable and give clearer guidance when a site requires browser cookies.
- Support self-hosted access through a custom domain and restore the web app when required download services are missing from the installation.
- Load video covers more reliably and keep download and settings controls consistent with Desktop.

## [0.1.0] - 2026-02-28

### What's New
- Manage downloads from a browser connected to your self-hosted VidBee server.
- Add individual videos and playlists, choose formats, and follow download progress.
- Configure download preferences from the browser, including saving options shared with the server.
- Use the web app with light or dark appearance and a translated interface.

[Unreleased]: https://github.com/nexmoe/VidBee/compare/a68da29...75441e4
[2.1.0]: https://github.com/nexmoe/VidBee/compare/ec9fac1...a68da29
[0.1.0]: https://github.com/nexmoe/VidBee/commit/ec9fac1
