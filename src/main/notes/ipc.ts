import type { BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { closeSync, constants, fstatSync, openSync, writeFileSync } from 'fs'
import { basename, join } from 'node:path'

import type { CreateNoteInput, ImportRead, Note, NoteFilter, NotePatch } from '../db/queries'
import {
  createNote,
  deleteNote,
  duplicateNote,
  emptyTrash,
  getNote,
  getNoteCounts,
  getNoteTitle,
  importNotes,
  listNotes,
  restoreNote,
  trashNote,
  updateNote
} from '../db/queries'
import { dialogDefaultPath, rememberDialogDir } from '../dialog-dir'
import { fail, handle, ok, readFully, requireVault } from '../ipc/core'
import { logError } from '../log/log'
import { memzero } from '../vault/crypto'
import { getDb, getMasterKey, withVaultLock } from '../vault/vault'
import { dedupeName, parseMarkdownFile, serializeNote, toSafeFilename } from './markdown-io'

// Exported files are plaintext: on Linux and macOS the default 0644 would let other local
// accounts read them. Applies when a file is created; Windows ignores it.
const EXPORT_MODE = 0o600

// The caller must memzero the result once written.
function toMarkdownBytes(note: Note): Buffer {
  const tags = note.tags.map((t) => t.name)
  return Buffer.from(serializeNote({ ...note, tags }), 'utf8')
}

// 'wx' fails instead of replacing a file the user already has in `dir`; on EEXIST the next free
// " (n)" name is tried. `used` also catches collisions within this export.
function writeNewFile(dir: string, base: string, used: Set<string>, bytes: Uint8Array): void {
  for (;;) {
    try {
      writeFileSync(join(dir, dedupeName(base, used)), bytes, { flag: 'wx', mode: EXPORT_MODE })
      return
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
  }
}

// Imported files are untrusted: size is checked before reading (and again after, in case the
// file grew in between), and decoding is strict so a binary renamed to .md is rejected rather
// than stored as mojibake. A file that can't be read is skipped, not fatal to the import.
const IMPORT_MAX_FILES = 500
const IMPORT_MAX_BYTES = 5 * 1024 * 1024
const utf8Strict = new TextDecoder('utf-8', { fatal: true })

function decodeUtf8(raw: Uint8Array): string | null {
  try {
    return utf8Strict.decode(raw)
  } catch {
    return null
  }
}

// Checked and read through one descriptor, so the file that was checked is the file that is read.
async function readImportFile(file: string): Promise<ImportRead> {
  let fd: number
  try {
    // O_NONBLOCK: opening a FIFO would otherwise wait for a writer forever. No-op on Windows.
    fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
  } catch (e) {
    logError('notes:import: open failed:', e)
    return { skip: "couldn't be read" }
  }
  let buf: Buffer | undefined
  try {
    const stat = fstatSync(fd)
    // FIFOs and devices report size 0 and may never reach EOF, so the size cap can't hold.
    if (!stat.isFile()) return { skip: 'not a regular file' }
    if (stat.size > IMPORT_MAX_BYTES) return { skip: 'larger than 5 MB' }
    // One byte past the stated size, to notice a file that grew since fstat.
    buf = Buffer.alloc(stat.size + 1)
    const length = readFully(fd, buf)
    if (length > stat.size) return { skip: 'changed while being read' }
    const text = decodeUtf8(buf.subarray(0, length))
    if (text === null) return { skip: 'not valid UTF-8' }
    return { note: parseMarkdownFile(text, basename(file)) }
  } catch (e) {
    logError('notes:import: read failed:', e)
    return { skip: "couldn't be read" }
  } finally {
    if (buf) memzero(buf)
    closeSync(fd)
  }
}

export function registerNotesHandlers({
  requireWin,
  touchActivity
}: {
  requireWin: () => BrowserWindow
  touchActivity: () => void
}): void {
  handle('notes:create', async (_e, input: CreateNoteInput) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => createNote(getDb(), input, getMasterKey())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:get', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getNote(getDb(), id, getMasterKey())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:list', async (_e, filter: NoteFilter = {}) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => listNotes(getDb(), getMasterKey(), filter)))
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:update', async (_e, id: string, patch: NotePatch) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => updateNote(getDb(), id, patch, getMasterKey()))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // Takes only the id: the content is read and re-encrypted here, never round-tripped
  // through the renderer.
  handle('notes:duplicate', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => duplicateNote(getDb(), id, getMasterKey())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:trash', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => trashNote(getDb(), id))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:restore', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => restoreNote(getDb(), id))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:delete', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => deleteNote(getDb(), id))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:empty-trash', async () => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => emptyTrash(getDb()))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:counts', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getNoteCounts(getDb())))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Markdown export / import ────────────────────────────────────────────────
  // The renderer sends only ids and gets back only counts: note content is read, decrypted and
  // written here and never crosses IPC.

  handle('notes:export', async (_e, noteId: string) => {
    try {
      requireVault()
      touchActivity()
      // Only the title before the dialog: the content isn't decrypted while it waits on the user.
      const title = await withVaultLock(() => getNoteTitle(getDb(), noteId, getMasterKey()))
      if (title === null) return fail('Note not found')

      // Outside the vault lock: an open dialog must not hold up the periodic sync or a lock.
      const { canceled, filePath } = await dialog.showSaveDialog(requireWin(), {
        title: 'Export note',
        defaultPath: dialogDefaultPath(`${toSafeFilename(title)}.md`),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (canceled || !filePath) return ok(null)
      rememberDialogDir(filePath)
      // A lock while the dialog was open means the user may have walked away: don't write.
      requireVault()
      // Re-read from whatever vault is open now; another one may have been unlocked meanwhile.
      const note = await withVaultLock(() => getNote(getDb(), noteId, getMasterKey()))
      if (!note) return fail('Note not found')

      const bytes = toMarkdownBytes(note)
      try {
        writeFileSync(filePath, bytes, { mode: EXPORT_MODE })
      } catch (e) {
        logError('notes:export: write failed:', e)
        return fail("Couldn't write the exported file")
      } finally {
        memzero(bytes)
      }
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:export-all', async () => {
    try {
      requireVault()
      touchActivity()
      // The folder is picked before any note is decrypted, so no plaintext waits on the user.
      const { canceled, filePaths } = await dialog.showOpenDialog(requireWin(), {
        title: 'Export all notes',
        defaultPath: dialogDefaultPath(),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Export here'
      })
      const dir = filePaths[0]
      if (canceled || !dir) return ok(null)
      rememberDialogDir(dir)
      requireVault()

      // One note decrypted at a time. Exporting holds the vault lock, but it's a one-off action
      // the user is waiting on.
      return await withVaultLock(async () => {
        const ids = (await listNotes(getDb(), getMasterKey(), { trashed: false })).map((n) => n.id)
        const used = new Set<string>()
        let written = 0
        for (const id of ids) {
          const note = await getNote(getDb(), id, getMasterKey())
          if (!note) continue
          const bytes = toMarkdownBytes(note)
          try {
            writeNewFile(dir, toSafeFilename(note.title), used, bytes)
          } catch (e) {
            logError('notes:export-all: write failed:', e)
            return fail(
              `Export stopped after ${written} of ${ids.length} notes: a file couldn't be written`
            )
          } finally {
            memzero(bytes)
          }
          written++
        }
        return ok(written)
      })
    } catch (e) {
      return fail(e)
    }
  })

  handle('notes:import', async () => {
    try {
      requireVault()
      touchActivity()
      const { canceled, filePaths } = await dialog.showOpenDialog(requireWin(), {
        title: 'Import Markdown',
        defaultPath: dialogDefaultPath(),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
      })
      if (canceled || filePaths.length === 0) return ok(null)
      rememberDialogDir(filePaths[0])
      if (filePaths.length > IMPORT_MAX_FILES) {
        return fail(`Select at most ${IMPORT_MAX_FILES} files per import`)
      }
      requireVault()

      // importNotes reads each file inside its transaction, so this holds the vault lock for the
      // whole import; it's a one-off action the user is waiting on.
      const result = await withVaultLock(() =>
        importNotes(getDb(), filePaths, getMasterKey(), readImportFile)
      )
      return ok(result)
    } catch (e) {
      return fail(e)
    }
  })
}
