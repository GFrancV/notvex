/**
 * vault.ts — SQLCipher vault lifecycle
 *
 * The vault is stored as a single opaque .nvx file (see container.ts):
 *   [4B magic "NVEX"][2B version][4B sidecar length][sidecar JSON][SQLCipher DB bytes]
 *
 * At runtime the DB bytes are extracted to a temporary file and opened with
 * SQLCipher. On close the temp file is repacked into the .nvx container then
 * deleted. The sidecar (plaintext) holds the Argon2id salt, params, and the
 * recovery-wrapped master key — everything needed to re-derive or recover
 * the master key without access to the encrypted DB.
 *
 * Memory security:
 * - masterKey lives in a native Buffer (outside V8 GC heap) locked with
 *   VirtualLock/mlock so the OS cannot page it to disk.
 * - All intermediate key copies are zeroed immediately after use.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'

import { getPref } from '../prefs'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'

import { runMigrations } from '../db/migrations'
import { dbAll, dbGet, dbRun } from '../db/queries'

import { isNotvexContainer, makeTempDbPath, readContainer, writeContainer } from './container'
import {
  calibrateArgon2id,
  decryptBytes,
  decryptField,
  deriveKey,
  deriveRecoveryWrapKey,
  encryptBytes,
  encryptField,
  generateSalt,
  hashKeyFile,
  initSodium,
  memzero,
  type Argon2Params
} from './crypto'
import { allocSecure, freeSecure } from './memlock'
import { generateMnemonic, mnemonicToMasterKey, validateMnemonic } from './recovery'

// ─── Sidecar schema ──────────────────────────────────────────────────────────

interface VaultSidecar {
  version: number
  argon2_salt: string
  argon2_params: Argon2Params
  recovery_encrypted_master_key: string
  recovery_nonce: string
  hasKeyFile?: boolean
}

// Raw note row from the DB (used only in reencryptNotes and its callers).
interface RawNote {
  id: string
  title: Buffer
  title_iv: Buffer
  content: Buffer
  content_iv: Buffer
}

// ─── Module state ────────────────────────────────────────────────────────────

let db: sqlite3.Database | null = null
let masterKey: Buffer | null = null
let currentVaultPath: string | null = null
let currentSidecar: VaultSidecar | null = null
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

// Removes leftover .bak and .new files from a previous re-keying crash.
// Safe to call before opening: if .new exists the rename never completed,
// and if .bak exists the cleanup after rename never completed.
function cleanupOrphanedTempFiles(vaultPath: string): void {
  for (const suffix of ['.bak', '.new']) {
    const p = vaultPath + suffix
    if (existsSync(p)) {
      try {
        unlinkSync(p)
      } catch {
        /* ignore — not critical */
      }
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

function encryptMasterKey(
  masterKeyBuf: Uint8Array,
  wrapKey: Uint8Array
): { ciphertext: string; nonce: string } {
  // Encrypt raw bytes (32) directly — not the hex-encoded string (64 chars) from before.
  // Uses XChaCha20-Poly1305 IETF via encryptBytes (same cipher as encryptField).
  const { ciphertext, nonce } = encryptBytes(masterKeyBuf, wrapKey)
  return {
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex')
  }
}

function decryptMasterKey(
  ciphertextHex: string,
  nonceHex: string,
  wrapKey: Uint8Array
): Uint8Array {
  return decryptBytes(
    new Uint8Array(Buffer.from(ciphertextHex, 'hex')),
    new Uint8Array(Buffer.from(nonceHex, 'hex')),
    wrapKey
  )
}

// Derives a candidate key from credentials and verifies it by opening the SQLCipher
// database at dbPath. Verification is implicit — if the key is wrong, SQLCipher
// cannot decrypt the first page and the query throws.
//
// This is the single point of credential verification for all Argon2id-based unlock
// and credential-change flows. Never duplicate this open-verify-close pattern inline.
//
// Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
// The DB at dbPath is always closed in the finally block, even on success.
async function authenticateVaultKey(params: {
  dbPath: string
  password: string
  keyFileContents?: Uint8Array
  salt: Uint8Array
  argon2Params: Argon2Params
}): Promise<{ valid: false } | { valid: true; masterKey: Buffer }> {
  const kfHash = params.keyFileContents
    ? hashKeyFile(Buffer.from(params.keyFileContents))
    : undefined
  const candidateKey = deriveKey(params.password, params.salt, params.argon2Params, kfHash)

  let verifyDb: sqlite3.Database | null = null
  try {
    verifyDb = await openDatabase(params.dbPath)
    await applyKey(verifyDb, candidateKey)
    // Cheapest read that proves the key decrypts the first page correctly.
    // SQLCipher throws before this query resolves if the key is wrong.
    await dbGet(verifyDb, 'SELECT 1 FROM schema_migrations LIMIT 1')
    const result = Buffer.from(candidateKey)
    memzero(candidateKey)
    return { valid: true, masterKey: result }
  } catch {
    memzero(candidateKey)
    return { valid: false }
  } finally {
    if (verifyDb) await closeDatabase(verifyDb).catch(() => {})
  }
}

