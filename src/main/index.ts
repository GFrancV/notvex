import { join } from 'path'

import { app, BrowserWindow, powerMonitor, shell } from 'electron'

import { lockVaultAndNotify, registerIpcHandlers, stopAutoLockTimer } from './ipc-handlers'
import { getPref } from './prefs'
import { initSodium } from './vault/crypto'
import { closeVault, isVaultOpen } from './vault/vault'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#111111',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#111111',
      symbolColor: '#e5e5e5',
      height: 32
    },
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

  registerIpcHandlers(mainWindow)

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
  await initSodium()
  createWindow()

  app.on('activate', (): void => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', (): void => {
  void (async (): Promise<void> => {
    stopAutoLockTimer()
    await closeVault()
    if (process.platform !== 'darwin') app.quit()
  })()
})

app.on('before-quit', (): void => {
  void (async (): Promise<void> => {
    stopAutoLockTimer()
    await closeVault()
  })()
})
