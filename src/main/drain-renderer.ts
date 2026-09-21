import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

export const FLUSH_ACK_TIMEOUT_MS = 200

// Tags each drain's will-lock/flush-complete round trip so a concurrent
// drain's ack (e.g. suspend and lock-screen firing back to back) can never
// resolve this one early — ipcMain would otherwise invoke every listener
// registered for the channel on a single emitted ack.
let nextRequestId = 0

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

  const requestId = ++nextRequestId

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      ipcMain.off('vault:flush-complete', onAck)
      resolve()
    }
    const onAck = (_e: unknown, ackId?: number): void => {
      if (ackId === requestId) finish()
    }
    // The timer is what bounds the wait: it always fires, so this promise
    // always settles even if the renderer never answers.
    const timer = setTimeout(finish, FLUSH_ACK_TIMEOUT_MS)
    ipcMain.on('vault:flush-complete', onAck)

    try {
      win.webContents.send('vault:will-lock', requestId)
    } catch {
      // webContents can be gone while the window still reports alive. An
      // unreachable renderer is just one that cannot ack, and draining is
      // best-effort — but this must not escape, or the caller would never
      // reach closeVault() and the vault would stay open.
      finish()
    }
  })
}
