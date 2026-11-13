import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// The real prefs module is used, so what the handler writes to prefs.json is what is asserted.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const fsState = vi.hoisted(() => ({ contents: '' }))

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/user-data' },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  readFileSync: vi.fn(() => fsState.contents),
  existsSync: vi.fn(() => true),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn()
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { writeFileSync } = await import('fs')
const { removeRecentVault } = await import('@main/prefs')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const first = { path: '/vaults/a.nvx', hasKeyFile: false, lastOpenedAt: 3 }
const second = { path: '/vaults/b.nvx', hasKeyFile: true, lastOpenedAt: 2 }
const third = { path: '/vaults/c.nvx', hasKeyFile: false, lastOpenedAt: 1 }

function writtenRecents(): unknown {
  const [, json] = vi.mocked(writeFileSync).mock.calls.at(-1) ?? []
  return (JSON.parse(String(json)) as { recentVaults: unknown }).recentVaults
}

beforeEach(() => {
  vi.clearAllMocks()
  fsState.contents = JSON.stringify({ recentVaults: [first, second, third] })
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('prefs:remove-recent-vault', () => {
  it('removes the matching entry from the recent list and keeps the others', async () => {
    expect(await invoke('prefs:remove-recent-vault', second.path)).toEqual({
      success: true,
      data: null
    })

    expect(writtenRecents()).toEqual([first, third])
  })

  it.each([[undefined], [null], [42], [{}], ['']])(
    'refuses %j as a path and leaves the list alone',
    async (path) => {
      expect(await invoke('prefs:remove-recent-vault', path)).toEqual({
        success: false,
        error: expect.stringMatching(/^Couldn't /)
      })
      expect(writeFileSync).not.toHaveBeenCalled()
    }
  )

  describe('matching a path that differs only in letter case', () => {
    const platform = process.platform
    const stored = { path: 'C:\\Vaults\\Work.nvx', hasKeyFile: false, lastOpenedAt: 1 }

    afterEach(() => Object.defineProperty(process, 'platform', { value: platform }))

    it.each([
      ['win32', []],
      ['linux', [stored]]
    ])('on %s leaves %j', async (os, expected) => {
      Object.defineProperty(process, 'platform', { value: os })
      fsState.contents = JSON.stringify({ recentVaults: [stored] })

      // Called directly: the sender-frame check in the handler also depends on the platform
      removeRecentVault('c:\\vaults\\work.nvx')

      expect(writtenRecents()).toEqual(expected)
    })
  })
})
