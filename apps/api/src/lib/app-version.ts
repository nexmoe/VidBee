import releasePackage from '../../../desktop/package.json' with { type: 'json' }

/** Release version shared with Desktop for About and `/rpc/status`. */
export const APP_VERSION = releasePackage.version
