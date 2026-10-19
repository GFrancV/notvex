import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'node:url'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Note } from '@shared/types'
import { rendererIndexPath } from '@main/url-guard'
import { clearClipboardIfOurs } from '@main/clipboard-guard'
import { promoteVaultToTop } from '@main/prefs'
import { closeVault, createVault, isVaultOpen, openVault } from '@main/vault/vault'

// Drives each close path through the real IPC handlers and vault module: an edit followed by
// the autosave's notes:list must still be packed, never reach doCloseVault() as skipPack.
// Only Electron and the surrounding main-process modules are stubbed.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  // isPackaged: true so the trusted-frame check never consults a dev server URL
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
  getCurrentVaultPath: vi.fn(),
  getPref: vi.fn(() => 0),
  getPrefs: vi.fn(),
  promoteVaultToTop: vi.fn(),
  recordVaultUsed: vi.fn(),
  setPref: vi.fn()
}))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/clipboard-guard', () => ({ clearClipboardIfOurs: vi.fn(async () => undefined) }))
vi.mock('@main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

// Real Argon2id, cheapest tier: calibration is not what's under test.
vi.mock('@main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/vault/crypto')>()
  return { ...actual, calibrateArgon2id: vi.fn(() => ({ tier: 10 })) }
})

const APP_URL = pathToFileURL(rendererIndexPath).href
const PASSWORD = 'correct horse battery staple'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  const res = (await fn({ sender: {}, senderFrame: { url: APP_URL } }, ...args)) as
    { success: true; data: T } | { success: false; error: string }
  if (!res.success) throw new Error(`${channel} failed: ${res.error}`)
  return res.data
}

describe('every close path packs the latest edit (issue #61)', () => {
  let ipc: typeof import('@main/ipc-handlers')
  let vaultDir: string
  let vaultPath: string
  let otherVaultPath: string
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }

  beforeAll(async () => {
    ipc = await import('@main/ipc-handlers')
    ipc.registerIpcHandlers(win as never, () => null)

    vaultDir = mkdtempSync(join(tmpdir(), 'notvex-test-'))
    vaultPath = join(vaultDir, 'test.nvx')
    otherVaultPath = join(vaultDir, 'other.nvx')
    await createVault(vaultPath, PASSWORD)
    await closeVault()
    // vault:switch only validates its target; a copy is a valid .nvx without a second KDF run
    copyFileSync(vaultPath, otherVaultPath)
  }, 60_000)

  afterEach(async () => {
    ipc.stopAutoLockTimer()
    await closeVault()
  })

  afterAll(() => {
    rmSync(vaultDir, { recursive: true, force: true })
  })

  it.each<[string, () => Promise<unknown>]>([
    ['vault:close', () => invoke('vault:close')],
    ['vault:switch', () => invoke('vault:switch', otherVaultPath)],
    ['lockVaultAndNotify()', () => ipc.lockVaultAndNotify(win as never)],
    ['closeVaultDrained()', () => ipc.closeVaultDrained(win as never)]
  ])(
    '%s keeps an edit followed by a notes:list',
    async (_path, close) => {
      await openVault(vaultPath, PASSWORD)
      const note = await invoke<{ id: string }>('notes:create', {
        title: 'Draft',
        content: 'before'
      })
      await invoke('notes:update', note.id, { content: 'after' })

      // Mirrors the editor: autosave resolves, then `void loadNotes()` queues a notes:list
      void invoke('notes:list')
      vi.mocked(clearClipboardIfOurs).mockClear()
      await close()
      expect(isVaultOpen()).toBe(false)
      expect(clearClipboardIfOurs).toHaveBeenCalledExactlyOnceWith('lock')

      await openVault(vaultPath, PASSWORD)
      expect((await invoke<Note | null>('notes:get', note.id))?.content).toBe('after')
    },
    60_000
  )

  // The close already ran, so a failed prefs write must not tell the renderer the switch failed
  it('vault:switch succeeds when the prefs write after the close fails', async () => {
    await openVault(vaultPath, PASSWORD)
    const err = Object.assign(new Error(`EACCES: permission denied, open '${vaultDir}'`), {
      code: 'EACCES'
    })
    vi.mocked(promoteVaultToTop).mockImplementationOnce(() => {
      throw err
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await expect(invoke('vault:switch', otherVaultPath)).resolves.toBeNull()

      expect(isVaultOpen()).toBe(false)
      expect(console.error).toHaveBeenCalledExactlyOnceWith('[switch] promote failed:', 'EACCES')
    } finally {
      vi.mocked(console.error).mockRestore()
      // An unconsumed throw would otherwise fire in the next test that reaches the promote
      vi.mocked(promoteVaultToTop).mockReset()
    }
  }, 60_000)

  it.each<[string, () => string, string]>([
    ['a missing vault', () => join(vaultDir, 'missing.nvx'), 'Vault not found'],
    [
      'a file that is not a vault',
      () => {
        const junk = join(vaultDir, 'junk.nvx')
        writeFileSync(junk, 'not a vault')
        return junk
      },
      'not a valid Notvex vault'
    ]
  ])(
    'vault:switch to %s fails and keeps the current one open',
    async (_target, target, error) => {
      await openVault(vaultPath, PASSWORD)

      await expect(invoke('vault:switch', target())).rejects.toThrow(error)
      expect(isVaultOpen()).toBe(true)
    },
    60_000
  )

  it('leaves the clipboard alone when no vault is open', async () => {
    vi.mocked(clearClipboardIfOurs).mockClear()

    await ipc.closeVaultDrained(win as never)

    expect(clearClipboardIfOurs).not.toHaveBeenCalled()
  })

  it('tells the window when the pack on close fails', async () => {
    await openVault(vaultPath, PASSWORD)
    // atomicWrite() writes <vault>.tmp first; a directory there makes the pack fail
    const blocker = vaultPath + '.tmp'
    mkdirSync(blocker)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    win.webContents.send.mockClear()

    try {
      await ipc.closeVaultDrained(win as never)

      expect(win.webContents.send).toHaveBeenCalledWith('vault:pack-failed')
    } finally {
      vi.mocked(console.error).mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }
  }, 60_000)

  it('sends nothing when the pack on close succeeds', async () => {
    await openVault(vaultPath, PASSWORD)
    win.webContents.send.mockClear()

    await ipc.closeVaultDrained(win as never)

    expect(win.webContents.send).not.toHaveBeenCalled()
  }, 60_000)

  // webContents.send on a destroyed window throws, which would turn a close
  // that already finished into a rejected one (e.g. the window closing mid-lock).
  it('does not message a destroyed window when the pack on close fails', async () => {
    await openVault(vaultPath, PASSWORD)
    const blocker = vaultPath + '.tmp'
    mkdirSync(blocker)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const destroyed = {
      isDestroyed: () => true,
      webContents: {
        send: vi.fn(() => {
          throw new Error('Object has been destroyed')
        })
      }
    }

    try {
      await expect(ipc.closeVaultDrained(destroyed as never)).resolves.toEqual({
        packFailed: true
      })

      expect(destroyed.webContents.send).not.toHaveBeenCalled()
      expect(isVaultOpen()).toBe(false)
    } finally {
      vi.mocked(console.error).mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }
  }, 60_000)
})
