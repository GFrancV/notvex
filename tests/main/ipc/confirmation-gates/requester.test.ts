import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeWindow, flush, invoke, invokeFrom, loadIpcModules } from './harness'

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

  // macOS: window A starts the unlock, the user closes A and clicks
  // the dock icon mid-Argon2id, and `activate` builds window B. B never asked
  // to unlock, so a gate firing now must not prompt it.
  describe('when another window replaces the requester mid-unlock (issue #50)', () => {
    let a: ReturnType<typeof fakeWindow>
    let b: ReturnType<typeof fakeWindow> | null

    function replaceRequester({ destroyA = true } = {}): void {
      if (destroyA) a.destroy()
      b = fakeWindow()
      ipc.registerIpcHandlers(b.win, () => null)
    }

    type Gate = (req: { fromVersion: number; toVersion: number }) => Promise<boolean>

    beforeEach(() => {
      a = fakeWindow()
      b = null
      ipc.registerIpcHandlers(a.win, () => null)
    })

    it('cancels the schema-migration gate of vault:open without prompting the new window', async () => {
      vi.mocked(vault.openVault).mockImplementationOnce(async (...args) => {
        replaceRequester()
        const gate = args[4] as Gate
        if (!(await gate({ fromVersion: 1, toVersion: 2 }))) {
          throw new Error('SCHEMA_MIGRATION_CANCELLED')
        }
        return { maj: 1, min: 0 }
      })

      await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
        success: false,
        error: 'MIGRATION_CANCELLED'
      })
      expect(b?.sent).toEqual([])
    })

    // A requester that is still alive but no longer the current window is just as
    // unable to answer from the user's point of view: isLiveSender checks identity,
    // not only isDestroyed().
    it('cancels a gate whose requester is alive but no longer the current window', async () => {
      vi.mocked(container.shouldWarnOpeningInDevBuild).mockImplementationOnce(() => {
        replaceRequester({ destroyA: false })
        return true
      })

      await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
        success: false,
        error: 'DEV_BUILD_WARNING_CANCELLED'
      })
      expect(a.sent).toEqual([])
      expect(b?.sent).toEqual([])
    })

    it('cancels the dev-build warning without prompting the new window', async () => {
      vi.mocked(container.shouldWarnOpeningInDevBuild).mockImplementationOnce(() => {
        replaceRequester()
        return true
      })

      await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
        success: false,
        error: 'DEV_BUILD_WARNING_CANCELLED'
      })
      expect(b?.sent).toEqual([])
    })

    it('cancels the schema-migration gate of vault:open-with-recovery the same way', async () => {
      vi.mocked(vault.openVaultWithRecovery).mockImplementationOnce(async (...args) => {
        replaceRequester()
        const gate = args[3] as Gate
        if (!(await gate({ fromVersion: 1, toVersion: 2 }))) {
          throw new Error('SCHEMA_MIGRATION_CANCELLED')
        }
        return { maj: 1, min: 0 }
      })

      await expect(invoke('vault:open-with-recovery', '/v.nvx', 'words')).resolves.toEqual({
        success: false,
        error: 'MIGRATION_CANCELLED'
      })
      expect(b?.sent).toEqual([])
    })

    it('re-locks a vault whose unlock finished after the requester was replaced', async () => {
      vi.mocked(vault.openVault).mockImplementationOnce(async () => {
        replaceRequester()
        return { maj: 1, min: 0 }
      })

      await expect(invoke('vault:open', '/v.nvx', 'pw')).resolves.toEqual({
        success: false,
        error: 'No window is open'
      })
      expect(vault.closeVault).toHaveBeenCalled()
      expect(prefs.recordVaultUsed).not.toHaveBeenCalled()
    })

    it('re-locks a recovery unlock that finished after the requester was replaced', async () => {
      vi.mocked(vault.openVaultWithRecovery).mockImplementationOnce(async () => {
        replaceRequester()
        return { maj: 1, min: 0 }
      })

      await expect(invoke('vault:open-with-recovery', '/v.nvx', 'words')).resolves.toEqual({
        success: false,
        error: 'No window is open'
      })
      expect(vault.closeVault).toHaveBeenCalled()
    })
  })

  // The other half of the requester check: a window that never got the prompt
  // must not be able to answer it either. `other` stands in for any renderer
  // but the requester.
  describe('gate answers from a renderer other than the requester (issue #50)', () => {
    let requester: WebContents
    let requesterSent: string[]
    let other: WebContents

    beforeEach(() => {
      const a = fakeWindow()
      ipc.registerIpcHandlers(a.win, () => null)
      requester = a.win.webContents
      requesterSent = a.sent
      other = fakeWindow().win.webContents
    })

    // The macOS `activate` case: B is the window the user now sees, so a check on
    // "is the sender live?" instead of "is it the requester?" would let it answer.
    it('ignores an answer from the window that replaced the requester', async () => {
      const { createVaultBackup } = await import('@main/vault/backups')
      const pending = invokeFrom(requester, 'vault:open', '/v.nvx', 'pw')
      await flush()
      const b = fakeWindow()
      ipc.registerIpcHandlers(b.win, () => null)

      await invokeFrom(b.win.webContents, 'vault:migration-confirmed', true)
      ipc.cancelPendingConfirmations()

      await expect(pending).resolves.toEqual({ success: false, error: 'MIGRATION_CANCELLED' })
      expect(createVaultBackup).not.toHaveBeenCalled()
    })

    it('lets the requester answer both gates of one unlock in turn', async () => {
      const { createVaultBackup } = await import('@main/vault/backups')
      vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
      const pending = invokeFrom(requester, 'vault:open', '/v.nvx', 'pw')
      await flush()

      await invokeFrom(requester, 'vault:dev-build-warning-confirmed')
      await flush()
      expect(requesterSent).toEqual([
        'vault:dev-build-warning-required',
        'vault:migration-required'
      ])
      await invokeFrom(requester, 'vault:migration-confirmed', true)

      await expect(pending).resolves.toEqual({ success: true, data: 1 })
      expect(createVaultBackup).toHaveBeenCalledWith('/v.nvx', 'schema', 1, 2)
    })

    it('ignores vault:migration-confirmed and never backs up', async () => {
      const { createVaultBackup } = await import('@main/vault/backups')
      const pending = invokeFrom(requester, 'vault:open', '/v.nvx', 'pw')
      await flush()

      await expect(invokeFrom(other, 'vault:migration-confirmed', true)).resolves.toEqual({
        success: true,
        data: null
      })
      ipc.cancelPendingConfirmations()

      await expect(pending).resolves.toEqual({ success: false, error: 'MIGRATION_CANCELLED' })
      expect(createVaultBackup).not.toHaveBeenCalled()
    })

    it('ignores vault:migration-cancelled, leaving the requester free to confirm', async () => {
      const { createVaultBackup } = await import('@main/vault/backups')
      const pending = invokeFrom(requester, 'vault:open', '/v.nvx', 'pw')
      await flush()

      await invokeFrom(other, 'vault:migration-cancelled')
      await invokeFrom(requester, 'vault:migration-confirmed', true)

      await expect(pending).resolves.toEqual({ success: true, data: 1 })
      expect(createVaultBackup).toHaveBeenCalledWith('/v.nvx', 'schema', 1, 2)
    })

    it('ignores vault:dev-build-warning-confirmed', async () => {
      vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
      // No schema gate after it, so a regression fails on the assertion instead of hanging.
      vi.mocked(vault.openVault).mockResolvedValueOnce({ maj: 1, min: 0 })
      const pending = invokeFrom(requester, 'vault:open', '/v.nvx', 'pw')
      await flush()

      await invokeFrom(other, 'vault:dev-build-warning-confirmed')
      ipc.cancelPendingConfirmations()

      await expect(pending).resolves.toEqual({
        success: false,
        error: 'DEV_BUILD_WARNING_CANCELLED'
      })
    })

    it('ignores vault:dev-build-warning-cancelled, leaving the requester free to confirm', async () => {
      vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(true)
      vi.mocked(vault.openVault).mockResolvedValueOnce({ maj: 1, min: 0 })
      const pending = invokeFrom(requester, 'vault:open', '/v.nvx', 'pw')
      await flush()

      await invokeFrom(other, 'vault:dev-build-warning-cancelled')
      await invokeFrom(requester, 'vault:dev-build-warning-confirmed')

      await expect(pending).resolves.toEqual({ success: true, data: { maj: 1, min: 0 } })
    })
  })
})
