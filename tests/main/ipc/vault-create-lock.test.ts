import { pathToFileURL } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/security/url-guard'

// A hard lock (suspend, lock screen, app resigning active) that arrives while a vault is being
// created has nothing to close yet. It must still apply once creation finishes, before the
// recovery phrase reaches the renderer.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const vault = vi.hoisted(() => ({ open: false, path: null as string | null }))

const NEW_PATH = '/vaults/new.nvx'
const MNEMONIC = { mnemonic: 'abandon '.repeat(23) + 'art' }
const RENDERER_PID = 4242

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
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({
  isVaultOpen: vi.fn(() => vault.open),
  getVaultPath: vi.fn(() => vault.path),
  closeVault: vi.fn(async () => {
    vault.open = false
    vault.path = null
    return { packFailed: false }
  }),
  createVault: vi.fn()
}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/error-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/error-log')>()),
  appendError: vi.fn()
}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn(async () => undefined) }))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

const senderFrame = { url: pathToFileURL(rendererIndexPath).href }

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame }, ...args))
}

const win = {
  isDestroyed: () => false,
  webContents: { send: vi.fn(), getOSProcessId: vi.fn(() => RENDERER_PID), reload: vi.fn() }
}

describe('hard lock during vault creation', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let pending: typeof import('@main/pending-vault')
  let vaultMod: typeof import('@main/vault/vault')
  let prefs: typeof import('@main/prefs')
  let kill: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    vault.open = false
    vault.path = null
    ipc = await import('@main/ipc-handlers')
    pending = await import('@main/pending-vault')
    vaultMod = await import('@main/vault/vault')
    prefs = await import('@main/prefs')
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    ipc.registerIpcHandlers(win as never, () => null)
  })

  // The lock event lands while createVault() is still running, before the vault reports open
  function lockDuringCreate(outcome: 'created' | 'failed'): void {
    vi.mocked(vaultMod.createVault).mockImplementation(async () => {
      await ipc.lockVaultAndNotify(win as never)
      if (outcome === 'failed') throw new Error('disk full')
      vault.open = true
      vault.path = NEW_PATH
      return MNEMONIC as never
    })
  }

  it('locks the new vault and withholds the recovery phrase', async () => {
    lockDuringCreate('created')

    const result = await invoke('vault:create', NEW_PATH, 'pw', 4)

    expect(result).toEqual({
      success: false,
      error:
        "Couldn't show the recovery key: the vault was locked while it was created. Unlock it to get a new one"
    })
    expect(vaultMod.closeVault).toHaveBeenCalledTimes(1)
    expect(kill).toHaveBeenCalledExactlyOnceWith(RENDERER_PID, 'SIGKILL')
    expect(pending.takePendingVault()).toEqual({ path: NEW_PATH, mode: 'open' })
  })

  it('reports the usual error and closes nothing when creation fails', async () => {
    lockDuringCreate('failed')

    await expect(invoke('vault:create', NEW_PATH, 'pw', 4)).resolves.toEqual({
      success: false,
      error: 'disk full'
    })

    expect(vaultMod.closeVault).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
    expect(pending.takePendingVault()).toBeNull()
  })

  it('does not lock the next creation because of an earlier request', async () => {
    lockDuringCreate('failed')
    await invoke('vault:create', NEW_PATH, 'pw', 4)

    vi.mocked(vaultMod.createVault).mockImplementation(async () => {
      vault.open = true
      vault.path = NEW_PATH
      return MNEMONIC as never
    })

    await expect(invoke('vault:create', NEW_PATH, 'pw', 4)).resolves.toEqual({
      success: true,
      data: MNEMONIC
    })
    expect(vaultMod.closeVault).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  // The phrase was never shown, so the next unlock must warn that a key was issued but not confirmed
  it('marks the recovery key unconfirmed before the lock closes the vault', async () => {
    lockDuringCreate('created')

    await invoke('vault:create', NEW_PATH, 'pw', 4)

    expect(prefs.markRecoveryUnconfirmed).toHaveBeenCalledExactlyOnceWith(NEW_PATH)
    expect(vi.mocked(prefs.markRecoveryUnconfirmed).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(vaultMod.closeVault).mock.invocationCallOrder[0]
    )
  })
})
