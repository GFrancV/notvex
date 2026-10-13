import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

// Replaces Electron's default menu, whose View → Reload / Force Reload throws the renderer away
// without draining autosaves. No `reload` / `forceReload` role in any build: Reload Window only
// asks the renderer, which confirms with the user and then calls app:reload-window.
export function buildMenuTemplate(
  isPackaged: boolean,
  platform: NodeJS.Platform
): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      {
        label: 'Reload Window',
        accelerator: 'CmdOrCtrl+R',
        click: (_item, win) => {
          if (win instanceof BrowserWindow) win.webContents.send('app:reload-requested')
        }
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(isPackaged ? [] : [{ role: 'toggleDevTools' } as const])
    ]
  }

  // fileMenu holds Close (Cmd+W) on macOS; elsewhere windowMenu holds it (Ctrl+W) with Minimize.
  if (platform === 'darwin') {
    return [
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      view,
      { role: 'windowMenu' }
    ]
  }
  return [{ role: 'editMenu' }, view, { role: 'windowMenu' }]
}

export function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildMenuTemplate(app.isPackaged, process.platform))
  )
}
