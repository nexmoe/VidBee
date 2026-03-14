#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.join(scriptDir, '..')
const packageJsonPath = path.join(desktopDir, 'package.json')
const changelogPath = path.join(desktopDir, 'changelogs', 'CHANGELOG.md')
const releaseMetadataPath = path.join(desktopDir, 'release-metadata.json')
const shanghaiDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

const command = process.argv[2]
const args = process.argv.slice(3)

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'))

const writeJson = (filePath, data) => {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

const setOutput = (name, value) => {
  const outputPath = process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return
  }

  fs.appendFileSync(outputPath, `${name}=${value}\n`)
}

const getArgValue = (name) => {
  const index = args.indexOf(name)
  if (index === -1) {
    return undefined
  }

  return args[index + 1]
}

const hasFlag = (name) => args.includes(name)

const formatShanghaiDate = (date = new Date()) => {
  const parts = Object.fromEntries(
    shanghaiDateFormatter.formatToParts(date).map((part) => [part.type, part.value])
  )

  return `${parts.year}-${parts.month}-${parts.day}`
}

const normalizeVersion = (version) => version.replace(/^v/i, '').trim()

const getNextPatchVersion = (currentVersion) => {
  const match = currentVersion.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)

  if (!match) {
    throw new Error(`Unsupported app version format: ${currentVersion}`)
  }

  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`
}

const getAuthHeaders = () => {
  const token =
    process.env.YTDLP_RELEASE_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.ACCESS_TOKEN

  if (!token) {
    return {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'VidBee ytdlp auto release'
    }
  }

  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'VidBee ytdlp auto release'
  }
}

const fetchLatestYtDlpVersion = async (overrideVersion) => {
  if (overrideVersion) {
    return normalizeVersion(overrideVersion)
  }

  const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', {
    headers: getAuthHeaders()
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch yt-dlp latest release: ${response.status} ${response.statusText}`
    )
  }

  const data = await response.json()
  const tagName = typeof data.tag_name === 'string' ? data.tag_name : ''

  if (!tagName) {
    throw new Error('yt-dlp latest release response did not include tag_name')
  }

  return normalizeVersion(tagName)
}

const prependChangelogEntry = ({
  changelogContent,
  releaseVersion,
  releaseDate,
  previousYtDlpVersion,
  latestYtDlpVersion
}) => {
  const versionSectionIndex = changelogContent.indexOf('\n## [')

  if (versionSectionIndex === -1) {
    throw new Error('Unable to find the first version heading in CHANGELOG.md')
  }

  const changelogEntry = [
    `## [v${releaseVersion}](https://github.com/nexmoe/VidBee/releases/tag/v${releaseVersion}) - ${releaseDate}`,
    '### Requirement Updates',
    `- Updated the bundled yt-dlp runtime from v${previousYtDlpVersion} to v${latestYtDlpVersion} so site compatibility stays current.`,
    ''
  ].join('\n')

  return `${changelogContent.slice(0, versionSectionIndex + 1)}${changelogEntry}${changelogContent.slice(versionSectionIndex + 1)}`
}

const readReleaseState = () => {
  const packageJson = readJson(packageJsonPath)
  const releaseMetadata = readJson(releaseMetadataPath)

  return {
    packageJson,
    currentAppVersion: packageJson.version,
    currentYtDlpVersion: normalizeVersion(releaseMetadata.ytDlpVersion ?? '')
  }
}

const runCheck = async () => {
  const latestYtDlpVersion = await fetchLatestYtDlpVersion(getArgValue('--latest-version'))
  const { currentYtDlpVersion } = readReleaseState()
  const updateAvailable = latestYtDlpVersion !== currentYtDlpVersion

  console.log(`Tracked yt-dlp version: ${currentYtDlpVersion || 'unknown'}`)
  console.log(`Latest yt-dlp version: ${latestYtDlpVersion}`)
  console.log(updateAvailable ? 'yt-dlp update detected.' : 'yt-dlp is already up to date.')

  setOutput('current_ytdlp_version', currentYtDlpVersion)
  setOutput('latest_ytdlp_version', latestYtDlpVersion)
  setOutput('update_available', String(updateAvailable))
}

const runPrepare = async () => {
  const latestYtDlpVersion = await fetchLatestYtDlpVersion(getArgValue('--latest-version'))
  const releaseDate = getArgValue('--release-date') ?? formatShanghaiDate()
  const dryRun = hasFlag('--dry-run')
  const { packageJson, currentAppVersion, currentYtDlpVersion } = readReleaseState()

  if (latestYtDlpVersion === currentYtDlpVersion) {
    console.log('yt-dlp is already up to date. No release changes prepared.')
    setOutput('update_available', 'false')
    setOutput('current_ytdlp_version', currentYtDlpVersion)
    setOutput('latest_ytdlp_version', latestYtDlpVersion)
    setOutput('release_version', currentAppVersion)
    return
  }

  const releaseVersion = getNextPatchVersion(currentAppVersion)
  const updatedPackageJson = { ...packageJson, version: releaseVersion }
  const currentChangelog = fs.readFileSync(changelogPath, 'utf8')
  const updatedChangelog = prependChangelogEntry({
    changelogContent: currentChangelog,
    releaseVersion,
    releaseDate,
    previousYtDlpVersion: currentYtDlpVersion,
    latestYtDlpVersion
  })
  const updatedReleaseMetadata = {
    ytDlpVersion: latestYtDlpVersion
  }

  if (!dryRun) {
    writeJson(packageJsonPath, updatedPackageJson)
    writeJson(releaseMetadataPath, updatedReleaseMetadata)
    fs.writeFileSync(changelogPath, updatedChangelog)
  }

  console.log(`Prepared patch release ${currentAppVersion} -> ${releaseVersion}`)
  console.log(`Bundled yt-dlp ${currentYtDlpVersion} -> ${latestYtDlpVersion}`)
  if (dryRun) {
    console.log('Dry run enabled. No files were written.')
  }

  setOutput('update_available', 'true')
  setOutput('current_ytdlp_version', currentYtDlpVersion)
  setOutput('latest_ytdlp_version', latestYtDlpVersion)
  setOutput('release_date', releaseDate)
  setOutput('release_version', releaseVersion)
}

const main = async () => {
  if (command === 'check') {
    await runCheck()
    return
  }

  if (command === 'prepare') {
    await runPrepare()
    return
  }

  console.error(
    'Usage: node scripts/ytdlp-auto-release.mjs <check|prepare> [--latest-version <version>] [--release-date <YYYY-MM-DD>] [--dry-run]'
  )
  process.exit(1)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
