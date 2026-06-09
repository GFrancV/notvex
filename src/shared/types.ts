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

export interface CreateNoteInput {
  title: string
  content: string
}
export interface NotePatch {
  title?: string
  content?: string
  isPinned?: boolean
}
export interface NoteFilter {
  trashed?: boolean
  tagId?: string
}
export interface CreateTagInput {
  name: string
  color: string
}
export interface TagPatch {
  name?: string
  color?: string
}

export interface NoteTagPair {
  noteId: string
  tagId: string
}

export interface VaultStatus {
  isOpen: boolean
  vaultPath: string | null
}
export interface CreateVaultResult {
  mnemonic: string
}
export interface ChangePasswordResult {
  mnemonic: string
}

export interface Prefs {
  vaultPath: string | null
  autoLockMinutes: number
}

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

export interface NotvexAPI {
  vault: {
    hasVault(filePath?: string): Promise<IpcResult<boolean>>
    create(filePath: string, password: string): Promise<IpcResult<CreateVaultResult>>
    open(filePath: string, password: string): Promise<IpcResult<boolean>>
    openWithRecovery(filePath: string, mnemonic: string): Promise<IpcResult<boolean>>
    changePassword(
      currentPassword: string,
      newPassword: string
    ): Promise<IpcResult<ChangePasswordResult>>
    rotateCredentials(newPassword: string): Promise<IpcResult<ChangePasswordResult>>
    confirmRecoverySaved(): Promise<IpcResult<null>>
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
    all(): Promise<IpcResult<NoteTagPair[]>>
  }
  prefs: {
    get(key?: string): Promise<IpcResult<Prefs | Prefs[keyof Prefs]>>
    set(key: string, value: unknown): Promise<IpcResult<null>>
  }
  shell: {
    openExternal(url: string): Promise<void>
  }
  onAutoLocked(callback: () => void): () => void
}
