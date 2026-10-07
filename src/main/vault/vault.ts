/**
 * SQLCipher vault lifecycle. The .nvx container (layout: container.ts) is unpacked to a temp
 * DB in os.tmpdir() for the session and repacked on sync and close. masterKey lives in a
 * page-locked native Buffer (memlock.ts). Every keyFileContents argument has already been
 * validated by readKeyFileContents() in the IPC handler.
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'

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

interface RawNote {
  id: string
  title: Buffer
  title_iv: Buffer
  content: Buffer
  content_iv: Buffer
}

// ─── Concurrency lock ────────────────────────────────────────────────────────

// Serializes every operation on the open vault: packs, closes, credential rotations and the
// note/tag IPC handlers. A rotation rekeys the temp DB several awaits before it swaps
// masterKey; a pack or note write interleaved there would use the stale key and brick the
// vault or the note. FIFO, not coalescing: queued calls may carry different arguments.
//
// Not reentrant: a call from inside the lock waits on its own caller and wedges the queue
// for good, leaving masterKey un-zeroed. Code already inside calls the unlocked do*() bodies
// (doPackContainer, doCloseVault) directly.
//
// fn is wrapped, not passed to .then(): .then() would hand it the predecessor's result,
// which doCloseVault would read as skipPack.
let vaultOpLock: Promise<unknown> = Promise.resolve()
export function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = vaultOpLock.then(() => fn())
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

// Exclusive per-vault lock via a sidecar .lock holding our PID. A lock whose PID is dead,
// or whose file is unreadable, is stale and taken over.
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

// Removes a <vault>.tmp left by a crash mid-atomicWrite(). Never deletes <vault>.bak: older
// versions could leave one behind as the user's only recovery copy.
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
  // SQLCipher's Node binding has no binary PRAGMA path, so the key passes through an immutable
  // JS hex string that can't be zeroed. Same limitation for every PRAGMA rekey below.
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

// Checkpoints the WAL into tempDbPath, then repacks the .nvx from it. The checkpoint is
// required: packing reads only the main file, and small sessions may never auto-checkpoint.
export function packContainer(): Promise<void> {
  return withVaultLock(doPackContainer)
}

async function doPackContainer(): Promise<void> {
  if (!currentVaultPath || !currentMetadata || !tempDbPath || !masterKey) return
  if (db) {
    // A partial checkpoint reports busy=1 instead of throwing; refuse to pack rather than read a
    // possibly under-flushed file.
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
    existingVersionMin: currentMetadata.versionMin,
    devBuild: currentMetadata.devBuild
  })
  atomicWrite(currentVaultPath, bytes)
}

// Derives a candidate key from credentials, verifies the header HMAC (before
// touching SQLCipher), then confirms the key opens the DB. Returns the key on
// success, zeros it on failure. The temp DB at dbPath is always closed on return.
async function authenticateVaultKey(params: {
  dbPath: string
  password: string
  metadata: ContainerMetadata
  keyFileContents?: Uint8Array
}): Promise<{ valid: false } | { valid: true; masterKey: Buffer }> {
  const kfHash = params.keyFileContents
    ? hashKeyFile(Buffer.from(params.keyFileContents))
    : undefined
  const { salt: kdfSalt, params: kdfParams } = getArgon2Params(params.metadata.kdfInput)
  const rawDerived = deriveKey(params.password, kdfSalt, kdfParams, kfHash)
  // Native Buffer copy; the WASM-backed original is zeroed right away.
  const candidateKey = Buffer.from(rawDerived)
  memzero(rawDerived)

  // HMAC check: wrong password → mismatch → reject immediately, no SQLCipher needed
  if (
    !verifyHeaderHmac(params.metadata.hmacCoveredBytes, params.metadata.storedHmac, candidateKey)
  ) {
    memzero(candidateKey)
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
    memzero(candidateKey)
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

export async function createVault(
  filePath: string,
  password: string,
  devBuild = false
): Promise<CreateVaultResult> {
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
    dbBytes,
    devBuild
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
    if (auth?.valid) memzero(auth.masterKey)
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
  await initSodium()

  if (!existsSync(filePath)) throw new Error('Vault not found at the specified location.')
  if (!validateMnemonic(mnemonic)) return null

  const fileBytes = readFileSync(filePath)
  const metadata = readContainer(fileBytes)

  cleanupOrphanedTempFiles(filePath)
  acquireLock(filePath)

  // The wrap key also binds the key file when one is configured (deriveRecoveryWrapKey()); a
  // wrong mnemonic or key file fails the AEAD tag and returns null.
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
      try {
        await closeDatabase(database)
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(tmp)
      } catch {
        /* ignore */
      }
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

