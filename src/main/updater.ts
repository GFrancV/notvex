import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

import { logError } from './log'

// autoUpdater is app-wide but createWindow() calls this once per window, and
// macOS `activate` creates more than one. Listeners are registered once and
// send to the latest window, skipping it while it's destroyed.
let currentWin: BrowserWindow | null = null
let listenersRegistered = false

function send(channel: string, ...args: unknown[]): void {
  if (currentWin && !currentWin.isDestroyed()) currentWin.webContents.send(channel, ...args)
}

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  currentWin = mainWindow
  if (listenersRegistered) return
  listenersRegistered = true

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('update-available', (info) => {
    send('updater:update-available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('update-not-available', () => {
    send('updater:update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    send('updater:download-progress', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', () => {
    send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    logError('[updater] error:', err)
    send('updater:error', {
      message: 'Update check failed. Please try again later.'
    })
  })
}
