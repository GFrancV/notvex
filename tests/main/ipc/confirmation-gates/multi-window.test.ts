import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, flush, invoke, loadIpcModules } from './harness'

// On macOS, closing the last window keeps the app alive and `activate` builds a
// new one, so createWindow() — and registerIpcHandlers() with it — runs again.
describe('registerIpcHandlers across windows (macOS activate, issue #36)', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let container: typeof import('@main/vault/container')
  let vault: typeof import('@main/vault/vault')
  let prefs: typeof import('@main/prefs')

  beforeEach(async () => {
    ;({ ipc, container, vault, prefs } = await loadIpcModules())
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
    vi.useRealTimers()
  })

  it('does not register any channel twice when a second window is created', () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)

    expect(() => ipc.registerIpcHandlers(fakeWindow().win, () => null)).not.toThrow()
  })

  it('sends a confirmation gate to the newest window, not the closed one', async () => {
    const first = fakeWindow()
    ipc.registerIpcHandlers(first.win, () => null)
    first.destroy()
    const second = fakeWindow()
    ipc.registerIpcHandlers(second.win, () => null)
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)

    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    expect(second.sent).toContain('vault:dev-build-warning-required')
    ipc.cancelPendingConfirmations()
    await expect(pending).resolves.toMatchObject({ error: 'DEV_BUILD_WARNING_CANCELLED' })
  })

  it('tells the newest window when a failed rotation locks the vault', async () => {
    const first = fakeWindow()
    ipc.registerIpcHandlers(first.win, () => null)
    first.destroy()
    const second = fakeWindow()
    ipc.registerIpcHandlers(second.win, () => null)
    // Open for requireVault(); the rollback has closed it by the time the catch runs.
    vi.mocked(vault.isVaultOpen).mockReturnValueOnce(true)
    vi.mocked(vault.rotateVaultCredentials).mockRejectedValueOnce(new Error('rekey failed'))

    await expect(invoke('vault:rotate-credentials', 'new pw')).resolves.toEqual({
      success: false,
      error: 'rekey failed'
    })
    expect(second.sent).toEqual(['vault:auto-locked'])
  })

  it('cancels a gate straight away when no live window can answer it', async () => {
    const only = fakeWindow()
    ipc.registerIpcHandlers(only.win, () => null)
    only.destroy()
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)

    await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
      success: false,
      error: 'DEV_BUILD_WARNING_CANCELLED'
    })
  })

  it('lockVaultAndNotify drains and notifies the window it was given', async () => {
    const registered = fakeWindow()
    ipc.registerIpcHandlers(registered.win, () => null)
    const given = fakeWindow()
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
    const { drainRenderer } = await import('@main/drain-renderer')

    await ipc.lockVaultAndNotify(given.win)

    // undefined: a lock keeps drainRenderer()'s default, short bound
    expect(drainRenderer).toHaveBeenLastCalledWith(given.win, undefined)
    expect(given.sent).toEqual(['vault:auto-locked'])
  })

  // macOS: the window closes mid-Argon2id, window-all-closed finds nothing to
  // lock yet (and stops auto-lock), then the unlock finishes with no UI.
  it('re-locks a vault whose vault:open finished after its window closed', async () => {
    const only = fakeWindow()
    ipc.registerIpcHandlers(only.win, () => null)
    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      only.destroy()
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
      success: false,
      error: 'No window is open'
    })
    expect(vault.closeVault).toHaveBeenCalled()
    expect(prefs.recordVaultUsed).not.toHaveBeenCalled()
  })

  it('re-locks a vault whose vault:open-with-recovery finished after its window closed', async () => {
    const only = fakeWindow()
    ipc.registerIpcHandlers(only.win, () => null)
    vi.mocked(vault.openVaultWithRecovery).mockImplementationOnce(async () => {
      only.destroy()
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open-with-recovery', '/v.nvx', 'words')).resolves.toEqual({
      success: false,
      error: 'No window is open'
    })
    expect(vault.closeVault).toHaveBeenCalled()
    expect(prefs.recordVaultUsed).not.toHaveBeenCalled()
  })

  // A reload or renderer crash keeps the window alive, so liveWin() can't tell
  // — but the unlock that finishes afterwards has no renderer left to show it
  // to, and the reloaded one would boot straight into the notes.
  it('re-locks a vault whose vault:open finished after the renderer was replaced', async () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      ipc.markRendererReplaced()
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
      success: false,
      error: 'No window is open'
    })
    expect(vault.closeVault).toHaveBeenCalled()
    expect(prefs.recordVaultUsed).not.toHaveBeenCalled()
  })

  it('re-locks a vault whose vault:open-with-recovery finished after the renderer was replaced', async () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
    vi.mocked(vault.openVaultWithRecovery).mockImplementationOnce(async () => {
      ipc.markRendererReplaced()
      return { maj: 1, min: 0 }
    })

    await expect(invoke('vault:open-with-recovery', '/v.nvx', 'words')).resolves.toEqual({
      success: false,
      error: 'No window is open'
    })
    expect(vault.closeVault).toHaveBeenCalled()
    expect(prefs.recordVaultUsed).not.toHaveBeenCalled()
  })

  // The relock's close packs the whole container (seconds on a large vault).
  // Until it is done, a retry from the reloaded page must still be refused,
  // or it races the close for the vault's file lock.
  it('keeps the unlock in progress until the orphaned vault is closed again', async () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
    vi.mocked(vault.openVault).mockImplementationOnce(async () => {
      ipc.markRendererReplaced()
      return { maj: 1, min: 0 }
    })
    let releaseClose = (): void => undefined
    vi.mocked(vault.closeVault).mockImplementationOnce(
      () => new Promise((resolve) => (releaseClose = (): void => resolve({ packFailed: false })))
    )

    const orphaned = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    // The retry goes through recovery: its mock opens straight away, with no
    // gate to park on, so a retry that isn't refused fails here, not by timeout.
    await expect(invoke('vault:open-with-recovery', '/v.nvx', 'words')).resolves.toEqual({
      success: false,
      error: 'Unlock already in progress'
    })
    releaseClose()
    await expect(orphaned).resolves.toEqual({ success: false, error: 'No window is open' })
  })

  // Only a vault that actually opened is orphaned: a wrong password must still
  // count toward the throttle, or reloading mid-attempt would bypass it.
  it('counts a wrong password toward the throttle even if the renderer was replaced', async () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
    const wrongPasswordDuringReload = async (): Promise<null> => {
      ipc.markRendererReplaced()
      return null
    }

    for (let i = 0; i < 4; i++) {
      vi.mocked(vault.openVault).mockImplementationOnce(wrongPasswordDuringReload)
      await expect(invoke('vault:open', '/v.nvx', 'bad')).resolves.toEqual({
        success: true,
        data: null
      })
    }

    expect(vault.closeVault).not.toHaveBeenCalled()
    await expect(invoke('vault:open', '/v.nvx', 'bad')).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/Too many failed attempts/)
    })
  })

  // Control: only a replacement *during* the unlock counts, not an earlier one.
  it('lets an unlock started from the reloaded renderer open normally', async () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
    ipc.markRendererReplaced()
    vi.mocked(vault.openVault).mockResolvedValueOnce({ maj: 1, min: 0 })

    await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toMatchObject({ success: true })
    expect(vault.closeVault).not.toHaveBeenCalled()
  })

  // Reading through the vault lock queues vault:status behind an in-flight close.
  it('vault:status waits for an in-flight close before reading the vault path', async () => {
    ipc.registerIpcHandlers(fakeWindow().win, () => null)
    let releaseClose = (): void => undefined
    const closing = new Promise<void>((resolve) => (releaseClose = resolve))
    vi.mocked(vault.withVaultLock).mockImplementationOnce((fn) => closing.then(fn))
    vi.mocked(vault.getVaultPath).mockReturnValue('/v.nvx')

    let settled = false
    const status = invoke('vault:status').then((res) => ((settled = true), res))
    await flush()
    expect(settled).toBe(false)

    vi.mocked(vault.getVaultPath).mockReturnValue(null)
    releaseClose()

    await expect(status).resolves.toEqual({ success: true, data: { isOpen: false } })
  })

  it('auto-lock still closes the vault while no window is alive', async () => {
    vi.useFakeTimers()
    const only = fakeWindow()
    ipc.registerIpcHandlers(only.win, () => null)
    only.destroy()
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
    vi.mocked(prefs.getPref).mockReturnValue(1)

    await vi.advanceTimersByTimeAsync(120_000)

    expect(vault.closeVault).toHaveBeenCalled()
  })
})
