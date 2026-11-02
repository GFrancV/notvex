import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// A lock must leave no renderer heap behind: once the vault has closed, the window's renderer
// process is killed and reloaded into a fresh one, unless a failed pack still has to be shown.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()
const vault = vi.hoisted(() => ({ open: true, path: 'C:/vaults/work.nvx' as string | null }))

vi.mock('electron', () => ({
  app: { isPackaged: true },
  clipboard: {},
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
  promoteVaultToTop: vi.fn(),
  samePath: (a: string, b: string) => a === b
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({ isValidNotvexFile: vi.fn(() => true) }))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 0 }))
vi.mock('@main/vault/vault', () => ({
  isVaultOpen: vi.fn(() => vault.open),
  getVaultPath: vi.fn(() => vault.path),
  closeVault: vi.fn(async () => {
    vault.open = false
    vault.path = null
    return { packFailed: false }
  }),
  rotateVaultCredentials: vi.fn(async () => {
    vault.open = false
    vault.path = null
    throw new Error('rekey failed')
  })
}))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/error-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@main/error-log')>()),
  appendError: vi.fn()
}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn(async () => undefined) }))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

const APP_URL = pathToFileURL(rendererIndexPath).href
// existsSync() is real, so switch / open-file targets must exist on disk
const OTHER = join(mkdtempSync(join(tmpdir(), 'notvex-recycle-')), 'other.nvx')
writeFileSync(OTHER, '')

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn({ sender: {}, senderFrame: { url: APP_URL } }, ...args))
}

const RENDERER_PID = 4242

function makeWin(): {
  isDestroyed: ReturnType<typeof vi.fn>
  webContents: Record<'send' | 'getOSProcessId' | 'reload', ReturnType<typeof vi.fn>>
} {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn(), getOSProcessId: vi.fn(() => RENDERER_PID), reload: vi.fn() }
  }
}

