# VidBee Changelog

This page only includes user-visible updates and avoids implementation details.
For full release notes, see [GitHub Releases](https://github.com/nexmoe/VidBee/releases).

## [Unreleased]

### Fixed
- Downloads no longer time out after one minute while merging or converting media. ([#462](https://github.com/nexmoe/VidBee/issues/462))
- Desktop and web format pickers retain high-resolution HLS streams and distinct audio languages when HTTP downloads are also available. ([#443](https://github.com/nexmoe/VidBee/issues/443))
- RSS videos can be queued again after their downloads are removed, including removals from another connected app. You can also copy video links from the RSS item menu. ([#479](https://github.com/nexmoe/VidBee/issues/479), [#485](https://github.com/nexmoe/VidBee/pull/485))
- Incomplete Qwen3-ASR model files are repaired or reported clearly before transcription starts. Overlapping model installations no longer delete each other's files, including when one is cancelled. ([#473](https://github.com/nexmoe/VidBee/issues/473), [#486](https://github.com/nexmoe/VidBee/pull/486))

## [v2.1.0](https://github.com/nexmoe/VidBee/releases/tag/v2.1.0) - 2026-08-30

### What's New
- Edit transcript captions: add a line, change the text, or delete one or more lines.
- Transcripts now appear in the Downloads list, so videos and transcripts can be managed in one place.
- Select several downloads at once to delete them.

### Improvements
- Filter the download list by site, with platform icons so each source is easier to recognize.
- Long titles scroll so the full name stays readable.
- Files with no audio track show a clear message instead of failing quietly.

## [v2.0.2](https://github.com/nexmoe/VidBee/releases/tag/v2.0.2) - 2026-08-23

### Improvements
- On Windows, completed transcripts now open with working video playback instead of showing a blank page. (by @Autsunset)

## [v2.0.1](https://github.com/nexmoe/VidBee/releases/tag/v2.0.1) - 2026-08-23

### What's New
- Choose up to five subtitle languages in Settings, or have VidBee follow the interface language.
- Pause and resume active downloads without starting over. (by @Gani-SMA)

### Improvements
- When subtitles are unavailable, VidBee continues with the video instead of failing the whole download.
- Cancelled downloads stay cancelled after a restart and disappear only after the cancellation is safely saved.
- Download links are recognized more reliably, with clearer guidance when a site needs browser cookies.
- Download from more sites without installing an extra helper.
- On Windows, video playback and the app window recover more reliably after graphics or page failures.
- The tray icon opens the app more reliably.

## [v2.0.0](https://github.com/nexmoe/VidBee/releases/tag/v2.0.0) - 2026-08-22

In 1.x, VidBee saved the file and stopped there. 2.0 keeps going: transcribe on this computer, label who is speaking, search a quote, then ask AI for a summary.

![Before v1.x and after v2.0](https://github.com/nexmoe/VidBee/releases/download/v2.0.0/v2-before-after.webp)

![Download, transcribe locally, search keywords, ask AI](https://github.com/nexmoe/VidBee/releases/download/v2.0.0/v2-workflow-grid.webp)

### What's New
- New workflow: download → transcribe locally → search keywords → ask AI for a summary, all in one app.

### Local transcription
- Choose Whisper, SenseVoice, Parakeet, or Qwen3-ASR. VidBee can recommend a model for your computer and language.
- Speech recognition runs on this computer and can work offline after the model is downloaded. Audio is never uploaded to a transcription service.
- Import a local audio or video file, or drag it onto Transcripts, and transcribe it in the app.

### Speaker labels
- Automatically detect who is speaking and show speaking-time bars under the player.
- Set a fixed speaker count and re-label the conversation without changing the recognized words.
- Click a speaker to jump to their next line.

### Search and timestamps
- Search spoken text or a speaker name. Matches are highlighted in the transcript.
- Every line has a timestamp. Click a line (or a word) to play from that exact moment.
- Copy a passage, or export plain text, Markdown, or subtitles.

### Ask AI
- Built-in prompts for bullet summaries, translations, FAQs, mind maps, grammar cleanup, and more. You can also write your own.
- Connect OpenAI, Anthropic, Google, DeepSeek, xAI, Ollama, LM Studio, or another provider you choose. API keys stay on this computer.

### Privacy
- Privacy first: speech and files stay on this computer.
- When you run Ask AI, only the transcript text goes to the provider you selected. Use Ollama or LM Studio to keep that step on this computer too.

### Also in this release
- The mini player stays available while you move between screens.
- The download engine can update itself in the background so more sites keep working.

### Improvements
- Portable mode no longer resets a custom download folder you chose outside the portable directory.
- Transcription now works on Intel Macs as well as Apple Silicon.
- Downloads and self-hosted setups are more reliable.

## [v1.3.14](https://github.com/nexmoe/VidBee/releases/tag/v1.3.14) - 2026-07-05
### Requirement Updates
- Updated the bundled yt-dlp runtime from v2026.06.09 to v2026.07.04 so site compatibility stays current.
## [v1.3.11](https://github.com/nexmoe/VidBee/releases/tag/v1.3.11) - 2026-06-19
### Requirement Updates
- Updated the bundled yt-dlp runtime from v2026.03.17 to v2026.06.09 so site compatibility stays current.
## [v1.3.10](https://github.com/nexmoe/VidBee/releases/tag/v1.3.10) - 2026-04-11
### Improvements
- One-click download is enabled by default so you can start downloads faster on first use.
- Download list titles are easier to read with clearer left alignment.

## [v1.3.9](https://github.com/nexmoe/VidBee/releases/tag/v1.3.9) - 2026-04-11
### Improvements
- Custom FFmpeg locations are easier to set: use either the executable path or the folder that contains it.
- Subscription checks show clearer messages when a feed is unavailable or something goes wrong.
- Download status and hints are easier to follow when you need to fix a setting or retry.
- Very long download filenames are shortened automatically on macOS and Linux, matching Windows behavior.
- Where supported, you can use a keyboard shortcut to add a link to downloads more quickly.

## [v1.3.8](https://github.com/nexmoe/VidBee/releases/tag/v1.3.8) - 2026-04-06
### Bug Fixes
- Hardened database migrations so older installs upgrade more reliably.
- Optional tools such as FFmpeg no longer block app startup when they are missing or fail to initialize.
- Subscription checks now avoid noisy error reports for common network or feed-format issues.

### Improvements
- Refined GlitchTip feedback and error reporting details.

## [v1.3.7](https://github.com/nexmoe/VidBee/releases/tag/v1.3.7) - 2026-03-29
### Bug Fixes
- Improved filename sanitization to handle special Unicode characters and control codes.
- Windows downloads now automatically trim overly long filenames.
- Changing the concurrent download limit now takes effect immediately without restarting.

## [v1.3.6](https://github.com/nexmoe/VidBee/releases/tag/v1.3.6) - 2026-03-29

### Features
- Added GlitchTip error reporting and user feedback support
- Added update notification when running an outdated version
- Integrated Rybbit analytics
- Improved download UI details

## [v1.3.5](https://github.com/nexmoe/VidBee/releases/tag/v1.3.5) - 2026-03-18
### Requirement Updates
- Updated the bundled yt-dlp runtime from v2026.03.13 to v2026.03.17 so site compatibility stays current.
## [v1.3.4](https://github.com/nexmoe/VidBee/releases/tag/v1.3.4) - 2026-03-14
### Bug Fixes
- Improved macOS release build reliability by using the default Electron download source during packaging.

## [v1.3.3](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3) - 2026-03-14
### Requirement Updates
- Improved the release pipeline so preview builds can be published separately from production update notifications.

### Bug Fixes
- Restored npm rebuilds during Electron packaging so native dependencies are prepared more reliably in release builds.
- Bundled shared workspace packages more consistently in desktop builds.

## [v1.3.3-preview.1](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3-preview.1) - 2026-03-14
### Bug Fixes
- Restored npm rebuilds during Electron packaging so native dependencies are prepared more reliably in release builds.

## [v1.3.3-preview.0](https://github.com/nexmoe/VidBee/releases/tag/v1.3.3-preview.0) - 2026-03-14
### Requirement Updates
- Added a preview release channel so test builds can be published without triggering production site updates.

### Bug Fixes
- Bundled shared workspace packages more consistently in desktop builds.

## [v1.3.2](https://github.com/nexmoe/VidBee/releases/tag/v1.3.2) - 2026-03-14
### Bug Fixes
- Improved desktop packaging reliability so shared downloader components are bundled more consistently.

## [v1.3.1](https://github.com/nexmoe/VidBee/releases/tag/v1.3.1) - 2026-03-14
### Requirement Updates
- Added web and API editions with shared downloader capabilities and aligned settings behavior.
- Added support for uploading Cookie and config files from Settings.
- Migrated download history storage to SQLite for better reliability and cross-platform consistency.
- Added a shared add-url popover flow in download dialogs and refined dark-theme thumb visibility.

### Bug Fixes
- Improved bundled binary setup resilience and diagnostics in desktop startup scripts.
- Fixed profile input cursor jumping in Settings.
- Fixed Linux download-directory validation when selecting existing non-empty folders.
- Polished localization consistency, including Chinese translation corrections.

## [v1.3.0](https://github.com/nexmoe/VidBee/releases/tag/v1.3.0) - 2026-02-15
### Requirement Updates
- Added new one-click actions so you can paste and start downloading faster.
- Added French, Russian, and Turkish app localization support.
- Completed tray localization for Turkish.
- Reorganized Cookie settings into three clearer groups.
- Added RSSHub portal links to the RSS documentation.

### Bug Fixes
- Improved download compatibility for YouTube and format fallback scenarios.
- Download output now follows the selected container format more consistently.
- Settings and docs were improved, including clearer bug report and RSS guidance.
- Added fallback handling when requested download formats are unavailable.
- Synced missing Turkish locale keys.
- Reduced release pipeline friction with check and workflow fixes.

## [v1.2.4](https://github.com/nexmoe/VidBee/releases/tag/v1.2.4) - 2026-01-24
### Requirement Updates
- The one-click download flow is now more direct with fewer steps.
- A dedicated Cookie tab was added in Settings for easier account-related actions.

### Bug Fixes
- FAQ entry points are clearer and error messages are easier to understand.
- RSS guidance is clearer, especially for new users.

## [v1.2.3](https://github.com/nexmoe/VidBee/releases/tag/v1.2.3) - 2026-01-23
### Bug Fixes
- Playlist loading is more stable and no longer causes layout compression issues.
- Cookie usage guidance now includes clearer examples.

## [v1.2.2](https://github.com/nexmoe/VidBee/releases/tag/v1.2.2) - 2026-01-21
### Requirement Updates
- Download-related actions are easier to access.
- Added an option to include or remove watermarks when sharing.

### Bug Fixes
- Download interactions are more consistent overall.

## [v1.2.1](https://github.com/nexmoe/VidBee/releases/tag/v1.2.1) - 2026-01-20
### Requirement Updates
- Items with the same title in playlists are easier to distinguish.
- It is easier to find logs and related files when troubleshooting.
- Added docs site improvements, including i18n support, sitemap generation, and protocol documentation.

### Bug Fixes
- Download notifications are less intrusive.
- Subscription links and guidance are more reliable.
- Resolved TypeScript build issues in the documentation project.

## [v1.2.0](https://github.com/nexmoe/VidBee/releases/tag/v1.2.0) - 2026-01-17
### Requirement Updates
- Added faster ways to select all and clear download history.
- Playlist and Settings pages are easier to use.
- Minimize-to-tray behavior is now the default.
- Feedback reporting now warns when GitHub issue links are too long.

### Bug Fixes
- Minimize and reopen behavior feels smoother.
- Duplicate items in subscriptions are reduced.
- Resume behavior after interrupted downloads is more reliable.
- Playlist list height is constrained more reliably.
- Feedback issue links are cleaner and more stable.
- Added clearer Windows-only Cookie guidance.
- Strengthened ffmpeg/ffprobe bundle checks.

## [v1.1.12](https://github.com/nexmoe/VidBee/releases/tag/v1.1.12) - 2026-01-15
### Bug Fixes
- Download folder behavior in Settings is more predictable.
- Feedback reports now have clearer supporting information.

## [v1.1.11](https://github.com/nexmoe/VidBee/releases/tag/v1.1.11) - 2026-01-14
### Requirement Updates
- Default settings are better for everyday use.
- Extension error pages and branding were refined.
- Download error panels now include richer troubleshooting links.
- Subscription tabs support horizontal scrolling.

### Bug Fixes
- Download flows and page layouts are clearer.
- Subscription browsing feels smoother.
- Error messages now provide clearer next-step suggestions.
- Added safeguards for Bilibili subtitle embedding failures.
- Missing locale translation entries were filled.
- Embedded thumbnail behavior is safer by default.

## [v1.1.10](https://github.com/nexmoe/VidBee/releases/tag/v1.1.10) - 2026-01-12
### Bug Fixes
- Installation and update experience on macOS is more stable.
- Bundled tools are now signed during macOS builds.
- DMG notarization was tightened in CI for better release reliability.

## [v1.1.8](https://github.com/nexmoe/VidBee/releases/tag/v1.1.8) - 2026-01-12
### Requirement Updates
- Download progress details are easier to read.

### Bug Fixes
- Localized update notifications are clearer.

## [v1.1.7](https://github.com/nexmoe/VidBee/releases/tag/v1.1.7) - 2026-01-11
### Requirement Updates
- Added more media output preference options.

### Bug Fixes
- First-time setup and daily usage flow are smoother.

## [v1.1.6](https://github.com/nexmoe/VidBee/releases/tag/v1.1.6) - 2026-01-11
### Requirement Updates
- Local video information workflows are easier to use.

### Bug Fixes
- Cookie profile management is more stable and predictable.

## [v1.1.5](https://github.com/nexmoe/VidBee/releases/tag/v1.1.5) - 2026-01-10
### Bug Fixes
- Fixed known issues in Advanced Settings.
- Improved remote cover loading stability.
- Subscription cover selection is more reliable.

## [v1.1.4](https://github.com/nexmoe/VidBee/releases/tag/v1.1.4) - 2026-01-09
### Requirement Updates
- Startup window behavior feels more natural.

### Bug Fixes
- Settings behavior is more consistent overall.

## [v1.1.3](https://github.com/nexmoe/VidBee/releases/tag/v1.1.3) - 2026-01-02
### Requirement Updates
- Update status is easier to spot on the About page.

### Bug Fixes
- Format selection is more reliable across scenarios.

## [v1.1.2](https://github.com/nexmoe/VidBee/releases/tag/v1.1.2) - 2025-12-26
### Requirement Updates
- Issue reporting flow is simpler.
- Added issue templates and streamlined bug report forms.

### Bug Fixes
- Restored download availability for more sites.
- CI download steps were hardened for better reliability.

## [v1.1.1](https://github.com/nexmoe/VidBee/releases/tag/v1.1.1) - 2025-12-26
### Requirement Updates
- Update notifications are less disruptive.
- Added JavaScript runtime support for yt-dlp integration.
- Advanced options panels now use smoother animations.

### Bug Fixes
- About page text and links are clearer.
- Download panel interactions feel smoother.
- Electron language resources were limited to English for consistency.

## [v1.1.0](https://github.com/nexmoe/VidBee/releases/tag/v1.1.0) - 2025-12-20
### Requirement Updates
- Added bulk actions for download history cleanup.
- Opening download task links now behaves more predictably.
- Added support for custom download folders.

### Bug Fixes
- RSS setup dialog is easier to understand and fill.

## [v1.0.2](https://github.com/nexmoe/VidBee/releases/tag/v1.0.2) - 2025-12-06
### Bug Fixes
- Added more compatibility options for wider usage scenarios.
- Path input is more forgiving in daily usage.

## [v1.0.1](https://github.com/nexmoe/VidBee/releases/tag/v1.0.1) - 2025-11-16
### Requirement Updates
- Added auto-launch support.
- Language support was further expanded.

## [v1.0.0](https://github.com/nexmoe/VidBee/releases/tag/v1.0.0) - 2025-11-15
### Requirement Updates
- Added RSS subscription downloads.
- Added site icons in supported source lists.
- Introduced remote image loading with caching for media previews.
- Sidebar interactions were refined with draggable title-bar behavior.

### Bug Fixes
- First major stable release of VidBee.
- Navigation and overall interface flow became clearer.
- History and media preview experience were improved.
- Migrated history storage to SQLite (Drizzle) for more reliable data handling.

## [v0.3.5](https://github.com/nexmoe/VidBee/releases/tag/v0.3.5) - 2025-11-08
### Bug Fixes
- One-click download copy and feedback prompts are easier to understand.
- Visual style is more consistent.

## [v0.3.4](https://github.com/nexmoe/VidBee/releases/tag/v0.3.4) - 2025-11-03
### Bug Fixes
- Update prompts and download option display are clearer.

## [v0.3.3](https://github.com/nexmoe/VidBee/releases/tag/v0.3.3) - 2025-11-02
### Bug Fixes
- Download processing stability improved in more scenarios.

## [v0.3.2](https://github.com/nexmoe/VidBee/releases/tag/v0.3.2) - 2025-10-31
### Bug Fixes
- Multi-device distribution experience was improved.

## [v0.3.1](https://github.com/nexmoe/VidBee/releases/tag/v0.3.1) - 2025-10-30
### Requirement Updates
- Linux experience is more user-friendly.
- Added version update notifications for faster upgrades.

## [v0.3.0](https://github.com/nexmoe/VidBee/releases/tag/v0.3.0) - 2025-10-29
### Requirement Updates
- Added playlist download support.
- Added controls to reduce desktop disruption.

## [v0.2.2](https://github.com/nexmoe/VidBee/releases/tag/v0.2.2) - 2025-10-27
### Bug Fixes
- Continued UX polishing during the preview stage.

## [v0.2.1](https://github.com/nexmoe/VidBee/releases/tag/v0.2.1) - 2025-10-26
### Bug Fixes
- Continued UX polishing during the preview stage.

## [v0.2.0](https://github.com/nexmoe/VidBee/releases/tag/v0.2.0) - 2025-10-25
### Bug Fixes
- Continued UX polishing during the preview stage.

## [v0.1.8](https://github.com/nexmoe/VidBee/releases/tag/v0.1.8) - 2025-10-24
### Requirement Updates
- Public preview period started.

## [v0.1.7](https://github.com/nexmoe/VidBee/releases/tag/v0.1.7) - 2025-10-24
### Requirement Updates
- Added auto-updater support and improved release guidance in documentation.
- Improved project documentation, including screenshots and contribution guidelines.

### Bug Fixes
- Simplified download path handling and removed unused output path logic.

## [v0.1.6](https://github.com/nexmoe/VidBee/releases/tag/v0.1.6) - 2025-10-23
### Bug Fixes
- Removed an unnecessary directory creation step in the release workflow.

## [v0.1.5](https://github.com/nexmoe/VidBee/releases/tag/v0.1.5) - 2025-10-23
### Bug Fixes
- Improved the release workflow to download yt-dlp binaries for cross-platform packaging.

## [v0.1.4](https://github.com/nexmoe/VidBee/releases/tag/v0.1.4) - 2025-10-23
### Bug Fixes
- Updated the release workflow to target Windows builds only.

## [v0.1.3](https://github.com/nexmoe/VidBee/releases/tag/v0.1.3) - 2025-10-23
### Bug Fixes
- Simplified release build steps and artifact handling in CI.
- Adjusted CI triggers so pull-request automation runs only for `main`.

## [v0.1.2](https://github.com/nexmoe/VidBee/releases/tag/v0.1.2) - 2025-10-23
### Bug Fixes
- Set an explicit shell for the build step in the release workflow.

## [v0.1.1](https://github.com/nexmoe/VidBee/releases/tag/v0.1.1) - 2025-10-23
### Requirement Updates
- Early release iteration with no additional user-visible changes recorded.

## [v0.1.0](https://github.com/nexmoe/VidBee/releases/tag/v0.1.0) - 2025-10-23
### Requirement Updates
- Initial public release baseline.
