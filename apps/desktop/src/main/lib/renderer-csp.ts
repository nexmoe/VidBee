import { app, session } from 'electron'

export const RYBBIT_ORIGIN = 'https://rybbit.102417.xyz'
const USER_IMAGE_SCHEME = 'user-image:'

const BASE_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-eval'", RYBBIT_ORIGIN],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': [
    "'self'",
    'data:',
    'file:',
    'vidbee:',
    'agent-artifact:',
    USER_IMAGE_SCHEME,
    'https://i.ytimg.com',
    'https://img.youtube.com',
    'https://favicon.im'
  ],
  'media-src': ["'self'", 'blob:', 'file:', 'vidbee:', 'agent-artifact:'],
  'connect-src': ["'self'", 'data:', 'blob:', 'file:', 'vidbee:', 'agent-artifact:', RYBBIT_ORIGIN]
}

const appendUnique = (values: string[], extras: string[]): string[] => {
  const next = [...values]
  for (const extra of extras) {
    if (!next.includes(extra)) {
      next.push(extra)
    }
  }
  return next
}

const authOriginFromUrl = (authApiUrl: string): string => {
  return new URL(authApiUrl, 'http://localhost').origin
}

const serializeCsp = (directives: Map<string, string[]>): string => {
  return Array.from(directives.entries())
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

const parseCsp = (policy: string): Map<string, string[]> => {
  const directives = new Map<string, string[]>()
  for (const rawToken of policy.split(';')) {
    const token = rawToken.trim()
    if (token.length === 0) {
      continue
    }
    const [rawDirectiveName, ...directiveValue] = token.split(/\s+/)
    const directiveName = rawDirectiveName?.toLowerCase()
    if (!directiveName || directives.has(directiveName)) {
      continue
    }
    directives.set(directiveName, directiveValue)
  }
  return directives
}

/** Build the renderer CSP, including the auth API origin and Rybbit analytics. */
export function buildRendererContentSecurityPolicy(
  authApiUrl: string,
  allowInlineScripts = false
): string {
  const directives = new Map<string, string[]>()
  for (const [name, values] of Object.entries(BASE_DIRECTIVES)) {
    directives.set(name, [...values])
  }
  if (allowInlineScripts) {
    directives.set(
      'script-src',
      appendUnique(directives.get('script-src') ?? [], ["'unsafe-inline'"])
    )
  }
  directives.set(
    'connect-src',
    appendUnique(directives.get('connect-src') ?? [], [authOriginFromUrl(authApiUrl)])
  )
  return serializeCsp(directives)
}

/** Merge Rybbit, auth API, and avatar proxy origins into an existing CSP header. */
export function mergeRendererContentSecurityPolicy(
  policy: string,
  authApiUrl: string,
  allowInlineScripts = false
): string {
  const origin = authOriginFromUrl(authApiUrl)
  const directives = parseCsp(policy)
  const connectSrc = directives.get('connect-src')
  directives.set(
    'connect-src',
    appendUnique(connectSrc ?? BASE_DIRECTIVES['connect-src'], ["'self'", origin, RYBBIT_ORIGIN])
  )

  const scriptSrc = directives.get('script-src')
  const scriptExtras = allowInlineScripts ? [RYBBIT_ORIGIN, "'unsafe-inline'"] : [RYBBIT_ORIGIN]
  if (scriptSrc) {
    directives.set('script-src', appendUnique(scriptSrc, scriptExtras))
  }

  const imgSrc = directives.get('img-src')
  if (imgSrc) {
    directives.set('img-src', appendUnique(imgSrc, [USER_IMAGE_SCHEME]))
  } else {
    directives.set('img-src', [...BASE_DIRECTIVES['img-src']])
  }

  return serializeCsp(directives)
}

/**
 * Apply a complete renderer CSP as a response header.
 *
 * Better Auth's `csp: true` injects only `connect-src 'self' <api>` when no
 * header exists. That second policy intersects the HTML meta CSP and blocks
 * Rybbit, so Desktop owns the header instead.
 */
export function setupRendererContentSecurityPolicy(authApiUrl: string): void {
  const allowInlineScripts = !app.isPackaged
  void app.whenReady().then(() => {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') {
        callback({ responseHeaders: details.responseHeaders })
        return
      }

      const responseHeaders = details.responseHeaders ?? {}
      const cspKey = Object.keys(responseHeaders).find(
        (key) => key.toLowerCase() === 'content-security-policy'
      )
      if (!cspKey) {
        callback({
          responseHeaders: {
            ...responseHeaders,
            'content-security-policy': [
              buildRendererContentSecurityPolicy(authApiUrl, allowInlineScripts)
            ]
          }
        })
        return
      }

      const policy = responseHeaders[cspKey]?.toString() ?? ''
      callback({
        responseHeaders: {
          ...responseHeaders,
          [cspKey]: [mergeRendererContentSecurityPolicy(policy, authApiUrl, allowInlineScripts)]
        }
      })
    })
  })
}
