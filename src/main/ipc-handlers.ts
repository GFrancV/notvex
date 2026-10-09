import { randomBytes } from 'crypto'
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'
import { app, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'node:path'

import { CURRENT_VERSION_MIN, Prefs, TAG_NAME_MAX } from '@shared/types'
import { scheduleClipboardClear } from './clipboard-guard'
import { dialogDefaultPath, rememberDialogDir } from './dialog-dir'
import { drainRenderer } from './drain-renderer'
import { logError } from './log'
import type { SchemaMigrationGate } from './db/migrations'
import type { CreateNoteInput, CreateTagInput, NoteFilter, NotePatch, TagPatch } from './db/queries'
import {
  addTagToNote,
  createNote,
  createTag,
  createTagAndAssign,
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
import {
  getCurrentVaultPath,
  getPref,
  getPrefs,
  isNoteSort,
  promoteVaultToTop,
  recordVaultUsed,
  setPref
} from './prefs'
import { isSafeExternalUrl, isTrustedFrame } from './url-guard'
import {
  createVaultBackup,
  ensureVaultBackupDir,
  getVaultBackupDir,
  hasAnyBackups
} from './vault/backups'
import { isValidNotvexFile, readContainer, shouldWarnOpeningInDevBuild } from './vault/container'
import { KEY_FILE_MAX_BYTES, readKeyFileContents } from './vault/crypto'
import {
  changePassword,
  closeVault,
  configureKeyFile,
  createVault,
  getDb,
  getHasKeyFileFromOpenVault,
  getMasterKey,
  getVaultPath,
  isVaultOpen,
  migrateHeaderIfNeeded,
  openVault,
  openVaultWithRecovery,
  packContainer,
  removeKeyFile,
  rotateVaultCredentials,
  syncContainer,
  withVaultLock
} from './vault/vault'

// ─── IPC envelope helper ─────────────────────────────────────────────────────

type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

function ok<T>(data: T): IpcResult<T> {
  return { success: true, data }
}

function fail(error: unknown): IpcResult<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

// Every handler registers through this so a call from any frame other than the
// app's own page is refused before it runs. ipcMain.handle has no
// middleware, and a guard line per handler is easy to forget on a new channel.
function handle(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: never[]) => unknown
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) =>
    isTrustedFrame(event) ? fn(event, ...(args as never[])) : fail('Untrusted sender')
  )
}

function requireVault(): void {
  if (!isVaultOpen()) throw new Error('Vault is locked')
}

// The renderer's maxLength only limits typing, so any caller of window.notvex.tags.* reaches
// here unchecked. Validated on write only: tags stored before the cap stay readable.
function validTagName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length === 0) throw new Error('Tag name cannot be empty')
  if (trimmed.length > TAG_NAME_MAX) {
    throw new Error(`Tag name must be at most ${TAG_NAME_MAX} characters`)
  }
  return trimmed
}

// ─── Auto-lock + periodic sync state ─────────────────────────────────────────

const VAULT_SYNC_INTERVAL_MS = 30_000

let lastActivityAt = Date.now()
let autoLockTimer: ReturnType<typeof setInterval> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null

function touchActivity(): void {
  lastActivityAt = Date.now()
}

