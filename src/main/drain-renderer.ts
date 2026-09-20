import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

export const FLUSH_ACK_TIMEOUT_MS = 200

/**
 * Give the renderer a brief window to persist anything still sitting in its
 * autosave debounce, while the database is still open (#19).
 *
 * Bounded by construction: a renderer that is hung, crashed or simply not
 * listening must never keep an unlocked vault on screen, so the wait is a race
 * against the timeout rather than a condition we hope resolves.
 */
export async function drainRenderer(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return
  const acked = new Promise<void>((resolve) => {
    ipcMain.once('vault:flush-complete', () => resolve())
  })
  win.webContents.send('vault:will-lock')
  try {
    await Promise.race([
      acked,
      new Promise<void>((resolve) => setTimeout(resolve, FLUSH_ACK_TIMEOUT_MS))
    ])
  } finally {
    // Drop the listener either way, so a late ack cannot resolve the next lock.
    ipcMain.removeAllListeners('vault:flush-complete')
  }
}
