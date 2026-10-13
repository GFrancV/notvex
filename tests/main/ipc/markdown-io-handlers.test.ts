import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportRead } from '@main/db/queries'
import { rendererIndexPath } from '@main/url-guard'

// Export and import are the only handlers that write or read user-chosen files, and the only
// ones that put decrypted note content on disk. Only what importing ipc-handlers.ts and these
// handlers touch is mocked.

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  shell: {},
  ipcMain: { handle: (channel: string, fn: Handler): void => void handlers.set(channel, fn) }
}))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('fs', () => ({
  closeSync: vi.fn(),
  constants: { O_RDONLY: 0, O_NONBLOCK: 2048 },
  copyFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  fstatSync: vi.fn(),
  openSync: vi.fn(),
  readFileSync: vi.fn(),
  readSync: vi.fn(),
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
vi.mock('@main/db/queries', () => ({ getNote: vi.fn(), listNotes: vi.fn(), importNotes: vi.fn() }))
vi.mock('@main/clipboard-guard', () => ({}))
vi.mock('@main/drain-renderer', () => ({}))

const { registerIpcHandlers, stopAutoLockTimer } = await import('@main/ipc-handlers')
const { getNote, importNotes, listNotes } = await import('@main/db/queries')
const { isVaultOpen } = await import('@main/vault/vault')
const { memzero } = await import('@main/vault/crypto')
const { logError } = await import('@main/log')
const { dialog } = await import('electron')
const { closeSync, fstatSync, openSync, readSync, writeFileSync } = await import('fs')

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

describe('notes:export-all', () => {
  const DIR = join('/out', 'export')
  // A fake folder: path → text. writeFileSync honours the 'wx' flag like the real one does.
  let disk: Map<string, string>

  function noteWith(id: string, title: string, content = ''): typeof NOTE {
    return { ...NOTE, id, title, content, tags: [] }
  }

  function exporting(notes: Array<typeof NOTE>): void {
    vi.mocked(listNotes).mockResolvedValue(notes)
    vi.mocked(getNote).mockImplementation(async (_db, id) => notes.find((n) => n.id === id) ?? null)
  }

  beforeEach(() => {
    disk = new Map()
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [DIR] })
    vi.mocked(writeFileSync).mockImplementation((path, data, options) => {
      const flag = (options as { flag?: string } | undefined)?.flag
      if (flag === 'wx' && disk.has(String(path))) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      }
      disk.set(String(path), Buffer.from(data as Uint8Array).toString('utf8'))
    })
  })

  it('writes one file per non-trashed note and returns the count', async () => {
    exporting([noteWith('a', 'Alpha', 'one'), noteWith('b', 'Beta', 'two')])

    expect(await invoke('notes:export-all')).toEqual({ success: true, data: 2 })
    expect(listNotes).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      trashed: false
    })
    expect(disk.get(join(DIR, 'Alpha.md'))).toBe('# Alpha\n\none')
    expect(disk.get(join(DIR, 'Beta.md'))).toBe('# Beta\n\ntwo')
  })

  it('gives notes whose names collide case-insensitively unique names', async () => {
    exporting([noteWith('a', 'Same'), noteWith('b', 'same'), noteWith('c', '')])

    await invoke('notes:export-all')

    expect([...disk.keys()]).toEqual([
      join(DIR, 'Same.md'),
      join(DIR, 'same (2).md'),
      join(DIR, 'Untitled.md')
    ])
  })

  it('never overwrites a file that is already in the folder', async () => {
    disk.set(join(DIR, 'Title.md'), 'user file')
    exporting([noteWith('a', 'Title', 'from vault')])

    expect(await invoke('notes:export-all')).toEqual({ success: true, data: 1 })
    expect(disk.get(join(DIR, 'Title.md'))).toBe('user file')
    expect(disk.get(join(DIR, 'Title (2).md'))).toBe('# Title\n\nfrom vault')
  })

  it('zeroes every plaintext buffer it wrote', async () => {
    exporting([noteWith('a', 'Alpha', 'one'), noteWith('b', 'Beta', 'two')])

    await invoke('notes:export-all')

    const buffers = vi.mocked(writeFileSync).mock.calls.map((c) => c[1] as Uint8Array)
    expect(buffers).toHaveLength(2)
    expect(buffers.every((b) => b.every((byte) => byte === 0))).toBe(true)
  })

  it('reads no notes and writes nothing when the dialog is canceled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })
    exporting([noteWith('a', 'Alpha')])

    expect(await invoke('notes:export-all')).toEqual({ success: true, data: null })
    expect(listNotes).not.toHaveBeenCalled()
    expect(disk.size).toBe(0)
  })

  it('reads no notes if the vault locked while the dialog was open', async () => {
    vi.mocked(dialog.showOpenDialog).mockImplementation(async () => {
      vi.mocked(isVaultOpen).mockReturnValue(false)
      return { canceled: false, filePaths: [DIR] }
    })
    exporting([noteWith('a', 'Alpha')])

    expect(await invoke('notes:export-all')).toEqual({ success: false, error: 'Vault is locked' })
    expect(listNotes).not.toHaveBeenCalled()
  })

  it('reports how far it got when a write fails, without the path', async () => {
    exporting([noteWith('a', 'Alpha'), noteWith('b', 'Beta')])
    vi.mocked(writeFileSync).mockImplementationOnce(() => undefined)
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error(`ENOSPC: no space left, open '${join(DIR, 'Beta.md')}'`), {
        code: 'ENOSPC'
      })
    })

    expect(await invoke('notes:export-all')).toEqual({
      success: false,
      error: 'Export stopped after 1 of 2 notes: a file could not be written'
    })
    expect(logError).toHaveBeenCalled()
  })
})

