import type { BrowserWindow, SaveDialogOptions } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// Export and import are the only handlers that write or read user-chosen files, and the only
// ones that put decrypted note content on disk. Only what importing ipc-handlers.ts and these
// handlers touch is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showSaveDialog: vi.fn() },
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => 0) }))
vi.mock('@main/log', () => ({ logError: vi.fn() }))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({
  KEY_FILE_MAX_BYTES: 0,
  memzero: vi.fn((buf: Uint8Array) => buf.fill(0))
}))
vi.mock('@main/vault/vault', () => ({
  getDb: vi.fn(() => ({})),
  getMasterKey: vi.fn(() => new Uint8Array(32)),
  isVaultOpen: vi.fn(() => true),
  withVaultLock: vi.fn(<T>(fn: () => Promise<T>) => fn())
}))
vi.mock('@main/db/queries', () => ({ getNote: vi.fn() }))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { getNote } = await import('@main/db/queries')
const { isVaultOpen } = await import('@main/vault/vault')
const { memzero } = await import('@main/vault/crypto')
const { logError } = await import('@main/log')
const { dialog } = await import('electron')
const { writeFileSync } = await import('fs')

const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }
const win = { isDestroyed: () => false, webContents: {} } as unknown as BrowserWindow

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event, ...args))
}

const NOTE = {
  id: 'n1',
  title: 'Plan: Q3?',
  content: 'secret body',
  isPinned: false,
  isTrashed: false,
  createdAt: 1,
  updatedAt: 1,
  trashedAt: null,
  tags: [{ id: 't1', name: 'work', color: '#10b981', createdAt: 1 }]
}

// Captured at call time: the handler zeroes the buffer right after writing it.
let written: { path: string; text: string } | undefined

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isVaultOpen).mockReset().mockReturnValue(true)
  vi.mocked(getNote).mockResolvedValue(NOTE)
  written = undefined
  vi.mocked(writeFileSync).mockImplementation((path, data) => {
    written = { path: String(path), text: Buffer.from(data as Uint8Array).toString('utf8') }
  })
  registerIpcHandlers(win, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('notes:export', () => {
  it('writes the serialized note to the chosen path and returns no content', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/out/x.md' })

    const result = await invoke('notes:export', 'n1')

    expect(result).toEqual({ success: true, data: true })
    expect(written).toEqual({
      path: '/out/x.md',
      text: '---\ntags: [work]\n---\n# Plan: Q3?\n\nsecret body'
    })
  })

  it('offers a sanitized filename', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })

    await invoke('notes:export', 'n1')

    // Typed as the (options) overload; the handler uses (window, options).
    const [, options] = vi.mocked(dialog.showSaveDialog).mock.calls[0] as unknown as [
      BrowserWindow,
      SaveDialogOptions
    ]
    expect(options.defaultPath).toMatch(/Plan_ Q3_\.md$/)
  })

  it('zeroes the plaintext buffer after writing', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '/out/x.md' })

    await invoke('notes:export', 'n1')

    const buf = vi.mocked(writeFileSync).mock.calls[0][1] as Uint8Array
    expect(memzero).toHaveBeenCalledWith(buf)
    expect(buf.every((b) => b === 0)).toBe(true)
  })

  it('writes nothing when the dialog is canceled', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })

    expect(await invoke('notes:export', 'n1')).toEqual({ success: true, data: null })
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('refuses a locked vault without opening a dialog', async () => {
    vi.mocked(isVaultOpen).mockReturnValue(false)

    expect(await invoke('notes:export', 'n1')).toEqual({
      success: false,
      error: 'Vault is locked'
    })
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('writes nothing if the vault locked while the dialog was open', async () => {
    vi.mocked(dialog.showSaveDialog).mockImplementation(async () => {
      vi.mocked(isVaultOpen).mockReturnValue(false)
      return { canceled: false, filePath: '/out/x.md' }
    })

    expect(await invoke('notes:export', 'n1')).toEqual({
      success: false,
      error: 'Vault is locked'
    })
    expect(writeFileSync).not.toHaveBeenCalled()
  })

  it('reports a missing note', async () => {
    vi.mocked(getNote).mockResolvedValue(null)

    expect(await invoke('notes:export', 'gone')).toEqual({
      success: false,
      error: 'Note not found'
    })
  })

  it('hides the path of a failed write from the renderer', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/home/alice/x.md'
    })
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied, open '/home/alice/x.md'"), {
        code: 'EACCES'
      })
    })

    const result = await invoke('notes:export', 'n1')

    expect(result).toEqual({ success: false, error: 'Could not write the exported file' })
    expect(logError).toHaveBeenCalled()
    expect(memzero).toHaveBeenCalled()
  })
})
