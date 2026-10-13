import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// Only what importing ipc-handlers.ts and the notes:duplicate handler touches is mocked.

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
vi.mock('@main/db/queries', () => ({ duplicateNote: vi.fn() }))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { duplicateNote } = await import('@main/db/queries')
const { isVaultOpen, withVaultLock } = await import('@main/vault/vault')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const copy = {
  id: 'n2',
  title: 'Plan (copy)',
  isPinned: false,
  isTrashed: false,
  createdAt: 1,
  updatedAt: 1,
  trashedAt: null,
  tags: []
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isVaultOpen).mockReset().mockReturnValue(true)
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('notes:duplicate', () => {
  it('returns the copy in the success envelope, duplicated inside the vault lock', async () => {
    vi.mocked(duplicateNote).mockImplementationOnce(async () => {
      // The query must run from inside the lock, not before it was taken.
      expect(withVaultLock).toHaveBeenCalledTimes(1)
      return copy
    })

    expect(await invoke('notes:duplicate', 'n1')).toEqual({ success: true, data: copy })
    expect(duplicateNote).toHaveBeenCalledWith({ db: true }, 'n1', new Uint8Array([1]))
  })

  it('fails cleanly on an unknown id instead of throwing across IPC', async () => {
    vi.mocked(duplicateNote).mockRejectedValueOnce(new Error('Note not found'))

    expect(await invoke('notes:duplicate', 'missing')).toEqual({
      success: false,
      error: 'Note not found'
    })
  })

  it('refuses while the vault is locked, without touching the database', async () => {
    vi.mocked(isVaultOpen).mockReturnValue(false)

    expect(await invoke('notes:duplicate', 'n1')).toEqual({
      success: false,
      error: 'Vault is locked'
    })
    expect(duplicateNote).not.toHaveBeenCalled()
  })
})
