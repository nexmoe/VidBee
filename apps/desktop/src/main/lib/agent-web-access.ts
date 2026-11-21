import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import type { TObject } from 'typebox'
import { inAgentDirectory } from './agent-extension-runtime'
import { createAgentPluginRuntime } from './agent-plugin-runtime'
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ToolDefinition
} from './agent-session-types'

export const AGENT_WEB_TOOL_NAMES = ['web_search', 'fetch_content', 'get_search_content'] as const
const factories = new Map<string, ExtensionFactory>()

export interface AgentWebAccessOptions {
  agentDir: string
  packageRoot: string
}

/** Keep provider credentials editable while owning the embedded extension's operating mode. */
function configureWebAccess(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, 'web-search.json')
  const previous = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  const saved: unknown = previous ? JSON.parse(previous) : {}
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('VidBee web-search.json must contain a JSON object')
  }
  const config = {
    provider: 'exa',
    ...saved,
    workflow: 'none',
    toolExposure: 'deferred',
    toolActivation: 'none',
    sourceCheck: { enabled: false },
    githubClone: { enabled: false },
    youtube: { enabled: false },
    allowBrowserCookies: false,
    image: { enabled: false },
    fetch: { allowedModes: ['readable', 'raw'], defaultMode: 'readable' }
  }
  const content = `${JSON.stringify(config, null, 2)}\n`
  if (content !== previous) {
    writeFileSync(file, content, { mode: 0o600 })
  }
}

/** Restrict the web reader to URLs; local media remains owned by VidBee's media tools. */
function assertWebUrls(params: Record<string, unknown>): void {
  const urls = Array.isArray(params.urls) ? params.urls : [params.url]
  for (const value of urls) {
    if (value === undefined) {
      continue
    }
    let url: URL
    try {
      url = new URL(String(value))
    } catch {
      throw new Error('Web content requires an HTTP or HTTPS URL')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Web content requires an HTTP or HTTPS URL')
    }
  }
}

/** Keep the upstream tools and lifecycle while removing terminal UI and summary-model calls. */
function webExtensionApi(pi: ExtensionAPI): ExtensionAPI {
  return new Proxy(pi, {
    get(target, key) {
      if (key === 'registerCommand' || key === 'registerShortcut') {
        return () => undefined
      }
      if (key === 'on') {
        return (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) =>
          Reflect.apply(pi.on, pi, [
            event,
            (value: unknown, ctx: ExtensionContext) => handler(value, { ...ctx, hasUI: false })
          ])
      }
      if (key === 'registerTool') {
        return (tool: ToolDefinition<TObject>) => {
          if (!AGENT_WEB_TOOL_NAMES.some((name) => name === tool.name)) {
            return
          }
          pi.registerTool({
            ...tool,
            parameters:
              tool.name === 'web_search'
                ? {
                    ...tool.parameters,
                    properties: Object.fromEntries(
                      Object.entries(tool.parameters.properties).filter(
                        ([name]) => name !== 'workflow' && name !== 'includeContent'
                      )
                    )
                  }
                : tool.parameters,
            exposure: 'deferred',
            /** Return raw evidence through the app's existing tool event stream. */
            async execute(id, params, signal, onUpdate, ctx) {
              if (tool.name === 'fetch_content') {
                assertWebUrls(params)
              }
              const input =
                tool.name === 'web_search'
                  ? { ...params, workflow: 'none', includeContent: false }
                  : params
              return await tool.execute(id, input, signal, onUpdate, {
                ...ctx,
                hasUI: false
              })
            }
          })
        }
      }
      return Reflect.get(target, key)
    }
  })
}

/** Load the published upstream bundle once per profile without importing host Pi configuration. */
export async function createAgentWebAccess(
  options: AgentWebAccessOptions
): Promise<ExtensionFactory> {
  const directory = resolve(options.agentDir)
  configureWebAccess(directory)
  const key = JSON.stringify([resolve(options.packageRoot), directory])
  let upstream = factories.get(key)
  if (!upstream) {
    const packageFile = join(options.packageRoot, 'package.json')
    const require = createRequire(packageFile)
    const jiti = await createAgentPluginRuntime(options.packageRoot, directory)
    const module = inAgentDirectory(directory, () =>
      jiti(require.resolve('pi-web-access/dist/index.js'))
    ) as {
      default: ExtensionFactory
    }
    upstream = module.default
    factories.set(key, upstream)
  }
  const extension = upstream
  return (pi) => extension(webExtensionApi(pi))
}
