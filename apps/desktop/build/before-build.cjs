const { ensureSherpaNative } = require('../scripts/sherpa-natives.cjs')

/**
 * Fetch the sherpa-onnx native that matches this pack target before
 * electron-builder copies node_modules. Must return true so electron-builder
 * still rebuilds better-sqlite3.
 */
exports.default = async function beforeBuild(context) {
  let log = console
  try {
    const logger = await import('@vidbee/logger/script')
    log = logger.log
  } catch {
    // electron-builder can still pack if the workspace logger fails to load
  }

  const platformName = context?.platform?.nodeName || process.platform
  const arch = context?.arch || process.arch
  try {
    await ensureSherpaNative(platformName, arch, log)
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    log.error?.(`beforeBuild sherpa native failed: ${message}`)
    throw error
  }
  return true
}
