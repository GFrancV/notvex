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

  it('leaves one listener per event after a close and reopen', () => {
    createWindow(() => null).emit('closed')
    createWindow(() => null)

    for (const event of POWER_EVENTS) expect(powerMonitor.listenerCount(event)).toBe(1)
  })
})
