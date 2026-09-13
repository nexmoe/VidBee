import type { YtDlpKernelStatus } from '@shared/types'

export const KERNEL_PREPARATION_ISSUE_TITLE = '[Bug]: Download engine unavailable'

const GITHUB_ISSUE_BASE = 'https://github.com/nexmoe/VidBee/issues/new'
const GITHUB_ISSUE_TEMPLATE = 'bug_report.yml'
const MAX_LOGS_CHARS = 4000
const UNKNOWN_VALUE = 'Unknown'

export interface KernelErrorAppInfo {
  appVersion: string
  osVersion: string
}

/**
 * Truncate diagnostic text so the GitHub issue URL stays within browser limits.
 */
function truncateLogs(value: string): string {
  if (value.length <= MAX_LOGS_CHARS) {
    return value
  }
  return `${value.slice(0, MAX_LOGS_CHARS)}\n…(truncated)`
}

/**
 * Build a copyable report for the kernel preparation failure.
 */
export function buildKernelErrorReport(
  status: YtDlpKernelStatus,
  appInfo: KernelErrorAppInfo
): string {
  const errorText = status.error?.trim() || 'No detailed error was recorded.'
  return [
    '=== VidBee download engine error ===',
    `Timestamp: ${new Date().toISOString()}`,
    `App version: ${appInfo.appVersion.trim() || UNKNOWN_VALUE}`,
    `OS: ${appInfo.osVersion.trim() || UNKNOWN_VALUE}`,
    `State: ${status.state}`,
    `Source: ${status.source ?? 'none'}`,
    `yt-dlp: ${status.ytDlpVersion ?? 'unknown'}`,
    `Node: ${status.nodeVersion ?? 'unknown'}`,
    '',
    '--- Error ---',
    errorText,
    '',
    '=== End of report ==='
  ].join('\n')
}

/**
 * Build a prefilled GitHub bug-report URL for a kernel preparation failure.
 */
export function buildKernelIssueUrl(report: string, appInfo: KernelErrorAppInfo): string {
  const issueParams = new URLSearchParams({
    template: GITHUB_ISSUE_TEMPLATE,
    title: KERNEL_PREPARATION_ISSUE_TITLE,
    actual:
      'VidBee could not prepare a working download engine. Diagnostic details are in the logs field.',
    logs: truncateLogs(report),
    app_version: appInfo.appVersion.trim() ? `VidBee v${appInfo.appVersion.trim()}` : UNKNOWN_VALUE,
    os_version: appInfo.osVersion.trim() || UNKNOWN_VALUE
  })
  return `${GITHUB_ISSUE_BASE}?${issueParams.toString()}`
}
