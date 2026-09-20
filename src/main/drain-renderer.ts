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

  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      // Only this drain's listener: a concurrent lock must keep its own.
      ipcMain.off('vault:flush-complete', done)
      resolve()
    }
    // The timer is what bounds the wait: it always fires, so this promise
    // always settles even if the renderer never answers.
    const timer = setTimeout(done, FLUSH_ACK_TIMEOUT_MS)
    ipcMain.once('vault:flush-complete', done)

    try {
      win.webContents.send('vault:will-lock')
    } catch {
      // webContents can be gone while the window still reports alive. An
      // unreachable renderer is just one that cannot ack, and draining is
      // best-effort — but this must not escape, or the caller would never
      // reach closeVault() and the vault would stay open.
      done()
    }
  })
}
