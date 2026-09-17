/**
 * vault.ts — SQLCipher vault lifecycle
 *
 * The vault is stored as a single opaque .nvx file (see container.ts):
 *   [4B magic "NVX\0"][2B VERSION_MAJ][2B VERSION_MIN][TLV fields...][0x00][SQLCipher DB bytes]
 *
 * At runtime the DB bytes are extracted to a temporary file and opened with
 * SQLCipher. On close the temp file is repacked into the .nvx container then
 * deleted. The TLV header holds the Argon2id salt (raw bytes), KDF tier, and the
 * recovery-wrapped master key — all as opaque binary fields with no labels.
 * An HMAC (BLAKE2b-256 keyed with the master key) covers the entire header and
 * serves as the first authentication gate before SQLCipher is opened.
 *
 * Memory security:
 * - masterKey lives in a native Buffer (outside V8 GC heap) locked with
 *   VirtualLock/mlock so the OS cannot page it to disk.
 * - All intermediate key copies are zeroed immediately after use.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'

import { CURRENT_VERSION_MIN, type VaultVersion } from '@shared/types'
import { runMigrations, type SchemaMigrationGate } from '../db/migrations'
import { dbAll, dbGet, dbRun } from '../db/queries'
import {
  type ContainerMetadata,
  isValidNotvexFile,
  makeTempDbPath,
  readContainer,
  verifyHeaderHmac,
  writeContainer
} from './container'
import {
  type KdfInputV1,
  calibrateArgon2id,
  decryptBytes,
  decryptField,
  deriveKey,
  deriveRecoveryWrapKey,
  encryptBytes,
  encryptField,
  generateSalt,
  getArgon2Params,
  hashKeyFile,
  initSodium,
  memzero
} from './crypto'
import { allocSecure, freeSecure } from './memlock'
import { generateMnemonic, mnemonicToMasterKey, validateMnemonic } from './recovery'

// Raw note row from the DB (used only in reencryptNotes and its callers).
interface RawNote {
  id: string
  title: Buffer
  title_iv: Buffer
  content: Buffer
  content_iv: Buffer
}

// ─── Concurrency lock ────────────────────────────────────────────────────────

// Serializes packContainer() against itself and against every credential-
// rotation function (changePassword, rotateVaultCredentials, configureKeyFile,
// removeKeyFile). Without this, packContainer() — now async, with a real
// await at the checkpoint — can resume mid-rekey: those functions PRAGMA
// rekey the on-disk temp DB several awaits before reassigning the in-memory
// masterKey, so an interleaved repack can write a .nvx header encrypted
// under the stale key over a body already re-keyed to the new one, bricking
// the vault. A plain FIFO queue (not coalescing) is required, not just
// dedup: two calls can carry different arguments (e.g. two changePassword()
// calls), so a second caller must run its own body, not reuse the first
// caller's result. Exported only so the test suite can verify the ordering
// directly and fast, without real Argon2id/SQLCipher timing.
let vaultOpLock: Promise<unknown> = Promise.resolve()
export function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = vaultOpLock.then(fn, fn)
  vaultOpLock = run.catch(() => undefined)
  return run
}

// ─── Module state ────────────────────────────────────────────────────────────

let db: sqlite3.Database | null = null
let masterKey: Buffer | null = null
let currentVaultPath: string | null = null
let currentMetadata: ContainerMetadata | null = null
let currentHasKeyFile: boolean = false
let tempDbPath: string | null = null
let pendingKeyFileContents: Uint8Array | null = null

// ─── Lock state ──────────────────────────────────────────────────────────────

let currentLockPath: string | null = null

// Acquires an exclusive lock on a vault file using a sidecar .lock file.
// Reads the PID from an existing lock to detect stale locks from crashed processes.
// Throws with a user-facing message if another live process holds the lock.
function acquireLock(vaultPath: string): void {
  const lockPath = vaultPath + '.lock'

  if (existsSync(lockPath)) {
    let shouldProceed = false
    try {
      const { pid } = JSON.parse(readFileSync(lockPath, 'utf-8')) as { pid: number }
      try {
        process.kill(pid, 0)
        // process.kill returned without error → process is alive → vault is in use
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
          shouldProceed = true // process is dead — orphaned lock
        }
        // EPERM: process exists but we can't signal it → treat as in use
      }
    } catch {
      shouldProceed = true // corrupted or unreadable lock file — proceed
    }

    if (!shouldProceed) {
      throw new Error(
        'This vault is already open in another Notvex window. Close the other window before opening it here.'
      )
    }
    try {
      unlinkSync(lockPath)
    } catch {
      /* ignore — proceeding is safe even if we can't clean up the old lock */
    }
  }

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, openedAt: Date.now() }))
  currentLockPath = lockPath
}

