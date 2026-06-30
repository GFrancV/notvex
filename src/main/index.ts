import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { readdirSync, statSync, unlinkSync } from 'fs'
import os from 'os'
import { join } from 'path'

import {
  extractNvxArgv,
  resolveOpenFilePath,
  setValidatedPending,
  takePendingOpenFilePath
} from './file-opener'
import { lockVaultAndNotify, registerIpcHandlers, stopAutoLockTimer } from './ipc-handlers'
import { getPref } from './prefs'
import { initSodium } from './vault/crypto'
import { closeVault, isVaultOpen } from './vault/vault'

// ─── Single-instance lock ──────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let mainWindow: BrowserWindow | null = null

function cleanupOrphanedTempDbs(): void {
  const tmpDir = os.tmpdir()
  const ONE_HOUR_MS = 60 * 60 * 1000
  const now = Date.now()
  // Pattern matches exactly what makeTempDbPath() produces: notvex_<16 hex>.db
  const notvexTempPattern = /^notvex_[a-f0-9]{16}\.db(-wal|-shm)?$/
  try {
    const files = readdirSync(tmpDir)
    for (const file of files) {
      if (!notvexTempPattern.test(file)) continue
      try {
        const { mtimeMs } = statSync(join(tmpDir, file))
        if (now - mtimeMs > ONE_HOUR_MS) {
          unlinkSync(join(tmpDir, file))
        }
      } catch {
        /* in use, already deleted, or no permissions — skip */
      }
    }
  } catch {
    /* tmpdir not accessible — skip */
  }
}

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1020,
    minHeight: 740,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    ...(isWindows && {
      titleBarOverlay: {
        color: '#0a0a0a', // --card / --sidebar token equivalent
        symbolColor: '#a3a3a3', // --muted-foreground token equivalent
        height: 40
      }
    }),
    ...(isMac && {
      trafficLightPosition: {
        x: 14,
        y: 13
      }
    }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: false // must be false for preload to work
    }
  })

  // Block navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  // Open external links in system browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  registerIpcHandlers(mainWindow, takePendingOpenFilePath)

  mainWindow.setContentProtection(!getPref('allowScreenCapture'))

  powerMonitor.on('suspend', () => {
    void lockVaultAndNotify(mainWindow!)
  })
  powerMonitor.on('lock-screen', () => {
    void lockVaultAndNotify(mainWindow!)
  })
  powerMonitor.on('user-did-resign-active', () => {
    void lockVaultAndNotify(mainWindow!)
  })

  mainWindow.on('minimize', () => {
    if (getPref('lockOnMinimize') && isVaultOpen()) {
      void lockVaultAndNotify(mainWindow!)
    }
  })
}

void app.whenReady().then(async (): Promise<void> => {
  cleanupOrphanedTempDbs()
  await initSodium()
  createWindow()

  app.on('activate', (): void => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
