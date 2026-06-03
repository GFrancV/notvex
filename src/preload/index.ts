import { contextBridge, ipcRenderer } from 'electron'

// ─── API types (exported for renderer use) ────────────────────────────────────

export interface Note {
  id: string
  title: string
  content: string
  isPinned: boolean
  isTrashed: boolean
  createdAt: number
  updatedAt: number
  trashedAt: number | null
  tags: Tag[]
}

export interface NoteListItem {
  id: string
  title: string
  isPinned: boolean
  isTrashed: boolean
  createdAt: number
  updatedAt: number
  trashedAt: number | null
}

export interface Tag {
  id: string
  name: string
  color: string
  createdAt: number
}

export interface CreateNoteInput { title: string; content: string }
export interface NotePatch { title?: string; content?: string; isPinned?: boolean }
export interface NoteFilter { trashed?: boolean; tagId?: string }
export interface CreateTagInput { name: string; color: string }
export interface TagPatch { name?: string; color?: string }

export interface VaultStatus { isOpen: boolean; vaultPath: string | null }
export interface CreateVaultResult { mnemonic: string }

export interface Prefs {
  vaultPath: string | null
  autoLockMinutes: number
  showPreview: boolean
}

type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

export interface NotvexAPI {
  vault: {
    hasVault(filePath?: string): Promise<IpcResult<boolean>>
    create(filePath: string, password: string): Promise<IpcResult<CreateVaultResult>>
    open(filePath: string, password: string): Promise<IpcResult<boolean>>
    openWithRecovery(filePath: string, mnemonic: string): Promise<IpcResult<boolean>>
    close(): Promise<IpcResult<null>>
    status(): Promise<IpcResult<VaultStatus>>
    chooseFile(mode: 'new' | 'existing'): Promise<IpcResult<string | null>>
  }
  notes: {
    create(input: CreateNoteInput): Promise<IpcResult<NoteListItem>>
    get(id: string): Promise<IpcResult<Note | null>>
    list(filter?: NoteFilter): Promise<IpcResult<NoteListItem[]>>
    update(id: string, patch: NotePatch): Promise<IpcResult<null>>
    trash(id: string): Promise<IpcResult<null>>
    restore(id: string): Promise<IpcResult<null>>
    delete(id: string): Promise<IpcResult<null>>
    emptyTrash(): Promise<IpcResult<null>>
    search(query: string): Promise<IpcResult<NoteListItem[]>>
  }
  tags: {
    create(input: CreateTagInput): Promise<IpcResult<Tag>>
    list(): Promise<IpcResult<Tag[]>>
    update(id: string, patch: TagPatch): Promise<IpcResult<null>>
    delete(id: string): Promise<IpcResult<null>>
  }
  noteTags: {
    add(noteId: string, tagId: string): Promise<IpcResult<null>>
    remove(noteId: string, tagId: string): Promise<IpcResult<null>>
    list(noteId: string): Promise<IpcResult<Tag[]>>
    counts(): Promise<IpcResult<Record<string, number>>>
  }
  prefs: {
    get(key?: string): Promise<IpcResult<Prefs | Prefs[keyof Prefs]>>
    set(key: string, value: unknown): Promise<IpcResult<null>>
  }
  onAutoLocked(callback: () => void): () => void
}

// ─── Implementation ────────────────────────────────────────────────────────────

const api: NotvexAPI = {
  vault: {
    hasVault: (filePath) => ipcRenderer.invoke('vault:has-vault', filePath),
    create: (filePath, pw) => ipcRenderer.invoke('vault:create', filePath, pw),
    open: (filePath, pw) => ipcRenderer.invoke('vault:open', filePath, pw),
    openWithRecovery: (filePath, m) => ipcRenderer.invoke('vault:open-with-recovery', filePath, m),
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
    return () => ipcRenderer.off('vault:auto-locked', listener)
  },
}

contextBridge.exposeInMainWorld('notvex', api)
