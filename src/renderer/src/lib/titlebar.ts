import { notvex } from './ipc'

/**
 * The height of the strip the window controls are drawn over (40 px titleBarOverlay on Windows and
 * Linux, the traffic lights on macOS). Each column's top row uses it, so the three line up.
 */
export const TITLEBAR_ROW = notvex.platform === 'darwin' ? 'h-11' : 'h-10'
