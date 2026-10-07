import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'node:url'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Note } from '@shared/types'
import { rendererIndexPath } from '../src/main/url-guard'
import { closeVault, createVault, isVaultOpen, openVault } from '../src/main/vault/vault'

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
vi.mock('../src/main/prefs', () => ({
  getCurrentVaultPath: vi.fn(),
  getPref: vi.fn(() => 0),
  getPrefs: vi.fn(),
  promoteVaultToTop: vi.fn(),
  recordVaultUsed: vi.fn(),
  setPref: vi.fn()
}))
vi.mock('../src/main/vault/backups', () => ({}))
vi.mock('../src/main/clipboard-guard', () => ({}))
vi.mock('../src/main/drain-renderer', () => ({ drainRenderer: vi.fn(async () => undefined) }))

// Real Argon2id, cheapest tier: calibration is not what's under test.
vi.mock('../src/main/vault/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/vault/crypto')>()
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
  let ipc: typeof import('../src/main/ipc-handlers')
  let vaultDir: string
  let vaultPath: string
  let otherVaultPath: string
  const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }

  beforeAll(async () => {
    ipc = await import('../src/main/ipc-handlers')
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
      await close()
      expect(isVaultOpen()).toBe(false)

      await openVault(vaultPath, PASSWORD)
      expect((await invoke<Note | null>('notes:get', note.id))?.content).toBe('after')
    },
    60_000
  )

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
      await expect(ipc.closeVaultDrained(destroyed as never)).resolves.toBeUndefined()

      expect(destroyed.webContents.send).not.toHaveBeenCalled()
      expect(isVaultOpen()).toBe(false)
    } finally {
      vi.mocked(console.error).mockRestore()
      rmSync(blocker, { recursive: true, force: true })
    }
  }, 60_000)
})