// Failure path shared by the 4 credential rotations. Precondition: vaultPath hasn't been
// written yet (commitRotatedContainer() is the last statement of each rollback try), so the
// container on disk is intact. The temp DB isn't: past reencryptNotes()'s COMMIT its notes
// are under the discarded new key. So the session closes WITHOUT packing and the user unlocks
// again; callers pack pending writes before mutating, so nothing is lost.
// doCloseVault(), not closeVault(): this runs inside withVaultLock.
async function rollbackCredentialRotation(vaultPath: string): Promise<void> {
  try {
    unlinkSync(vaultPath + '.tmp')
  } catch {
    /* ignore */
  }
  await doCloseVault(true)
}

// Frees a secure buffer, falling back to a plain wipe if releasing the
// memory lock throws — for the spots where a failure must not propagate.
function freeSecureOrWipe(buf: Buffer): void {
  try {
    freeSecure(buf)
  } catch {
    buf.fill(0)
  }
}

// The rotations' point of no return. Everything that can fail (parsing the new container,
// allocating the new secure key, the write itself) runs before vaultPath changes, so a failure
// still meets rollbackCredentialRotation()'s precondition; after atomicWrite nothing throws.
// Metadata is re-read from containerBytes, not patched, so a second rotation in the same
// session authenticates against the new header HMAC.
function commitRotatedContainer(
  vaultPath: string,
  containerBytes: Buffer,
  newRawKey: Uint8Array
): void {
  const newMetadata = readContainer(containerBytes)
  const newSecureKey = storeKey(newRawKey) // zeros newRawKey
  try {
    atomicWrite(vaultPath, containerBytes)
  } catch (err) {
    freeSecureOrWipe(newSecureKey)
    throw err
  }

  currentMetadata = newMetadata
  const oldKey = masterKey
  masterKey = newSecureKey
  if (oldKey) freeSecureOrWipe(oldKey)
}

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

  // Pack pending writes first: a failed rotation closes without packing.
  await doPackContainer()

  // Step 1 — verify current credentials. Pass key file only if the vault has one.
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password: currentPassword,
    metadata: currentMetadata,
    keyFileContents: currentHasKeyFile ? keyFileContents : undefined
  })
  if (!auth.valid) {
    throw new Error('Current password is incorrect')
  }
  memzero(auth.masterKey) // verified; the live masterKey is already in memory

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

  const newHexBuf = Buffer.from(newRawKey)
  const newHex = newHexBuf.toString('hex')
  memzero(newHexBuf)

  try {
    try {
      // Step 3 — re-key in-place, inside the rollback try (see rollbackCredentialRotation()).
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) =>
          err ? reject(err) : resolve()
        )
      })

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
      const containerMasterKey = Buffer.from(newRawKey)
      let containerBytes: Buffer
      try {
        containerBytes = writeContainer({
          masterKey: containerMasterKey,
          salt: newSalt,
          kdfTier: currentMetadata.kdfInput.kdfTier,
          recoveryBlob: newRecoveryBlob,
          dbBytes,
          existingVersionMin: currentMetadata.versionMin,
          devBuild: currentMetadata.devBuild
        })
      } finally {
        memzero(containerMasterKey)
      }
      commitRotatedContainer(currentVaultPath, containerBytes, newRawKey)

      return { mnemonic }
    } catch (err) {
      await rollbackCredentialRotation(currentVaultPath)
      throw err
    }
  } finally {
    memzero(newRawKey) // no-op if storeKey() already zeroed it on the success path
  }
}

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
  // Pack pending writes first: a failed rotation closes without packing.
  await doPackContainer()

  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(newPassword, newSalt, newKdfParams, kfHash)

  const newHexBuf = Buffer.from(newRawKey)
  const newHex = newHexBuf.toString('hex')
  memzero(newHexBuf)

  try {
    try {
      // Re-key in-place, inside the rollback try (see rollbackCredentialRotation()).
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) =>
          err ? reject(err) : resolve()
        )
      })

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
      const containerMasterKey = Buffer.from(newRawKey)
      let containerBytes: Buffer
      try {
        containerBytes = writeContainer({
          masterKey: containerMasterKey,
          salt: newSalt,
          kdfTier: currentMetadata.kdfInput.kdfTier,
          recoveryBlob: newRecoveryBlob,
          dbBytes,
          existingVersionMin: currentMetadata.versionMin,
          devBuild: currentMetadata.devBuild
        })
      } finally {
        memzero(containerMasterKey)
      }
      currentHasKeyFile = newHasKeyFile
      if (pendingKeyFileContents) {
        memzero(pendingKeyFileContents)
        pendingKeyFileContents = null
      }
      commitRotatedContainer(currentVaultPath, containerBytes, newRawKey)

      return { mnemonic }
    } catch (err) {
      await rollbackCredentialRotation(currentVaultPath)
      throw err
    }
  } finally {
    memzero(newRawKey) // no-op if storeKey() already zeroed it on the success path
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

// Never throws on a failed pack: resolves { packFailed } so the caller can warn the user.
export function closeVault(): Promise<{ packFailed: boolean }> {
  return withVaultLock(doCloseVault)
}

// skipPack: only rollbackCredentialRotation() passes true; packing then would overwrite the
// intact container with an unreadable one (see its comment).
async function doCloseVault(skipPack = false): Promise<{ packFailed: boolean }> {
  let packFailed = false
  // Pack while db is still open so the checkpoint runs through it. doPackContainer(), not
  // packContainer(): already inside withVaultLock.
  if (!skipPack && tempDbPath && currentVaultPath && currentMetadata) {
    try {
      await doPackContainer()
    } catch (e) {
      // Don't throw on close, not even from here: the key wipe and lock release
      // below depend on it. Log the error code only: fs messages embed the
      // vault path (username, location, file name), which must not leak to stdout.
      const tag = e instanceof Error ? ((e as NodeJS.ErrnoException).code ?? e.name) : typeof e
      console.error('[close] pack failed:', tag)
      packFailed = true
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
    freeSecureOrWipe(masterKey)
    masterKey = null
  }
  currentVaultPath = null
  currentMetadata = null
  currentHasKeyFile = false
  tempDbPath = null
  releaseLock()
  return { packFailed }
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
  if (!isVaultOpen() || !db || !masterKey || !currentMetadata || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  // Pack pending writes first: a failed rotation closes without packing.
  await doPackContainer()

  // Verify current credentials. Pass current key file only if one is already configured.
  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password,
    metadata: currentMetadata,
    keyFileContents: currentHasKeyFile ? keyFileContents : undefined
  })
  if (!auth.valid) {
    throw new Error('Incorrect password or key file')
  }
  memzero(auth.masterKey)

  const kfHash = hashKeyFile(Buffer.from(keyFileContents))
  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(password, newSalt, newKdfParams, kfHash)

  const newHexBuf = Buffer.from(newRawKey)
  const newHex = newHexBuf.toString('hex')
  memzero(newHexBuf)

  try {
    try {
      // Re-key in-place, inside the rollback try (see rollbackCredentialRotation()).
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) =>
          err ? reject(err) : resolve()
        )
      })

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
      const containerMasterKey = Buffer.from(newRawKey)
      let containerBytes: Buffer
      try {
        containerBytes = writeContainer({
          masterKey: containerMasterKey,
          salt: newSalt,
          kdfTier: currentMetadata.kdfInput.kdfTier,
          recoveryBlob: newRecoveryBlob,
          dbBytes,
          existingVersionMin: currentMetadata.versionMin,
          devBuild: currentMetadata.devBuild
        })
      } finally {
        memzero(containerMasterKey)
      }
      currentHasKeyFile = true
      commitRotatedContainer(currentVaultPath, containerBytes, newRawKey)

      return { mnemonic }
    } catch (err) {
      await rollbackCredentialRotation(currentVaultPath)
      throw err
    }
  } finally {
    memzero(newRawKey) // no-op if storeKey() already zeroed it on the success path
  }
}