function releaseLock(): void {
  if (currentLockPath) {
    try {
      unlinkSync(currentLockPath)
    } catch {
      /* ignore */
    }
    currentLockPath = null
  }
}

// Removes a leftover .tmp file from a previous re-keying crash.
// A .bak is deliberately NOT cleaned up here — its presence means a re-key
// rollback also failed (see the catch blocks in doChangePassword() etc.),
// and it must survive an app restart as the user's only recovery copy.
function cleanupOrphanedTempFiles(vaultPath: string): void {
  const p = vaultPath + '.tmp'
  if (existsSync(p)) {
    try {
      unlinkSync(p)
    } catch {
      /* ignore — not critical */
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function openDatabase(path: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new sqlcipher.Database(path, (err) => {
      if (err) reject(err)
      else resolve(database)
    })
  })
}

function closeDatabase(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((err) => (err ? reject(err) : resolve()))
  })
}

async function applyKey(database: sqlite3.Database, key: Uint8Array): Promise<void> {
  // NOTE: toString('hex') creates an immutable JS string with the key material.
  // This is an unavoidable limitation of the SQLCipher Node.js binding — there is
  // no binary PRAGMA path. The string is unreachable after this function returns
  // and will be collected by the GC on its next pass.
  const hex = Buffer.isBuffer(key) ? key.toString('hex') : Buffer.from(key).toString('hex')
  await new Promise<void>((resolve, reject) => {
    database.serialize(() => {
      database.run(`PRAGMA key = "x'${hex}'"`, (err: Error | null) =>
        err ? reject(err) : resolve()
      )
    })
  })
}

// Moves rawKey (WASM-backed or native Uint8Array) into a locked native Buffer
// and zeros the original immediately.
function storeKey(rawKey: Uint8Array): Buffer {
  const secure = allocSecure(rawKey.length)
  secure.set(rawKey)
  memzero(rawKey)
  return secure
}

// Writes container bytes atomically: write to .tmp then rename.
function atomicWrite(filePath: string, bytes: Buffer): void {
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, bytes)
  renameSync(tmp, filePath)
}

// Flushes the -wal into tempDbPath, then repacks the .nvx container from it.
// Safe to call while the DB is idle (not mid-transaction). Does nothing if
// state is incomplete. The checkpoint is required: WAL-mode commits live in
// tempDbPath + '-wal' until an auto-checkpoint (every ~1000 pages) flushes
// them into the main file, which small-note sessions can go an entire run
// without hitting — packContainer only ever reads the main file.
//
// Goes through withVaultLock: see its docstring for why an unserialized
// version of this function is unsafe.
export function packContainer(): Promise<void> {
  return withVaultLock(doPackContainer)
}

async function doPackContainer(): Promise<void> {
  if (!currentVaultPath || !currentMetadata || !tempDbPath || !masterKey) return
  if (db) {
    // wal_checkpoint(TRUNCATE) reports (busy, log, checkpointed) rather than
    // throwing when it can only partially complete (busy=1, e.g. a reader
    // holding a lock) — dbRun() discards that row, so a partial checkpoint
    // would otherwise look identical to a full one. Treat busy as a hard
    // failure rather than silently reading a possibly under-flushed file.
    const checkpoint = await dbGet<{ busy: number; log: number; checkpointed: number }>(
      db,
      'PRAGMA wal_checkpoint(TRUNCATE)'
    )
    if (checkpoint?.busy) {
      throw new Error('WAL checkpoint incomplete (busy) — refusing to pack a possibly stale DB')
    }
  }
  const { salt } = getArgon2Params(currentMetadata.kdfInput)
  const dbBytes = readFileSync(tempDbPath)
  const bytes = writeContainer({
    masterKey: Buffer.isBuffer(masterKey) ? masterKey : Buffer.from(masterKey),
    salt,
    kdfTier: currentMetadata.kdfInput.kdfTier,
    recoveryBlob: currentMetadata.recoveryBlob,
    dbBytes,
    existingVersionMin: currentMetadata.versionMin
  })
  atomicWrite(currentVaultPath, bytes)
}

