import { existsSync } from 'fs'

import type { BrowserWindow } from 'electron'

import { lockAndRecycle } from './ipc-handlers'
import { setPendingVault } from './pending-vault'
import { samePath } from './prefs'
import { isValidNotvexFile } from './vault/container'
import { getVaultPath, isVaultOpen } from './vault/vault'

export function extractNvxArgv(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('-') && arg.toLowerCase().endsWith('.nvx')) {
      return arg
    }
  }
  return null
}

export function setValidatedPending(filePath: string): void {
  if (existsSync(filePath) && isValidNotvexFile(filePath)) {
    setPendingVault({ path: filePath, mode: 'open' })
  }
}

// Cold-start: validate before storing so the renderer never receives a bad path
const _initialNvxArg = extractNvxArgv(process.argv)
if (_initialNvxArg) setValidatedPending(_initialNvxArg)

export async function resolveOpenFilePath(
  win: BrowserWindow | null,
  filePath: string
): Promise<void> {
  if (!existsSync(filePath) || !isValidNotvexFile(filePath)) return

  // Same vault already unlocked → just focus the window
  const currentPath = getVaultPath()
  if (isVaultOpen() && currentPath !== null && samePath(currentPath, filePath)) {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    return
  }

  // A different vault is open → close it first, draining any pending autosave. The fresh
  // renderer reads the file from the pending slot; the old one only hears of it when it
  // survived the close (a failed pack keeps it for its toast).
  if (isVaultOpen()) {
    const { recycled } = await lockAndRecycle(win, { next: { path: filePath, mode: 'open' } })
    if (recycled) return
  }

  // promoteVaultToTop intentionally omitted: recordVaultUsed is called after
  // successful unlock in the vault:open / vault:open-with-recovery handlers.

  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send('vault:open-file', filePath)
  } else {
    setPendingVault({ path: filePath, mode: 'open' })
  }
}
