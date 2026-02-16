# VidBee Changelog

This page only includes user-visible updates and avoids implementation details.
For full release notes, see [GitHub Releases](https://github.com/nexmoe/VidBee/releases).

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
