import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, flush, invoke, loadIpcModules } from './harness'

// app:reload-window is the only way the app reloads its renderer: unlike a raw reload, it lets
// the old page flush its autosaves and settles any parked gate before the page goes away.
describe('app:reload-window', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let vault: typeof import('@main/vault/vault')
  let fake: ReturnType<typeof fakeWindow>
  let order: string[]

  beforeEach(async () => {
    ;({ ipc, vault } = await loadIpcModules())
    fake = fakeWindow()
    ipc.registerIpcHandlers(fake.win, () => null)

    order = []
    const { drainRenderer } = await import('@main/drain-renderer')
    vi.mocked(drainRenderer).mockImplementation(async () => {
      order.push('drain')
    })
    vi.mocked(vault.closeVault).mockImplementation(async () => {
      order.push('close')
      return { packFailed: false }
    })
    fake.reload.mockImplementation(() => order.push('reload'))
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it('drains, closes the open vault, then reloads', async () => {
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)

    await expect(invoke('app:reload-window')).resolves.toEqual({ success: true, data: true })

    expect(order).toEqual(['drain', 'close', 'reload'])
  })

  it('reloads straight away when no vault is open', async () => {
    await expect(invoke('app:reload-window')).resolves.toEqual({ success: true, data: true })

    expect(order).toEqual(['reload'])
  })

  it('settles a vault:open parked on the migration gate before reloading', async () => {
    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    expect(fake.sent).toContain('vault:migration-required')

    await invoke('app:reload-window')

    await expect(pending).resolves.toEqual({ success: false, error: 'MIGRATION_CANCELLED' })
    expect(fake.reload).toHaveBeenCalledOnce()
  })

  // The pack-failed toast is the only notice of lost changes; a reload would discard it.
  it('locks without reloading when the vault fails to pack', async () => {
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
    vi.mocked(vault.closeVault).mockResolvedValue({ packFailed: true })

    await expect(invoke('app:reload-window')).resolves.toEqual({ success: true, data: false })

    expect(fake.reload).not.toHaveBeenCalled()
    expect(fake.sent).toEqual(['vault:pack-failed', 'vault:auto-locked'])
  })

  // The vault only reports open once createVault() returns, so a reload mid-create would find it
  // closed and the recovery phrase would never be shown.
  describe('while a vault is being created', () => {
    let finishCreate: (fail?: Error) => void

    beforeEach(() => {
      vi.mocked(vault.createVault).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finishCreate = (fail) => (fail ? reject(fail) : resolve(['recovery', 'words']))
          })
      )
    })

    it('refuses to reload', async () => {
      const creating = invoke('vault:create', '/v.nvx', 'pw')
      await flush()

      const res = await invoke('app:reload-window')

      expect(res).toMatchObject({ success: false })
      expect(fake.reload).not.toHaveBeenCalled()
      finishCreate()
      await creating
    })

    it.each([
      ['succeeded', undefined],
      ['failed', new Error('disk full')]
    ])('reloads again once the create %s', async (_outcome, error) => {
      const creating = invoke('vault:create', '/v.nvx', 'pw')
      await flush()
      finishCreate(error)
      await creating

      await expect(invoke('app:reload-window')).resolves.toEqual({ success: true, data: true })
      expect(fake.reload).toHaveBeenCalledOnce()
    })
  })

  it('reports a failed close and does not reload', async () => {
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)
    vi.mocked(vault.closeVault).mockRejectedValue(new Error('disk full'))

    await expect(invoke('app:reload-window')).resolves.toEqual({
      success: false,
      error: 'disk full'
    })
    expect(fake.reload).not.toHaveBeenCalled()
  })
})
