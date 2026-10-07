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
// Not app.isReady(): open-file can also arrive while initSodium() is still
// pending, and opening a window there would run before sodium is ready and
// leave startup to open a second one.
let startupDone = false

function openMainWindow(): void {
  const win = createWindow(takePendingOpenFilePath)
  // On macOS the app outlives its last window; open-file / second-instance
  // must not reuse the destroyed one.
  win.on('closed', (): void => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win
}

void app.whenReady().then(async (): Promise<void> => {
  cleanupOrphanedTempDbs()
  await initSodium()
  openMainWindow()
  startupDone = true

  app.on('activate', (): void => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
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
    // The window that just closed already drained via its own 'close'
    // handler (window.ts) — this is a safety net, not the primary drain path.
    void closeVaultDrained(null)
    return
  }
  app.quit() // before-quit does the real shutdown
})

// On macOS, Cmd+Q / app.quit() fires before-quit *before* any window's
// 'close' event, so this is the primary drain path for that gesture — the
// window-level intercept in window.ts only ever sees an already-closed
// vault by the time it runs.
app.on('before-quit', (event): void => {
  if (readyToQuit) return // our own re-entrant app.quit(): let it through
  event.preventDefault() // synchronous, before any await
  if (isQuitting) return // a duplicate quit signal while one is already in flight
  isQuitting = true
  void (async (): Promise<void> => {
    try {
      stopAutoLockTimer()
      await closeVaultDrained(mainWindow)
    } catch (e) {
      console.error('[quit] closeVault failed:', e)
    } finally {
      readyToQuit = true
      app.quit() // re-enters before-quit, which now lets it through
    }
  })()
})

app.on('second-instance', (_event, argv): void => {
  const filePath = extractNvxArgv(argv)

  // Same as open-file: no window means store the path and, once started,
  // open a window for it — the user relaunched the app either way.
  if (!mainWindow) {
    if (filePath) setValidatedPending(filePath)
    if (startupDone && !isQuitting) openMainWindow()
    return
  }

  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()

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

  // No window yet (cold start) or anymore (macOS dock): store the path; the
  // window's renderer picks it up via takePendingOpenFilePath on load. No new
  // window mid-quit: it would re-arm the auto-lock timer before-quit stopped.
  setValidatedPending(filePath)
  if (startupDone && !isQuitting) openMainWindow()
})
