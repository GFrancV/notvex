import type { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// autoUpdater is app-wide, but createWindow() calls initAutoUpdater() once per
// window — and macOS `activate` creates more than one.

const netFetch = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ app: { isPackaged: true }, net: { fetch: netFetch } }))

vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  return { autoUpdater: new EventEmitter() }
})

// Like a real BrowserWindow, sending to a destroyed one throws.
function fakeWindow(): {
  win: BrowserWindow
  sent: string[]
  payloads: unknown[]
  destroy: () => void
} {
  const sent: string[] = []
  const payloads: unknown[] = []
  let destroyed = false
  const win = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload?: unknown) => {
        if (destroyed) throw new Error('Object has been destroyed')
        sent.push(channel)
        payloads.push(payload)
      }
    }
  } as unknown as BrowserWindow
  return { win, sent, payloads, destroy: () => (destroyed = true) }
}

describe('initAutoUpdater across windows (issue #36)', () => {
  let autoUpdater: EventEmitter
  let initAutoUpdater: typeof import('@main/updater').initAutoUpdater

  beforeEach(async () => {
    vi.resetModules()
    ;({ autoUpdater } = (await import('electron-updater')) as unknown as {
      autoUpdater: EventEmitter
    })
    autoUpdater.removeAllListeners()
    ;({ initAutoUpdater } = await import('@main/updater'))
  })

  it("turns off electron-updater's own console logger", () => {
    initAutoUpdater(fakeWindow().win)

    expect((autoUpdater as unknown as { logger: unknown }).logger).toBeNull()
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

describe('update-available payload', () => {
  let autoUpdater: EventEmitter
  let initAutoUpdater: typeof import('@main/updater').initAutoUpdater

  beforeEach(async () => {
    vi.resetModules()
    netFetch.mockReset()
    ;({ autoUpdater } = (await import('electron-updater')) as unknown as {
      autoUpdater: EventEmitter
    })
    autoUpdater.removeAllListeners()
    ;({ initAutoUpdater } = await import('@main/updater'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const availableInfo = {
    version: '1.2.3',
    releaseNotes: '<p>Full notes</p>',
    releaseDate: '2026-11-01T10:00:00.000Z',
    files: [{ url: 'Notvex-Setup-1.2.3.exe', sha512: 'x', size: 104857600 }]
  }

  async function sentPayload(): Promise<unknown> {
    const w = fakeWindow()
    initAutoUpdater(w.win)
    autoUpdater.emit('update-available', availableInfo)
    await vi.waitFor(() => expect(w.payloads).toHaveLength(1))
    return w.payloads[0]
  }

  it('sends the in-app summary, security flag, date, size and release link', async () => {
    netFetch.mockResolvedValue(
      new Response(JSON.stringify({ body: '<!-- in-app\nFaster search.\nSecurity: yes\n-->' }))
    )

    expect(await sentPayload()).toEqual({
      version: '1.2.3',
      releaseNotes: '<p>Full notes</p>',
      summary: 'Faster search.',
      security: true,
      releaseDate: '2026-11-01T10:00:00.000Z',
      size: 104857600,
      releaseUrl: 'https://github.com/GFrancV/notvex/releases/tag/v1.2.3'
    })
  })

  it('asks the GitHub API only for the release tagged with the new version', async () => {
    netFetch.mockResolvedValue(new Response(JSON.stringify({ body: '' })))

    await sentPayload()

    expect(netFetch).toHaveBeenCalledOnce()
    expect(netFetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/GFrancV/notvex/releases/tags/v1.2.3'
    )
  })

  it('sends no summary and no security flag when the body has no in-app block', async () => {
    netFetch.mockResolvedValue(
      new Response(JSON.stringify({ body: '## Fixed\n- A bug\nSecurity: yes' }))
    )

    expect(await sentPayload()).toMatchObject({
      releaseNotes: '<p>Full notes</p>',
      summary: null,
      security: false
    })
  })

  it.each([
    [
      'the request rejects',
      () => netFetch.mockRejectedValue(new Error('net::ERR_INTERNET_DISCONNECTED'))
    ],
    [
      'the API answers with an error status',
      () =>
        netFetch.mockResolvedValue(
          new Response(JSON.stringify({ body: '<!-- in-app\nRate limited.\nSecurity: yes\n-->' }), {
            status: 403
          })
        )
    ],
    ['the response is not JSON', () => netFetch.mockResolvedValue(new Response('<html>'))]
  ])('falls back to the full notes when %s', async (_case, arrange) => {
    arrange()

    expect(await sentPayload()).toMatchObject({
      releaseNotes: '<p>Full notes</p>',
      summary: null,
      security: false
    })
  })

  // latest.yml comes from the release, so a broken one must not reach a renderer that formats it
  it.each([
    ['a date that does not parse', { releaseDate: 'not a date' }, { releaseDate: null }],
    ['a date that is not a string', { releaseDate: 20261101 }, { releaseDate: null }],
    ['a size that is not a number', { files: [{ size: '100 MB' }] }, { size: null }],
    ['a negative size', { files: [{ size: -1 }] }, { size: null }]
  ])('sends null for %s', async (_case, broken, expected) => {
    netFetch.mockResolvedValue(new Response(JSON.stringify({ body: '' })))
    const w = fakeWindow()
    initAutoUpdater(w.win)

    autoUpdater.emit('update-available', { ...availableInfo, ...broken })
    await vi.waitFor(() => expect(w.payloads).toHaveLength(1))

    expect(w.payloads[0]).toMatchObject(expected)
  })

  it('stops waiting for the API after 5 seconds and falls back to the full notes', async () => {
    vi.useFakeTimers()
    // Like net.fetch, the request only settles when its signal aborts.
    netFetch.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        })
    )
    const w = fakeWindow()
    initAutoUpdater(w.win)

    autoUpdater.emit('update-available', availableInfo)
    await vi.advanceTimersByTimeAsync(4999)
    expect(w.payloads).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(w.payloads[0]).toMatchObject({ summary: null, security: false })
  })
})
