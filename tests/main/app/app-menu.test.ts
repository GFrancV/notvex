import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: class {
    webContents = { send: vi.fn(), reload: vi.fn() }
  },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() }
}))

const { BrowserWindow } = await import('electron')
const { buildMenuTemplate } = await import('@main/app-menu')

type Item = Electron.MenuItemConstructorOptions

function roles(items: Item[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? roles(item.submenu as Item[]) : [])
  ])
}

const PLATFORMS: NodeJS.Platform[] = ['darwin', 'win32', 'linux']

describe('buildMenuTemplate', () => {
  it.each(PLATFORMS)('packaged on %s exposes no reload or DevTools role', (platform) => {
    const found = roles(buildMenuTemplate(true, platform))
    expect(found).not.toContain('reload')
    expect(found).not.toContain('forceReload')
    expect(found).not.toContain('toggleDevTools')
  })

  it.each(PLATFORMS)('dev on %s keeps DevTools but no reload role', (platform) => {
    const found = roles(buildMenuTemplate(false, platform))
    expect(found).toContain('toggleDevTools')
    expect(found).not.toContain('reload')
    expect(found).not.toContain('forceReload')
  })

  it.each(PLATFORMS)('%s keeps editing, zoom and fullscreen shortcuts', (platform) => {
    const found = roles(buildMenuTemplate(true, platform))
    expect(found).toEqual(
      expect.arrayContaining(['editMenu', 'zoomIn', 'zoomOut', 'resetZoom', 'togglefullscreen'])
    )
  })

  // The renderer decides whether to confirm first; the menu must never reload by itself.
  it.each(PLATFORMS)('%s Reload Window asks the renderer instead of reloading', (platform) => {
    const items = buildMenuTemplate(true, platform).flatMap((m) =>
      Array.isArray(m.submenu) ? (m.submenu as Item[]) : []
    )
    const reloadItem = items.find((item) => item.accelerator === 'CmdOrCtrl+R')
    const win = new BrowserWindow()

    reloadItem?.click?.({} as never, win, {} as never)

    expect(reloadItem?.label).toBe('Reload Window')
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith('app:reload-requested')
    expect(win.webContents.reload).not.toHaveBeenCalled()
  })

  it('macOS keeps the app and Window menus', () => {
    const found = roles(buildMenuTemplate(true, 'darwin'))
    expect(found).toEqual(expect.arrayContaining(['appMenu', 'windowMenu']))
  })
})
