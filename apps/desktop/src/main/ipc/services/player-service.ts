import type { AppIconMenuState } from '@shared/app-icon-menu'
import { type IpcContext, IpcMethod, IpcService } from 'electron-ipc-decorator'
import type { PlayerAttachInput, PlayerAttachResult } from '../../../shared/types/player'
import { setAppIconMenuState } from '../../lib/app-icon-menu'
import { getPlayerHost } from '../../lib/player-host'

class PlayerService extends IpcService {
  static readonly groupName = 'player'

  /**
   * Prepare a Chromium-playable local file for the in-page player.
   */
  @IpcMethod()
  attach(_context: IpcContext, input: PlayerAttachInput): Promise<PlayerAttachResult> {
    return getPlayerHost().attach(input)
  }

  /**
   * Cancel an in-flight media prepare.
   */
  @IpcMethod()
  detach(_context: IpcContext): Promise<void> {
    return getPlayerHost().detach()
  }

  /**
   * Keep dock and tray playback actions in sync with the renderer player.
   */
  @IpcMethod()
  syncIconMenu(_context: IpcContext, state: AppIconMenuState): void {
    setAppIconMenuState(state)
  }
}

export { PlayerService }
