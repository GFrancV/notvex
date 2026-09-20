import type { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { drainRenderer, FLUSH_ACK_TIMEOUT_MS } from '../src/main/drain-renderer'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { ipcMain: new EventEmitter() }
})

/** The mocked ipcMain is a real EventEmitter, so acks are just emitted events. */
const ipc = ipcMain as unknown as EventEmitter

function fakeWindow(destroyed = false): { win: BrowserWindow; sent: string[] } {
  const sent: string[] = []
  const win = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string): void => {
        sent.push(channel)
      }
    }
  } as unknown as BrowserWindow
  return { win, sent }
}

describe('drainRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    ipc.removeAllListeners()
  })

  it('1 · locks anyway when the renderer never acks', async () => {
    // The security property: a hung, crashed or non-listening renderer must
    // never keep an unlocked vault on screen.
    const { win, sent } = fakeWindow()

    let settled = false
    const drained = drainRenderer(win).then(() => {
      settled = true
    })

    expect(sent).toEqual(['vault:will-lock'])

    await vi.advanceTimersByTimeAsync(FLUSH_ACK_TIMEOUT_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await drained
    expect(settled).toBe(true)
  })

  it('2 · resolves as soon as the renderer acks, without waiting out the timeout', async () => {
    const { win } = fakeWindow()

    let settled = false
    const drained = drainRenderer(win).then(() => {
      settled = true
    })

    ipc.emit('vault:flush-complete')
    await drained

    // Resolved without any timer having been advanced.
    expect(settled).toBe(true)
  })

  it('3 · does nothing when the window is already destroyed', async () => {
    const { win, sent } = fakeWindow(true)

    await drainRenderer(win)

    expect(sent).toEqual([])
    expect(ipc.listenerCount('vault:flush-complete')).toBe(0)
  })

  it('4 · drops its listener, so a stale ack cannot resolve the next lock', async () => {
    const { win } = fakeWindow()

    const first = drainRenderer(win)
    ipc.emit('vault:flush-complete')
    await first

    expect(ipc.listenerCount('vault:flush-complete')).toBe(0)
    // A late ack from the previous cycle arrives with no drain in flight.
    ipc.emit('vault:flush-complete')

    let settled = false
    const second = drainRenderer(win).then(() => {
      settled = true
    })

    // The second drain must wait for its own ack, not inherit the stale one.
    await vi.advanceTimersByTimeAsync(FLUSH_ACK_TIMEOUT_MS - 1)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(settled).toBe(true)
  })

  it('5 · survives an unreachable renderer instead of blocking the lock', async () => {
    // webContents can be gone while the window itself still reports alive. If
    // that throw escaped, lockVaultAndNotify would never reach closeVault() —
    // the drain meant to protect data would be leaving the vault open.
    const win = {
      isDestroyed: () => false,
      webContents: {
        send: (): never => {
          throw new Error('Render frame was disposed')
        }
      }
    } as unknown as BrowserWindow

    await expect(drainRenderer(win)).resolves.toBeUndefined()
    expect(ipc.listenerCount('vault:flush-complete')).toBe(0)
  })
})
