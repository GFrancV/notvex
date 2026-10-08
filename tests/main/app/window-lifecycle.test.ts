import type { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// createWindow() runs once per window, and on macOS `activate` can run it many
// times in one process. Anything it hangs on an app-wide emitter must come off
// again when the window closes, or listeners pile up still pointing at dead
// windows.

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class MockBrowserWindow extends EventEmitter {
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      super()
    }
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn()
    })
    loadURL = vi.fn(async () => undefined)
    loadFile = vi.fn(async () => undefined)
    setTitle = vi.fn()
    setContentProtection = vi.fn()
    isDestroyed = vi.fn(() => false)
    close = vi.fn()
  }
  return {
    app: { isPackaged: true },
    BrowserWindow: MockBrowserWindow,
    powerMonitor: new EventEmitter(),
    shell: { openExternal: vi.fn() }
  }
})

vi.mock('@main/ipc-handlers', () => ({
  cancelPendingConfirmations: vi.fn(),
  closeVaultDrained: vi.fn(async () => undefined),
  lockVaultAndNotify: vi.fn(async () => undefined),
  markRendererReplaced: vi.fn(),
  registerIpcHandlers: vi.fn()
}))

vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => false) }))
vi.mock('@main/updater', () => ({ initAutoUpdater: vi.fn() }))
vi.mock('@main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))

const POWER_EVENTS = ['suspend', 'lock-screen', 'user-did-resign-active'] as const

describe('createWindow: powerMonitor listeners (issue #36)', () => {
  let powerMonitor: EventEmitter
  let createWindow: typeof import('@main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    const electron = await import('electron')
    powerMonitor = electron.powerMonitor as unknown as EventEmitter
    powerMonitor.removeAllListeners()
    ;({ createWindow } = await import('@main/window'))
  })

  it('removes its powerMonitor listeners when the window closes', () => {
    const win = createWindow(() => null)
    win.emit('closed')

    for (const event of POWER_EVENTS) expect(powerMonitor.listenerCount(event)).toBe(0)
  })

  it('settles any pending confirmation prompt when the window closes', async () => {
    const { cancelPendingConfirmations } = await import('@main/ipc-handlers')
    const win = createWindow(() => null)

    win.emit('closed')

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
  })

  it('locks through the reopened window, not the closed one, on every lock event', async () => {
    const { lockVaultAndNotify } = await import('@main/ipc-handlers')
    createWindow(() => null).emit('closed')
    const second = createWindow(() => null)

    for (const event of POWER_EVENTS) powerMonitor.emit(event)

    expect(lockVaultAndNotify).toHaveBeenCalledTimes(POWER_EVENTS.length)
    for (const call of vi.mocked(lockVaultAndNotify).mock.calls) expect(call[0]).toBe(second)
  })

  it('leaves one listener per event after a close and reopen', () => {
    createWindow(() => null).emit('closed')
    createWindow(() => null)

    for (const event of POWER_EVENTS) expect(powerMonitor.listenerCount(event)).toBe(1)
  })
})

describe('createWindow: webPreferences', () => {
  it('runs the renderer sandboxed and isolated from Node', async () => {
    const { createWindow } = await import('@main/window')
    const win = createWindow(() => null) as Electron.BrowserWindow & {
      options: Electron.BrowserWindowConstructorOptions
    }
    win.emit('closed')

    expect(win.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    })
  })

  // The default app menu's Toggle Developer Tools accelerator stays live even
  // with the menu bar hidden, and a console reaches window.notvex directly.
  describe('devTools', () => {
    let app: { isPackaged: boolean }

    beforeEach(async () => {
      app = (await import('electron')).app as unknown as { isPackaged: boolean }
    })

    afterEach(() => {
      app.isPackaged = true
    })

    it.each([
      [true, false],
      [false, true]
    ])('isPackaged=%s → devTools=%s', async (isPackaged, devTools) => {
      app.isPackaged = isPackaged
      const { createWindow } = await import('@main/window')
      const win = createWindow(() => null) as Electron.BrowserWindow & {
        options: Electron.BrowserWindowConstructorOptions
      }
      win.emit('closed')

      expect(win.options.webPreferences?.devTools).toBe(devTools)
    })
  })
})

