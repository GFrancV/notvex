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

  let onAck!: () => void
  const acked = new Promise<void>((resolve) => {
    onAck = (): void => resolve()
  })
  ipcMain.once('vault:flush-complete', onAck)

  try {
    // Inside the try: webContents can be gone while the window still reports
    // alive, and that throw must not escape — see the catch.
    win.webContents.send('vault:will-lock')
    await Promise.race([
      acked,
      new Promise<void>((resolve) => setTimeout(resolve, FLUSH_ACK_TIMEOUT_MS))
    ])
  } catch {
    // An unreachable renderer is just a renderer that cannot ack. Draining is
    // best-effort; letting this propagate would stop the caller from ever
    // reaching closeVault() and leave the vault open.
  } finally {
    // Only this drain's listener: a concurrent lock must keep its own.
    ipcMain.off('vault:flush-complete', onAck)
  }
}
