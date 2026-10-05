import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { join } from 'path'

import {
  cancelPendingConfirmations,
  closeVaultDrained,
  lockVaultAndNotify,
  markRendererReplaced,
  registerIpcHandlers
} from './ipc-handlers'
import { getPref } from './prefs'
import { initAutoUpdater } from './updater'
import { isSafeExternalUrl } from './url-guard'
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

  // The renderer is a SPA and never navigates; any page this window loads
  // would get the preload's window.notvex, so block every navigation —
  // including a dropped file, which navigates to file:// by default (#57).
  // Reloads (Vite HMR, Ctrl+R) don't fire will-navigate.
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  // Open external links in system browser, not in-app — http(s) only (#56)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
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

  // A reloaded or crashed renderer can never answer a prompt sent to the old
  // one, so settle it like a closed window would or unlock stays wedged. The
  // new renderer starts with no vault UI, so drop the key too — null skips the
  // drain, since there is no renderer left with pending edits (#51).
  const onRendererGone = (): void => {
    markRendererReplaced()
    cancelPendingConfirmations()
    void closeVaultDrained(null).catch(() => undefined)
  }
  win.webContents.on('render-process-gone', onRendererGone)
  // did-navigate, not did-start-navigation: the latter fires before
  // will-navigate can block the navigation, so the old page may survive it.
  // did-navigate only fires once a main-frame, cross-document load commits.
  win.webContents.on('did-navigate', onRendererGone)

  win.on('closed', () => {
    // A destroyed window can never answer a pending migration / dev-build
    // prompt, so settle it here or the next unlock stays wedged (#36).
    cancelPendingConfirmations()
    // powerMonitor outlives this window (macOS `activate` builds another),
    // so its listeners must not keep pointing at a dead one (#36).
    powerMonitor.off('suspend', lockOnSuspend)
    powerMonitor.off('lock-screen', lockOnSuspend)
    powerMonitor.off('user-did-resign-active', lockOnSuspend)
  })

  return win
}
