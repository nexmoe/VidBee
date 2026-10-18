/** Connection details displayed only inside Desktop and stored in a private local file. */
export interface DesktopMcpStatus {
  enabled: boolean
  running: boolean
  url: string | null
  configPath: string
  toolCount: number
  httpConfig: string
  stdioConfig: string
}

/** A registered capability and its human-readable label for the Settings inventory. */
export interface DesktopMcpCapability {
  name: string
  labelKey: string
  description: string
}

/** Group real registered tools, resources and workflows without maintaining a second tool list. */
export interface DesktopMcpCapabilityGroup {
  id: string
  kind: 'tools' | 'resources' | 'prompts'
  items: DesktopMcpCapability[]
}
