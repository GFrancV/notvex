import { contextBridge, ipcRenderer } from 'electron'

export type {
  Note,
  NoteListItem,
  Tag,
  CreateNoteInput,
  NotePatch,
  NoteFilter,
  CreateTagInput,
  TagPatch,
  VaultStatus,
  CreateVaultResult,
  ChangePasswordResult,
  Prefs,
  IpcResult,
  NotvexAPI,
} from '../shared/types'

import type { NotvexAPI } from '../shared/types'

// ─── Implementation ────────────────────────────────────────────────────────────

const api: NotvexAPI = {
  vault: {
    hasVault: (filePath) => ipcRenderer.invoke('vault:has-vault', filePath),
    create: (filePath, pw) => ipcRenderer.invoke('vault:create', filePath, pw),
    open: (filePath, pw) => ipcRenderer.invoke('vault:open', filePath, pw),
    openWithRecovery: (filePath, m) => ipcRenderer.invoke('vault:open-with-recovery', filePath, m),
    changePassword: (cur, next) => ipcRenderer.invoke('vault:change-password', cur, next),
    close: () => ipcRenderer.invoke('vault:close'),
    status: () => ipcRenderer.invoke('vault:status'),
    chooseFile: (mode) => ipcRenderer.invoke('vault:choose-file', mode),
  },
  notes: {
    create: (input) => ipcRenderer.invoke('notes:create', input),
    get: (id) => ipcRenderer.invoke('notes:get', id),
    list: (filter) => ipcRenderer.invoke('notes:list', filter),
    update: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
    trash: (id) => ipcRenderer.invoke('notes:trash', id),
    restore: (id) => ipcRenderer.invoke('notes:restore', id),
    delete: (id) => ipcRenderer.invoke('notes:delete', id),
    emptyTrash: () => ipcRenderer.invoke('notes:empty-trash'),
    search: (q) => ipcRenderer.invoke('notes:search', q),
  },
  tags: {
    create: (input) => ipcRenderer.invoke('tags:create', input),
    list: () => ipcRenderer.invoke('tags:list'),
    update: (id, patch) => ipcRenderer.invoke('tags:update', id, patch),
    delete: (id) => ipcRenderer.invoke('tags:delete', id),
  },
  noteTags: {
    add: (n, t) => ipcRenderer.invoke('note-tags:add', n, t),
    remove: (n, t) => ipcRenderer.invoke('note-tags:remove', n, t),
    list: (n) => ipcRenderer.invoke('note-tags:list', n),
    counts: () => ipcRenderer.invoke('note-tags:counts'),
  },
  prefs: {
    get: (key) => ipcRenderer.invoke('prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('prefs:set', key, value),
  },
  onAutoLocked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault:auto-locked', listener)
    return (): void => {
      ipcRenderer.off('vault:auto-locked', listener)
    }
  },
}

contextBridge.exposeInMainWorld('notvex', api)
