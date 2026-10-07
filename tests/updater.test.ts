import type { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// autoUpdater is app-wide, but createWindow() calls initAutoUpdater() once per
// window — and macOS `activate` creates more than one.

vi.mock('electron', () => ({ app: { isPackaged: true } }))

vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  return { autoUpdater: new EventEmitter() }
})

// Like a real BrowserWindow, sending to a destroyed one throws.
function fakeWindow(): { win: BrowserWindow; sent: string[]; destroy: () => void } {
  const sent: string[] = []
  let destroyed = false
  const win = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string) => {
        if (destroyed) throw new Error('Object has been destroyed')
        sent.push(channel)
      }
    }
  } as unknown as BrowserWindow
  return { win, sent, destroy: () => (destroyed = true) }
}

describe('initAutoUpdater across windows (issue #36)', () => {
  let autoUpdater: EventEmitter
  let initAutoUpdater: typeof import('../src/main/updater').initAutoUpdater

  beforeEach(async () => {
    vi.resetModules()
    ;({ autoUpdater } = (await import('electron-updater')) as unknown as {
      autoUpdater: EventEmitter
    })
    autoUpdater.removeAllListeners()
    ;({ initAutoUpdater } = await import('../src/main/updater'))
  })

  it('registers each autoUpdater listener only once', () => {
    initAutoUpdater(fakeWindow().win)
    initAutoUpdater(fakeWindow().win)

    expect(autoUpdater.listenerCount('update-downloaded')).toBe(1)
  })

  it('sends updater events to the newest window only', () => {
    const first = fakeWindow()
    initAutoUpdater(first.win)
    first.destroy()
    const second = fakeWindow()
    initAutoUpdater(second.win)

    autoUpdater.emit('update-downloaded')

    expect(second.sent).toEqual(['updater:update-downloaded'])
    expect(first.sent).toEqual([])
  })

  it('drops updater events while no window is alive', () => {
    const only = fakeWindow()
    initAutoUpdater(only.win)
    only.destroy()

    expect(() => autoUpdater.emit('update-downloaded')).not.toThrow()
  })
})
