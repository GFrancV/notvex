import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, flush, handlers, invoke } from './harness'

describe('confirmation gates: cancelPendingConfirmations (issue #36)', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let container: typeof import('@main/vault/container')
  let sent: string[]

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    container = await import('@main/vault/container')
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(false)
    ipc = await import('@main/ipc-handlers')
    const fake = fakeWindow()
    sent = fake.sent
    ipc.registerIpcHandlers(fake.win, () => null)
  })

  afterEach(() => {
    ipc.stopAutoLockTimer()
  })

  it('settles a vault:open parked on the dev-build warning as cancelled', async () => {
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    expect(sent).toContain('vault:dev-build-warning-required')

    ipc.cancelPendingConfirmations()

    await expect(pending).resolves.toEqual({
      success: false,
      error: 'DEV_BUILD_WARNING_CANCELLED'
    })
  })

  it('settles a vault:open parked on the schema-migration gate as cancelled', async () => {
    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    expect(sent).toContain('vault:migration-required')

    ipc.cancelPendingConfirmations()

    await expect(pending).resolves.toEqual({ success: false, error: 'MIGRATION_CANCELLED' })
  })

  it('never backs up a migration that was cancelled instead of confirmed', async () => {
    const { createVaultBackup } = await import('@main/vault/backups')
    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    ipc.cancelPendingConfirmations()
    await pending

    expect(createVaultBackup).not.toHaveBeenCalled()
  })

  // Control for the test above: proves its assertion can fail.
  it('backs up a migration the user confirmed with a backup', async () => {
    const { createVaultBackup } = await import('@main/vault/backups')
    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    await invoke('vault:migration-confirmed', true)
    await pending

    expect(createVaultBackup).toHaveBeenCalledWith('/v.nvx', 'schema', 1, 2)
  })

  it('leaves the next vault:open free to proceed after a cancel', async () => {
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
    const first = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    ipc.cancelPendingConfirmations()
    await first

    const second = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    ipc.cancelPendingConfirmations()

    // Reaching the gate again (instead of 'Unlock already in progress' or
    // 'dialog is already open') proves isUnlocking and the resolver were reset.
    await expect(second).resolves.toEqual({
      success: false,
      error: 'DEV_BUILD_WARNING_CANCELLED'
    })
  })

  it('settles and unwedges vault:open-with-recovery the same way', async () => {
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
    const first = invoke('vault:open-with-recovery', '/v.nvx', 'words')
    await flush()
    ipc.cancelPendingConfirmations()
    await expect(first).resolves.toEqual({
      success: false,
      error: 'DEV_BUILD_WARNING_CANCELLED'
    })

    // Its own finally must have reset isUnlocking too.
    const second = invoke('vault:open-with-recovery', '/v.nvx', 'words')
    await flush()
    ipc.cancelPendingConfirmations()
    await expect(second).resolves.toEqual({
      success: false,
      error: 'DEV_BUILD_WARNING_CANCELLED'
    })
  })

  it('keeps the renderer-driven -cancelled handlers working', async () => {
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
    const devPending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    await expect(invoke('vault:dev-build-warning-cancelled')).resolves.toEqual({
      success: true,
      data: null
    })
    await expect(devPending).resolves.toMatchObject({ error: 'DEV_BUILD_WARNING_CANCELLED' })

    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(false)
    const migPending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()
    await expect(invoke('vault:migration-cancelled')).resolves.toEqual({
      success: true,
      data: null
    })
    await expect(migPending).resolves.toMatchObject({ error: 'MIGRATION_CANCELLED' })
  })

  it('is a no-op when nothing is pending', () => {
    expect(() => ipc.cancelPendingConfirmations()).not.toThrow()
  })
})