// Derives a candidate key from credentials, verifies the header HMAC (before
// touching SQLCipher), then confirms the key opens the DB. Returns the key on
// success, zeros it on failure. The temp DB at dbPath is always closed on return.
//
// Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
async function authenticateVaultKey(params: {
  dbPath: string
  password: string
  metadata: ContainerMetadata
  keyFileContents?: Uint8Array
}): Promise<{ valid: false } | { valid: true; masterKey: Buffer }> {
  const kfHash = params.keyFileContents
    ? hashKeyFile(Buffer.from(params.keyFileContents))
    : undefined
  // Convert WASM-backed Uint8Array to a native Buffer, then zero the WASM copy.
  const { salt: kdfSalt, params: kdfParams } = getArgon2Params(params.metadata.kdfInput)
  const rawDerived = deriveKey(params.password, kdfSalt, kdfParams, kfHash)
  const candidateKey = Buffer.from(rawDerived)
  memzero(rawDerived)

  // HMAC check: wrong password → mismatch → reject immediately, no SQLCipher needed
  if (
    !verifyHeaderHmac(params.metadata.hmacCoveredBytes, params.metadata.storedHmac, candidateKey)
  ) {
    candidateKey.fill(0)
    return { valid: false }
  }

  let verifyDb: sqlite3.Database | null = null
  try {
    verifyDb = await openDatabase(params.dbPath)
    await applyKey(verifyDb, candidateKey)
    // Cheapest read that proves the key decrypts the first page correctly.
    await dbGet(verifyDb, 'SELECT 1 FROM schema_migrations LIMIT 1')
    return { valid: true, masterKey: candidateKey }
  } catch {
    candidateKey.fill(0)
    return { valid: false }
  } finally {
    if (verifyDb) await closeDatabase(verifyDb).catch(() => {})
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isVaultOpen(): boolean {
  return db !== null && masterKey !== null
}

export function getMasterKey(): Uint8Array {
  if (!masterKey) throw new Error('Vault is locked')
  return masterKey
}

export function getDb(): sqlite3.Database {
  if (!db) throw new Error('Vault is locked')
  return db
}

export function getVaultPath(): string | null {
  return currentVaultPath
}

export function getHasKeyFileFromOpenVault(): boolean {
  return currentHasKeyFile
}

// No-op for v1.0 — scaffolding for future minor version migrations.
// Called by the vault:open IPC handler after the user confirms the migration dialog.
export async function migrateHeaderIfNeeded(
  _vaultPath: string,
  _currentMin: number
): Promise<void> {
  if (_currentMin >= CURRENT_VERSION_MIN) return
  // Future: apply chained header migrations here
}

export interface CreateVaultResult {
  mnemonic: string
}

export async function createVault(filePath: string, password: string): Promise<CreateVaultResult> {
  await initSodium()

  if (!password || password.trim().length === 0) {
    throw new Error('PASSWORD_EMPTY')
  }
  if (password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT')
  }

  if (existsSync(filePath) && isValidNotvexFile(filePath)) {
    throw new Error('A vault already exists at this location.')
  }

  const { tier } = calibrateArgon2id(1500)
  const salt = Buffer.from(generateSalt())
  const kdfInput: KdfInputV1 = { version: 1, salt, kdfTier: tier }
  const { params: kdfParams } = getArgon2Params(kdfInput)
  const rawKey = deriveKey(password, salt, kdfParams)

  // Build the DB in a temp file
  const tmp = makeTempDbPath()
  const database = await openDatabase(tmp)
  await applyKey(database, rawKey)
  await runMigrations(database)

  await dbRun(
    database,
    'INSERT INTO vault_meta (id, version, created_at, has_key_file) VALUES (1, 1, ?, 0)',
    [Date.now()]
  )

  const mnemonic = generateMnemonic()
  const mnemonicKey = mnemonicToMasterKey(mnemonic)
  const wrapKey = deriveRecoveryWrapKey(mnemonicKey, undefined)
  memzero(mnemonicKey)
  const { ciphertext: recCt, nonce: recNonce } = encryptBytes(rawKey, wrapKey)
  memzero(wrapKey)
  const recoveryBlob = Buffer.concat([Buffer.from(recNonce), Buffer.from(recCt)])

  // Close DB to flush all pages to the temp file, then pack the .nvx container
  await closeDatabase(database)
  const dbBytes = readFileSync(tmp)

  const containerBytes = writeContainer({
    masterKey: Buffer.from(rawKey),
    salt,
    kdfTier: tier,
    recoveryBlob,
    dbBytes
  })
  atomicWrite(filePath, containerBytes)

  // Reopen the temp DB for the active session
  const reopened = await openDatabase(tmp)
  await applyKey(reopened, rawKey)

  db = reopened
  masterKey = storeKey(rawKey) // zeros rawKey
  currentVaultPath = filePath
  currentHasKeyFile = false
  tempDbPath = tmp

  // Rebuild currentMetadata from the written file for consistency
  currentMetadata = readContainer(readFileSync(filePath))

  return { mnemonic }
}

export async function openVault(
  filePath: string,
  password: string,
  keyFileContents?: Uint8Array,
  preReadBytes?: Buffer,
  onSchemaMigrationNeeded?: SchemaMigrationGate
): Promise<VaultVersion | null> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  await initSodium()

  if (!existsSync(filePath)) throw new Error('Vault not found at the specified location.')

  cleanupOrphanedTempFiles(filePath)

  const fileBytes = preReadBytes ?? readFileSync(filePath)
  const metadata = readContainer(fileBytes) // throws NOT_NOTVEX_FILE / VERSION_TOO_NEW

  acquireLock(filePath)

  let tmp: string | null = null
  let auth: Awaited<ReturnType<typeof authenticateVaultKey>> | null = null
  let database: sqlite3.Database | null = null

  try {
    tmp = makeTempDbPath()
    writeFileSync(tmp, fileBytes.subarray(metadata.dbOffset))

    auth = await authenticateVaultKey({ dbPath: tmp, password, metadata, keyFileContents })

    if (!auth.valid) {
      releaseLock()
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
      return null
    }

    // authenticateVaultKey verified and closed the DB. Reopen for the session.
    database = await openDatabase(tmp)
    await applyKey(database, auth.masterKey)
    await runMigrations(database, onSchemaMigrationNeeded)

    const meta = await dbGet<{ has_key_file: number }>(
      database,
      'SELECT has_key_file FROM vault_meta WHERE id = 1'
    )

    db = database
    masterKey = storeKey(auth.masterKey) // zeros auth.masterKey
    currentVaultPath = filePath
    currentMetadata = metadata
    currentHasKeyFile = (meta?.has_key_file ?? 0) === 1
    tempDbPath = tmp
    return { maj: metadata.versionMaj, min: metadata.versionMin }
  } catch (err) {
    releaseLock()
    if (auth?.valid) auth.masterKey.fill(0)
    if (database) {
      try {
        await closeDatabase(database)
      } catch {
        /* ignore */
      }
    }
    if (tmp) {
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

export async function openVaultWithRecovery(
  filePath: string,
  mnemonic: string,
  keyFileContents?: Uint8Array,
  onSchemaMigrationNeeded?: SchemaMigrationGate
): Promise<VaultVersion | null> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  await initSodium()

  if (!existsSync(filePath)) throw new Error('Vault not found at the specified location.')
  if (!validateMnemonic(mnemonic)) return null

  const fileBytes = readFileSync(filePath)
  const metadata = readContainer(fileBytes)

  cleanupOrphanedTempFiles(filePath)
  acquireLock(filePath)

  // Derive the wrap key that was used to encrypt the recovery blob.
  // When a key file was configured, the wrap key binds both factors:
  // wrapKey = BLAKE2b(mnemonicKey || BLAKE2b(keyFileContents))
  // If either factor is wrong the XChaCha20-Poly1305 MAC fails and decryption throws.
  const mnemonicKey = mnemonicToMasterKey(mnemonic)
  const wrapKey = deriveRecoveryWrapKey(mnemonicKey, keyFileContents)
  memzero(mnemonicKey)

  // RecoveryBlob layout: [24B nonce][ciphertext]
  const recNonce = metadata.recoveryBlob.subarray(0, 24)
  const recCt = metadata.recoveryBlob.subarray(24)

  let rawKey: Uint8Array
  try {
    rawKey = decryptBytes(recCt, recNonce, wrapKey)
  } catch {
    memzero(wrapKey)
    releaseLock()
    return null
  } finally {
    memzero(wrapKey)
  }

  const tmp = makeTempDbPath()
  writeFileSync(tmp, fileBytes.subarray(metadata.dbOffset))

  let database: sqlite3.Database | null = null
  try {
    database = await openDatabase(tmp)
    await applyKey(database, rawKey)
    await runMigrations(database, onSchemaMigrationNeeded)

    const meta = await dbGet<{ id: number; has_key_file: number }>(
      database,
      'SELECT id, has_key_file FROM vault_meta WHERE id = 1'
    )
    if (!meta) {
      memzero(rawKey)
      releaseLock()
      return null
    }

    db = database
    masterKey = storeKey(rawKey) // zeros rawKey
    currentVaultPath = filePath
    currentMetadata = metadata
    currentHasKeyFile = (meta.has_key_file ?? 0) === 1
    tempDbPath = tmp
    pendingKeyFileContents = keyFileContents ?? null
    return { maj: metadata.versionMaj, min: metadata.versionMin }
  } catch (err) {
    releaseLock()
    memzero(rawKey)
    if (database) {
      try {
        await closeDatabase(database)
      } catch {
        /* ignore */
      }
    }
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}

// Goes through withVaultLock: see its docstring for why concurrent calls
// here (or a concurrent packContainer()) are unsafe.
export function changePassword(
  currentPassword: string,
  newPassword: string,
  keyFileContents?: Uint8Array
): Promise<{ mnemonic: string }> {
  return withVaultLock(() => doChangePassword(currentPassword, newPassword, keyFileContents))
}

async function doChangePassword(
  currentPassword: string,
  newPassword: string,
  keyFileContents?: Uint8Array
): Promise<{ mnemonic: string }> {
  if (!isVaultOpen() || !db || !masterKey || !currentMetadata || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  // Step 1 — verify current credentials. Pass key file only if the vault has one.
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password: currentPassword,
    metadata: currentMetadata,
    keyFileContents: currentHasKeyFile ? keyFileContents : undefined
  })
  if (!auth.valid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Current password is incorrect')
  }
  auth.masterKey.fill(0) // verified; the live masterKey is already in memory

  // Step 2 — derive new key with a fresh salt, same tier
  const kfHash = keyFileContents ? hashKeyFile(Buffer.from(keyFileContents)) : undefined
  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(newPassword, newSalt, newKdfParams, kfHash)

  // NOTE: hex strings are immutable in V8 and cannot be explicitly zeroed.
  // Unavoidable limitation of the SQLCipher Node.js binding.
  const oldKeyHex = masterKey.toString('hex')
  const newHex = Buffer.from(newRawKey).toString('hex')

  // Step 3 — re-key SQLCipher in-place
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')
    try {
      await reencryptNotes(masterKey, newRawKey)
      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    // Generate new recovery blob wrapping the new key
    const mnemonic = generateMnemonic()
    const mnemonicKey = mnemonicToMasterKey(mnemonic)
    const wrapKey = deriveRecoveryWrapKey(
      mnemonicKey,
      currentHasKeyFile ? keyFileContents : undefined
    )
    memzero(mnemonicKey)
    const { ciphertext: recCt, nonce: recNonce } = encryptBytes(newRawKey, wrapKey)
    const newRecoveryBlob = Buffer.concat([Buffer.from(recNonce), Buffer.from(recCt)])
    memzero(wrapKey)

    const dbBytes = readFileSync(tempDbPath)
    const containerBytes = writeContainer({
      masterKey: Buffer.from(newRawKey),
      salt: newSalt,
      kdfTier: currentMetadata.kdfInput.kdfTier,
      recoveryBlob: newRecoveryBlob,
      dbBytes,
      existingVersionMin: currentMetadata.versionMin
    })
    atomicWrite(currentVaultPath, containerBytes)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    const newSecureKey = storeKey(newRawKey) // zeros newRawKey
    freeSecure(masterKey)
    masterKey = newSecureKey
    // Re-derive from containerBytes itself, not a manual field patch — that
    // previously left hmacCoveredBytes/storedHmac pointing at the pre-
    // rotation header, so a second rotation in the same open session (e.g.
    // configureKeyFile() right after changePassword()) authenticated the
    // correct new credentials against a stale HMAC and rejected them.
    currentMetadata = readContainer(containerBytes)

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.tmp')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
      // Rollback succeeded — live connection and currentVaultPath are both
      // back on the old key, so the backup is genuinely redundant now.
      try {
        unlinkSync(backupPath)
      } catch {
        /* ignore */
      }
    } catch {
      // Rollback also failed: masterKey/currentMetadata still hold the OLD
      // key (never reassigned on this failure path) while tempDbPath's
      // bytes are keyed with the NEW one — doCloseVault(true) skips the
      // pack step so it doesn't atomicWrite that inconsistent container
      // over the just-restored currentVaultPath, and backupPath is kept as
      // the user's recovery copy instead of being deleted.
      //
      // doCloseVault(), not closeVault(): we're already running inside
      // withVaultLock here (this catch block belongs to one of the four
      // doX functions it wraps) — calling the locked closeVault() would
      // deadlock the whole queue permanently. See doCloseVault()'s docstring.
      await doCloseVault(true)
      throw new Error(
        `Your vault was restored to its previous state, but the operation could not be fully rolled back. A backup copy was kept at ${backupPath} as a precaution.`,
        { cause: err }
      )
    }
    throw err
  }
}

// Goes through withVaultLock: see its docstring for why concurrent calls
// here (or a concurrent packContainer()) are unsafe.
export function rotateVaultCredentials(newPassword: string): Promise<{ mnemonic: string }> {
  return withVaultLock(() => doRotateVaultCredentials(newPassword))
}

async function doRotateVaultCredentials(newPassword: string): Promise<{ mnemonic: string }> {
  if (!isVaultOpen() || !db || !masterKey || !currentMetadata || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  const kfHash = pendingKeyFileContents
    ? hashKeyFile(Buffer.from(pendingKeyFileContents))
    : undefined
  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(newPassword, newSalt, newKdfParams, kfHash)

  const oldKeyHex = masterKey.toString('hex')
  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')
    try {
      const newHasKeyFile = pendingKeyFileContents !== null ? true : currentHasKeyFile
      await dbRun(db, 'UPDATE vault_meta SET has_key_file = ? WHERE id = 1', [
        newHasKeyFile ? 1 : 0
      ])
      await reencryptNotes(masterKey, newRawKey)
      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    const newHasKeyFile = pendingKeyFileContents !== null ? true : currentHasKeyFile
    const mnemonic = generateMnemonic()
    const mnemonicKey = mnemonicToMasterKey(mnemonic)
    const wrapKey = deriveRecoveryWrapKey(
      mnemonicKey,
      newHasKeyFile ? (pendingKeyFileContents ?? undefined) : undefined
    )
    memzero(mnemonicKey)
    const { ciphertext: recCt, nonce: recNonce } = encryptBytes(newRawKey, wrapKey)
    const newRecoveryBlob = Buffer.concat([Buffer.from(recNonce), Buffer.from(recCt)])
    memzero(wrapKey)

    const dbBytes = readFileSync(tempDbPath)
    const containerBytes = writeContainer({
      masterKey: Buffer.from(newRawKey),
      salt: newSalt,
      kdfTier: currentMetadata.kdfInput.kdfTier,
      recoveryBlob: newRecoveryBlob,
      dbBytes,
      existingVersionMin: currentMetadata.versionMin
    })
    atomicWrite(currentVaultPath, containerBytes)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    if (pendingKeyFileContents) {
      memzero(pendingKeyFileContents)
      pendingKeyFileContents = null
    }

    const newSecureKey = storeKey(newRawKey) // zeros newRawKey
    freeSecure(masterKey)
    masterKey = newSecureKey
    // Re-derive from containerBytes itself, not a manual field patch — that
    // previously left hmacCoveredBytes/storedHmac pointing at the pre-
    // rotation header, so a second rotation in the same open session (e.g.
    // configureKeyFile() right after changePassword()) authenticated the
    // correct new credentials against a stale HMAC and rejected them.
    currentMetadata = readContainer(containerBytes)
    currentHasKeyFile = newHasKeyFile

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.tmp')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
      // Rollback succeeded — live connection and currentVaultPath are both
      // back on the old key, so the backup is genuinely redundant now.
      try {
        unlinkSync(backupPath)
      } catch {
        /* ignore */
      }
    } catch {
      // Rollback also failed: masterKey/currentMetadata still hold the OLD
      // key (never reassigned on this failure path) while tempDbPath's
      // bytes are keyed with the NEW one — doCloseVault(true) skips the
      // pack step so it doesn't atomicWrite that inconsistent container
      // over the just-restored currentVaultPath, and backupPath is kept as
      // the user's recovery copy instead of being deleted.
      //
      // doCloseVault(), not closeVault(): we're already running inside
      // withVaultLock here (this catch block belongs to one of the four
      // doX functions it wraps) — calling the locked closeVault() would
      // deadlock the whole queue permanently. See doCloseVault()'s docstring.
      await doCloseVault(true)
      throw new Error(
        `Your vault was restored to its previous state, but the operation could not be fully rolled back. A backup copy was kept at ${backupPath} as a precaution.`,
        { cause: err }
      )
    }
    throw err
  }
}

// Repacks the .nvx container from the current temp DB without closing the session.
// Called periodically for crash safety. No-op if vault is closed.
export async function syncContainer(): Promise<void> {
  if (!isVaultOpen()) return
  try {
    await packContainer()
  } catch {
    /* don't disrupt the session */
  }
}

// Goes through withVaultLock: see its docstring for why concurrent calls
// here (or a concurrent packContainer()/credential rotation) are unsafe.
//
// IMPORTANT: doCloseVault() must never be reached through the exported,
// lock-wrapped closeVault() from code that is already running inside
// withVaultLock — e.g. the catch-block fallbacks in doChangePassword() /
// doRotateVaultCredentials() / doConfigureKeyFile() / doRemoveKeyFile().
// withVaultLock is a plain FIFO queue, not reentrant: a nested call to it
// waits for the outer call to settle, which itself is waiting on the
// nested call — a permanent deadlock that also wedges every future queued
// operation (including the 30s sync timer) and leaves masterKey un-zeroed.
// Those fallbacks call doCloseVault() directly for this reason.
export function closeVault(): Promise<void> {
  return withVaultLock(doCloseVault)
}

// skipPack=true is used by the 4 credential-rotation fallbacks when the
// re-key rollback itself also failed: at that point masterKey/currentMetadata
// still hold the OLD key material (never reassigned on this failure path)
// while tempDbPath's bytes are keyed with the NEW key, so packing now would
// atomicWrite an internally-inconsistent container over the just-restored
// currentVaultPath, destroying it. Every other cleanup step still runs.
async function doCloseVault(skipPack = false): Promise<void> {
  // packContainer() checkpoints via `db`, so it runs before the connection
  // closes below, while there's still something to checkpoint against.
  // (SQLite implicitly checkpoints WAL when the last connection to a
  // database closes, so closeDatabase() alone would likely be enough today —
  // but that's relying on an implementation detail we don't control here.
  // Explicit beats implicit, and this stops depending on it entirely.)
  //
  // Calls doPackContainer() directly, not packContainer() — this function
  // already runs inside withVaultLock, and packContainer() is that same
  // lock, so calling it here would be the exact reentrant deadlock this
  // function's docstring warns callers about.
  if (!skipPack && tempDbPath && currentVaultPath && currentMetadata) {
    try {
      await doPackContainer()
    } catch {
      /* don't throw on close */
    }
  }
  if (db) {
    try {
      await closeDatabase(db)
    } catch {
      /* ignore */
    }
    db = null
  }
  if (tempDbPath) {
    try {
      unlinkSync(tempDbPath)
    } catch {
      /* ignore */
    }
  }
  if (pendingKeyFileContents) {
    memzero(pendingKeyFileContents)
    pendingKeyFileContents = null
  }
  if (masterKey) {
    freeSecure(masterKey)
    masterKey = null
  }
  currentVaultPath = null
  currentMetadata = null
  currentHasKeyFile = false
  tempDbPath = null
  releaseLock()
}

// Helper to re-encrypt all notes with a new key inside an open transaction.
// Caller is responsible for BEGIN/COMMIT/ROLLBACK.
async function reencryptNotes(oldKey: Uint8Array, newKey: Uint8Array): Promise<void> {
  const notes = await dbAll<RawNote>(
    db!,
    'SELECT id, title, title_iv, content, content_iv FROM notes',
    []
  )
  for (const note of notes) {
    const titlePlain = decryptField(
      new Uint8Array(note.title),
      new Uint8Array(note.title_iv),
      oldKey
    )
    const contentPlain = decryptField(
      new Uint8Array(note.content),
      new Uint8Array(note.content_iv),
      oldKey
    )
    const { ciphertext: newTitle, nonce: newTitleIv } = encryptField(titlePlain, newKey)
    const { ciphertext: newContent, nonce: newContentIv } = encryptField(contentPlain, newKey)
    await dbRun(
      db!,
      'UPDATE notes SET title = ?, title_iv = ?, content = ?, content_iv = ? WHERE id = ?',
      [
        Buffer.from(newTitle),
        Buffer.from(newTitleIv),
        Buffer.from(newContent),
        Buffer.from(newContentIv),
        note.id
      ]
    )
  }
}

// Add or change the key file on the open vault.
// Goes through withVaultLock: see its docstring for why concurrent calls
// here (or a concurrent packContainer()) are unsafe.
export function configureKeyFile(
  password: string,
  keyFileContents: Uint8Array
): Promise<{ mnemonic: string }> {
  return withVaultLock(() => doConfigureKeyFile(password, keyFileContents))
}

async function doConfigureKeyFile(
  password: string,
  keyFileContents: Uint8Array
): Promise<{ mnemonic: string }> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  if (!isVaultOpen() || !db || !masterKey || !currentMetadata || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  // Verify current credentials. Pass current key file only if one is already configured.
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password,
    metadata: currentMetadata,
    keyFileContents: currentHasKeyFile ? keyFileContents : undefined
  })
  if (!auth.valid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Incorrect password or key file')
  }
  auth.masterKey.fill(0)

  const kfHash = hashKeyFile(Buffer.from(keyFileContents))
  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(password, newSalt, newKdfParams, kfHash)
  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')
    try {
      await dbRun(db, 'UPDATE vault_meta SET has_key_file = 1 WHERE id = 1')
      await reencryptNotes(masterKey, newRawKey)
      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    const mnemonic = generateMnemonic()
    const mnemonicKey = mnemonicToMasterKey(mnemonic)
    const wrapKey = deriveRecoveryWrapKey(mnemonicKey, keyFileContents)
    memzero(mnemonicKey)
    const { ciphertext: recCt, nonce: recNonce } = encryptBytes(newRawKey, wrapKey)
    const newRecoveryBlob = Buffer.concat([Buffer.from(recNonce), Buffer.from(recCt)])
    memzero(wrapKey)

    const dbBytes = readFileSync(tempDbPath)
    const containerBytes = writeContainer({
      masterKey: Buffer.from(newRawKey),
      salt: newSalt,
      kdfTier: currentMetadata.kdfInput.kdfTier,
      recoveryBlob: newRecoveryBlob,
      dbBytes,
      existingVersionMin: currentMetadata.versionMin
    })
    atomicWrite(currentVaultPath, containerBytes)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    const newSecureKey = storeKey(newRawKey)
    freeSecure(masterKey)
    masterKey = newSecureKey
    // Re-derive from containerBytes itself, not a manual field patch — that
    // previously left hmacCoveredBytes/storedHmac pointing at the pre-
    // rotation header, so a second rotation in the same open session (e.g.
    // configureKeyFile() right after changePassword()) authenticated the
    // correct new credentials against a stale HMAC and rejected them.
    currentMetadata = readContainer(containerBytes)
    currentHasKeyFile = true

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.tmp')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
      // Rollback succeeded — live connection and currentVaultPath are both
      // back on the old key, so the backup is genuinely redundant now.
      try {
        unlinkSync(backupPath)
      } catch {
        /* ignore */
      }
    } catch {
      // Rollback also failed: masterKey/currentMetadata still hold the OLD
      // key (never reassigned on this failure path) while tempDbPath's
      // bytes are keyed with the NEW one — doCloseVault(true) skips the
      // pack step so it doesn't atomicWrite that inconsistent container
      // over the just-restored currentVaultPath, and backupPath is kept as
      // the user's recovery copy instead of being deleted.
      //
      // doCloseVault(), not closeVault(): we're already running inside
      // withVaultLock here (this catch block belongs to one of the four
      // doX functions it wraps) — calling the locked closeVault() would
      // deadlock the whole queue permanently. See doCloseVault()'s docstring.
      await doCloseVault(true)
      throw new Error(
        `Your vault was restored to its previous state, but the operation could not be fully rolled back. A backup copy was kept at ${backupPath} as a precaution.`,
        { cause: err }
      )
    }
    throw err
  }
}