// The close path for a vault the user can see: lets the renderer flush pending autosaves
// (drainRenderer()) before closeVault(), then reports a failed pack to the window if it can
// still show it; otherwise doCloseVault()'s log is the only record. win = null skips the
// drain when there's no renderer left to flush.
//
// Callers, and why each sits where it does:
// - manual lock (vault:close), vault switch, opening a different .nvx (file-opener.ts).
// - auto-lock, suspend / lock-screen, minimize: via lockVaultAndNotify(), which also tells
//   the window it was locked.
// - a bare win.close(): window.ts's 'close' intercept, while webContents can still be
//   messaged (window-all-closed is too late for that).
// - Cmd+Q / app.quit(): index.ts's before-quit, which fires before any window's 'close'; the
//   window intercept then finds the vault already closed.
// - macOS window-all-closed (the app stays alive): index.ts, a safety net with win = null.
//   It can fire mid-quitAndInstall(); harmless, closeVault() is serialized and idempotent.
// - renderer reloaded or crashed: window.ts, with win = null.
// relockOrphanedVault() is the exception: the renderer that asked for the unlock is gone, so
// there's nothing to drain and it calls closeVault() directly.
export async function closeVaultDrained(
  win: BrowserWindow | null
): Promise<{ packFailed: boolean }> {
  if (!isVaultOpen()) return { packFailed: false }
  if (win) await drainRenderer(win)
  const { packFailed } = await closeVault()
  if (packFailed && win && !win.isDestroyed()) win.webContents.send('vault:pack-failed')
  return { packFailed }
}

export async function lockVaultAndNotify(win: BrowserWindow | null): Promise<void> {
  if (!isVaultOpen()) return
  await closeVaultDrained(win)
  if (win && !win.isDestroyed()) win.webContents.send('vault:auto-locked')
}

// ─── Current window ──────────────────────────────────────────────────────────
// On macOS the app outlives its last window and `activate` builds a new one,
// so createWindow() calls registerIpcHandlers() more than once. ipcMain.handle
// throws on a second registration, so handlers are registered once and read
// the window through liveWin() instead of capturing the first one.

let currentWin: BrowserWindow | null = null
let handlersRegistered = false

function liveWin(): BrowserWindow | null {
  return currentWin && !currentWin.isDestroyed() ? currentWin : null
}

// Whether the renderer that made a call is still the window the user sees. On
// macOS `activate` can replace it mid-unlock with a window that never asked for
// the unlock, so long-running handlers check this instead of liveWin().
function isLiveSender(sender: WebContents): boolean {
  return !sender.isDestroyed() && sender === liveWin()?.webContents
}

// For renderer-invoked handlers, which only run while their window is alive.
function requireWin(): BrowserWindow {
  const win = liveWin()
  if (!win) throw new Error('No window is open')
  return win
}

