import { app, BrowserWindow } from 'electron'

import {
  extractNvxArgv,
  resolveOpenFilePath,
  setValidatedPending,
  takePendingOpenFilePath
} from './file-opener'
import { closeVaultDrained, stopAutoLockTimer } from './ipc-handlers'
import { cleanupOrphanedTempDbs } from './vault/container'
import { initSodium } from './vault/crypto'
import { isVaultOpen } from './vault/vault'
import { createWindow } from './window'

// ─── Dev/prod isolation ─────────────────────────────────────────────────────────
// Must run before requestSingleInstanceLock() and any getPath('userData') access,
// since both are derived from the app name.

if (!app.isPackaged) {
  app.setName('Notvex Dev')
}

// ─── Single-instance lock ──────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null

void app.whenReady().then(async (): Promise<void> => {
  cleanupOrphanedTempDbs()
  await initSodium()
  mainWindow = createWindow(takePendingOpenFilePath)

  app.on('activate', (): void => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow(takePendingOpenFilePath)
    }
  })
})

app.on('window-all-closed', async (): Promise<void> => {
  stopAutoLockTimer()
  // The window that just closed already drained via its own 'close' handler
  // (window.ts) — this is a no-op safety net, not the primary drain path.
  await closeVaultDrained(null)
  if (process.platform !== 'darwin') app.quit()
})

// On macOS, Cmd+Q / app.quit() fires before-quit *before* any window's
// 'close' event, so this is the primary drain path for that gesture — the
// window-level intercept in window.ts only ever sees an already-closed
// vault by the time it runs (#19).
let quitting = false
app.on('before-quit', (event): void => {
  if (quitting || !isVaultOpen()) return
  quitting = true
  event.preventDefault()
  stopAutoLockTimer()
  void closeVaultDrained(mainWindow)
    .catch(() => undefined)
    .finally(() => app.quit())
})

app.on('second-instance', (_event, argv): void => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
  const filePath = extractNvxArgv(argv)

  if (filePath) {
    resolveOpenFilePath(mainWindow, filePath).catch((e) => {
      console.error('[open-file] resolveOpenFilePath failed:', e)
    })
  }
})

app.on('open-file', (event, filePath): void => {
  event.preventDefault()
  if (mainWindow) {
    resolveOpenFilePath(mainWindow, filePath).catch((e) => {
      console.error('[open-file] resolveOpenFilePath failed:', e)
    })
    return
  }

  setValidatedPending(filePath)
})