describe('renderer recycle on lock', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let pending: typeof import('@main/pending-vault')
  let vaultMod: typeof import('@main/vault/vault')
  let win: ReturnType<typeof makeWin>
  // Never let a real process.kill run from a test
  let kill: MockInstance<typeof process.kill>

  beforeEach(async () => {
    handlers.clear()
    vi.resetModules()
    vi.clearAllMocks()
    vault.open = true
    vault.path = 'C:/vaults/work.nvx'
    ipc = await import('@main/ipc-handlers')
    pending = await import('@main/pending-vault')
    vaultMod = await import('@main/vault/vault')
    win = makeWin()
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    ipc.registerIpcHandlers(win as never, () => null)
  })

  const expectRecycledAfterClose = (): void => {
    expect(kill).toHaveBeenCalledExactlyOnceWith(RENDERER_PID, 'SIGKILL')
    expect(vi.mocked(vaultMod.closeVault).mock.invocationCallOrder[0]).toBeLessThan(
      kill.mock.invocationCallOrder[0]
    )
    expect(ipc.takeRecycleMark(win.webContents as never)).toBe(true)
  }

  // A kill that never happens would leave the old renderer, and its heap, on screen
  it('reloads without killing anything when no renderer process is live', async () => {
    win.webContents.getOSProcessId.mockReturnValue(0)

    await ipc.lockVaultAndNotify(win as never)

    expect(kill).not.toHaveBeenCalled()
    expect(win.webContents.reload).toHaveBeenCalledTimes(1)
    expect(ipc.takeRecycleMark(win.webContents as never)).toBe(false)
  })

  // Locking the screen can fire two locks at once; a second kill of the dead pid would drop the
  // mark and the kill would be logged as a crash.
  it('kills once when two locks race, so the kill stays marked', async () => {
    await Promise.all([ipc.lockVaultAndNotify(win as never), ipc.lockVaultAndNotify(win as never)])

    expect(kill).toHaveBeenCalledTimes(1)
    expect(ipc.takeRecycleMark(win.webContents as never)).toBe(true)
  })

  // A failed kill (EPERM) reloads in the same process, keeping the old heap, so it must be logged
  it('reloads straight away and logs the code when the kill fails', async () => {
    const { appendError } = await import('@main/error-log')
    kill.mockImplementationOnce(() => {
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    })

    await ipc.lockVaultAndNotify(win as never)

    expect(win.webContents.reload).toHaveBeenCalledTimes(1)
    expect(ipc.takeRecycleMark(win.webContents as never)).toBe(false)
    expect(appendError).toHaveBeenCalledExactlyOnceWith('renderer-recycle', {
      name: 'EPERM',
      stack: ''
    })
  })

  it.each<[string, () => Promise<unknown>]>([
    ['lockVaultAndNotify()', () => ipc.lockVaultAndNotify(win as never)],
    ['vault:close', () => invoke('vault:close')],
    ['app:reload-window', () => invoke('app:reload-window')]
  ])('%s swaps in a fresh renderer once the vault has closed', async (_path, lock) => {
    await lock()

    expectRecycledAfterClose()
    expect(win.webContents.send).not.toHaveBeenCalledWith('vault:auto-locked')
  })

  it('a failed credential rotation swaps in a fresh renderer', async () => {
    await invoke('vault:rotate-credentials', 'new password')

    expect(kill).toHaveBeenCalledTimes(1)
    expect(win.webContents.send).not.toHaveBeenCalledWith('vault:auto-locked')
  })

  it('queues the vault it locked for the next renderer', async () => {
    await ipc.lockVaultAndNotify(win as never)

    expect(pending.takePendingVault()).toEqual({ path: 'C:/vaults/work.nvx', mode: 'open' })
  })

  it.each<[string, () => Promise<unknown>]>([
    ['lockVaultAndNotify()', () => ipc.lockVaultAndNotify(win as never)],
    ['app:reload-window', () => invoke('app:reload-window')]
  ])('%s keeps the renderer when the pack fails, so its toast survives', async (_p, lock) => {
    vi.mocked(vaultMod.closeVault).mockImplementationOnce(async () => {
      vault.open = false
      return { packFailed: true }
    })

    await lock()

    expect(kill).not.toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('vault:pack-failed')
    expect(win.webContents.send).toHaveBeenCalledWith('vault:auto-locked')
    expect(pending.takePendingVault()).toBeNull()
  })

  it('does nothing to a destroyed window', async () => {
    win.isDestroyed.mockReturnValue(true)

    await expect(ipc.lockVaultAndNotify(win as never)).resolves.toBeUndefined()

    expect(kill).not.toHaveBeenCalled()
  })

  it('never recycles on the plain close path', async () => {
    await ipc.closeVaultDrained(win as never)

    expect(kill).not.toHaveBeenCalled()
  })

  it('vault:switch queues its target and recycles', async () => {
    await invoke('vault:switch', OTHER)

    expectRecycledAfterClose()
    expect(pending.takePendingVault()).toEqual({ path: OTHER, mode: 'open' })
  })

  it('opening a different .nvx queues it and recycles instead of messaging the old renderer', async () => {
    const { resolveOpenFilePath } = await import('@main/file-opener')
    const focusable = Object.assign(win, {
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      focus: vi.fn()
    })

    await resolveOpenFilePath(focusable as never, OTHER)

    expectRecycledAfterClose()
    expect(win.webContents.send).not.toHaveBeenCalledWith('vault:open-file', OTHER)
    expect(pending.takePendingVault()).toEqual({ path: OTHER, mode: 'open' })
  })

  it('vault:close with a path queues it for Setup', async () => {
    await invoke('vault:close', 'C:/vaults/new.nvx')

    expectRecycledAfterClose()
    expect(pending.takePendingVault()).toEqual({ path: 'C:/vaults/new.nvx', mode: 'create' })
  })

  it('vault:close ignores a create path that is not a string', async () => {
    await invoke('vault:close', { path: 'C:/vaults/new.nvx' })

    expect(pending.takePendingVault()).toEqual({ path: 'C:/vaults/work.nvx', mode: 'open' })
  })
})