// Reads the current temp DB and repacks the .nvx container. Safe to call while
// the DB is idle (not mid-transaction). Does nothing if state is incomplete.
function packContainer(): void {
  if (!currentVaultPath || !currentSidecar || !tempDbPath) return
  const dbBytes = readFileSync(tempDbPath)
  writeContainer(currentVaultPath, JSON.stringify(currentSidecar), dbBytes)
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

export function vaultExistsAt(filePath: string): boolean {
  return isNotvexContainer(filePath)
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

  if (vaultExistsAt(filePath)) {
    throw new Error('A vault already exists at this location.')
  }

  // Calibrate Argon2id to ~1.5s on this hardware (only runs at vault creation).
  // The result is stored in the sidecar so future unlocks use the same params.
  const params = calibrateArgon2id(1500)
  const salt = generateSalt()
  const rawKey = deriveKey(password, salt, params)

  // Build the DB in a temp file
  const tmp = makeTempDbPath()
  const database = await openDatabase(tmp)
  await applyKey(database, rawKey)
  await runMigrations(database)

  await dbRun(
    database,
    `INSERT INTO vault_meta (id, version, argon2_salt, argon2_params, created_at)
     VALUES (1, 1, ?, ?, ?)`,
    [Buffer.from(salt), JSON.stringify(params), Date.now()]
  )

  const mnemonic = generateMnemonic()
  const mnemonicKey = mnemonicToMasterKey(mnemonic)
  const wrapKey = deriveRecoveryWrapKey(mnemonicKey, undefined)
  memzero(mnemonicKey)
  const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(rawKey, wrapKey)
  memzero(wrapKey)

  // Close DB to flush all pages to the temp file, then pack the .nvx container
  await closeDatabase(database)
  const dbBytes = readFileSync(tmp)

  const sidecar: VaultSidecar = {
    version: 1,
    argon2_salt: Buffer.from(salt).toString('hex'),
    argon2_params: params,
    recovery_encrypted_master_key: recCipher,
    recovery_nonce: recNonce
  }
  writeContainer(filePath, JSON.stringify(sidecar), dbBytes)

  // Reopen the temp DB for the active session
  const reopened = await openDatabase(tmp)
  await applyKey(reopened, rawKey)

  db = reopened
  masterKey = storeKey(rawKey)
  currentVaultPath = filePath
  currentSidecar = sidecar
  tempDbPath = tmp

  return { mnemonic }
}

export async function openVault(
  filePath: string,
  password: string,
  keyFileContents?: Uint8Array
): Promise<boolean> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  await initSodium()

  if (!vaultExistsAt(filePath)) throw new Error('Vault not found at the specified location.')

  cleanupOrphanedTempFiles(filePath)
  acquireLock(filePath)

  const { sidecarJson, dbBytes } = readContainer(filePath)
  const sidecar = JSON.parse(sidecarJson) as VaultSidecar
  const salt = new Uint8Array(Buffer.from(sidecar.argon2_salt, 'hex'))

  const tmp = makeTempDbPath()
  writeFileSync(tmp, dbBytes)

  const auth = await authenticateVaultKey({
    dbPath: tmp,
    password,
    keyFileContents,
    salt,
    argon2Params: sidecar.argon2_params
  })

  if (!auth.valid) {
    releaseLock()
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    return false
  }

  // authenticateVaultKey verified and closed the DB. Reopen for the session.
  let database: sqlite3.Database | null = null
  try {
    database = await openDatabase(tmp)
    await applyKey(database, auth.masterKey)
    db = database
    masterKey = storeKey(auth.masterKey) // zeros auth.masterKey
    currentVaultPath = filePath
    currentSidecar = sidecar
    tempDbPath = tmp
    return true
  } catch (err) {
    releaseLock()
    auth.masterKey.fill(0)
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

export async function openVaultWithRecovery(
  filePath: string,
  mnemonic: string,
  keyFileContents?: Uint8Array
): Promise<boolean> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  await initSodium()

  if (!vaultExistsAt(filePath)) throw new Error('Vault not found at the specified location.')
  if (!validateMnemonic(mnemonic)) return false

  const { sidecarJson, dbBytes } = readContainer(filePath)
  const sidecar = JSON.parse(sidecarJson) as VaultSidecar

  if (sidecar.hasKeyFile && !keyFileContents) return false

  cleanupOrphanedTempFiles(filePath)
  acquireLock(filePath)

  // Derive the wrap key that was used to encrypt the recovery blob.
  // When a key file is configured, the wrap key binds both factors:
  // wrapKey = BLAKE2b(mnemonicKey || BLAKE2b(keyFileContents))
  // If either factor is wrong the XChaCha20-Poly1305 MAC fails and decryption throws.
  const mnemonicKey = mnemonicToMasterKey(mnemonic)
  const wrapKey = deriveRecoveryWrapKey(
    mnemonicKey,
    sidecar.hasKeyFile ? keyFileContents : undefined
  )
  memzero(mnemonicKey)

  let rawKey: Uint8Array
  try {
    rawKey = decryptMasterKey(
      sidecar.recovery_encrypted_master_key,
      sidecar.recovery_nonce,
      wrapKey
    )
  } catch {
    memzero(wrapKey)
    releaseLock()
    return false
  } finally {
    memzero(wrapKey)
  }

  const tmp = makeTempDbPath()
  writeFileSync(tmp, dbBytes)

  let database: sqlite3.Database | null = null
  try {
    database = await openDatabase(tmp)
    await applyKey(database, rawKey)

    const meta = await dbGet<{ id: number }>(database, 'SELECT id FROM vault_meta WHERE id = 1')
    if (!meta) {
      memzero(rawKey)
      releaseLock()
      return false
    }

    db = database
    masterKey = storeKey(rawKey)
    currentVaultPath = filePath
    currentSidecar = sidecar
    tempDbPath = tmp
    pendingKeyFileContents = keyFileContents ?? null
    return true
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

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  keyFileContents?: Uint8Array
): Promise<{ mnemonic: string }> {
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  if (currentSidecar.hasKeyFile && !keyFileContents) {
    throw new Error('Key file is required to change the password')
  }

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  // Step 1 — verify current password via SQLCipher (same source of truth as the live vault).
  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password: currentPassword,
    keyFileContents,
    salt,
    argon2Params: currentSidecar.argon2_params
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

  // Step 2 — derive new key with a fresh salt (preserving key file in derivation)
  const kfHash = keyFileContents ? hashKeyFile(Buffer.from(keyFileContents)) : undefined
  const newSalt = generateSalt()
  const newRawKey = deriveKey(newPassword, newSalt, currentSidecar.argon2_params, kfHash)

  // NOTE: hex strings are immutable in V8 and cannot be explicitly zeroed.
  // Unavoidable limitation of the SQLCipher Node.js binding. Becomes unreachable after this scope.
  const oldKeyHex = masterKey.toString('hex')

  // Step 3 — re-key SQLCipher in-place
  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    // Steps 4-5 inside a single transaction so all data changes are atomic.
    await dbRun(db, 'BEGIN TRANSACTION')

    try {
      // Step 4 — update vault_meta with new salt
      await dbRun(db, `UPDATE vault_meta SET argon2_salt = ? WHERE id = 1`, [Buffer.from(newSalt)])

      // Step 5 — re-encrypt all note ciphertexts with the new key
      await reencryptNotes(masterKey, newRawKey)

      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    // Step 6 — checkpoint WAL so readFileSync gets all committed data
    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    // Step 7 — generate new recovery mnemonic, wrap new key (bind key file when active)
    const mnemonic = generateMnemonic()
    const mnemonicKey = mnemonicToMasterKey(mnemonic)
    const wrapKey = deriveRecoveryWrapKey(
      mnemonicKey,
      currentSidecar.hasKeyFile ? keyFileContents : undefined
    )
    memzero(mnemonicKey)
    const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(newRawKey, wrapKey)
    memzero(wrapKey)

    // Step 8 — write new container to .new, then rename atomically
    const newSidecar: VaultSidecar = {
      ...currentSidecar,
      argon2_salt: Buffer.from(newSalt).toString('hex'),
      recovery_encrypted_master_key: recCipher,
      recovery_nonce: recNonce
    }
    const newContainerPath = currentVaultPath + '.new'
    const dbBytes = readFileSync(tempDbPath)
    writeContainer(newContainerPath, JSON.stringify(newSidecar), dbBytes)
    renameSync(newContainerPath, currentVaultPath)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    // Step 9 — swap masterKey in memory
    const newSecureKey = storeKey(newRawKey) // zeros newRawKey
    freeSecure(masterKey)
    masterKey = newSecureKey
    currentSidecar = newSidecar

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.new')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
    } catch {
      await closeVault()
    }
    throw err
  }
}

export async function rotateVaultCredentials(newPassword: string): Promise<{ mnemonic: string }> {
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  const kfHash = pendingKeyFileContents
    ? hashKeyFile(Buffer.from(pendingKeyFileContents))
    : undefined
  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  const newSalt = generateSalt()
  const newRawKey = deriveKey(newPassword, newSalt, currentSidecar.argon2_params, kfHash)

  // NOTE: hex strings are immutable in V8 and cannot be explicitly zeroed.
  // Unavoidable limitation of the SQLCipher Node.js binding. Becomes unreachable after this scope.
  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')

    try {
      await dbRun(db, `UPDATE vault_meta SET argon2_salt = ? WHERE id = 1`, [Buffer.from(newSalt)])
      await reencryptNotes(masterKey, newRawKey)
      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    const newHasKeyFile = pendingKeyFileContents !== null ? true : currentSidecar.hasKeyFile
    const mnemonic = generateMnemonic()
    const mnemonicKey = mnemonicToMasterKey(mnemonic)
    const wrapKey = deriveRecoveryWrapKey(
      mnemonicKey,
      newHasKeyFile ? (pendingKeyFileContents ?? undefined) : undefined
    )
    memzero(mnemonicKey)
    const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(newRawKey, wrapKey)
    memzero(wrapKey)

    const newSidecar: VaultSidecar = {
      ...currentSidecar,
      argon2_salt: Buffer.from(newSalt).toString('hex'),
      recovery_encrypted_master_key: recCipher,
      recovery_nonce: recNonce,
      hasKeyFile: newHasKeyFile
    }
    const newContainerPath = currentVaultPath + '.new'
    const dbBytes = readFileSync(tempDbPath)
    writeContainer(newContainerPath, JSON.stringify(newSidecar), dbBytes)
    renameSync(newContainerPath, currentVaultPath)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    if (pendingKeyFileContents) {
      memzero(pendingKeyFileContents)
      pendingKeyFileContents = null
    }

    const newSecureKey = storeKey(newRawKey)
    freeSecure(masterKey)
    masterKey = newSecureKey
    currentSidecar = newSidecar

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.new')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
    } catch {
      await closeVault()
    }
    throw err
  }
}

