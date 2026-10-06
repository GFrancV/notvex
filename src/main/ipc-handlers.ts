import { randomBytes } from 'crypto'
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'
import { app, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'node:path'

import { CURRENT_VERSION_MIN, Prefs } from '@shared/types'
import { scheduleClipboardClear } from './clipboard-guard'
import { drainRenderer } from './drain-renderer'
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
// app's own page is refused before it runs (#57). ipcMain.handle has no
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

// ─── Auto-lock + periodic sync state ─────────────────────────────────────────

const VAULT_SYNC_INTERVAL_MS = 30_000

let lastActivityAt = Date.now()
let autoLockTimer: ReturnType<typeof setInterval> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null

function touchActivity(): void {
  lastActivityAt = Date.now()
}

// Single place that closes the vault after giving the renderer a chance to
// flush pending autosaves — every caller that can close the vault (manual
// lock, vault switch, opening a different .nvx, quitting, auto-lock) routes
// through this instead of calling closeVault() directly, so none of them can
// silently regress back to discarding a pending edit (#19).
// A failed pack on close loses every write since the last sync, so the
// window is told; with no window (quit) the log in doCloseVault is all (#61).
export async function closeVaultDrained(win: BrowserWindow | null): Promise<void> {
  if (!isVaultOpen()) return
  if (win) await drainRenderer(win)
  const { packFailed } = await closeVault()
  if (packFailed && win && !win.isDestroyed()) win.webContents.send('vault:pack-failed')
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
// the window through liveWin() instead of capturing the first one (#36).

let currentWin: BrowserWindow | null = null
let handlersRegistered = false

function liveWin(): BrowserWindow | null {
  return currentWin && !currentWin.isDestroyed() ? currentWin : null
}

// Whether the renderer that made a call is still the window the user sees. On
// macOS `activate` can replace it mid-unlock with a window that never asked for
// the unlock, so long-running handlers check this instead of liveWin() (#50).
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

// Bumped when the renderer is replaced while its window stays alive (reload,
// crash). An unlock started under an older renderer has nobody left to show
// the vault to, and isLiveSender() can't tell: the webContents is the same (#51).
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
  clipboardClearSeconds: (v) => typeof v === 'number' && [0, 10, 30, 60, 120, 300].includes(v)
}

// ─── Migration coordinator ────────────────────────────────────────────────────

let migrationResolver: ((result: { confirmed: boolean; createBackup: boolean }) => void) | null =
  null
let migrationBackupTimestamp: number | null = null

// The renderer the pending gate was sent to — the only one whose answer counts,
// so a window that never got the prompt can't confirm or cancel it (#50). Never
// reset: it is only read while a resolver is pending, and every gate assigns it
// before parking, so a stale value is always overwritten first.
let gateRequester: WebContents | null = null

type MigrationPayload =
  | { reason: 'header'; fromVersion: number; toVersion: number }
  | { reason: 'schema'; fromVersion: number; toVersion: number }

// Sends 'vault:migration-required' to the renderer that requested the unlock and waits
// for the user's response. Shared by the header-version and schema-version gates in
// vault:open and vault:open-with-recovery. If that renderer is gone nobody can answer,
// so it counts as cancelled — never re-routed to another window (#50).
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

// Sends 'vault:dev-build-warning-required' to the renderer that requested the
// unlock and waits for the user's response. Shared by vault:open and
// vault:open-with-recovery, gated on shouldWarnOpeningInDevBuild() — see its
// docstring in container.ts. If that renderer is gone nobody can answer, so it
// counts as cancelled (#50).
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

// Settles whichever confirmation gate is pending as "cancelled". Resolving
// rather than just nulling the resolver lets the parked vault:open /
// vault:open-with-recovery unwind through its own cleanup (the finally that
// resets isUnlocking, openVault's temp-file catch) instead of hanging forever.
// Called by the renderer's -cancelled handlers and by the window's 'closed'
// event, since a destroyed window can never answer (#36). The gates run in
// sequence, so at most one is ever pending.
export function cancelPendingConfirmations(): void {
  migrationResolver?.({ confirmed: false, createBackup: false })
  migrationResolver = null
  devBuildWarningResolver?.(false)
  devBuildWarningResolver = null
}

// An unlock that finishes after its window closed (macOS: the window closed
// mid-key-derivation, so window-all-closed found nothing to lock yet and
// stopped auto-lock) must not leave an unlocked vault with no UI — the next
// `activate` window would open straight into the notes (#36). The same holds
// when that `activate` window already exists: it never asked for the unlock and
// is sitting on its own unlock view, out of sync with an open vault (#50). And
// when the renderer was reloaded or crashed mid-unlock: the window survives, but
// the page that asked is gone and the new one would boot into the notes (#51).
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
    try {
      const result = await createVault(filePath, password, !app.isPackaged)
      recordVaultUsed(filePath)
      touchActivity()
      return ok(result)
    } catch (e) {
      return fail(e)
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
          // A real vault (no devBuild field) opened by a development build can be
          // corrupted by an in-progress bug or migration, with no server backup —
          // checked before any migration runs, not after, so it actually guards
          // the thing it exists to guard.
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
        // the close, or a retry from the reloaded page races it (#51).
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

  // The four gate answers below are no-ops unless they come from gateRequester (#50).
  handle('vault:migration-confirmed', (event, createBackup: boolean) => {
    try {
      if (event.sender !== gateRequester) return ok(null)
      // Resolving here only schedules the awaiting migration-flow code's continuation as a
      // microtask — it doesn't run inline. Nulling migrationBackupTimestamp here would race
      // that continuation (which still needs to read it to decide whether to back up), so
      // leave it to that code to clear once it's done reading it.
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
      if (!isVaultOpen()) win.webContents.send('vault:auto-locked')
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

      // Unlike syncContainer() (used by the periodic timer, which must never
      // throw), this is a deliberate user-initiated backup — a failed sync
      // here must surface as a failed backup, not silently copy stale data.
      // Caught separately (generic message, real error logged here only)
      // because packContainer() can throw fs errors (ENOENT/EACCES/etc.)
      // whose message embeds local filesystem paths — those shouldn't cross
      // the IPC boundary to the renderer.
      try {
        await packContainer()
      } catch (e) {
        console.error('vault:save-copy-as: sync before copy failed:', e)
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
        defaultPath: 'notvex.nvxkey',
        filters: [{ name: 'Notvex Key File', extensions: ['nvxkey'] }]
      })
      if (result.canceled || !result.filePath) return ok(null)
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
        properties: ['openFile'],
        filters: [
          { name: 'Notvex Key File', extensions: ['nvxkey'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (result.canceled || !result.filePaths[0]) return ok(null)
      const filePath = result.filePaths[0]
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
      // read "open" and boot into the notes over a closing vault (#51).
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
          defaultPath: 'vault.nvx',
          filters: [{ name: 'Notvex Vault', extensions: ['nvx'] }]
        })
        return ok(result.canceled ? null : result.filePath)
      } else {
        const result = await dialog.showOpenDialog(requireWin(), {
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
      touchActivity()
      return ok(await withVaultLock(() => createTag(getDb(), input)))
    } catch (e) {
      return fail(e)
    }
  })

  handle(
    'tags:create-and-assign',
    async (_e, input: { noteId: string; name: string; color: string }) => {
      try {
        requireVault()
        touchActivity()
        return ok(await withVaultLock(() => createTagAndAssign(getDb(), input)))
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
      touchActivity()
      await withVaultLock(() => updateTag(getDb(), id, patch))
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
}
