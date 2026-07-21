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
  tags: Tag[]
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
export interface CreateTagAndAssignInput {
  noteId: string
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

export type VaultStatus = { isOpen: true; vaultPath: string } | { isOpen: false }
export interface RecentVault {
  path: string
  hasKeyFile: boolean
  lastOpenedAt: number
}
export interface CreateVaultResult {
  mnemonic: string
}
export interface ChangePasswordResult {
  mnemonic: string
}
export interface KeyFileOperationResult {
  mnemonic: string
}
export interface KeyFileSelection {
  contents: Uint8Array
  filename: string
  sizeBytes: number
}
export interface GeneratedKeyFile {
  path: string
  contents: Uint8Array
  filename: string
}

export interface Prefs {
  recentVaults: RecentVault[]
  autoLockMinutes: number
  allowScreenCapture: boolean
  lockOnMinimize: boolean
}

export interface UnlockThrottleStatus {
  isThrottled: boolean
  waitSeconds: number
  failedAttempts: number
}

export interface VaultVersion {
  maj: number
  min: number
}

export interface UpdateInfo {
  version: string
  releaseNotes: string | null
}

export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export const CURRENT_VERSION_MAJ = 1
export const CURRENT_VERSION_MIN = 0

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

export type Platform = 'darwin' | 'win32' | 'linux'

export interface NotvexAPI {
  platform: Platform
  vault: {
    hasVault(filePath?: string): Promise<IpcResult<boolean>>
    create(filePath: string, password: string): Promise<IpcResult<CreateVaultResult>>
    open(
      filePath: string,
      password: string,
      keyFileContents?: Uint8Array
    ): Promise<IpcResult<VaultVersion | null>>
    openWithRecovery(
      filePath: string,
      mnemonic: string,
      keyFileContents?: Uint8Array
    ): Promise<IpcResult<VaultVersion | null>>
    changePassword(
      currentPassword: string,
      newPassword: string,
      keyFileContents?: Uint8Array
    ): Promise<IpcResult<ChangePasswordResult>>
    rotateCredentials(newPassword: string): Promise<IpcResult<ChangePasswordResult>>
    confirmRecoverySaved(): Promise<IpcResult<null>>
    close(): Promise<IpcResult<null>>
    clearDecryptedContent(): Promise<IpcResult<null>>
    status(): Promise<IpcResult<VaultStatus>>
    switchTo(filePath: string): Promise<IpcResult<null>>
    chooseFile(mode: 'new' | 'existing'): Promise<IpcResult<string | null>>
    selectKeyFile(): Promise<IpcResult<KeyFileSelection | null>>
    getUnlockThrottleStatus(): Promise<IpcResult<UnlockThrottleStatus>>
    getHasKeyFile(): Promise<IpcResult<boolean>>
    generateKeyFile(): Promise<IpcResult<GeneratedKeyFile | null>>
    configureKeyFile(
      password: string,
      keyFileContents: Uint8Array
    ): Promise<IpcResult<KeyFileOperationResult>>
    removeKeyFile(
      password: string,
      keyFileContents: Uint8Array
    ): Promise<IpcResult<KeyFileOperationResult>>
    saveCopyAs(): Promise<IpcResult<string | null>>
    confirmMigration(createBackup: boolean): Promise<IpcResult<null>>
    cancelMigration(): Promise<IpcResult<null>>
    getPendingFile(): Promise<IpcResult<string | null>>
    onMigrationRequired(
      callback: (data: { vaultPath: string; currentMin: number; backupTimestamp: number }) => void
    ): () => void
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
    createAndAssign(input: CreateTagAndAssignInput): Promise<IpcResult<Tag>>
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
    get(): Promise<IpcResult<Prefs>>
    set<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<IpcResult<void>>
  }
  shell: {
    openExternal(url: string): Promise<IpcResult<null>>
  }
  app: {
    isDev(): Promise<IpcResult<boolean>>
  }
  updater: {
    onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void
    onUpdateNotAvailable(callback: () => void): () => void
    onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void
    onUpdateDownloaded(callback: () => void): () => void
    onError(callback: (error: { message: string }) => void): () => void
    checkNow(): Promise<IpcResult<string | null>>
    download(): Promise<IpcResult<null>>
    installNow(): Promise<IpcResult<null>>
    getCurrentVersion(): Promise<IpcResult<string>>
  }
  onAutoLocked(callback: () => void): () => void
  onOpenFile(callback: (filePath: string) => void): () => void
}
