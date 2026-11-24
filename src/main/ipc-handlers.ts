import { randomBytes } from 'crypto'
import type { BrowserWindow, WebContents } from 'electron'
import { app, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { release } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { isKdfLevelId, type KdfMeasurement } from '@shared/kdf-levels'
import { CURRENT_VERSION_MIN } from '@shared/types'
import type { PendingVault } from '@shared/types'
import { clearClipboardIfOurs, writeClipboard } from './clipboard/clipboard-guard'
import { dialogDefaultPath, rememberDialogDir } from './dialog-dir'
import { drainRenderer } from './drain-renderer'
import { appendError, clearLog, ensureLogDir, readLogTail } from './log/error-log'
import { logError } from './log/log'
import { fail, handle, type IpcResult, ok, readFully, requireVault } from './ipc/core'
import { registerNotesHandlers } from './notes/ipc'
import { setPendingVault } from './pending-vault'
import { registerPrefsHandlers } from './prefs/ipc'
import { registerTagsHandlers } from './tags/ipc'
import type { SchemaMigrationGate } from './db/migrations'
import {
  clearRecoveryUnconfirmed,
  getCurrentVaultPath,
  getPref,
  isLocalVaultPath,
  isRecoveryUnconfirmed,
  markRecoveryUnconfirmed,
  promoteVaultToTop,
  recordVaultUsed
} from './prefs/prefs'
import {
  clearUpdateSilences,
  dismissUpdateForSession,
  downloadUpdate,
  snoozeUpdate
} from './updater/updater'
import { isSafeExternalUrl } from './security/url-guard'
import {
  createVaultBackup,
  ensureVaultBackupDir,
  getVaultBackupDir,
  hasAnyBackups
} from './vault/backups'
import { readContainer, shouldWarnOpeningInDevBuild, vaultFileStatus } from './vault/container'
import { KEY_FILE_MAX_BYTES, measureKdfLevel, readKeyFileContents } from './vault/crypto'
import {
  changePassword,
  closeVault,
  configureKeyFile,
  createVault,
  getHasKeyFileFromOpenVault,
  getKdfLevelFromOpenVault,
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

// Set while a new recovery key may still be on screen, so the soft locks (inactivity, minimize)
// wait for the user to confirm it. Memory only and dropped on any close: the prefs flag is what
// warns the next unlock, this one must never keep a later session from locking.
let recoveryConfirmPending = false

// A lock started mid-rotation queues behind the rekey and closes right after the new key is
// issued, before the renderer can show it, so the soft locks wait for the rotation too.
let rotationsRunning = 0

// What the soft locks wait for: a new key on screen, or a rotation about to issue one.
export function isRecoveryConfirmPending(): boolean {
  return recoveryConfirmPending || rotationsRunning > 0
}

// Called by every handler that hands out a new recovery key, before it returns. The old key is
// already invalid, so a failed prefs write must not keep the new one from reaching the user: the
// next unlock just won't warn if it is lost.
function markIssuedRecoveryKey(vaultPath: string): void {
  recoveryConfirmPending = true
  try {
    markRecoveryUnconfirmed(vaultPath)
  } catch (e) {
    logError('recovery key: mark unconfirmed failed:', e)
  }
}

// Far above any real note; only bounds what an untrusted renderer can push onto the clipboard.
const CLIPBOARD_MAX_CHARS = 10_000_000

// ─── Auto-lock + periodic sync state ─────────────────────────────────────────

const VAULT_SYNC_INTERVAL_MS = 30_000
// A lock keeps the renderer, so a save that misses the short drain bound still fails visibly; a
// reload takes the page and that error with it. Nobody is racing a reload the user asked for.
const RELOAD_DRAIN_TIMEOUT_MS = 2_000

const LOG_STACK_MAX = 4 * 1024
const LOG_RATE_LIMIT = 10
const LOG_RATE_WINDOW_MS = 60_000
const REPORT_LOG_LINES = 30

let rendererErrorTimes: number[] = []
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
// - via lockAndRecycle(): manual lock (vault:close), vault switch, opening a different .nvx
//   (file-opener.ts), Reload Window, and auto-lock, suspend / lock-screen, minimize (through
//   lockVaultAndNotify()).
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
  win: BrowserWindow | null,
  drainTimeoutMs?: number
): Promise<{ packFailed: boolean }> {
  if (!isVaultOpen()) return { packFailed: false }
  if (win) await drainRenderer(win, drainTimeoutMs)
  try {
    const { packFailed } = await closeVault()
    if (packFailed && win && !win.isDestroyed()) win.webContents.send('vault:pack-failed')
    return { packFailed }
  } finally {
    // After the close, not before: closeVault() queues behind any running rekey, whose handler
    // marks its new key before the vault actually closes.
    recoveryConfirmPending = false
    await clearClipboardIfOurs('lock')
  }
}

// ─── Renderer recycle ────────────────────────────────────────────────────────
// After a lock the old renderer's heap still holds decrypted titles, note text and the typed
// password, and a same-site reload() keeps the same process. So the lock kills it, and
// render-process-gone, seeing the mark (takeRecycleMark()), reloads into a new process without
// logging the kill or treating it as a crash. A reload() sent right after the kill is dropped.
// SIGKILL, not forcefullyCrashRenderer(): that one makes the renderer crash itself, which runs
// the OS crash-dump path. That can write the heap being discarded to disk, or hang the exit so
// render-process-gone never fires.

const recycling = new WeakSet<WebContents>()

export function takeRecycleMark(webContents: WebContents): boolean {
  return recycling.delete(webContents)
}

// next: the vault the new renderer opens on, since nothing of the old renderer's state survives.
function recycleRenderer(win: BrowserWindow | null, next: PendingVault | null): boolean {
  if (!win || win.isDestroyed()) return false
  if (next) setPendingVault(next)
  // A kill already in flight reloads into a new process; a second one would hit a dead pid
  if (recycling.has(win.webContents)) return true
  // pid 0 means no live renderer (and kill(0) would hit our own group); a plain reload then
  // already starts a new process
  const pid = win.webContents.getOSProcessId()
  if (pid) {
    recycling.add(win.webContents)
    try {
      process.kill(pid, 'SIGKILL')
      return true
    } catch (e) {
      recycling.delete(win.webContents)
      // Unless the process is already gone, the reload below keeps the old heap: leave a trace
      const code = (e as NodeJS.ErrnoException).code ?? 'Error'
      appendError('renderer-recycle', { name: code, stack: '' })
    }
  }
  win.webContents.reload()
  return true
}

// closeVaultDrained() for a lock the user stays in the app for. A failed pack keeps the
// renderer, since its pack-failed toast is the only notice of the lost changes. next defaults
// to the vault being locked.
export async function lockAndRecycle(
  win: BrowserWindow | null,
  opts: { drainTimeoutMs?: number; next?: PendingVault } = {}
): Promise<{ recycled: boolean }> {
  const lockedPath = getVaultPath()
  const next = opts.next ?? (lockedPath ? { path: lockedPath, mode: 'open' } : null)
  const { packFailed } = await closeVaultDrained(win, opts.drainTimeoutMs)
  if (packFailed) return { recycled: false }
  return { recycled: recycleRenderer(win, next) }
}

export async function lockVaultAndNotify(win: BrowserWindow | null): Promise<void> {
  if (!isVaultOpen()) {
    // Nothing to close yet, but vault:create applies this lock once the vault exists
    if (isCreating) lockPendingDuringCreate = true
    return
  }
  const { recycled } = await lockAndRecycle(win)
  if (!recycled && win && !win.isDestroyed()) win.webContents.send('vault:auto-locked')
}

// A failed credential rotation closes the vault itself, outside closeVaultDrained(), so the
// clipboard clear every lock does happens here.
async function notifyIfRotationLocked(): Promise<void> {
  if (isVaultOpen()) return
  recoveryConfirmPending = false
  await clearClipboardIfOurs('lock')
  recycleRenderer(liveWin(), null)
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
      if (!isVaultOpen() || isRecoveryConfirmPending()) return
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
// A hard lock that arrived while isCreating was set.
let lockPendingDuringCreate = false

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

// Runs after the vault change already happened: failing the handler here would leave the
// renderer believing the change didn't, while main holds the result (open vault, new mnemonic).
function recordVaultUsedNonFatal(tag: string, path: string): void {
  try {
    recordVaultUsed(path)
  } catch (e) {
    logError(`[${tag}] record vault used failed:`, e)
  }
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
  takePendingVault: () => PendingVault | null
): void {
  currentWin = win
  startAutoLockTimer()
  if (handlersRegistered) return
  handlersRegistered = true

  // ── Vault ──────────────────────────────────────────────────────────────────

  handle('vault:get-pending-file', () => {
    try {
      return ok(takePendingVault())
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:has-vault', (_e, filePath?: string) => {
    try {
      const path = filePath ?? getCurrentVaultPath()
      if (!path) return ok('missing')
      if (!isLocalVaultPath(path)) return fail('Vaults on network shares are not supported')
      return ok(vaultFileStatus(path))
    } catch (e) {
      return fail(e)
    }
  })

  handle('kdf:measure', async (_e, kdfLevelId: unknown): Promise<IpcResult<KdfMeasurement>> => {
    if (!isKdfLevelId(kdfLevelId)) {
      return fail(new Error("Couldn't measure the level: unknown key derivation level"))
    }
    try {
      return ok({ status: 'measured', ms: await measureKdfLevel(kdfLevelId) })
    } catch {
      return ok({ status: 'unavailable' })
    }
  })

  handle('vault:create', async (_e, filePath: string, password: string, kdfLevelId: unknown) => {
    if (!isKdfLevelId(kdfLevelId)) {
      return fail(new Error("Couldn't create the vault: unknown key derivation level"))
    }
    isCreating = true
    try {
      const result = await createVault(filePath, password, !app.isPackaged, kdfLevelId)
      markIssuedRecoveryKey(filePath)
      recordVaultUsedNonFatal('vault:create', filePath)
      if (lockPendingDuringCreate) {
        await lockAndRecycle(liveWin())
        return fail(
          "Couldn't show the recovery key: the vault was locked while it was created. Unlock it to get a new one"
        )
      }
      touchActivity()
      return ok(result)
    } catch (e) {
      return fail(e)
    } finally {
      isCreating = false
      lockPendingDuringCreate = false
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
          return fail("Vault file not found or couldn't be read.")
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
          recordVaultUsedNonFatal('vault:open', filePath)
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
            return fail("Vault file not found or couldn't be read.")
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
            recordVaultUsedNonFatal('vault:open-with-recovery', filePath)
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
        rotationsRunning += 1
        requireVault()
        touchActivity()
        const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
        const result = await changePassword(currentPassword, newPassword, kfContents)
        markIssuedRecoveryKey(getVaultPath()!)
        return ok(result)
      } catch (e) {
        await notifyIfRotationLocked()
        return fail(e)
      } finally {
        rotationsRunning -= 1
      }
    }
  )

  // A new recovery key for a user who lost the last one before saving it: re-keying under the
  // same password is what issues it, and invalidates the lost one.
  handle(
    'vault:regenerate-recovery-key',
    async (_e, password: string, keyFileContents?: Uint8Array) => {
      try {
        rotationsRunning += 1
        requireVault()
        touchActivity()
        const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
        const result = await changePassword(password, password, kfContents)
        markIssuedRecoveryKey(getVaultPath()!)
        return ok(result)
      } catch (e) {
        await notifyIfRotationLocked()
        return fail(e)
      } finally {
        rotationsRunning -= 1
      }
    }
  )

  handle('vault:rotate-credentials', async (_e, newPassword: string) => {
    try {
      rotationsRunning += 1
      requireVault()
      touchActivity()
      const result = await rotateVaultCredentials(newPassword)
      markIssuedRecoveryKey(getVaultPath()!)
      return ok(result)
    } catch (e) {
      await notifyIfRotationLocked()
      return fail(e)
    } finally {
      rotationsRunning -= 1
    }
  })

  handle('vault:confirm-recovery-saved', () => {
    try {
      recoveryConfirmPending = false
      // Reading and confirming the key was activity: the auto-lock restarts from here.
      touchActivity()
      const vaultPath = getVaultPath()
      if (vaultPath) clearRecoveryUnconfirmed(vaultPath)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:recovery-unconfirmed', () => {
    try {
      const vaultPath = getVaultPath()
      return ok(vaultPath ? isRecoveryUnconfirmed(vaultPath) : false)
    } catch (e) {
      return fail(e)
    }
  })

  // createPath: a vault the user is about to create, so the next renderer opens Setup for it
  handle('vault:close', async (_e, createPath?: unknown) => {
    try {
      const next: PendingVault | undefined =
        typeof createPath === 'string' ? { path: createPath, mode: 'create' } : undefined
      await lockAndRecycle(liveWin(), { next })
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('vault:switch', async (_e, filePath: string) => {
    try {
      // Validate before closeVaultDrained() so a bad target never locks the current vault
      const status = vaultFileStatus(filePath)
      if (status !== 'usable') return ok(status)
      await lockAndRecycle(liveWin(), { next: { path: filePath, mode: 'open' } })
      try {
        promoteVaultToTop(filePath)
      } catch (e) {
        // The vault is already closed: failing here would strand the renderer unlocked over it
        logError('[switch] promote failed:', e)
      }
      return ok(status)
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

  handle(
    'vault:change-kdf-level',
    async (_e, kdfLevelId: unknown, password: string, keyFileContents?: Uint8Array) => {
      if (!isKdfLevelId(kdfLevelId)) {
        return fail(new Error("Couldn't change the level: unknown key derivation level"))
      }
      try {
        rotationsRunning += 1
        requireVault()
        touchActivity()
        const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
        const result = await changePassword(password, password, kfContents, kdfLevelId)
        markIssuedRecoveryKey(getVaultPath()!)
        return ok(result)
      } catch (e) {
        await notifyIfRotationLocked()
        const reason = e instanceof Error ? e.message : String(e)
        return fail(new Error(`Couldn't change the level: ${reason}`))
      } finally {
        rotationsRunning -= 1
      }
    }
  )

  handle('vault:get-kdf-level', () => {
    try {
      requireVault()
      return ok(getKdfLevelFromOpenVault())
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
        return fail("Couldn't sync the vault before copying. Try again.")
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
    } catch {
      // fs errors quote the path, and the renderer shows this error as is.
      return fail("Couldn't save the key file")
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
      const fd = openSync(filePath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0))
      try {
        const stat = fstatSync(fd)
        if (!stat.isFile()) return fail("Couldn't read the selected key file")
        // Only the first KEY_FILE_MAX_BYTES feed the key, so a file of any size costs at most that.
        const buf = new Uint8Array(Math.min(stat.size, KEY_FILE_MAX_BYTES))
        const read = readFully(fd, buf)
        if (read === 0) return fail('The selected key file is empty')
        return ok({ contents: buf.subarray(0, read), filename, sizeBytes: stat.size })
      } finally {
        closeSync(fd)
      }
    } catch {
      // fs errors quote the path, and the renderer shows this error as is.
      return fail("Couldn't read the selected key file")
    }
  })

  handle('vault:configure-key-file', async (_e, password: string, keyFileContents: Uint8Array) => {
    try {
      rotationsRunning += 1
      requireVault()
      touchActivity()
      const kfContents = readKeyFileContents(keyFileContents)
      const result = await configureKeyFile(password, kfContents)
      markIssuedRecoveryKey(getVaultPath()!)
      recordVaultUsedNonFatal('vault:configure-key-file', getVaultPath()!)
      return ok(result)
    } catch (e) {
      await notifyIfRotationLocked()
      return fail(e)
    } finally {
      rotationsRunning -= 1
    }
  })

  handle('vault:remove-key-file', async (_e, password: string, keyFileContents: Uint8Array) => {
    try {
      rotationsRunning += 1
      requireVault()
      touchActivity()
      const kfContents = readKeyFileContents(keyFileContents)
      const result = await removeKeyFile(password, kfContents)
      markIssuedRecoveryKey(getVaultPath()!)
      recordVaultUsedNonFatal('vault:remove-key-file', getVaultPath()!)
      return ok(result)
    } catch (e) {
      await notifyIfRotationLocked()
      return fail(e)
    } finally {
      rotationsRunning -= 1
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

  registerNotesHandlers({ requireWin, touchActivity })
  registerTagsHandlers({ touchActivity })

  registerPrefsHandlers()

  // ── Clipboard ────────────────────────────────────────────────────────────

  handle('clipboard:write', async (_e, text: unknown, opts: unknown) => {
    try {
      if (typeof text !== 'string' || text === '' || text.length > CLIPBOARD_MAX_CHARS) {
        return fail('Invalid clipboard value')
      }
      const flags = opts as { secret?: unknown; fromUnlockedView?: unknown } | null | undefined
      const secret = flags?.secret === true
      // The renderer hears of a lock only after main cleared the clipboard, so a copy from the
      // view it still shows can arrive with the vault closed. The recovery key is shown once, so
      // its copy goes through regardless. Nothing may await between this check and
      // writeClipboard(): a lock in that gap would be missed by both this and its lock generation.
      if (!secret && flags?.fromUnlockedView === true && !isVaultOpen()) {
        return fail('Vault is locked')
      }
      await writeClipboard(text, { secret })
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

  // ── Error log ──────────────────────────────────────────────────────────────

  // The renderer is untrusted here: an error loop must not fill the disk, so past the limit
  // errors are dropped, and ok() because the renderer can do nothing useful with a refusal.
  handle('log:error', (_e, payload: unknown) => {
    try {
      const { name, stack } = (
        typeof payload === 'object' && payload !== null ? payload : {}
      ) as Record<string, unknown>
      if (typeof name !== 'string' || typeof stack !== 'string') {
        return fail('Invalid error payload')
      }
      const now = Date.now()
      rendererErrorTimes = rendererErrorTimes.filter((t) => now - t < LOG_RATE_WINDOW_MS)
      if (rendererErrorTimes.length >= LOG_RATE_LIMIT) return ok(null)
      rendererErrorTimes.push(now)
      appendError('renderer', { name, stack: stack.slice(0, LOG_STACK_MAX) })
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // Returned as parts, not one text: the renderer drops log lines to fit the issue URL limit.
  handle('log:build-report', () => {
    try {
      const environment = [
        `**Version:** ${app.getVersion()}`,
        `**Electron:** ${process.versions.electron ?? 'unknown'}`,
        `**OS:** ${process.platform} ${release()} ${process.arch}`
      ].join(' · ')
      return ok({ environment, log: readLogTail(REPORT_LOG_LINES) })
    } catch (e) {
      return fail(e)
    }
  })

  handle('log:open-folder', async () => {
    try {
      const result = await shell.openPath(ensureLogDir())
      return result ? fail(result) : ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('log:clear', () => {
    try {
      clearLog()
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Updater ────────────────────────────────────────────────────────────────

  const checkForUpdates = async (): Promise<IpcResult<string | null>> => {
    try {
      const result = await autoUpdater.checkForUpdates()
      const available = result?.isUpdateAvailable ?? false
      return ok(available ? (result?.updateInfo.version ?? null) : null)
    } catch (e) {
      return fail(e)
    }
  }

  handle('updater:check-now', () => {
    try {
      clearUpdateSilences()
    } catch (e) {
      return fail(e)
    }
    return checkForUpdates()
  })

  // The opt-out is enforced here, not in the renderer, so a renderer bug can't leak the request.
  // Each check downloads latest.yml from the real release, and its download count is the only
  // signal of how many installs exist, so dev launches must not add to it.
  handle('updater:check-on-startup', () =>
    app.isPackaged && getPref('checkUpdatesOnStartup') ? checkForUpdates() : ok(null)
  )

  handle('updater:snooze', (_e, version: unknown) => {
    if (typeof version !== 'string' || version === '') return fail('Invalid version')
    try {
      snoozeUpdate(version)
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('updater:dismiss', (_e, version: unknown) => {
    if (typeof version !== 'string' || version === '') return fail('Invalid version')
    dismissUpdateForSession(version)
    return ok(null)
  })

  handle('updater:download', async () => {
    try {
      await downloadUpdate()
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
      const { recycled } = await lockAndRecycle(win, { drainTimeoutMs: RELOAD_DRAIN_TIMEOUT_MS })
      if (!recycled) {
        win.webContents.send('vault:auto-locked')
        return ok(false)
      }
      return ok(true)
    } catch (e) {
      return fail(e)
    }
  })
}