// Remove the key file from the open vault. Requires the current password + key file.
// Goes through withVaultLock: see its docstring for why concurrent calls
// here (or a concurrent packContainer()) are unsafe.
export function removeKeyFile(
  password: string,
  keyFileContents: Uint8Array
): Promise<{ mnemonic: string }> {
  return withVaultLock(() => doRemoveKeyFile(password, keyFileContents))
}

async function doRemoveKeyFile(
  password: string,
  keyFileContents: Uint8Array
): Promise<{ mnemonic: string }> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  if (!isVaultOpen() || !db || !masterKey || !currentMetadata || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }
  if (!currentHasKeyFile) {
    throw new Error('No key file is configured for this vault')
  }

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password,
    metadata: currentMetadata,
    keyFileContents
  })
  if (!auth.valid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Incorrect password or key file')
  }
  auth.masterKey.fill(0)

  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(password, newSalt, newKdfParams)
  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')
    try {
      await dbRun(db, 'UPDATE vault_meta SET has_key_file = 0 WHERE id = 1')
      await reencryptNotes(masterKey, newRawKey)
      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    const mnemonic = generateMnemonic()
    const mnemonicKey = mnemonicToMasterKey(mnemonic)
    const wrapKey = deriveRecoveryWrapKey(mnemonicKey, undefined)
    memzero(mnemonicKey)
    const { ciphertext: recCt, nonce: recNonce } = encryptBytes(newRawKey, wrapKey)
    const newRecoveryBlob = Buffer.concat([Buffer.from(recNonce), Buffer.from(recCt)])
    memzero(wrapKey)

    const dbBytes = readFileSync(tempDbPath)
    const containerBytes = writeContainer({
      masterKey: Buffer.from(newRawKey),
      salt: newSalt,
      kdfTier: currentMetadata.kdfInput.kdfTier,
      recoveryBlob: newRecoveryBlob,
      dbBytes,
      existingVersionMin: currentMetadata.versionMin
    })
    atomicWrite(currentVaultPath, containerBytes)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    const newSecureKey = storeKey(newRawKey)
    freeSecure(masterKey)
    masterKey = newSecureKey
    // Re-derive from containerBytes itself, not a manual field patch — that
    // previously left hmacCoveredBytes/storedHmac pointing at the pre-
    // rotation header, so a second rotation in the same open session (e.g.
    // configureKeyFile() right after changePassword()) authenticated the
    // correct new credentials against a stale HMAC and rejected them.
    currentMetadata = readContainer(containerBytes)
    currentHasKeyFile = false

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.tmp')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
      // Rollback succeeded — live connection and currentVaultPath are both
      // back on the old key, so the backup is genuinely redundant now.
      try {
        unlinkSync(backupPath)
      } catch {
        /* ignore */
      }
    } catch {
      // Rollback also failed: masterKey/currentMetadata still hold the OLD
      // key (never reassigned on this failure path) while tempDbPath's
      // bytes are keyed with the NEW one — doCloseVault(true) skips the
      // pack step so it doesn't atomicWrite that inconsistent container
      // over the just-restored currentVaultPath, and backupPath is kept as
      // the user's recovery copy instead of being deleted.
      //
      // doCloseVault(), not closeVault(): we're already running inside
      // withVaultLock here (this catch block belongs to one of the four
      // doX functions it wraps) — calling the locked closeVault() would
      // deadlock the whole queue permanently. See doCloseVault()'s docstring.
      await doCloseVault(true)
      throw new Error(
        `Your vault was restored to its previous state, but the operation could not be fully rolled back. A backup copy was kept at ${backupPath} as a precaution.`,
        { cause: err }
      )
    }
    throw err
  }
}
