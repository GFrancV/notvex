import { app, Menu, type MenuItemConstructorOptions } from 'electron'

// Replaces Electron's default menu, whose View → Reload / Force Reload throws the renderer away
// without draining autosaves. No `reload` / `forceReload` role in any build.
export function buildMenuTemplate(
  isPackaged: boolean,
  platform: NodeJS.Platform
): MenuItemConstructorOptions[] {
  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(isPackaged ? [] : [{ role: 'toggleDevTools' } as const])
    ]
  }

  if (platform === 'darwin') {
    return [{ role: 'appMenu' }, { role: 'editMenu' }, view, { role: 'windowMenu' }]
  }
  return [{ role: 'editMenu' }, view]
}

export function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildMenuTemplate(app.isPackaged, process.platform))
  )
}
