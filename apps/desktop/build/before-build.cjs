const { ensureSherpaNative } = require('../scripts/sherpa-natives.cjs')

/**
 * Fetch the sherpa-onnx native that matches this pack target before
 * electron-builder copies node_modules. Must return true so electron-builder
 * still rebuilds better-sqlite3.
 */
exports.default = async function beforeBuild(context) {
  const { log } = await import('@vidbee/logger/script')
  const platformName = context.platform.nodeName
  await ensureSherpaNative(platformName, context.arch, log)
  return true
}
