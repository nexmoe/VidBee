import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { DesktopMcpCapabilityGroup, DesktopMcpStatus } from '../../../shared/mcp'
import { getMcpStatus, rotateMcpToken, setMcpEnabled } from '../../mcp/config'
import { closeMcpRequests } from '../../mcp/http'
import { desktopMcpTools, getDesktopMcpCapabilities } from '../../mcp/server'

class McpService extends IpcService {
  static readonly groupName = 'mcp'

  /** Read private connection configurations for the local Settings interface. */
  @IpcMethod()
  getStatus(_context: IpcContext): DesktopMcpStatus {
    return getMcpStatus(desktopMcpTools.length)
  }

  /** List every registered capability even when external access is disabled. */
  @IpcMethod()
  getCapabilities(_context: IpcContext): DesktopMcpCapabilityGroup[] {
    return getDesktopMcpCapabilities()
  }

  /** Persist external-access preferences and stop active clients when access is disabled. */
  @IpcMethod()
  async setEnabled(_context: IpcContext, enabled: boolean): Promise<DesktopMcpStatus> {
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean')
    }
    setMcpEnabled(enabled)
    if (!enabled) {
      await closeMcpRequests()
    }
    return getMcpStatus(desktopMcpTools.length)
  }

  /** Replace the bearer token and terminate connections authenticated with the previous token. */
  @IpcMethod()
  async rotateToken(_context: IpcContext): Promise<DesktopMcpStatus> {
    rotateMcpToken()
    await closeMcpRequests()
    return getMcpStatus(desktopMcpTools.length)
  }
}

export { McpService }