// A reload or renderer crash leaves the BrowserWindow alive, so 'closed' never
// fires, yet the prompt was sent to a renderer that no longer exists — and the
// new renderer starts with no vault UI, so the key must not stay in memory.
describe('createWindow: renderer reload / crash (issue #51)', () => {
  let createWindow: typeof import('@main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ createWindow } = await import('@main/window'))
  })

  it('settles the pending prompt and closes the vault when the renderer crashes', async () => {
    const { cancelPendingConfirmations, closeVaultDrained, markRendererReplaced } =
      await import('@main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('render-process-gone')

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
    expect(closeVaultDrained).toHaveBeenCalledExactlyOnceWith(null)
    expect(markRendererReplaced).toHaveBeenCalledTimes(1)
  })

  it('settles the pending prompt and closes the vault once a reload commits', async () => {
    const { cancelPendingConfirmations, closeVaultDrained, markRendererReplaced } =
      await import('@main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('did-navigate')

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
    expect(closeVaultDrained).toHaveBeenCalledExactlyOnceWith(null)
    expect(markRendererReplaced).toHaveBeenCalledTimes(1)
  })

  // did-start-navigation fires before will-navigate can block the navigation
  // (e.g. a plain external <a href>), so the old page may well survive it —
  // closing the vault there would drop unsaved edits under a live UI.
  it('leaves the vault alone when a navigation only starts', async () => {
    const { cancelPendingConfirmations, closeVaultDrained, markRendererReplaced } =
      await import('@main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })

    expect(cancelPendingConfirmations).not.toHaveBeenCalled()
    expect(closeVaultDrained).not.toHaveBeenCalled()
    expect(markRendererReplaced).not.toHaveBeenCalled()
  })
})

// The renderer is a SPA that never navigates and any loaded page gets window.notvex, so every
// navigation is blocked, lookalike hosts and dropped files included.
describe('createWindow: navigation (issue #57)', () => {
  let createWindow: typeof import('@main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ createWindow } = await import('@main/window'))
  })

  it.each([
    'file:///C:/Users/me/Downloads/evil.html',
    'http://localhost.attacker.example/',
    'http://localhost:5173/',
    'https://github.com/GFrancV/notvex'
  ])('blocks navigation to %s', (url) => {
    const win = createWindow(() => null)
    const event = { preventDefault: vi.fn() }

    win.webContents.emit('will-navigate', event, url)
    win.emit('closed')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })
})

// The bundle still reads ELECTRON_RENDERER_URL at runtime, so an installed app
// launched with it set would load that (remote) page with the preload. Only a
// dev build may load from the dev server.
describe('createWindow: dev server url (issue #57)', () => {
  let createWindow: typeof import('@main/window').createWindow
  let app: { isPackaged: boolean }

  beforeEach(async () => {
    vi.clearAllMocks()
    app = (await import('electron')).app as unknown as { isPackaged: boolean }
    ;({ createWindow } = await import('@main/window'))
  })

  afterEach(() => {
    app.isPackaged = true
    vi.unstubAllEnvs()
  })

  it('ignores ELECTRON_RENDERER_URL in a packaged build', async () => {
    const { rendererIndexPath } = await import('@main/url-guard')
    vi.stubEnv('ELECTRON_RENDERER_URL', 'https://attacker.example/')

    const win = createWindow(() => null)
    win.emit('closed')

    expect(win.loadURL).not.toHaveBeenCalled()
    expect(win.loadFile).toHaveBeenCalledExactlyOnceWith(rendererIndexPath)
    expect(win.webContents.openDevTools).not.toHaveBeenCalled()
  })

  it('loads the built renderer in a dev build with no dev server', async () => {
    const { rendererIndexPath } = await import('@main/url-guard')
    app.isPackaged = false

    const win = createWindow(() => null)
    win.emit('closed')

    expect(win.loadURL).not.toHaveBeenCalled()
    expect(win.loadFile).toHaveBeenCalledExactlyOnceWith(rendererIndexPath)
  })

  it('loads the dev server in a dev build', () => {
    app.isPackaged = false
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')

    const win = createWindow(() => null)
    win.emit('closed')

    expect(win.loadURL).toHaveBeenCalledExactlyOnceWith('http://localhost:5173')
  })
})

// target="_blank" links (note live preview, release notes) and window.open
// reach the OS through setWindowOpenHandler, so it must apply the same scheme
// filter as shell:open-external — file:, ms-msdt:, search-ms: etc. are the
// usual path from "click a link" to code execution on Windows.
describe('createWindow: window-open handler (issue #56)', () => {
  let createWindow: typeof import('@main/window').createWindow
  let openExternal: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const electron = await import('electron')
    openExternal = vi.mocked(electron.shell.openExternal)
    ;({ createWindow } = await import('@main/window'))
  })

  function openWindow(url: string): unknown {
    const win = createWindow(() => null)
    const [handler] = vi.mocked(win.webContents.setWindowOpenHandler).mock.calls[0]
    win.emit('closed') // drop its powerMonitor listeners; the handler outlives it
    return handler({ url } as Parameters<typeof handler>[0])
  }

  it.each(['https://github.com/GFrancV/notvex', 'http://example.com', 'HTTPS://example.com'])(
    'opens %s in the system browser',
    (url) => {
      expect(openWindow(url)).toEqual({ action: 'deny' })
      expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
    }
  )

  it.each([
    'file://\\\\attacker\\share\\x.exe',
    'file:///C:/Windows/System32/calc.exe',
    'ms-msdt:/id PCWDiagnostic',
    'search-ms:query=x',
    'javascript:alert(1)'
  ])('never hands %s to the OS', (url) => {
    expect(openWindow(url)).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
