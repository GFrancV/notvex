import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true
  }

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('updater:update-available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('update-not-available', () => {
    mainWindow.webContents.send('updater:update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('updater:download-progress', {
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total
    })
  })

  autoUpdater.on('update-downloaded', () => {
    mainWindow.webContents.send('updater:update-downloaded')
  })

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err)
    mainWindow.webContents.send('updater:error', {
      message: 'Update check failed. Please try again later.'
    })
  })
}
