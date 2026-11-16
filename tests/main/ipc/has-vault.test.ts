import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// Only what importing ipc-handlers.ts and the vault:has-vault handler touches is mocked.

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
  existsSync: vi.fn(() => true),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('@main/prefs', async (importOriginal) => ({
  getPref: vi.fn(() => 0),
  getCurrentVaultPath: vi.fn(() => null),
  isLocalVaultPath: (await importOriginal<typeof import('@main/prefs')>()).isLocalVaultPath
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({
  isValidNotvexFile: vi.fn(() => true),
  vaultFileStatus: vi.fn(() => 'usable')
}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { getCurrentVaultPath } = await import('@main/prefs')
const { vaultFileStatus } = await import('@main/vault/container')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const UNC = '\\\\host\\share\\v.nvx'
const LOCAL = '/vaults/a.nvx'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentVaultPath).mockReturnValue(null)
  vi.mocked(vaultFileStatus).mockReturnValue('usable')
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('vault:has-vault', () => {
  it.each([
    ['passed in', UNC, null],
    ['with forward slashes passed in', '//host/share/v.nvx', null],
    ['from getCurrentVaultPath', undefined, UNC]
  ])(
    'refuses a network-share path %s without touching the file system',
    async (_label, filePath, currentPath) => {
      vi.mocked(getCurrentVaultPath).mockReturnValue(currentPath)

      expect(await invoke('vault:has-vault', filePath)).toEqual({
        success: false,
        error: 'Vaults on network shares are not supported'
      })
      expect(vaultFileStatus).not.toHaveBeenCalled()
    }
  )

  it.each(['usable', 'missing', 'not-vault', 'unreadable'] as const)(
    'reports the status of the file on disk: %s',
    async (status) => {
      vi.mocked(vaultFileStatus).mockReturnValue(status)

      expect(await invoke('vault:has-vault', LOCAL)).toEqual({ success: true, data: status })
      expect(vaultFileStatus).toHaveBeenCalledWith(LOCAL)
    }
  )

  it('returns missing with no path and no recent vault', async () => {
    expect(await invoke('vault:has-vault')).toEqual({ success: true, data: 'missing' })
    expect(vaultFileStatus).not.toHaveBeenCalled()
  })
})
