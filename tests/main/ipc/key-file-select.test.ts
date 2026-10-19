import type { BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rendererIndexPath } from '@main/url-guard'

// The renderer shows these handlers' errors in a toast, so it must never carry the file path.
// Only what importing ipc-handlers.ts and these handlers touch is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn()
}))
vi.mock('@main/prefs', () => ({ getPref: vi.fn(() => 0) }))
vi.mock('@main/log', () => ({ logError: vi.fn() }))
vi.mock('@main/vault/backups', () => ({}))
vi.mock('@main/vault/container', () => ({}))
vi.mock('@main/vault/crypto', () => ({ KEY_FILE_MAX_BYTES: 4, memzero: vi.fn() }))
vi.mock('@main/vault/vault', () => ({ isVaultOpen: vi.fn(() => true) }))
vi.mock('@main/db/queries', () => ({}))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { dialog } = await import('electron')
const { readFileSync, writeFileSync } = await import('fs')

const PATH = '/home/someone/secret-folder/key.bin'
const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }
const win = { isDestroyed: () => false, webContents: {} } as unknown as BrowserWindow

function invoke(channel: string): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event))
}

const select = (): Promise<unknown> => invoke('vault:select-key-file')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [PATH] })
  registerIpcHandlers(win, () => null)
})

afterEach(() => stopAutoLockTimer())

describe('vault:select-key-file', () => {
  it('reports an unreadable file with a fixed message that leaves out the path', async () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error(`EACCES: permission denied, open '${PATH}'`)
    })

    const result = await select()

    expect(result).toEqual({ success: false, error: 'Could not read the selected key file' })
  })

  it('refuses an empty file', async () => {
    vi.mocked(readFileSync).mockReturnValue(Buffer.alloc(0))

    expect(await select()).toEqual({ success: false, error: 'The selected key file is empty' })
  })

  it('caps the contents but reports the real size', async () => {
    vi.mocked(readFileSync).mockReturnValue(Buffer.from([1, 2, 3, 4, 5, 6]))

    expect(await select()).toEqual({
      success: true,
      data: { contents: new Uint8Array([1, 2, 3, 4]), filename: 'key.bin', sizeBytes: 6 }
    })
  })

  it('returns null when the dialog is cancelled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })

    expect(await select()).toEqual({ success: true, data: null })
  })
})

describe('vault:generate-key-file', () => {
  it('reports a failed save with a fixed message that leaves out the path', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: PATH })
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error(`EACCES: permission denied, open '${PATH}'`)
    })

    const result = await invoke('vault:generate-key-file')

    expect(result).toEqual({ success: false, error: 'Could not save the key file' })
  })
})
