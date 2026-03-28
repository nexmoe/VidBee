import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const requiredEnvKeys = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_URL']
const missingEnvKeys = requiredEnvKeys.filter((key) => !process.env[key]?.trim())

if (missingEnvKeys.length > 0) {
  console.error(`Missing required GlitchTip environment variables: ${missingEnvKeys.join(', ')}`)
  process.exit(1)
}

const projectRoot = path.resolve(import.meta.dirname, '..')
const outputDir = path.join(projectRoot, 'out')
if (!existsSync(outputDir)) {
  console.error(`Build output not found at ${outputDir}. Run "pnpm run build" first.`)
  process.exit(1)
}

const { default: SentryCli } = await import('@sentry/cli')

const release = process.env.SENTRY_RELEASE?.trim() || `vidbee-desktop@${pkg.version}`
const cli = new SentryCli(undefined, {
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  url: process.env.SENTRY_URL,
  vcsRemote: 'origin'
})

try {
  console.info(`Creating release ${release}`)
  await cli.releases.new(release)
  await cli.releases.setCommits(release, {
    auto: true,
    ignoreMissing: true
  })
  await cli.releases.uploadSourceMaps(release, {
    include: [outputDir],
    rewrite: true,
    urlPrefix: '~/'
  })
  await cli.releases.finalize(release)
  console.info(`Uploaded source maps for ${release}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to upload GlitchTip source maps: ${message}`)
  if (message.includes('download the sentry-cli binary')) {
    console.error(
      'If pnpm blocked @sentry/cli postinstall, run "pnpm approve-builds" and allow @sentry/cli.'
    )
  }
  process.exit(1)
}
