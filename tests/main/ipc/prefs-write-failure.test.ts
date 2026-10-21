import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordVaultUsed } from '@main/prefs'
import { rendererIndexPath } from '@main/url-guard'
import { closeVault } from '@main/vault/vault'

// prefs.json is written after the vault change already happened, so a failed write must not
// turn that change into an error: the renderer would disagree with main about the vault.

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

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.alloc(0)),
  existsSync: vi.fn(() => false)
}))

vi.mock('@main/prefs', () => ({
  getPref: vi.fn(() => 0),
  recordVaultUsed: vi.fn()
}))

vi.mock('@main/vault/backups', () => ({ ensureVaultBackupDir: vi.fn() }))

vi.mock('@main/vault/container', () => ({
  readContainer: vi.fn(() => ({ versionMin: 0, devBuild: false })),
  shouldWarnOpeningInDevBuild: vi.fn(() => false)
}))

vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))

vi.mock('@main/vault/vault', () => ({
  getVaultPath: vi.fn(() => '/v.nvx'),
  isVaultOpen: vi.fn(() => false),
  closeVault: vi.fn(async () => ({ packFailed: false })),
  createVault: vi.fn(async () => ({ mnemonic: 'created words' })),
  openVault: vi.fn(async () => ({ maj: 1, min: 0 })),
  openVaultWithRecovery: vi.fn(async () => ({ maj: 1, min: 0 }))
}))

vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn(async () => undefined) }))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

const PATH = 'C:\\Users\\someone\\vaults\\v.nvx'

const webContents = { isDestroyed: () => false, send: vi.fn() }
const win = { isDestroyed: () => false, webContents } as unknown as BrowserWindow
const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: webContents, senderFrame }, ...args))
}

describe('a failed prefs write after a successful vault change', () => {
  let ipc: typeof import('@main/ipc-handlers')

  beforeAll(async () => {
    ipc = await import('@main/ipc-handlers')
    ipc.registerIpcHandlers(win, () => null)
  })

  afterAll(() => {
    ipc.stopAutoLockTimer()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each<[string, unknown[], unknown]>([
    ['vault:create', [PATH, 'pw'], { mnemonic: 'created words' }],
    ['vault:open', [PATH, 'pw'], { maj: 1, min: 0 }],
    ['vault:open-with-recovery', [PATH, 'recovery words'], { maj: 1, min: 0 }]
  ])('%s still succeeds and leaves the vault open', async (channel, args, data) => {
    vi.mocked(recordVaultUsed).mockImplementationOnce(() => {
      throw Object.assign(new Error(`EACCES: permission denied, open '${PATH}'`), {
        code: 'EACCES'
      })
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(invoke(channel, ...args)).resolves.toEqual({ success: true, data })

      expect(recordVaultUsed).toHaveBeenCalledExactlyOnceWith(PATH, false)
      expect(closeVault).not.toHaveBeenCalled()
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        `[${channel}] record vault used failed:`,
        'EACCES'
      )
    } finally {
      vi.mocked(console.error).mockRestore()
      // An unconsumed throw would otherwise fire in the next test
      vi.mocked(recordVaultUsed).mockReset()
    }
  })
})
