import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// prefs:set is a trust boundary: the renderer may send any value, so the handler must refuse
// anything outside a pref's shape before it reaches prefs.json.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: {
    handle: (channel: string, fn: Handler): void => {
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => 0), setPref: vi.fn() }))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({ isVaultOpen: vi.fn(() => false) }))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function setPrefIpc(key: string, value: unknown): Promise<unknown> {
  const fn = handlers.get('prefs:set')
  if (!fn) throw new Error('no handler for prefs:set')
  return Promise.resolve(fn({ sender: {}, senderFrame }, key, value))
}

describe('prefs:set noteSort', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let setPref: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    setPref = vi.mocked((await import('@main/prefs')).setPref)
    ipc = await import('@main/ipc-handlers')
    ipc.registerIpcHandlers({ isDestroyed: () => false } as never, () => null)
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it.each(
    (['updatedAt', 'createdAt', 'title'] as const).flatMap((field) =>
      (['asc', 'desc'] as const).map((direction) => ({ field, direction }))
    )
  )('accepts $field $direction', async (value) => {
    await expect(setPrefIpc('noteSort', value)).resolves.toEqual({ success: true, data: null })
    expect(setPref).toHaveBeenCalledExactlyOnceWith('noteSort', value)
  })

  it.each([
    ['an unknown field', { field: 'size', direction: 'asc' }],
    ['an unknown direction', { field: 'title', direction: 'up' }],
    ['a missing direction', { field: 'title' }],
    ['an extra key', { field: 'title', direction: 'asc', extra: 1 }],
    ['null', null],
    ['an array', ['title', 'asc']],
    ['a string', 'title']
  ])('rejects %s', async (_label, value) => {
    await expect(setPrefIpc('noteSort', value)).resolves.toEqual({
      success: false,
      error: 'Invalid value for preference: noteSort'
    })
    expect(setPref).not.toHaveBeenCalled()
  })
})
