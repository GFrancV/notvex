import type { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// createWindow() runs once per window, and on macOS `activate` can run it many
// times in one process. Anything it hangs on an app-wide emitter must come off
// again when the window closes, or listeners pile up still pointing at dead
// windows (issue #36).

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class MockBrowserWindow extends EventEmitter {
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

vi.mock('../src/main/ipc-handlers', () => ({
  cancelPendingConfirmations: vi.fn(),
  closeVaultDrained: vi.fn(async () => undefined),
  lockVaultAndNotify: vi.fn(async () => undefined),
  markRendererReplaced: vi.fn(),
  registerIpcHandlers: vi.fn()
}))

vi.mock('../src/main/prefs', () => ({ getPref: vi.fn(() => false) }))
vi.mock('../src/main/updater', () => ({ initAutoUpdater: vi.fn() }))
vi.mock('../src/main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))

const POWER_EVENTS = ['suspend', 'lock-screen', 'user-did-resign-active'] as const

describe('createWindow: powerMonitor listeners (issue #36)', () => {
  let powerMonitor: EventEmitter
  let createWindow: typeof import('../src/main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    const electron = await import('electron')
    powerMonitor = electron.powerMonitor as unknown as EventEmitter
    powerMonitor.removeAllListeners()
    ;({ createWindow } = await import('../src/main/window'))
  })

  it('removes its powerMonitor listeners when the window closes', () => {
    const win = createWindow(() => null)
    win.emit('closed')

    for (const event of POWER_EVENTS) expect(powerMonitor.listenerCount(event)).toBe(0)
  })

  it('settles any pending confirmation prompt when the window closes', async () => {
    const { cancelPendingConfirmations } = await import('../src/main/ipc-handlers')
    const win = createWindow(() => null)

    win.emit('closed')

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
  })

  it('locks through the reopened window, not the closed one, on every lock event', async () => {
    const { lockVaultAndNotify } = await import('../src/main/ipc-handlers')
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

// A reload or renderer crash leaves the BrowserWindow alive, so 'closed' never
// fires, yet the prompt was sent to a renderer that no longer exists — and the
// new renderer starts with no vault UI, so the key must not stay in memory (#51).
describe('createWindow: renderer reload / crash (issue #51)', () => {
  let createWindow: typeof import('../src/main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ createWindow } = await import('../src/main/window'))
  })

  it('settles the pending prompt and closes the vault when the renderer crashes', async () => {
    const { cancelPendingConfirmations, closeVaultDrained, markRendererReplaced } =
      await import('../src/main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('render-process-gone')

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
    expect(closeVaultDrained).toHaveBeenCalledExactlyOnceWith(null)
    expect(markRendererReplaced).toHaveBeenCalledTimes(1)
  })

  it('settles the pending prompt and closes the vault once a reload commits', async () => {
    const { cancelPendingConfirmations, closeVaultDrained, markRendererReplaced } =
      await import('../src/main/ipc-handlers')
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
      await import('../src/main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })

    expect(cancelPendingConfirmations).not.toHaveBeenCalled()
    expect(closeVaultDrained).not.toHaveBeenCalled()
    expect(markRendererReplaced).not.toHaveBeenCalled()
  })
})

// The renderer is a SPA and never navigates, and any page the window loads
// gets the preload's window.notvex. A prefix filter let through
// http://localhost.attacker.example and every file:// (a dropped .html file
// navigates there by default), so every navigation is blocked (#57).
describe('createWindow: navigation (issue #57)', () => {
  let createWindow: typeof import('../src/main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ createWindow } = await import('../src/main/window'))
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

// target="_blank" links (note live preview, release notes) and window.open
// reach the OS through setWindowOpenHandler, so it must apply the same scheme
// filter as shell:open-external — file:, ms-msdt:, search-ms: etc. are the
// usual path from "click a link" to code execution on Windows (#56).
describe('createWindow: window-open handler (issue #56)', () => {
  let createWindow: typeof import('../src/main/window').createWindow
  let openExternal: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const electron = await import('electron')
    openExternal = vi.mocked(electron.shell.openExternal)
    ;({ createWindow } = await import('../src/main/window'))
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
