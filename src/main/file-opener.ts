import { existsSync } from 'fs'

import type { BrowserWindow } from 'electron'

import type { PendingVault } from '@shared/types'

import { closeVaultDrained } from './ipc-handlers'
import { samePath } from './prefs'
import { isValidNotvexFile } from './vault/container'
import { getVaultPath, isVaultOpen } from './vault/vault'

let pendingVault: PendingVault | null = null

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
    pendingVault = { path: filePath, mode: 'open' }
  }
}

// Cold-start: validate before storing so the renderer never receives a bad path
const _initialNvxArg = extractNvxArgv(process.argv)
if (_initialNvxArg) setValidatedPending(_initialNvxArg)

export function takePendingVault(): PendingVault | null {
  const p = pendingVault
  pendingVault = null
  return p
}

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

  // A different vault is open → close it first, draining any
  // pending autosave in the window we're about to repurpose
  if (isVaultOpen()) {
    await closeVaultDrained(win)
  }

  // promoteVaultToTop intentionally omitted: recordVaultUsed is called after
  // successful unlock in the vault:open / vault:open-with-recovery handlers.

  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send('vault:open-file', filePath)
  } else {
    pendingVault = { path: filePath, mode: 'open' }
  }
}
