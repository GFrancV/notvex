import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// A target that can't be opened must come back as its case, with the current vault still open.
// The close-and-recycle path of a usable target is covered in renderer-recycle.test.ts.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('@main/prefs', () => ({
  getPref: vi.fn(() => 0),
  promoteVaultToTop: vi.fn()
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({
  isValidNotvexFile: vi.fn(() => true),
  vaultFileStatus: vi.fn(() => 'usable')
}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({
  isVaultOpen: vi.fn(() => true),
  getVaultPath: vi.fn(() => '/vaults/work.nvx'),
  closeVault: vi.fn(async () => ({ packFailed: false }))
}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn(async () => undefined) }))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { vaultFileStatus } = await import('@main/vault/container')
const { closeVault } = await import('@main/vault/vault')
const { promoteVaultToTop } = await import('@main/prefs')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const TARGET = '/vaults/home.nvx'

beforeEach(() => {
  vi.clearAllMocks()
  registerIpcHandlers({} as BrowserWindow, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('vault:switch to a vault file that can not be opened', () => {
  it.each(['missing', 'not-vault', 'unreadable'] as const)(
    'answers %s and keeps the current vault open',
    async (status) => {
      vi.mocked(vaultFileStatus).mockReturnValue(status)

      expect(await invoke('vault:switch', TARGET)).toEqual({ success: true, data: status })
      expect(vaultFileStatus).toHaveBeenCalledWith(TARGET)
      expect(closeVault).not.toHaveBeenCalled()
      expect(promoteVaultToTop).not.toHaveBeenCalled()
    }
  )
})
