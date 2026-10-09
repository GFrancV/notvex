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

  // A save that misses the short lock bound fails visibly on a lock, but a reload would take
  // the page and its error toast with it. Nobody is racing a user-requested reload.
  it('gives the renderer longer to flush than a lock does', async () => {
    const { drainRenderer, FLUSH_ACK_TIMEOUT_MS } = await import('@main/drain-renderer')
    vi.mocked(vault.isVaultOpen).mockReturnValue(true)

    await invoke('app:reload-window')

    const [, timeoutMs] = vi.mocked(drainRenderer).mock.lastCall!
    expect(timeoutMs).toBeGreaterThan(FLUSH_ACK_TIMEOUT_MS)
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

  // A gate left parked would leave isUnlocking set, so the reloaded page's unlock would fail
  // with "Unlock already in progress" instead of reaching the gate again.
  it.each([
    ['migration', 'vault:migration-required', false],
    ['dev-build', 'vault:dev-build-warning-required', true]
  ])('lets the reloaded page unlock after a parked %s gate', async (_gate, channel, devBuild) => {
    const container = await import('@main/vault/container')
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(devBuild)
    const first = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    await invoke('app:reload-window')
    await first
    const second = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    expect(fake.sent.filter((c) => c === channel)).toHaveLength(2)
    await invoke('app:reload-window')
    await second
  })

  // The reload's did-navigate replaces the renderer; an unlock finishing after it must not
  // leave the vault open for the new page to boot into.
  it('relocks a vault whose unlock finishes after the reload', async () => {
    let finishOpen: () => void = () => {}
    vi.mocked(vault.openVault).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOpen = () => resolve({ maj: 1, min: 0 })
        })
    )
    fake.reload.mockImplementation(() => ipc.markRendererReplaced())
    const unlocking = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    await expect(invoke('app:reload-window')).resolves.toEqual({ success: true, data: true })
    finishOpen()

    await expect(unlocking).resolves.toEqual({ success: false, error: 'No window is open' })
    expect(vault.closeVault).toHaveBeenCalledOnce()
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
            finishCreate = (fail) => (fail ? reject(fail) : resolve({ mnemonic: 'recovery words' }))
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
