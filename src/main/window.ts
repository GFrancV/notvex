import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { join } from 'path'

import { closeVaultDrained, lockVaultAndNotify, registerIpcHandlers } from './ipc-handlers'
import { getPref } from './prefs'
import { initAutoUpdater } from './updater'
import { isVaultOpen } from './vault/vault'

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'

export function createWindow(takePendingFilePath: () => string | null): BrowserWindow {
  const win = new BrowserWindow({
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

  if (!app.isPackaged) {
    win.setTitle('Notvex - Dev')
    win.on('page-title-updated', (event) => event.preventDefault())
  }

  // Block navigation away from the app
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  // Open external links in system browser, not in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  registerIpcHandlers(win, takePendingFilePath)
  initAutoUpdater(win)

  win.setContentProtection(!getPref('allowScreenCapture'))

  const lockOnSuspend = (): void => {
    void lockVaultAndNotify(win)
  }
  powerMonitor.on('suspend', lockOnSuspend)
  powerMonitor.on('lock-screen', lockOnSuspend)
  powerMonitor.on('user-did-resign-active', lockOnSuspend)

  win.on('minimize', () => {
    if (getPref('lockOnMinimize') && isVaultOpen()) {
      void lockVaultAndNotify(win)
    }
  })

  // Covers a bare win.close() (e.g. the window's own close button) — drain
  // it first instead of relying on window-all-closed, which fires after
  // webContents is already gone and can no longer be sent anything (#19).
  // The app-quit path (Cmd+Q / app.quit()) drains via before-quit instead
  // (see index.ts), since that fires before this window's close event does;
  // by the time it gets here the vault is already closed and this is a
  // harmless no-op.
  let closing = false
  win.on('close', (event) => {
    if (closing || !isVaultOpen()) return
    closing = true
    event.preventDefault()
    void closeVaultDrained(win)
      .catch(() => undefined)
      .finally(() => {
        // Reset before re-closing: a failed drain must not leave this
        // window permanently unable to close.
        closing = false
        win.close()
      })
  })

  return win
}
