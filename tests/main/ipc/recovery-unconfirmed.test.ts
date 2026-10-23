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
  closeVault: vi.fn(async () => ({ packFailed: false })),
  syncContainer: vi.fn(),
  createVault: vi.fn(),
  changePassword: vi.fn(),
  configureKeyFile: vi.fn(),
  removeKeyFile: vi.fn(),
  rotateVaultCredentials: vi.fn()
}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn() }))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn() }))

const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame }, ...args))
}

let ipc: typeof import('@main/ipc-handlers')
let prefs: typeof import('@main/prefs')
let vault: typeof import('@main/vault/vault')

const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }

async function load(): Promise<void> {
  handlers.clear()
  vi.resetModules()
  vi.clearAllMocks()
  prefs = await import('@main/prefs')
  vault = await import('@main/vault/vault')
  ipc = await import('@main/ipc-handlers')
  ipc.registerIpcHandlers(win as never, () => null)
}

beforeEach(load)

afterEach(() => {
  ipc.stopAutoLockTimer()
  vi.useRealTimers()
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
  { channel: 'vault:rotate-credentials', fn: 'rotateVaultCredentials', args: ['new'], path: VAULT },
  {
    channel: 'vault:regenerate-recovery-key',
    fn: 'changePassword',
    args: ['pw', KF],
    path: VAULT
  }
] as const

describe.each(ISSUERS)('$channel', ({ channel, fn, args, path }) => {
  it('marks the vault unconfirmed before returning the mnemonic', async () => {
    vi.mocked(vault[fn]).mockResolvedValue(MNEMONIC as never)
    await expect(invoke(channel, ...args)).resolves.toEqual({ success: true, data: MNEMONIC })
    expect(prefs.markRecoveryUnconfirmed).toHaveBeenCalledExactlyOnceWith(path)
    expect(ipc.isRecoveryConfirmPending()).toBe(true)
  })

  it('does not mark the vault when the change fails', async () => {
    vi.mocked(vault[fn]).mockRejectedValue(new Error('nope'))
    await expect(invoke(channel, ...args)).resolves.toMatchObject({ success: false })
    expect(prefs.markRecoveryUnconfirmed).not.toHaveBeenCalled()
    expect(ipc.isRecoveryConfirmPending()).toBe(false)
  })

  it('still returns the mnemonic when prefs.json cannot be written', async () => {
    vi.mocked(vault[fn]).mockResolvedValue(MNEMONIC as never)
    vi.mocked(prefs.markRecoveryUnconfirmed).mockImplementationOnce(() => {
      throw new Error('EACCES')
    })
    await expect(invoke(channel, ...args)).resolves.toEqual({ success: true, data: MNEMONIC })
    // Only the next-unlock warning is lost: the soft locks still wait for this key.
    expect(ipc.isRecoveryConfirmPending()).toBe(true)
  })
})

describe('vault:regenerate-recovery-key', () => {
  it('re-keys under the same password, which is what issues the new recovery key', async () => {
    vi.mocked(vault.changePassword).mockResolvedValue(MNEMONIC as never)

    await invoke('vault:regenerate-recovery-key', 'pw', KF)

    expect(vault.changePassword).toHaveBeenCalledExactlyOnceWith('pw', 'pw', KF)
    expect(ipc.isRecoveryConfirmPending()).toBe(true)
  })

  it('reports a wrong password and leaves the flag alone', async () => {
    vi.mocked(vault.changePassword).mockRejectedValue(new Error('Current password is incorrect'))

    await expect(invoke('vault:regenerate-recovery-key', 'wrong')).resolves.toEqual({
      success: false,
      error: 'Current password is incorrect'
    })
    expect(prefs.markRecoveryUnconfirmed).not.toHaveBeenCalled()
    expect(prefs.clearRecoveryUnconfirmed).not.toHaveBeenCalled()
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

describe('soft locks while a new key is on screen', () => {
  const MINUTE = 60_000

  // The auto-lock timer reads the clock when the module loads, so it loads again under fake timers.
  beforeEach(async () => {
    ipc.stopAutoLockTimer()
    vi.useFakeTimers()
    await load()
    vi.mocked(prefs.getPref).mockReturnValue(1)
    vi.mocked(vault.changePassword).mockResolvedValue(MNEMONIC as never)
  })

  // Module mocks survive resetModules, so the defaults the other tests rely on come back here.
  afterEach(() => {
    vi.mocked(prefs.getPref).mockReturnValue(0)
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
  })

  it('auto-lock waits until the key is confirmed', async () => {
    await invoke('vault:change-password', 'old', 'new')
    expect(ipc.isRecoveryConfirmPending()).toBe(true)

    await vi.advanceTimersByTimeAsync(5 * MINUTE)
    expect(vault.closeVault).not.toHaveBeenCalled()

    await invoke('vault:confirm-recovery-saved')
    expect(ipc.isRecoveryConfirmPending()).toBe(false)
    await vi.advanceTimersByTimeAsync(MINUTE)
    expect(vault.closeVault).toHaveBeenCalledOnce()
  })

  it('any close drops the pending key, so the next session auto-locks', async () => {
    await invoke('vault:change-password', 'old', 'new')

    await ipc.closeVaultDrained(null)

    expect(ipc.isRecoveryConfirmPending()).toBe(false)
  })

  it('a lock queued behind a rekey still leaves the next session able to auto-lock', async () => {
    let finishRekey!: () => void
    const rekey = new Promise<void>((resolve) => (finishRekey = resolve))
    vi.mocked(vault.changePassword).mockImplementationOnce(async () => {
      await rekey
      return MNEMONIC as never
    })
    // closeVault() queues behind the rekey on the vault lock, and takes a while to pack and close.
    vi.mocked(vault.closeVault).mockImplementationOnce(async () => {
      await rekey
      await new Promise((resolve) => setTimeout(resolve, 0))
      vi.mocked(vault.isVaultOpen).mockReturnValue(false)
      return { packFailed: false }
    })

    const change = invoke('vault:change-password', 'old', 'new')
    const lock = ipc.lockVaultAndNotify(null)
    finishRekey()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all([change, lock])

    // The key was issued, so the next unlock still warns; only the in-memory deferral must go.
    expect(prefs.markRecoveryUnconfirmed).toHaveBeenCalledExactlyOnceWith(VAULT)
    expect(ipc.isRecoveryConfirmPending()).toBe(false)
  })

  it('confirming releases the soft locks even when prefs.json cannot be written', async () => {
    await invoke('vault:change-password', 'old', 'new')
    vi.mocked(prefs.clearRecoveryUnconfirmed).mockImplementationOnce(() => {
      throw new Error('EACCES')
    })

    await expect(invoke('vault:confirm-recovery-saved')).resolves.toMatchObject({ success: false })

    expect(ipc.isRecoveryConfirmPending()).toBe(false)
  })

  it('a failed rotation that closed the vault drops the pending key', async () => {
    await invoke('vault:change-password', 'old', 'new')
    vi.mocked(vault.changePassword).mockRejectedValueOnce(new Error('rekey failed'))
    vi.mocked(vault.isVaultOpen).mockReturnValue(false)

    await invoke('vault:change-password', 'new', 'newer')

    expect(ipc.isRecoveryConfirmPending()).toBe(false)
  })
})
