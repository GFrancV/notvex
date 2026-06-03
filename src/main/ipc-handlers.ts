import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  createVault,
  openVault,
  openVaultWithRecovery,
  closeVault,
  isVaultOpen,
  getMasterKey,
  getDb,
  getVaultDir,
  vaultExistsAt,
} from './vault/vault'
import { deriveKeyFromYubiKey, listYubiKeys } from './vault/yubikey'
import {
  createNote,
  getNote,
  listNotes,
  updateNote,
  trashNote,
  restoreNote,
  deleteNote,
  emptyTrash,
  searchNotesByTitle,
  createTag,
  listTags,
  updateTag,
  deleteTag,
  addTagToNote,
  removeTagFromNote,
  getNoteTags,
  getNoteCountPerTag,
} from './db/queries'
import { getPrefs, setPrefs, getPref, setPref } from './prefs'
import type { CreateNoteInput, NotePatch, NoteFilter, CreateTagInput, TagPatch } from './db/queries'

// ─── IPC envelope helper ─────────────────────────────────────────────────────

type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: unknown): IpcResult<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

function requireVault(): void {
  if (!isVaultOpen()) throw new Error('Vault is locked')
}

// ─── Auto-lock state ─────────────────────────────────────────────────────────

let lastActivityAt = Date.now()
let autoLockTimer: ReturnType<typeof setInterval> | null = null
let mainWindowRef: BrowserWindow | null = null

function touchActivity(): void {
  lastActivityAt = Date.now()
}

function startAutoLockTimer(win: BrowserWindow): void {
  if (autoLockTimer) clearInterval(autoLockTimer)
  mainWindowRef = win
  autoLockTimer = setInterval(async () => {
    const minutes = getPref('autoLockMinutes')
    if (minutes === 0) return // 0 = never
    if (!isVaultOpen()) return
    const elapsed = (Date.now() - lastActivityAt) / 60000
    if (elapsed >= minutes) {
      await closeVault()
      mainWindowRef?.webContents.send('vault:auto-locked')
    }
  }, 60_000)
}

export function stopAutoLockTimer(): void {
  if (autoLockTimer) { clearInterval(autoLockTimer); autoLockTimer = null }
}

// ─── Register all handlers ────────────────────────────────────────────────────

export function registerIpcHandlers(win: BrowserWindow): void {
  startAutoLockTimer(win)

  // ── Vault ──────────────────────────────────────────────────────────────────

  ipcMain.handle('vault:has-vault', (_e, dir?: string) => {
    try {
      const path = dir ?? getPref('vaultDir')
      return ok(path ? vaultExistsAt(path) : false)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:create', async (_e, dir: string, password: string) => {
    try {
      const result = await createVault(dir, password)
      setPref('vaultDir', dir)
      touchActivity()
      return ok(result)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:open', async (_e, dir: string, password: string) => {
    try {
      const success = await openVault(dir, password)
      if (success) { setPref('vaultDir', dir); touchActivity() }
      return ok(success)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:open-with-recovery', async (_e, dir: string, mnemonic: string) => {
    try {
      const success = await openVaultWithRecovery(dir, mnemonic)
      if (success) { setPref('vaultDir', dir); touchActivity() }
      return ok(success)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:open-with-yubikey', async (_e, dir: string) => {
    try {
      const { readFileSync } = await import('fs')
      const { join } = await import('path')
      const sidecar = JSON.parse(readFileSync(join(dir, 'notvex.json'), 'utf8')) as {
        argon2_salt: string
        argon2_params: { memory: number; iterations: number; parallelism: number }
      }
      const salt = new Uint8Array(Buffer.from(sidecar.argon2_salt, 'hex'))
      const _key = await deriveKeyFromYubiKey(salt) // TODO: use this key to open vault
      return ok(false) // YubiKey vault opening: Phase 6 completion
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:close', async () => {
    try { await closeVault(); return ok(null) }
    catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:status', () => {
    return ok({ isOpen: isVaultOpen(), vaultDir: getVaultDir() })
  })

  ipcMain.handle('vault:choose-directory', async () => {
    try {
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Choose vault location',
      })
      return ok(result.canceled ? null : result.filePaths[0])
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('vault:list-yubikeys', () => {
    try { return ok(listYubiKeys()) }
    catch (e) { return fail(e) }
  })

  // ── Notes ─────────────────────────────────────────────────────────────────

  ipcMain.handle('notes:create', async (_e, input: CreateNoteInput) => {
    try {
      requireVault(); touchActivity()
      return ok(await createNote(getDb(), input, getMasterKey()))
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:get', async (_e, id: string) => {
    try {
      requireVault(); touchActivity()
      return ok(await getNote(getDb(), id, getMasterKey()))
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:list', async (_e, filter: NoteFilter = {}) => {
    try {
      requireVault(); touchActivity()
      return ok(await listNotes(getDb(), getMasterKey(), filter))
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:update', async (_e, id: string, patch: NotePatch) => {
    try {
      requireVault(); touchActivity()
      await updateNote(getDb(), id, patch, getMasterKey())
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:trash', async (_e, id: string) => {
    try {
      requireVault(); touchActivity()
      await trashNote(getDb(), id)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:restore', async (_e, id: string) => {
    try {
      requireVault(); touchActivity()
      await restoreNote(getDb(), id)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:delete', async (_e, id: string) => {
    try {
      requireVault(); touchActivity()
      await deleteNote(getDb(), id)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:empty-trash', async () => {
    try {
      requireVault(); touchActivity()
      await emptyTrash(getDb())
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('notes:search', async (_e, query: string) => {
    try {
      requireVault(); touchActivity()
      return ok(await searchNotesByTitle(getDb(), query, getMasterKey()))
    } catch (e) { return fail(e) }
  })

  // ── Tags ──────────────────────────────────────────────────────────────────

  ipcMain.handle('tags:create', async (_e, input: CreateTagInput) => {
    try {
      requireVault(); touchActivity()
      return ok(await createTag(getDb(), input))
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('tags:list', async () => {
    try {
      requireVault(); touchActivity()
      return ok(await listTags(getDb()))
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('tags:update', async (_e, id: string, patch: TagPatch) => {
    try {
      requireVault(); touchActivity()
      await updateTag(getDb(), id, patch)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('tags:delete', async (_e, id: string) => {
    try {
      requireVault(); touchActivity()
      await deleteTag(getDb(), id)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  // ── Note-tags ─────────────────────────────────────────────────────────────

  ipcMain.handle('note-tags:add', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault(); touchActivity()
      await addTagToNote(getDb(), noteId, tagId)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('note-tags:remove', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault(); touchActivity()
      await removeTagFromNote(getDb(), noteId, tagId)
      return ok(null)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('note-tags:list', async (_e, noteId: string) => {
    try {
      requireVault(); touchActivity()
      return ok(await getNoteTags(getDb(), noteId))
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('note-tags:counts', async () => {
    try {
      requireVault(); touchActivity()
      return ok(await getNoteCountPerTag(getDb()))
    } catch (e) { return fail(e) }
  })

  // ── Prefs ─────────────────────────────────────────────────────────────────

  ipcMain.handle('prefs:get', (_e, key?: string) => {
    try {
      const prefs = getPrefs()
      return ok(key ? prefs[key as keyof typeof prefs] : prefs)
    } catch (e) { return fail(e) }
  })

  ipcMain.handle('prefs:set', (_e, key: string, value: unknown) => {
    try {
      setPrefs({ [key]: value } as Parameters<typeof setPrefs>[0])
      return ok(null)
    } catch (e) { return fail(e) }
  })
}
