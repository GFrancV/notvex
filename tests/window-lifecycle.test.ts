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
// fires, yet the prompt was sent to a renderer that no longer exists (#51).
describe('createWindow: renderer reload / crash (issue #51)', () => {
  let createWindow: typeof import('../src/main/window').createWindow

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ createWindow } = await import('../src/main/window'))
  })

  const navigation = (isMainFrame: boolean, isSameDocument: boolean): object => ({
    isMainFrame,
    isSameDocument
  })

  it('settles any pending confirmation prompt when the renderer crashes', async () => {
    const { cancelPendingConfirmations } = await import('../src/main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('render-process-gone')

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
  })

  it('settles any pending confirmation prompt on a main-frame reload', async () => {
    const { cancelPendingConfirmations } = await import('../src/main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('did-start-navigation', navigation(true, false))

    expect(cancelPendingConfirmations).toHaveBeenCalledTimes(1)
  })

  it('ignores same-document and subframe navigations', async () => {
    const { cancelPendingConfirmations } = await import('../src/main/ipc-handlers')
    const win = createWindow(() => null)

    win.webContents.emit('did-start-navigation', navigation(true, true))
    win.webContents.emit('did-start-navigation', navigation(false, false))

    expect(cancelPendingConfirmations).not.toHaveBeenCalled()
  })
})