describe('notes:import', () => {
  const MB = 1024 * 1024
  // What the handler's reader produced for each file, in order. importNotes itself (the
  // transaction) is covered against a real database in tests/main/db/import-notes.test.ts.
  let reads: ImportRead[]
  // The fake disk. `files`: path → bytes. `special`: FIFOs/devices (size 0, not a regular file).
  // `grown`: what a read returns when the file changed after fstat.
  let files: Map<string, Buffer>
  let special: Set<string>
  let grown: Map<string, Buffer>
  // fd → path, for descriptors that are open; every one must be closed again.
  let open: Map<number, string>
  // The buffers the handler read into, so tests can check they were zeroed.
  let readBuffers: Buffer[]

  function selecting(paths: string[]): void {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: paths })
  }

  beforeEach(() => {
    reads = []
    files = new Map()
    special = new Set()
    grown = new Map()
    open = new Map()
    readBuffers = []
    let nextFd = 10
    vi.mocked(openSync).mockImplementation(((path: string) => {
      if (!files.has(path) && !special.has(path)) {
        throw Object.assign(new Error(`ENOENT: '${path}'`), { code: 'ENOENT' })
      }
      open.set(nextFd, path)
      return nextFd++
    }) as unknown as typeof openSync)
    vi.mocked(fstatSync).mockImplementation(((fd: number) => {
      const path = open.get(fd)!
      return { size: files.get(path)?.length ?? 0, isFile: () => !special.has(path) }
    }) as unknown as typeof fstatSync)
    vi.mocked(readSync).mockImplementation(((
      fd: number,
      buf: Buffer,
      offset: number,
      length: number,
      position: number
    ) => {
      const path = open.get(fd)!
      const source = grown.get(path) ?? files.get(path)!
      if (!readBuffers.includes(buf)) readBuffers.push(buf)
      return source.copy(buf, offset, position, Math.min(source.length, position + length))
    }) as unknown as typeof readSync)
    vi.mocked(closeSync).mockImplementation(((fd: number) => {
      open.delete(fd)
    }) as unknown as typeof closeSync)
    vi.mocked(importNotes).mockImplementation(async (_db, paths, _key, read) => {
      for (const path of paths) reads.push(await read(path))
      return { imported: reads.filter((r) => 'note' in r).length, skipped: [], droppedTags: [] }
    })
  })

  it('opens a multi-select dialog filtered to Markdown and text files', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })

    await invoke('notes:import')

    const [, options] = vi.mocked(dialog.showOpenDialog).mock.calls[0] as unknown as [
      BrowserWindow,
      OpenDialogOptions
    ]
    expect(options.properties).toEqual(['openFile', 'multiSelections'])
    expect(options.filters).toEqual([{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }])
  })

  it('parses each file and returns the import summary', async () => {
    files.set('/in/a.md', Buffer.from('---\ntags: [work]\n---\n# Alpha\n\nbody'))
    files.set('/in/b.txt', Buffer.from('plain'))
    selecting(['/in/a.md', '/in/b.txt'])

    expect(await invoke('notes:import')).toEqual({
      success: true,
      data: { imported: 2, skipped: [], droppedTags: [] }
    })
    expect(reads).toEqual([
      { note: { title: 'Alpha', content: 'body', tags: ['work'] } },
      { note: { title: 'b', content: 'plain', tags: [] } }
    ])
  })

  it('skips a file over 5 MB without reading it', async () => {
    files.set('/in/big.md', Buffer.alloc(5 * MB + 1, 'a'))
    selecting(['/in/big.md'])

    await invoke('notes:import')

    expect(reads).toEqual([{ skip: 'larger than 5 MB' }])
    expect(readSync).not.toHaveBeenCalled()
  })

  it('skips a FIFO or device without reading it', async () => {
    special.add('/in/fifo.md')
    selecting(['/in/fifo.md'])

    await invoke('notes:import')

    expect(reads).toEqual([{ skip: 'not a regular file' }])
    expect(readSync).not.toHaveBeenCalled()
  })

  it('skips a file that grew after it was checked, and zeroes what it read', async () => {
    files.set('/in/live.md', Buffer.from('short'))
    grown.set('/in/live.md', Buffer.from('short, then much longer'))
    selecting(['/in/live.md'])

    await invoke('notes:import')

    expect(reads).toEqual([{ skip: 'changed while being read' }])
    expect(readBuffers[0].every((b) => b === 0)).toBe(true)
  })

  it('closes every file it opened, whatever the outcome', async () => {
    files.set('/in/ok.md', Buffer.from('ok'))
    files.set('/in/big.md', Buffer.alloc(5 * MB + 1, 'a'))
    files.set('/in/bin.md', Buffer.from([0xff]))
    special.add('/in/fifo.md')
    selecting(['/in/ok.md', '/in/big.md', '/in/bin.md', '/in/fifo.md'])

    await invoke('notes:import')

    expect(openSync).toHaveBeenCalledTimes(4)
    expect(open.size).toBe(0)
  })

  it('accepts a file of exactly 5 MB', async () => {
    files.set('/in/max.md', Buffer.alloc(5 * MB, 'a'))
    selecting(['/in/max.md'])

    await invoke('notes:import')

    expect(reads[0]).toHaveProperty('note')
  })

  it('skips a file that is not valid UTF-8 and zeroes what it read', async () => {
    files.set('/in/binary.md', Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x41]))
    selecting(['/in/binary.md'])

    await invoke('notes:import')

    expect(reads).toEqual([{ skip: 'not valid UTF-8' }])
    expect(readBuffers[0].every((b) => b === 0)).toBe(true)
  })

  it('zeroes the bytes of a file it imported', async () => {
    files.set('/in/s.md', Buffer.from('# Secret\n\ntext'))
    selecting(['/in/s.md'])

    await invoke('notes:import')

    expect(reads[0]).toHaveProperty('note')
    expect(memzero).toHaveBeenCalledWith(readBuffers[0])
    expect(readBuffers[0].every((b) => b === 0)).toBe(true)
  })

  it('skips a file it cannot read instead of failing the import', async () => {
    files.set('/in/ok.md', Buffer.from('ok'))
    selecting(['/in/gone.md', '/in/ok.md'])

    await invoke('notes:import')

    expect(reads).toEqual([{ skip: 'could not be read' }, { note: expect.anything() }])
    expect(logError).toHaveBeenCalled()
  })

  it('rejects more than 500 files without reading any', async () => {
    selecting(Array.from({ length: 501 }, (_, i) => `/in/${i}.md`))

    expect(await invoke('notes:import')).toEqual({
      success: false,
      error: 'Select at most 500 files per import'
    })
    expect(importNotes).not.toHaveBeenCalled()
  })

  it('accepts exactly 500 files', async () => {
    const paths = Array.from({ length: 500 }, (_, i) => `/in/${i}.md`)
    for (const path of paths) files.set(path, Buffer.from('x'))
    selecting(paths)

    expect(await invoke('notes:import')).toMatchObject({ success: true, data: { imported: 500 } })
  })

  it('imports nothing when the dialog is canceled', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })

    expect(await invoke('notes:import')).toEqual({ success: true, data: null })
    expect(importNotes).not.toHaveBeenCalled()
  })

  it('refuses a locked vault without opening a dialog', async () => {
    vi.mocked(isVaultOpen).mockReturnValue(false)

    expect(await invoke('notes:import')).toEqual({ success: false, error: 'Vault is locked' })
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('imports nothing if the vault locked while the dialog was open', async () => {
    vi.mocked(dialog.showOpenDialog).mockImplementation(async () => {
      vi.mocked(isVaultOpen).mockReturnValue(false)
      return { canceled: false, filePaths: ['/in/a.md'] }
    })

    expect(await invoke('notes:import')).toEqual({ success: false, error: 'Vault is locked' })
    expect(importNotes).not.toHaveBeenCalled()
  })
})
