import { app, BrowserWindow } from 'electron'

import {
  extractNvxArgv,
  resolveOpenFilePath,
  setValidatedPending,
  takePendingOpenFilePath
} from './file-opener'
import { stopAutoLockTimer } from './ipc-handlers'
import { cleanupOrphanedTempDbs } from './vault/container'
import { initSodium } from './vault/crypto'
import { closeVault } from './vault/vault'
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
let isQuitting = false
let readyToQuit = false

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

app.on('window-all-closed', (): void => {
  if (process.platform === 'darwin') {
    // Closing the last window doesn't quit the app on macOS (dock
    // convention), so the vault still needs to lock here. This call can
    // also fire mid-shutdown (e.g. during autoUpdater.quitAndInstall(),
    // which closes windows before before-quit) — safe either way because
    // closeVault() is serialized (withVaultLock) and idempotent, not
    // because no quit could be in progress.
    stopAutoLockTimer()
    void closeVault()
    return
  }
  app.quit() // before-quit does the real shutdown
})

app.on('before-quit', (event): void => {
  if (readyToQuit) return // our own re-entrant app.quit(): let it through
  event.preventDefault() // synchronous, before any await
  if (isQuitting) return // a duplicate quit signal while one is already in flight
  isQuitting = true
  void (async (): Promise<void> => {
    try {
      stopAutoLockTimer()
      await closeVault()
    } catch (e) {
      console.error('[quit] closeVault failed:', e)
    } finally {
      readyToQuit = true
      app.quit() // re-enters before-quit, which now lets it through
    }
  })()
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
