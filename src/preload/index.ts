import { contextBridge, ipcRenderer } from 'electron'

export type {
  ChangePasswordResult,
  CreateNoteInput,
  CreateTagAndAssignInput,
  CreateTagInput,
  CreateVaultResult,
  GeneratedKeyFile,
  IpcResult,
  KeyFileOperationResult,
  KeyFileSelection,
  Note,
  NoteFilter,
  NoteListItem,
  NotePatch,
  NoteTagPair,
  NotvexAPI,
  Platform,
  Prefs,
  RecentVault,
  Tag,
  TagPatch,
  UnlockThrottleStatus,
  VaultStatus,
  VaultVersion
} from '@shared/types'

import type { NotvexAPI, Platform } from '@shared/types'

// ─── Implementation ────────────────────────────────────────────────────────────

const api: NotvexAPI = {
  platform: process.platform as Platform,
  vault: {
    hasVault: (filePath) => ipcRenderer.invoke('vault:has-vault', filePath),
    create: (filePath, pw) => ipcRenderer.invoke('vault:create', filePath, pw),
    open: (filePath, pw, keyFileContents) =>
      ipcRenderer.invoke('vault:open', filePath, pw, keyFileContents),
    openWithRecovery: (filePath, m, keyFileContents) =>
      ipcRenderer.invoke('vault:open-with-recovery', filePath, m, keyFileContents),
    changePassword: (cur, next, keyFileContents) =>
      ipcRenderer.invoke('vault:change-password', cur, next, keyFileContents),
    rotateCredentials: (pw) => ipcRenderer.invoke('vault:rotate-credentials', pw),
    confirmRecoverySaved: () => ipcRenderer.invoke('vault:confirm-recovery-saved'),
    close: () => ipcRenderer.invoke('vault:close'),
    clearDecryptedContent: () => ipcRenderer.invoke('vault:clear-decrypted'),
    status: () => ipcRenderer.invoke('vault:status'),
    switchTo: (filePath) => ipcRenderer.invoke('vault:switch', filePath),
    recentVaults: () => ipcRenderer.invoke('vault:recent-vaults'),
    chooseFile: (mode) => ipcRenderer.invoke('vault:choose-file', mode),
    selectKeyFile: () => ipcRenderer.invoke('vault:select-key-file'),
    getUnlockThrottleStatus: () => ipcRenderer.invoke('vault:unlock-throttle-status'),
    getHasKeyFile: () => ipcRenderer.invoke('vault:get-has-key-file'),
    generateKeyFile: () => ipcRenderer.invoke('vault:generate-key-file'),
    configureKeyFile: (password, keyFileContents) =>
      ipcRenderer.invoke('vault:configure-key-file', password, keyFileContents),
    removeKeyFile: (password, keyFileContents) =>
      ipcRenderer.invoke('vault:remove-key-file', password, keyFileContents),
    saveCopyAs: () => ipcRenderer.invoke('vault:save-copy-as'),
    confirmMigration: (createBackup) =>
      ipcRenderer.invoke('vault:migration-confirmed', createBackup),
    cancelMigration: () => ipcRenderer.invoke('vault:migration-cancelled'),
    onMigrationRequired: (callback) => {
      const listener = (
        _e: unknown,
        data: { currentMin: number; vaultPath: string; backupTimestamp: number }
      ): void =>
        callback({
          vaultPath: data.vaultPath,
          currentMin: data.currentMin,
          backupTimestamp: data.backupTimestamp
        })
      ipcRenderer.on('vault:migration-required', listener)
      return (): void => {
        ipcRenderer.off('vault:migration-required', listener)
      }
    }
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
    search: (q) => ipcRenderer.invoke('notes:search', q)
  },
  tags: {
    create: (input) => ipcRenderer.invoke('tags:create', input),
    createAndAssign: (input) => ipcRenderer.invoke('tags:create-and-assign', input),
    list: () => ipcRenderer.invoke('tags:list'),
    update: (id, patch) => ipcRenderer.invoke('tags:update', id, patch),
    delete: (id) => ipcRenderer.invoke('tags:delete', id)
  },
  noteTags: {
    add: (n, t) => ipcRenderer.invoke('note-tags:add', n, t),
    remove: (n, t) => ipcRenderer.invoke('note-tags:remove', n, t),
    list: (n) => ipcRenderer.invoke('note-tags:list', n),
    counts: () => ipcRenderer.invoke('note-tags:counts'),
    all: () => ipcRenderer.invoke('note-tags:all')
  },
  prefs: {
    get: (key) => ipcRenderer.invoke('prefs:get', key),
    set: (key, value) => ipcRenderer.invoke('prefs:set', key, value),
    vaulthPathHasKeyFile: (vaultPath) =>
      ipcRenderer.invoke('prefs:vault-path-has-key-file', vaultPath),
    getCurrentVaultPath: () => ipcRenderer.invoke('prefs:get-current-vault-path'),
    recordVaultUsed: (vaultPath: string, hasKeyFile: boolean = false) =>
      ipcRenderer.invoke('prefs:record-vault-used', vaultPath, hasKeyFile)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url)
  },
  onAutoLocked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault:auto-locked', listener)
    return (): void => {
      ipcRenderer.off('vault:auto-locked', listener)
    }
  }
}

contextBridge.exposeInMainWorld('notvex', api)
