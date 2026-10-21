import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// Only what importing ipc-handlers.ts and the notes:counts handler touches is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => 0) }))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({
  getDb: vi.fn(() => ({ db: true })),
  getMasterKey: vi.fn(() => new Uint8Array([1])),
  isVaultOpen: vi.fn(() => true),
  withVaultLock: vi.fn(<T>(fn: () => Promise<T>) => fn())
}))
vi.mock('@main/db/queries', () => ({ getNoteCounts: vi.fn() }))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { getNoteCounts } = await import('@main/db/queries')
const { isVaultOpen, withVaultLock } = await import('@main/vault/vault')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const counts = { live: 3, pinned: 1, trashed: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isVaultOpen).mockReset().mockReturnValue(true)
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('notes:counts', () => {
  it('returns the counts in the success envelope, read inside the vault lock', async () => {
    vi.mocked(getNoteCounts).mockImplementationOnce(async () => {
      // The query must run from inside the lock, not before it was taken.
      expect(withVaultLock).toHaveBeenCalledTimes(1)
      return counts
    })

    expect(await invoke('notes:counts')).toEqual({ success: true, data: counts })
    expect(getNoteCounts).toHaveBeenCalledWith({ db: true })
  })

  it('refuses while the vault is locked, without touching the database', async () => {
    vi.mocked(isVaultOpen).mockReturnValue(false)

    expect(await invoke('notes:counts')).toEqual({ success: false, error: 'Vault is locked' })
    expect(getNoteCounts).not.toHaveBeenCalled()
  })
})