// Repacks the .nvx container from the current temp DB without closing the session.
// Called periodically for crash safety. No-op if vault is closed.
export function syncContainer(): void {
  if (!isVaultOpen()) return
  try {
    packContainer()
  } catch {
    /* don't disrupt the session */
  }
}

export async function closeVault(): Promise<void> {
  if (pendingKeyFileContents) {
    memzero(pendingKeyFileContents)
    pendingKeyFileContents = null
  }
  if (masterKey) {
    freeSecure(masterKey)
    masterKey = null
  }
  if (db) {
    try {
      // SQLCipher also checkpoints on close, but making it explicit avoids any race where
      // readFileSync in packContainer runs before the implicit checkpoint completes.
      await dbRun(db, 'PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* non-fatal — SQLCipher checkpoints implicitly on connection close */
    }
    try {
      await closeDatabase(db)
    } catch {
      /* ignore */
    }
    db = null
  }
  if (tempDbPath && currentVaultPath && currentSidecar) {
    try {
      packContainer()
    } catch {
      /* don't throw on close */
    }
    try {
      unlinkSync(tempDbPath)
    } catch {
      /* ignore */
    }
  }
  currentVaultPath = null
  currentSidecar = null
  tempDbPath = null
  releaseLock()
}

// Returns whether the vault was configured with a key file.
// Reads from the sidecar (no open vault needed) so it works at unlock time.
export function getHasKeyFile(filePath?: string): boolean {
  const path = filePath ?? currentVaultPath ?? getPref('vaultPath')
  if (!path || !vaultExistsAt(path)) return false
  try {
    const { sidecarJson } = readContainer(path)
    const sidecar = JSON.parse(sidecarJson) as VaultSidecar
    return sidecar.hasKeyFile ?? false
  } catch {
    return false
  }
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
// Derives a new master key = Argon2id(password + BLAKE2b(keyFile), newSalt),
// re-encrypts all notes, updates the sidecar, and replaces the in-memory key.
export async function configureKeyFile(
  password: string,
  keyFileContents: Uint8Array
): Promise<{ mnemonic: string }> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  // Verify current credentials via SQLCipher. Pass the existing key file if one is configured.
  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password,
    keyFileContents: currentSidecar.hasKeyFile ? keyFileContents : undefined,
    salt,
    argon2Params: currentSidecar.argon2_params
  })
  if (!auth.valid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Incorrect password or key file')
  }
  auth.masterKey.fill(0) // verified; the live masterKey is already in memory

  const kfHash = hashKeyFile(Buffer.from(keyFileContents))
  const newSalt = generateSalt()
  const newRawKey = deriveKey(password, newSalt, currentSidecar.argon2_params, kfHash)
  // NOTE: hex strings are immutable in V8 and cannot be explicitly zeroed.
  // Unavoidable limitation of the SQLCipher Node.js binding. Becomes unreachable after this scope.
  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')
    try {
      await dbRun(db, 'UPDATE vault_meta SET argon2_salt = ? WHERE id = 1', [Buffer.from(newSalt)])
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
    const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(newRawKey, wrapKey)
    memzero(wrapKey)

    const newSidecar: VaultSidecar = {
      ...currentSidecar,
      argon2_salt: Buffer.from(newSalt).toString('hex'),
      recovery_encrypted_master_key: recCipher,
      recovery_nonce: recNonce,
      hasKeyFile: true
    }
    const newContainerPath = currentVaultPath + '.new'
    const dbBytes = readFileSync(tempDbPath)
    writeContainer(newContainerPath, JSON.stringify(newSidecar), dbBytes)
    renameSync(newContainerPath, currentVaultPath)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    const newSecureKey = storeKey(newRawKey)
    freeSecure(masterKey)
    masterKey = newSecureKey
    currentSidecar = newSidecar

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.new')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
    } catch {
      await closeVault()
    }
    throw err
  }
}