// Remove the key file from the open vault. Requires the current password + key file.
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
  if (!isVaultOpen() || !db || !masterKey || !currentMetadata || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }
  if (!currentHasKeyFile) {
    throw new Error('No key file is configured for this vault')
  }

  // Pack pending writes first: a failed rotation closes without packing.
  await doPackContainer()

  const auth = await authenticateVaultKey({
    dbPath: tempDbPath,
    password,
    metadata: currentMetadata,
    keyFileContents
  })
  if (!auth.valid) {
    throw new Error('Incorrect password or key file')
  }
  memzero(auth.masterKey)

  const newSalt = Buffer.from(generateSalt())
  const newKdfInput: KdfInputV1 = {
    version: 1,
    salt: newSalt,
    kdfTier: currentMetadata.kdfInput.kdfTier
  }
  const { params: newKdfParams } = getArgon2Params(newKdfInput)
  const newRawKey = deriveKey(password, newSalt, newKdfParams)

  const newHexBuf = Buffer.from(newRawKey)
  const newHex = newHexBuf.toString('hex')
  memzero(newHexBuf)

  try {
    try {
      // Re-key in-place, inside the rollback try (see rollbackCredentialRotation()).
      await new Promise<void>((resolve, reject) => {
        db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) =>
          err ? reject(err) : resolve()
        )
      })

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
      const containerMasterKey = Buffer.from(newRawKey)
      let containerBytes: Buffer
      try {
        containerBytes = writeContainer({
          masterKey: containerMasterKey,
          salt: newSalt,
          kdfTier: currentMetadata.kdfInput.kdfTier,
          recoveryBlob: newRecoveryBlob,
          dbBytes,
          existingVersionMin: currentMetadata.versionMin,
          devBuild: currentMetadata.devBuild
        })
      } finally {
        memzero(containerMasterKey)
      }
      currentHasKeyFile = false
      commitRotatedContainer(currentVaultPath, containerBytes, newRawKey)

      return { mnemonic }
    } catch (err) {
      await rollbackCredentialRotation(currentVaultPath)
      throw err
    }
  } finally {
    memzero(newRawKey) // no-op if storeKey() already zeroed it on the success path
  }
}
