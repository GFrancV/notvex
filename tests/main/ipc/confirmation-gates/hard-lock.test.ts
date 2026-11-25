import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, flush, invoke, loadIpcModules } from './harness'

// A hard lock (suspend, lock screen, app resigning active) that arrives while a vault is being
// unlocked has nothing to close yet. It must still apply once the unlock opens the vault, or the
// notes appear behind a lock the machine already asked for.

const VAULT_PATH = '/v.nvx'
const LOCKED_DURING_UNLOCK =
  "Couldn't unlock the vault: it was locked while it opened. Unlock it again"

describe('hard lock during an unlock', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let container: typeof import('@main/vault/container')
  let vault: typeof import('@main/vault/vault')
  let pending: typeof import('@main/pending-vault')
  let fake: ReturnType<typeof fakeWindow>
  let open: boolean

  beforeEach(async () => {
    ;({ ipc, container, vault } = await loadIpcModules())
    pending = await import('@main/pending-vault')
    fake = fakeWindow()
    ipc.registerIpcHandlers(fake.win, () => null)

    open = false
    vi.mocked(vault.isVaultOpen).mockImplementation(() => open)
    vi.mocked(vault.getVaultPath).mockImplementation(() => (open ? VAULT_PATH : null))
    vi.mocked(vault.closeVault).mockImplementation(async () => {
      open = false
      return { packFailed: false }
    })
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it('locks the vault when a hard lock arrives during a password unlock', async () => {
    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      await ipc.lockVaultAndNotify(fake.win)
      open = true
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open', VAULT_PATH, 'pw')).resolves.toEqual({
      success: false,
      error: LOCKED_DURING_UNLOCK
    })
    expect(open).toBe(false)
    expect(fake.crash).toHaveBeenCalledOnce()
    expect(pending.takePendingVault()).toEqual({ path: VAULT_PATH, mode: 'open' })
  })

  it('locks the vault when a hard lock arrives during a recovery-phrase unlock', async () => {
    vi.mocked(vault.openVaultWithRecovery).mockImplementationOnce(async () => {
      await ipc.lockVaultAndNotify(fake.win)
      open = true
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open-with-recovery', VAULT_PATH, 'words')).resolves.toEqual({
      success: false,
      error: LOCKED_DURING_UNLOCK
    })
    expect(open).toBe(false)
    expect(fake.crash).toHaveBeenCalledOnce()
    expect(pending.takePendingVault()).toEqual({ path: VAULT_PATH, mode: 'open' })

    // The lock that applied must not carry over to the next recovery unlock
    vi.mocked(vault.openVaultWithRecovery).mockImplementationOnce(async () => {
      open = true
      return { maj: 1, min: 0 }
    })
    await expect(invoke('vault:open-with-recovery', VAULT_PATH, 'words')).resolves.toEqual({
      success: true,
      data: { maj: 1, min: 0 }
    })
  })

  it.each([
    ['password', 'vault:open', 'openVault'],
    ['recovery-phrase', 'vault:open-with-recovery', 'openVaultWithRecovery']
  ] as const)(
    'reloads the Unlock screen after a %s unlock even when packing the vault fails',
    async (_kind, channel, opener) => {
      vi.mocked(vault[opener]).mockImplementationOnce(async () => {
        await ipc.lockVaultAndNotify(fake.win)
        open = true
        return { maj: 1, min: 0 }
      })
      vi.mocked(vault.closeVault).mockImplementationOnce(async () => {
        open = false
        return { packFailed: true }
      })

      await expect(invoke(channel, VAULT_PATH, 'secret')).resolves.toEqual({
        success: false,
        error: LOCKED_DURING_UNLOCK
      })
      expect(fake.crash).toHaveBeenCalledOnce()
    }
  )

  it('does not lock the next unlock after a hard lock during a wrong-password unlock', async () => {
    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      await ipc.lockVaultAndNotify(fake.win)
      return null
    })
    await expect(invoke('vault:open', VAULT_PATH, 'wrong')).resolves.toEqual({
      success: true,
      data: null
    })

    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      open = true
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open', VAULT_PATH, 'pw')).resolves.toEqual({
      success: true,
      data: { maj: 1, min: 0 }
    })
    expect(open).toBe(true)
    expect(fake.crash).not.toHaveBeenCalled()
  })

  it('does not lock the next unlock after a hard lock during a declined dialog', async () => {
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValueOnce(true)
    const declined = invoke('vault:open', VAULT_PATH, 'pw')
    await flush()
    await ipc.lockVaultAndNotify(fake.win)
    await invoke('vault:dev-build-warning-cancelled')
    await expect(declined).resolves.toEqual({
      success: false,
      error: 'DEV_BUILD_WARNING_CANCELLED'
    })

    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      open = true
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open', VAULT_PATH, 'pw')).resolves.toEqual({
      success: true,
      data: { maj: 1, min: 0 }
    })
    expect(open).toBe(true)
    expect(fake.crash).not.toHaveBeenCalled()
  })

  // The dialog stays up through the lock; answering it later still finds the lock waiting
  it('still locks when the hard lock arrives while a dialog is waiting and it is then accepted', async () => {
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValueOnce(true)
    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      open = true
      return { maj: 1, min: 0 }
    })
    const unlock = invoke('vault:open', VAULT_PATH, 'pw')
    await flush()
    await ipc.lockVaultAndNotify(fake.win)

    await invoke('vault:dev-build-warning-confirmed')

    await expect(unlock).resolves.toEqual({ success: false, error: LOCKED_DURING_UNLOCK })
    expect(open).toBe(false)
    expect(fake.crash).toHaveBeenCalledOnce()
  })
})
