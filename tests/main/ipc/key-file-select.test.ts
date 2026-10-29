import type { BrowserWindow } from 'electron'
import { closeSync, mkdtempSync, openSync, readSync, rmSync, truncateSync } from 'fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Mock } from 'vitest'
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
// Real fs, so the key file read runs against real files; the fd calls are wrapped so a test can
// force a short read or a failure and see which descriptor was closed.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    openSync: vi.fn(actual.openSync),
    closeSync: vi.fn(actual.closeSync),
    readSync: vi.fn(actual.readSync),
    writeFileSync: vi.fn()
  }
})
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
const { writeFileSync } = await import('fs')
const realFs = await vi.importActual<typeof import('fs')>('fs')
// readSync's overloads resolve to the options form; the handler uses the positional one.
const positionalReadSync = vi.mocked(readSync) as unknown as Mock<
  (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => number
>

const PATH = '/home/someone/secret-folder/key.bin'
const event = { senderFrame: { url: pathToFileURL(rendererIndexPath).href } }
const win = { isDestroyed: () => false, webContents: {} } as unknown as BrowserWindow

let dir: string

function invoke(channel: string): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(fn(event))
}

function pick(filePath: string): void {
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [filePath] })
}

function keyFile(bytes: number[]): string {
  const filePath = join(dir, 'key.bin')
  realFs.writeFileSync(filePath, Buffer.from(bytes))
  return filePath
}

const select = (): Promise<unknown> => invoke('vault:select-key-file')

beforeEach(() => {
  vi.clearAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'notvex-key-file-'))
  registerIpcHandlers(win, () => null)
})

afterEach(() => {
  stopAutoLockTimer()
  rmSync(dir, { recursive: true, force: true })
})

describe('vault:select-key-file', () => {
  it('caps the contents but reports the real size', async () => {
    pick(keyFile([1, 2, 3, 4, 5, 6]))

    expect(await select()).toEqual({
      success: true,
      data: { contents: new Uint8Array([1, 2, 3, 4]), filename: 'key.bin', sizeBytes: 6 }
    })
  })

  it('returns a file under the cap whole', async () => {
    pick(keyFile([7, 8]))

    expect(await select()).toEqual({
      success: true,
      data: { contents: new Uint8Array([7, 8]), filename: 'key.bin', sizeBytes: 2 }
    })
  })

  it('keeps reading when the OS returns fewer bytes than asked', async () => {
    pick(keyFile([1, 2, 3, 4, 5, 6]))
    positionalReadSync.mockImplementationOnce((fd, buffer, offset, _length, position) =>
      realFs.readSync(fd, buffer, offset, 2, position)
    )

    expect(await select()).toEqual({
      success: true,
      data: { contents: new Uint8Array([1, 2, 3, 4]), filename: 'key.bin', sizeBytes: 6 }
    })
  })

  it('reads only the capped head of a file over 2 GB', async () => {
    const filePath = keyFile([])
    const size = 3 * 1024 ** 3
    truncateSync(filePath, size)
    pick(filePath)

    expect(await select()).toEqual({
      success: true,
      data: { contents: new Uint8Array(4), filename: 'key.bin', sizeBytes: size }
    })
    const asked = positionalReadSync.mock.calls.reduce((sum, [, , , length]) => sum + length, 0)
    expect(asked).toBeLessThanOrEqual(4)
  })

  it('closes the file when the read fails, with the fixed message', async () => {
    pick(keyFile([1, 2, 3, 4, 5, 6]))
    vi.mocked(readSync).mockImplementationOnce(() => {
      throw new Error('EIO: i/o error, read')
    })

    expect(await select()).toEqual({
      success: false,
      error: "Couldn't read the selected key file"
    })
    const fd = vi.mocked(openSync).mock.results[0]?.value
    expect(vi.mocked(closeSync).mock.calls).toEqual([[fd]])
  })

  it('refuses an empty file', async () => {
    pick(keyFile([]))

    expect(await select()).toEqual({ success: false, error: 'The selected key file is empty' })
  })

  it('refuses something that is not a regular file with the fixed message', async () => {
    pick(dir)

    expect(await select()).toEqual({
      success: false,
      error: "Couldn't read the selected key file"
    })
  })

  it('reports an unreadable file with a fixed message that leaves out the path', async () => {
    pick(join(dir, 'missing.bin'))

    const result = await select()

    expect(result).toEqual({ success: false, error: "Couldn't read the selected key file" })
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

    expect(result).toEqual({ success: false, error: "Couldn't save the key file" })
  })
})
