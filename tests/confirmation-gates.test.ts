import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The confirmation gates in ipc-handlers.ts park a vault:open call on a
// module-level resolver until the renderer answers. If the window is destroyed
// first, nothing answers — these tests cover the cancel path that unwedges them
// (issue #36). Only what vault:open touches before/at the gates is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: {},
  shell: {},
  ipcMain: {
    // Same contract as Electron's: a second handler for a channel throws.
    handle: (channel: string, fn: Handler): void => {
      if (handlers.has(channel)) {
        throw new Error(`Attempted to register a second handler for '${channel}'`)
      }
      handlers.set(channel, fn)
    }
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: {} }))

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => Buffer.alloc(0)),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))

vi.mock('../src/main/prefs', () => ({
  getPref: vi.fn(() => 0),
  recordVaultUsed: vi.fn()
}))

vi.mock('../src/main/vault/backups', () => ({
  createVaultBackup: vi.fn(),
  ensureVaultBackupDir: vi.fn()
}))

vi.mock('../src/main/vault/container', () => ({
  readContainer: vi.fn(() => ({ versionMin: 0, devBuild: false })),
  shouldWarnOpeningInDevBuild: vi.fn(() => false)
}))

vi.mock('../src/main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))

// Mirrors runMigrations: a declined schema gate surfaces as SCHEMA_MIGRATION_CANCELLED.
vi.mock('../src/main/vault/vault', () => ({
  isVaultOpen: vi.fn(() => false),
  closeVault: vi.fn(async () => undefined),
  openVaultWithRecovery: vi.fn(async () => 1),
  syncContainer: vi.fn(),
  openVault: vi.fn(
    async (
      _path: string,
      _password: string,
      _kf: unknown,
      _bytes: unknown,
      gate?: (req: { fromVersion: number; toVersion: number }) => Promise<boolean>
    ) => {
      if (gate && !(await gate({ fromVersion: 1, toVersion: 2 }))) {
        throw new Error('SCHEMA_MIGRATION_CANCELLED')
      }
      return 1
    }
  )
}))

vi.mock('../src/main/db/queries', () => ({}))
vi.mock('../src/main/clipboard-guard', () => ({}))
vi.mock('../src/main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

// Like a real BrowserWindow, sending to a destroyed one throws.
function fakeWindow(): { win: BrowserWindow; sent: string[]; destroy: () => void } {
  const sent: string[] = []
  let destroyed = false
  const win = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string) => {
        if (destroyed) throw new Error('Object has been destroyed')
        sent.push(channel)
      }
    }
  } as unknown as BrowserWindow
  return { win, sent, destroy: () => (destroyed = true) }
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({}, ...args))
}

// Lets the handler run up to the point where it parks on a gate.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('confirmation gates: cancelPendingConfirmations (issue #36)', () => {
  let ipc: typeof import('../src/main/ipc-handlers')
  let container: typeof import('../src/main/vault/container')
  let sent: string[]

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    container = await import('../src/main/vault/container')
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(false)
    ipc = await import('../src/main/ipc-handlers')
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
    const { createVaultBackup } = await import('../src/main/vault/backups')
    const pending = invoke('vault:open', '/v.nvx', 'pw')
    await flush()

    ipc.cancelPendingConfirmations()
    await pending

    expect(createVaultBackup).not.toHaveBeenCalled()
  })

  // Control for the test above: proves its assertion can fail.
  it('backs up a migration the user confirmed with a backup', async () => {
    const { createVaultBackup } = await import('../src/main/vault/backups')
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

// On macOS, closing the last window keeps the app alive and `activate` builds a
// new one, so createWindow() — and registerIpcHandlers() with it — runs again.
describe('registerIpcHandlers across windows (macOS activate, issue #36)', () => {
  let ipc: typeof import('../src/main/ipc-handlers')
  let container: typeof import('../src/main/vault/container')
  let vault: typeof import('../src/main/vault/vault')
  let prefs: typeof import('../src/main/prefs')

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    container = await import('../src/main/vault/container')
    vi.mocked(container.shouldWarnOpeningInDevBuild).mockReturnValue(false)
    vault = await import('../src/main/vault/vault')
    vi.mocked(vault.isVaultOpen).mockReturnValue(false)
    vi.mocked(vault.closeVault).mockClear()
    prefs = await import('../src/main/prefs')
    vi.mocked(prefs.getPref).mockReturnValue(0)
    ipc = await import('../src/main/ipc-handlers')
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
    const { drainRenderer } = await import('../src/main/drain-renderer')

    await ipc.lockVaultAndNotify(given.win)

    expect(drainRenderer).toHaveBeenLastCalledWith(given.win)
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
