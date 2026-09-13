export const APP_ICON_MENU_COMMAND_CHANNEL = 'playback:icon-menu'

export type AppIconMenuCommand = 'next' | 'previous' | 'toggle'

export interface AppIconMenuState {
  canNext: boolean
  canPrevious: boolean
  canToggle: boolean
  playing: boolean
}

export const EMPTY_APP_ICON_MENU_STATE: AppIconMenuState = {
  canNext: false,
  canPrevious: false,
  canToggle: false,
  playing: false
}

/**
 * Derive dock/tray playback actions from the current session and playlist.
 */
export const buildAppIconMenuState = (input: {
  playlistCount: number
  playing: boolean
  sessionId: string | null
}): AppIconMenuState => {
  const hasSession = Boolean(input.sessionId)
  return {
    canNext: hasSession && input.playlistCount > 1,
    canPrevious: hasSession,
    canToggle: hasSession || input.playlistCount > 0,
    playing: hasSession && input.playing
  }
}

/**
 * True when two icon-menu snapshots would render the same items.
 */
export const sameAppIconMenuState = (left: AppIconMenuState, right: AppIconMenuState): boolean =>
  left.canNext === right.canNext &&
  left.canPrevious === right.canPrevious &&
  left.canToggle === right.canToggle &&
  left.playing === right.playing

/**
 * Narrow a renderer IPC payload to a known icon-menu command.
 */
export const isAppIconMenuCommand = (value: unknown): value is AppIconMenuCommand =>
  value === 'next' || value === 'previous' || value === 'toggle'
