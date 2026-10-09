import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'

export const FLUSH_ACK_TIMEOUT_MS = 200

// Tags each drain's will-lock/flush-complete round trip so a concurrent
// drain's ack (e.g. suspend and lock-screen firing back to back) can never
// resolve this one early — ipcMain would otherwise invoke every listener
// registered for the channel on a single emitted ack.
let nextRequestId = 0

/**
 * Gives the renderer a brief window to persist pending autosaves while the DB is still open.
 * Bounded by a timeout: a hung or crashed renderer must never keep the vault unlocked.
 */
export async function drainRenderer(
  win: BrowserWindow,
  timeoutMs = FLUSH_ACK_TIMEOUT_MS
): Promise<void> {
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
    const timer = setTimeout(finish, timeoutMs)
    ipcMain.on('vault:flush-complete', onAck)

    try {
      win.webContents.send('vault:will-lock', requestId)
    } catch {
      // webContents can be gone while the window reports alive. Must not escape, or the caller
      // would never reach closeVault().
      finish()
    }
  })
}
