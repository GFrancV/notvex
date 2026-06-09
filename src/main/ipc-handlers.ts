import type { BrowserWindow } from 'electron'
import { dialog, ipcMain, shell } from 'electron'

import type { CreateNoteInput, CreateTagInput, NoteFilter, NotePatch, TagPatch } from './db/queries'
import {
  addTagToNote,
  createNote,
  createTag,
  deleteNote,
  deleteTag,
  emptyTrash,
  getAllNoteTags,
  getNote,
  getNoteCountPerTag,
  getNoteTags,
  listNotes,
  listTags,
  removeTagFromNote,
  restoreNote,
  searchNotesByTitle,
  trashNote,
  updateNote,
  updateTag
} from './db/queries'
import { getPref, getPrefs, setPref, setPrefs } from './prefs'
import {
  changePassword,
  closeVault,
  createVault,
  getDb,
  getMasterKey,
  getVaultPath,
  isVaultOpen,
  openVault,
  openVaultWithRecovery,
  rotateVaultCredentials,
  syncContainer,
  vaultExistsAt
} from './vault/vault'

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

// ─── Auto-lock + periodic sync state ─────────────────────────────────────────

let lastActivityAt = Date.now()
let autoLockTimer: ReturnType<typeof setInterval> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null
let mainWindowRef: BrowserWindow | null = null

function touchActivity(): void {
  lastActivityAt = Date.now()
}

function startAutoLockTimer(win: BrowserWindow): void {
  if (autoLockTimer) clearInterval(autoLockTimer)
  mainWindowRef = win
  autoLockTimer = setInterval((): void => {
    void (async (): Promise<void> => {
      const minutes = getPref('autoLockMinutes')
      if (minutes === 0) return
      if (!isVaultOpen()) return
      const elapsed = (Date.now() - lastActivityAt) / 60000
      if (elapsed >= minutes) {
        await closeVault()
        mainWindowRef?.webContents.send('vault:auto-locked')
      }
    })()
  }, 60_000)

  // Repack the .nvx container every 5 minutes for crash safety
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(() => {
    syncContainer()
  }, 5 * 60_000)
}

export function stopAutoLockTimer(): void {
  if (autoLockTimer) {
    clearInterval(autoLockTimer)
    autoLockTimer = null
  }
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}

// ─── Register all handlers ────────────────────────────────────────────────────

export function registerIpcHandlers(win: BrowserWindow): void {
  startAutoLockTimer(win)

  // ── Vault ──────────────────────────────────────────────────────────────────

  ipcMain.handle('vault:has-vault', (_e, filePath?: string) => {
    try {
      const path = filePath ?? getPref('vaultPath')
      return ok(path ? vaultExistsAt(path) : false)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('vault:create', async (_e, filePath: string, password: string) => {
    try {
      const result = await createVault(filePath, password)
      setPref('vaultPath', filePath)
      touchActivity()
      return ok(result)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('vault:open', async (_e, filePath: string, password: string) => {
    try {
      const success = await openVault(filePath, password)
      if (success) {
        setPref('vaultPath', filePath)
        touchActivity()
      }
      return ok(success)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('vault:open-with-recovery', async (_e, filePath: string, mnemonic: string) => {
    try {
      const success = await openVaultWithRecovery(filePath, mnemonic)
      if (success) {
        setPref('vaultPath', filePath)
        touchActivity()
      }
      return ok(success)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle(
    'vault:change-password',
    async (_e, currentPassword: string, newPassword: string) => {
      try {
        requireVault()
        touchActivity()
        const result = await changePassword(currentPassword, newPassword)
        return ok(result)
      } catch (e) {
        return fail(e)
      }
    }
  )

  ipcMain.handle('vault:rotate-credentials', async (_e, newPassword: string) => {
    try {
      requireVault()
      touchActivity()
      const result = await rotateVaultCredentials(newPassword)
      return ok(result)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('vault:confirm-recovery-saved', () => {
    return ok(null)
  })

  ipcMain.handle('vault:close', async () => {
    try {
      await closeVault()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('vault:status', () => {
    return ok({ isOpen: isVaultOpen(), vaultPath: getVaultPath() })
  })

  ipcMain.handle('vault:choose-file', async (_e, mode: 'new' | 'existing') => {
    try {
      if (mode === 'new') {
        const result = await dialog.showSaveDialog(win, {
          title: 'Create new vault',
          defaultPath: 'vault.nvx',
          filters: [{ name: 'Notvex Vault', extensions: ['nvx'] }]
        })
        return ok(result.canceled ? null : result.filePath)
      } else {
        const result = await dialog.showOpenDialog(win, {
          title: 'Open existing vault',
          properties: ['openFile'],
          filters: [{ name: 'Notvex Vault', extensions: ['nvx'] }]
        })
        return ok(result.canceled ? null : result.filePaths[0])
      }
    } catch (e) {
      return fail(e)
    }
  })

  // ── Notes ─────────────────────────────────────────────────────────────────

  ipcMain.handle('notes:create', async (_e, input: CreateNoteInput) => {
    try {
      requireVault()
      touchActivity()
      return ok(await createNote(getDb(), input, getMasterKey()))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:get', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await getNote(getDb(), id, getMasterKey()))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:list', async (_e, filter: NoteFilter = {}) => {
    try {
      requireVault()
      touchActivity()
      return ok(await listNotes(getDb(), getMasterKey(), filter))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:update', async (_e, id: string, patch: NotePatch) => {
    try {
      requireVault()
      touchActivity()
      await updateNote(getDb(), id, patch, getMasterKey())
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:trash', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await trashNote(getDb(), id)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:restore', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await restoreNote(getDb(), id)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:delete', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await deleteNote(getDb(), id)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:empty-trash', async () => {
    try {
      requireVault()
      touchActivity()
      await emptyTrash(getDb())
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('notes:search', async (_e, query: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await searchNotesByTitle(getDb(), query, getMasterKey()))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Tags ──────────────────────────────────────────────────────────────────

  ipcMain.handle('tags:create', async (_e, input: CreateTagInput) => {
    try {
      requireVault()
      touchActivity()
      return ok(await createTag(getDb(), input))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('tags:list', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await listTags(getDb()))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('tags:update', async (_e, id: string, patch: TagPatch) => {
    try {
      requireVault()
      touchActivity()
      await updateTag(getDb(), id, patch)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('tags:delete', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await deleteTag(getDb(), id)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Note-tags ─────────────────────────────────────────────────────────────

  ipcMain.handle('note-tags:add', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault()
      touchActivity()
      await addTagToNote(getDb(), noteId, tagId)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('note-tags:remove', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault()
      touchActivity()
      await removeTagFromNote(getDb(), noteId, tagId)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('note-tags:list', async (_e, noteId: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await getNoteTags(getDb(), noteId))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('note-tags:counts', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await getNoteCountPerTag(getDb()))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('note-tags:all', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await getAllNoteTags(getDb()))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Prefs ─────────────────────────────────────────────────────────────────

  ipcMain.handle('prefs:get', (_e, key?: string) => {
    try {
      const prefs = getPrefs()
      return ok(key ? prefs[key as keyof typeof prefs] : prefs)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('prefs:set', (_e, key: string, value: unknown) => {
    try {
      setPrefs({ [key]: value })
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    if (/^https?:\/\//.test(url)) {
      await shell.openExternal(url)
    }
  })
}