function startAutoLockTimer(): void {
  if (autoLockTimer) clearInterval(autoLockTimer)
  autoLockTimer = setInterval((): void => {
    void (async (): Promise<void> => {
      const minutes = getPref('autoLockMinutes')
      if (minutes === 0) return
      if (!isVaultOpen()) return
      const elapsed = (Date.now() - lastActivityAt) / 60000
      if (elapsed >= minutes) {
        await lockVaultAndNotify(liveWin())
      }
    })()
  }, 60_000)

  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval((): void => {
    void syncContainer()
  }, VAULT_SYNC_INTERVAL_MS)
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

// ─── Unlock throttle ─────────────────────────────────────────────────────────

interface ThrottleState {
  failedAttempts: number
  lockedUntil: number
}

const unlockThrottle: ThrottleState = { failedAttempts: 0, lockedUntil: 0 }
let isUnlocking = false
// createVault() only reports the vault open once it returns, so until then a reload would find it
// closed, skip the confirmation and drop the recovery phrase the page is about to show.
let isCreating = false

// Bumped when the renderer is replaced while its window stays alive (reload,
// crash). An unlock started under an older renderer has nobody left to show
// the vault to, and isLiveSender() can't tell: the webContents is the same.
let rendererGeneration = 0

export function markRendererReplaced(): void {
  rendererGeneration++
}

function throttleDelaySeconds(attempts: number): number {
  if (attempts <= 3) return 0
  if (attempts === 4) return 5
  if (attempts === 5) return 15
  if (attempts === 6) return 30
  return 60 * (attempts - 6)
}

function checkAndSetThrottle(): IpcResult<never> | null {
  if (isUnlocking) return fail('Unlock already in progress')
  if (Date.now() < unlockThrottle.lockedUntil) {
    const waitSecs = Math.ceil((unlockThrottle.lockedUntil - Date.now()) / 1000)
    return fail(`Too many failed attempts. Try again in ${waitSecs}s`)
  }
  return null
}

// ─── Prefs validators ─────────────────────────────────────────────────────────

const PREFS_VALIDATORS: Partial<Record<keyof Prefs, (v: unknown) => boolean>> = {
  autoLockMinutes: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 480,
  allowScreenCapture: (v) => typeof v === 'boolean',
  lockOnMinimize: (v) => typeof v === 'boolean',
  clipboardClearSeconds: (v) => typeof v === 'number' && [0, 10, 30, 60, 120, 300].includes(v),
  // Resolved per call, not at load: suites that mock @main/prefs without isNoteSort would
  // otherwise fail on import.
  noteSort: (v) => isNoteSort(v)
}

// ─── Migration coordinator ────────────────────────────────────────────────────

let migrationResolver: ((result: { confirmed: boolean; createBackup: boolean }) => void) | null =
  null
let migrationBackupTimestamp: number | null = null

// The renderer the pending gate was sent to; only its answer counts. Never reset: every gate
// assigns it before parking, and it's only read while one is pending.
let gateRequester: WebContents | null = null

type MigrationPayload =
  | { reason: 'header'; fromVersion: number; toVersion: number }
  | { reason: 'schema'; fromVersion: number; toVersion: number }

// Prompts the renderer that requested the unlock and waits for its answer. If it's gone
// nobody can answer, so it counts as cancelled; never re-routed to another window.
async function confirmMigrationAndBackup(
  sender: WebContents,
  filePath: string,
  payload: MigrationPayload
): Promise<boolean> {
  if (migrationResolver !== null) {
    throw new Error('A migration dialog is already open. Complete or cancel it first.')
  }
  if (!isLiveSender(sender)) return false
  gateRequester = sender
  const backupTimestamp = Date.now()
  migrationBackupTimestamp = backupTimestamp
  sender.send('vault:migration-required', {
    vaultPath: filePath,
    backupTimestamp,
    ...payload
  })
  const migResult = await new Promise<{ confirmed: boolean; createBackup: boolean }>((resolve) => {
    migrationResolver = resolve
  })
  if (migResult.confirmed && migResult.createBackup && migrationBackupTimestamp !== null) {
    createVaultBackup(filePath, payload.reason, payload.fromVersion, payload.toVersion)
  }
  migrationBackupTimestamp = null
  return migResult.confirmed
}

// ─── Dev-build vault warning ──────────────────────────────────────────────────

let devBuildWarningResolver: ((confirmed: boolean) => void) | null = null

// Same contract as confirmMigrationAndBackup(), for the dev-build warning.
async function confirmDevBuildWarning(sender: WebContents, filePath: string): Promise<boolean> {
  if (devBuildWarningResolver !== null) {
    throw new Error('A dev-build warning dialog is already open. Complete or cancel it first.')
  }
  if (!isLiveSender(sender)) return false
  gateRequester = sender
  sender.send('vault:dev-build-warning-required', { vaultPath: filePath })
  return new Promise<boolean>((resolve) => {
    devBuildWarningResolver = resolve
  })
}

// Settles whichever gate is pending as cancelled (they run in sequence: at most one). Resolving,
// not just nulling, lets the parked open unwind through its own cleanup instead of hanging.
// Called by the -cancelled handlers and when the window closes or its renderer is replaced.
export function cancelPendingConfirmations(): void {
  migrationResolver?.({ confirmed: false, createBackup: false })
  migrationResolver = null
  devBuildWarningResolver?.(false)
  devBuildWarningResolver = null
}

// The unlock's renderer is gone: its window closed mid-KDF (macOS), another window replaced
// it, or it reloaded/crashed. An open vault would boot the next page straight into the notes.
function isUnlockOrphaned(sender: WebContents, generation: number): boolean {
  return !isLiveSender(sender) || generation !== rendererGeneration
}

async function relockOrphanedVault(): Promise<IpcResult<never>> {
  await closeVault()
  return fail('No window is open')
}

// Maps the internal error sentinels thrown by readContainer/runMigrations to
// user-facing messages. 'MIGRATION_CANCELLED' is the same sentinel unlock.tsx
// already special-cases to silently return to the idle unlock form.
function mapOpenVaultError(e: unknown): IpcResult<never> {
  if (e instanceof Error) {
    if (e.message === 'VERSION_TOO_NEW') {
      return fail(
        'This vault was created using a newer version of Notvex. Please update the app to open it.'
      )
    }
    if (e.message === 'NOT_NOTVEX_FILE') {
      return fail('The selected file is not a Notvex vault.')
    }
    if (e.message === 'SCHEMA_VERSION_TOO_NEW') {
      return fail(
        'This vault was created or modified by a newer version of Notvex. Please update the app to open it.'
      )
    }
    if (e.message === 'SCHEMA_MIGRATION_CANCELLED') {
      return fail('MIGRATION_CANCELLED')
    }
  }
  return fail(e)
}

// ─── Register all handlers ────────────────────────────────────────────────────

export function registerIpcHandlers(
  win: BrowserWindow,
  takePendingFilePath: () => string | null
): void {
  currentWin = win
  startAutoLockTimer()
  if (handlersRegistered) return
  handlersRegistered = true

  // ── Vault ──────────────────────────────────────────────────────────────────

  handle('vault:get-pending-file', () => {
    try {
      return ok(takePendingFilePath())
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:has-vault', (_e, filePath?: string) => {
    try {
      const path = filePath ?? getCurrentVaultPath()
      return ok(path ? existsSync(path) && isValidNotvexFile(path) : false)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:create', async (_e, filePath: string, password: string) => {
    isCreating = true
    try {
      const result = await createVault(filePath, password, !app.isPackaged)
      recordVaultUsed(filePath)
      touchActivity()
      return ok(result)
    } catch (e) {
      return fail(e)
    } finally {
      isCreating = false
    }
  })

  handle(
    'vault:open',
    async (event, filePath: string, password: string, keyFileContents?: Uint8Array) => {
      const throttleErr = checkAndSetThrottle()
      if (throttleErr) return throttleErr
      isUnlocking = true
      const generation = rendererGeneration
      try {
        // Pre-check container header before authenticating to surface format errors early
        let fileBytes: Buffer
        try {
          fileBytes = readFileSync(filePath)
        } catch {
          return fail('Vault file not found or could not be read.')
        }

        let migrationOccurred = false
        try {
          const header = readContainer(fileBytes)
          // Checked before any migration runs: a migration is part of what it guards against.
          if (shouldWarnOpeningInDevBuild(app.isPackaged, header)) {
            const confirmed = await confirmDevBuildWarning(event.sender, filePath)
            if (!confirmed) return fail('DEV_BUILD_WARNING_CANCELLED')
          }
          // Minor version: show migration dialog if needed (no-op for v1.0)
          if (header.versionMin < CURRENT_VERSION_MIN) {
            const confirmed = await confirmMigrationAndBackup(event.sender, filePath, {
              reason: 'header',
              fromVersion: header.versionMin,
              toVersion: CURRENT_VERSION_MIN
            })
            if (!confirmed) return fail('MIGRATION_CANCELLED')
            await migrateHeaderIfNeeded(filePath, header.versionMin)
            migrationOccurred = true
          }
        } catch (e) {
          migrationBackupTimestamp = null
          return mapOpenVaultError(e)
        }

        ensureVaultBackupDir(filePath)

        const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
        const onSchemaMigrationNeeded: SchemaMigrationGate = ({ fromVersion, toVersion }) =>
          confirmMigrationAndBackup(event.sender, filePath, {
            reason: 'schema',
            fromVersion,
            toVersion
          })

        // Pass pre-read bytes to avoid a second readFileSync; after migration the file was
        // rewritten so openVault must re-read it (pass undefined to trigger the internal read).
        let vaultVersion: Awaited<ReturnType<typeof openVault>>
        try {
          vaultVersion = await openVault(
            filePath,
            password,
            kfContents,
            migrationOccurred ? undefined : fileBytes,
            onSchemaMigrationNeeded
          )
        } catch (e) {
          return mapOpenVaultError(e)
        }

        // await, not return: the finally that clears isUnlocking must wait for
        // the close, or a retry from the reloaded page races it.
        if (vaultVersion !== null && isUnlockOrphaned(event.sender, generation)) {
          return await relockOrphanedVault()
        }

        if (vaultVersion !== null) {
          unlockThrottle.failedAttempts = 0
          unlockThrottle.lockedUntil = 0
          recordVaultUsed(filePath, keyFileContents !== undefined)
          touchActivity()
        } else {
          unlockThrottle.failedAttempts += 1
          const delaySecs = throttleDelaySeconds(unlockThrottle.failedAttempts)
          if (delaySecs > 0) unlockThrottle.lockedUntil = Date.now() + delaySecs * 1000
        }
        return ok(vaultVersion)
      } catch (e) {
        return fail(e)
      } finally {
        isUnlocking = false
      }
    }
  )

  // The four gate answers below are no-ops unless they come from gateRequester.
  handle('vault:migration-confirmed', (event, createBackup: boolean) => {
    try {
      if (event.sender !== gateRequester) return ok(null)
      // Don't clear migrationBackupTimestamp here: resolve() only queues the awaiting code, which
      // still reads it.
      migrationResolver?.({ confirmed: true, createBackup })
      migrationResolver = null
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:migration-cancelled', (event) => {
    try {
      if (event.sender !== gateRequester) return ok(null)
      cancelPendingConfirmations()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:dev-build-warning-confirmed', (event) => {
    try {
      if (event.sender !== gateRequester) return ok(null)
      devBuildWarningResolver?.(true)
      devBuildWarningResolver = null
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:dev-build-warning-cancelled', (event) => {
    try {
      if (event.sender !== gateRequester) return ok(null)
      cancelPendingConfirmations()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:unlock-throttle-status', () => {
    try {
      const now = Date.now()
      const waitMs = Math.max(0, unlockThrottle.lockedUntil - now)
      return ok({
        isThrottled: waitMs > 0,
        waitSeconds: Math.ceil(waitMs / 1000),
        failedAttempts: unlockThrottle.failedAttempts
      })
    } catch (e) {
      return fail(e)
    }
  })

  handle(
    'vault:open-with-recovery',
    async (event, filePath: string, mnemonic: string, keyFileContents?: Uint8Array) => {
      try {
        const throttleErr = checkAndSetThrottle()
        if (throttleErr) return throttleErr
        isUnlocking = true
        const generation = rendererGeneration
        try {
          let fileBytes: Buffer
          try {
            fileBytes = readFileSync(filePath)
          } catch {
            return fail('Vault file not found or could not be read.')
          }

          try {
            const header = readContainer(fileBytes)
            if (shouldWarnOpeningInDevBuild(app.isPackaged, header)) {
              const confirmed = await confirmDevBuildWarning(event.sender, filePath)
              if (!confirmed) return fail('DEV_BUILD_WARNING_CANCELLED')
            }
            if (header.versionMin < CURRENT_VERSION_MIN) {
              const confirmed = await confirmMigrationAndBackup(event.sender, filePath, {
                reason: 'header',
                fromVersion: header.versionMin,
                toVersion: CURRENT_VERSION_MIN
              })
              if (!confirmed) return fail('MIGRATION_CANCELLED')
              await migrateHeaderIfNeeded(filePath, header.versionMin)
            }
          } catch (e) {
            migrationBackupTimestamp = null
            return mapOpenVaultError(e)
          }

          ensureVaultBackupDir(filePath)

          const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
          const onSchemaMigrationNeeded: SchemaMigrationGate = ({ fromVersion, toVersion }) =>
            confirmMigrationAndBackup(event.sender, filePath, {
              reason: 'schema',
              fromVersion,
              toVersion
            })

          let vaultVersion: Awaited<ReturnType<typeof openVaultWithRecovery>>
          try {
            vaultVersion = await openVaultWithRecovery(
              filePath,
              mnemonic,
              kfContents,
              onSchemaMigrationNeeded
            )
          } catch (e) {
            return mapOpenVaultError(e)
          }

          if (vaultVersion !== null && isUnlockOrphaned(event.sender, generation)) {
            return await relockOrphanedVault()
          }

          if (vaultVersion !== null) {
            unlockThrottle.failedAttempts = 0
            unlockThrottle.lockedUntil = 0
            recordVaultUsed(filePath, keyFileContents !== undefined)
            touchActivity()
          } else {
            unlockThrottle.failedAttempts += 1
            const delaySecs = throttleDelaySeconds(unlockThrottle.failedAttempts)
            if (delaySecs > 0) unlockThrottle.lockedUntil = Date.now() + delaySecs * 1000
          }
          return ok(vaultVersion)
        } finally {
          isUnlocking = false
        }
      } catch (e) {
        return fail(e)
      }
    }
  )

  handle(
    'vault:change-password',
    async (_e, currentPassword: string, newPassword: string, keyFileContents?: Uint8Array) => {
      try {
        requireVault()
        touchActivity()
        const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
        const result = await changePassword(currentPassword, newPassword, kfContents)
        return ok(result)
      } catch (e) {
        if (!isVaultOpen()) liveWin()?.webContents.send('vault:auto-locked')
        return fail(e)
      }
    }
  )

  handle('vault:rotate-credentials', async (_e, newPassword: string) => {
    try {
      requireVault()
      touchActivity()
      const result = await rotateVaultCredentials(newPassword)
      return ok(result)
    } catch (e) {
      if (!isVaultOpen()) liveWin()?.webContents.send('vault:auto-locked')
      return fail(e)
    }
  })

  handle('vault:confirm-recovery-saved', () => {
    try {
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:close', async () => {
    try {
      await closeVaultDrained(liveWin())
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:switch', async (_e, filePath: string) => {
    try {
      // Validate before closeVaultDrained() so a bad target never locks the current vault
      if (!existsSync(filePath)) {
        return fail('Vault not found. It may have been moved or deleted.')
      }
      if (!isValidNotvexFile(filePath)) {
        return fail('This file is not a valid Notvex vault')
      }
      await closeVaultDrained(liveWin())
      promoteVaultToTop(filePath)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:clear-decrypted', () => {
    try {
      // Main process has no accumulated plaintext — the belt-and-suspenders signal is enough.
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:get-has-key-file', () => {
    try {
      requireVault()
      return ok(getHasKeyFileFromOpenVault())
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:save-copy-as', async () => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return fail('No vault open')

      // packContainer(), not syncContainer(): a failed sync must surface as a
      // failed backup, not silently copy stale data. Its fs errors embed local
      // paths, so the renderer only gets a generic message.
      try {
        await packContainer()
      } catch (e) {
        logError('vault:save-copy-as: sync before copy failed:', e)
        return fail('Failed to sync the vault before copying — try again')
      }

      const vaultDir = dirname(vaultPath)
      const vaultName = basename(vaultPath, '.nvx')

      const { canceled, filePath } = await dialog.showSaveDialog(requireWin(), {
        title: 'Save a copy of your vault',
        defaultPath: join(vaultDir, `${vaultName}_copy.nvx`),
        filters: [{ name: 'Notvex Vault', extensions: ['nvx'] }],
        buttonLabel: 'Save copy'
      })

      if (canceled || !filePath) return ok(null)
      rememberDialogDir(filePath)

      copyFileSync(vaultPath, filePath)
      return ok(filePath)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:open-backups-folder', async () => {
    try {
      const filePath = getVaultPath()
      if (!filePath) return fail('No vault is currently open.')
      if (!hasAnyBackups(filePath)) return fail('No backups yet.')
      const result = await shell.openPath(getVaultBackupDir(filePath))
      return result ? fail(result) : ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:generate-key-file', async () => {
    try {
      const result = await dialog.showSaveDialog(requireWin(), {
        title: 'Save key file',
        defaultPath: dialogDefaultPath('notvex.nvxkey'),
        filters: [{ name: 'Notvex Key File', extensions: ['nvxkey'] }]
      })
      if (result.canceled || !result.filePath) return ok(null)
      rememberDialogDir(result.filePath)
      const bytes = randomBytes(32)
      writeFileSync(result.filePath, bytes)
      const filename = basename(result.filePath)
      return ok({ path: result.filePath, contents: new Uint8Array(bytes), filename })
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:select-key-file', async () => {
    try {
      const result = await dialog.showOpenDialog(requireWin(), {
        title: 'Select key file',
        defaultPath: dialogDefaultPath(),
        properties: ['openFile'],
        filters: [
          { name: 'Notvex Key File', extensions: ['nvxkey'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths[0]) return ok(null)
      const filePath = result.filePaths[0]
      rememberDialogDir(filePath)
      const filename = basename(filePath)
      const raw = readFileSync(filePath)
      const sizeBytes = raw.length
      if (sizeBytes === 0) return fail('The selected key file is empty')
      const contents = new Uint8Array(raw.subarray(0, KEY_FILE_MAX_BYTES))
      return ok({ contents, filename, sizeBytes })
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:configure-key-file', async (_e, password: string, keyFileContents: Uint8Array) => {
    try {
      requireVault()
      touchActivity()
      const kfContents = readKeyFileContents(keyFileContents)
      const result = await configureKeyFile(password, kfContents)
      recordVaultUsed(getVaultPath()!, true)
      return ok(result)
    } catch (e) {
      if (!isVaultOpen()) liveWin()?.webContents.send('vault:auto-locked')
      return fail(e)
    }
  })

  handle('vault:remove-key-file', async (_e, password: string, keyFileContents: Uint8Array) => {
    try {
      requireVault()
      touchActivity()
      const kfContents = readKeyFileContents(keyFileContents)
      const result = await removeKeyFile(password, kfContents)
      recordVaultUsed(getVaultPath()!, false)
      return ok(result)
    } catch (e) {
      if (!isVaultOpen()) liveWin()?.webContents.send('vault:auto-locked')
      return fail(e)
    }
  })

  handle('vault:status', async () => {
    try {
      // closeVault() packs the container before it clears the path, so queue
      // behind any in-flight close: a renderer reloaded mid-close must not
      // read "open" and boot into the notes over a closing vault.
      const path = await withVaultLock(async () => getVaultPath())
      return ok(
        path !== null ? { isOpen: true as const, vaultPath: path } : { isOpen: false as const }
      )
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:choose-file', async (_e, mode: 'new' | 'existing') => {
    try {
      if (mode === 'new') {
        const result = await dialog.showSaveDialog(requireWin(), {
          title: 'Create new vault',
          defaultPath: dialogDefaultPath('vault.nvx'),
          filters: [{ name: 'Notvex Vault', extensions: ['nvx'] }]
        })
        if (result.canceled) return ok(null)
        rememberDialogDir(result.filePath)
        return ok(result.filePath)
      } else {
        const result = await dialog.showOpenDialog(requireWin(), {
          title: 'Open existing vault',
          defaultPath: dialogDefaultPath(),
          properties: ['openFile'],
          filters: [{ name: 'Notvex Vault', extensions: ['nvx'] }]
        })
        if (result.canceled) return ok(null)
        rememberDialogDir(result.filePaths[0])
        return ok(result.filePaths[0])
      }
    } catch (e) {
      return fail(e)
    }
  })

  // ── Notes ─────────────────────────────────────────────────────────────────

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

  handle('notes:search', async (_e, query: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => searchNotesByTitle(getDb(), query, getMasterKey())))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Tags ──────────────────────────────────────────────────────────────────

  handle('tags:create', async (_e, input: CreateTagInput) => {
    try {
      requireVault()
      const name = validTagName(input?.name)
      touchActivity()
      return ok(await withVaultLock(() => createTag(getDb(), { ...input, name })))
    } catch (e) {
      return fail(e)
    }
  })

  handle(
    'tags:create-and-assign',
    async (_e, input: { noteId: string; name: string; color: string }) => {
      try {
        requireVault()
        const name = validTagName(input?.name)
        touchActivity()
        return ok(await withVaultLock(() => createTagAndAssign(getDb(), { ...input, name })))
      } catch (e) {
        return fail(e)
      }
    }
  )

  handle('tags:list', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => listTags(getDb())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('tags:update', async (_e, id: string, patch: TagPatch) => {
    try {
      requireVault()
      const checked =
        patch?.name === undefined ? patch : { ...patch, name: validTagName(patch.name) }
      touchActivity()
      await withVaultLock(() => updateTag(getDb(), id, checked))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('tags:delete', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => deleteTag(getDb(), id))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Note-tags ─────────────────────────────────────────────────────────────

  handle('note-tags:add', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => addTagToNote(getDb(), noteId, tagId))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:remove', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => removeTagFromNote(getDb(), noteId, tagId))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:list', async (_e, noteId: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getNoteTags(getDb(), noteId)))
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:counts', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getNoteCountPerTag(getDb())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:all', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getAllNoteTags(getDb())))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Prefs ─────────────────────────────────────────────────────────────────

  handle('prefs:get', () => {
    try {
      const prefs = getPrefs()
      const validatedVaults = prefs.recentVaults.filter(
        (v) => existsSync(v.path) && isValidNotvexFile(v.path)
      )
      if (validatedVaults.length !== prefs.recentVaults.length) {
        setPref('recentVaults', validatedVaults)
      }
      return ok({ ...prefs, recentVaults: validatedVaults })
    } catch (e) {
      return fail(e)
    }
  })

  handle('prefs:set', (_e, key: keyof Prefs, value: Prefs[keyof Prefs]) => {
    try {
      const validator = PREFS_VALIDATORS[key as keyof Prefs]
      if (!validator) return fail(`Unknown preference key: ${key}`)
      if (!validator(value)) return fail(`Invalid value for preference: ${key}`)

      setPref(key, value)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Clipboard ────────────────────────────────────────────────────────────

  handle('clipboard:schedule-clear', (_e, value: unknown) => {
    try {
      if (typeof value !== 'string') return fail('Invalid clipboard value')
      scheduleClipboardClear(value)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('shell:open-external', async (_e, url: string) => {
    try {
      if (!isSafeExternalUrl(url)) return fail('URL must start with http:// or https://')
      await shell.openExternal(url)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Updater ────────────────────────────────────────────────────────────────

  handle('updater:check-now', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      const available = result?.isUpdateAvailable ?? false
      return ok(available ? (result?.updateInfo.version ?? null) : null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:install-now', () => {
    try {
      autoUpdater.quitAndInstall(false, true)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:get-current-version', () => {
    try {
      return ok(app.getVersion())
    } catch (e) {
      return fail(e)
    }
  })

  handle('app:is-dev', () => {
    try {
      return ok(!app.isPackaged)
    } catch (e) {
      return fail(e)
    }
  })

  // The app's only renderer reload. Resolves true once reloading, false when it locked instead.
  handle('app:reload-window', async () => {
    try {
      if (isCreating) return fail('A vault is being created. Try again once it is ready.')
      const win = requireWin()
      cancelPendingConfirmations()
      const { packFailed } = await closeVaultDrained(win)
      if (packFailed) {
        // a reload would discard the pack-failed toast, the only notice of the lost changes
        win.webContents.send('vault:auto-locked')
        return ok(false)
      }
      win.webContents.reload()
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })
}
