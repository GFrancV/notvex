import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// A new recovery key is shown once and the old one is already invalid, so main records it as
// unconfirmed before handing it out: a lock, quit or crash before the user confirms must leave a
// trace the next unlock can warn about.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

const VAULT = '/vaults/a.nvx'
const MNEMONIC = { mnemonic: 'abandon '.repeat(23) + 'art' }

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
vi.mock('@main/prefs', () => ({
  getPref: vi.fn(() => 0),
  recordVaultUsed: vi.fn(),
  markRecoveryUnconfirmed: vi.fn(),
  clearRecoveryUnconfirmed: vi.fn(),
  isRecoveryUnconfirmed: vi.fn(() => false)
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({
  KEY_FILE_MAX_BYTES: 0,
  readKeyFileContents: (c: Uint8Array) => c
}))
vi.mock('@main/vault/vault', () => ({
  isVaultOpen: vi.fn(() => true),
  getVaultPath: vi.fn(() => VAULT),
  createVault: vi.fn(),
  changePassword: vi.fn(),
  configureKeyFile: vi.fn(),
  removeKeyFile: vi.fn(),
  rotateVaultCredentials: vi.fn()
}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn() }))
vi.mock('@main/drain-renderer', () => ({}))

const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame }, ...args))
}

let ipc: typeof import('@main/ipc-handlers')
let prefs: typeof import('@main/prefs')
let vault: typeof import('@main/vault/vault')

beforeEach(async () => {
  handlers.clear()
  vi.resetModules()
  vi.clearAllMocks()
  prefs = await import('@main/prefs')
  vault = await import('@main/vault/vault')
  ipc = await import('@main/ipc-handlers')
  ipc.registerIpcHandlers({ isDestroyed: () => false } as never, () => null)
})

afterEach(() => {
  ipc.stopAutoLockTimer()
})

const KF = new Uint8Array([1])

const ISSUERS = [
  {
    channel: 'vault:create',
    fn: 'createVault',
    args: ['/vaults/new.nvx', 'pw'],
    path: '/vaults/new.nvx'
  },
  { channel: 'vault:change-password', fn: 'changePassword', args: ['old', 'new'], path: VAULT },
  { channel: 'vault:configure-key-file', fn: 'configureKeyFile', args: ['pw', KF], path: VAULT },
  { channel: 'vault:remove-key-file', fn: 'removeKeyFile', args: ['pw', KF], path: VAULT },
  { channel: 'vault:rotate-credentials', fn: 'rotateVaultCredentials', args: ['new'], path: VAULT }
] as const

describe.each(ISSUERS)('$channel', ({ channel, fn, args, path }) => {
  it('marks the vault unconfirmed before returning the mnemonic', async () => {
    vi.mocked(vault[fn]).mockResolvedValue(MNEMONIC as never)
    await expect(invoke(channel, ...args)).resolves.toEqual({ success: true, data: MNEMONIC })
    expect(prefs.markRecoveryUnconfirmed).toHaveBeenCalledExactlyOnceWith(path)
  })

  it('does not mark the vault when the change fails', async () => {
    vi.mocked(vault[fn]).mockRejectedValue(new Error('nope'))
    await expect(invoke(channel, ...args)).resolves.toMatchObject({ success: false })
    expect(prefs.markRecoveryUnconfirmed).not.toHaveBeenCalled()
  })

  it('still returns the mnemonic when prefs.json cannot be written', async () => {
    vi.mocked(vault[fn]).mockResolvedValue(MNEMONIC as never)
    vi.mocked(prefs.markRecoveryUnconfirmed).mockImplementationOnce(() => {
      throw new Error('EACCES')
    })
    await expect(invoke(channel, ...args)).resolves.toEqual({ success: true, data: MNEMONIC })
  })
})

describe('vault:confirm-recovery-saved', () => {
  it('clears the flag for the open vault', async () => {
    await expect(invoke('vault:confirm-recovery-saved')).resolves.toEqual({
      success: true,
      data: null
    })
    expect(prefs.clearRecoveryUnconfirmed).toHaveBeenCalledExactlyOnceWith(VAULT)
  })

  it('leaves the flag when no vault is open', async () => {
    vi.mocked(vault.getVaultPath).mockReturnValueOnce(null)
    await expect(invoke('vault:confirm-recovery-saved')).resolves.toEqual({
      success: true,
      data: null
    })
    expect(prefs.clearRecoveryUnconfirmed).not.toHaveBeenCalled()
  })
})

describe('vault:recovery-unconfirmed', () => {
  it.each([true, false])('reports %s for the open vault', async (flag) => {
    vi.mocked(prefs.isRecoveryUnconfirmed).mockReturnValue(flag)
    await expect(invoke('vault:recovery-unconfirmed')).resolves.toEqual({
      success: true,
      data: flag
    })
    expect(prefs.isRecoveryUnconfirmed).toHaveBeenCalledWith(VAULT)
  })

  it('reports false when no vault is open', async () => {
    vi.mocked(vault.getVaultPath).mockReturnValueOnce(null)
    await expect(invoke('vault:recovery-unconfirmed')).resolves.toEqual({
      success: true,
      data: false
    })
  })
})
