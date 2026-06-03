import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { initSodium } from './vault/crypto'
import { closeVault } from './vault/vault'
import { registerIpcHandlers, stopAutoLockTimer } from './ipc-handlers'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#111111',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      sandbox: false, // must be false for preload to work
    },
  })

  // Block navigation away from the app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  // Open external links in system browser, not in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerIpcHandlers(mainWindow)
}

app.whenReady().then(async () => {
  await initSodium()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  stopAutoLockTimer()
  await closeVault()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  stopAutoLockTimer()
  await closeVault()
})
