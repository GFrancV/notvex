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
  await closeVault()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (): Promise<void> => {
  stopAutoLockTimer()
  await closeVault()
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