// Remove the key file from the open vault.
// Requires both the current password AND the current key file for verification.
export async function removeKeyFile(
  password: string,
  keyFileContents: Uint8Array
): Promise<{ mnemonic: string }> {
  // Precondition: keyFileContents already validated by readKeyFileContents() in the IPC handler.
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }
  if (!currentSidecar.hasKeyFile) throw new Error('No key file is configured')

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  // Verify current credentials (password + key file) via SQLCipher.
  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password,
    keyFileContents,
    salt,
    argon2Params: currentSidecar.argon2_params
  })
  if (!auth.valid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Incorrect password or key file')
  }
  auth.masterKey.fill(0) // verified; the live masterKey is already in memory

  const newSalt = generateSalt()
  const newRawKey = deriveKey(password, newSalt, currentSidecar.argon2_params)
  // NOTE: hex strings are immutable in V8 and cannot be explicitly zeroed.
  // Unavoidable limitation of the SQLCipher Node.js binding. Becomes unreachable after this scope.
  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')
    try {
      await dbRun(db, 'UPDATE vault_meta SET argon2_salt = ? WHERE id = 1', [Buffer.from(newSalt)])
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
    const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(newRawKey, wrapKey)
    memzero(wrapKey)

    const newSidecar: VaultSidecar = {
      ...currentSidecar,
      argon2_salt: Buffer.from(newSalt).toString('hex'),
      recovery_encrypted_master_key: recCipher,
      recovery_nonce: recNonce,
      hasKeyFile: false
    }
    const newContainerPath = currentVaultPath + '.new'
    const dbBytes = readFileSync(tempDbPath)
    writeContainer(newContainerPath, JSON.stringify(newSidecar), dbBytes)
    renameSync(newContainerPath, currentVaultPath)
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }

    const newSecureKey = storeKey(newRawKey)
    freeSecure(masterKey)
    masterKey = newSecureKey
    currentSidecar = newSidecar

    return { mnemonic }
  } catch (err) {
    try {
      unlinkSync(currentVaultPath + '.new')
    } catch {
      /* ignore */
    }
    try {
      copyFileSync(backupPath, currentVaultPath)
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    try {
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${oldKeyHex}'"`, (e: Error | null) =>
          e ? reject(e) : resolve()
        )
      })
    } catch {
      await closeVault()
    }
    throw err
  }
}
