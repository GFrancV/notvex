/**
 * vault.ts — SQLCipher vault lifecycle
 *
 * The vault is stored as a single opaque .nvx file (see container.ts):
 *   [4B magic "NVEX"][2B version][4B sidecar length][sidecar JSON][SQLCipher DB bytes]
 *
 * At runtime the DB bytes are extracted to a temporary file and opened with
 * SQLCipher. On close the temp file is repacked into the .nvx container then
 * deleted. The sidecar (plaintext) holds the Argon2id salt, params, verify hash,
 * and the recovery-wrapped master key — everything needed to re-derive or recover
 * the master key without access to the encrypted DB.
 *
 * Memory security:
 * - masterKey lives in a native Buffer (outside V8 GC heap) locked with
 *   VirtualLock/mlock so the OS cannot page it to disk.
 * - All intermediate key copies are zeroed immediately after use.
 */
import { readFileSync, unlinkSync, writeFileSync } from 'fs'

import type sqlite3 from '@journeyapps/sqlcipher'
import sqlcipher from '@journeyapps/sqlcipher'

import { runMigrations } from '../db/migrations'
import { dbAll, dbGet, dbRun } from '../db/queries'

import { isNotvexContainer, makeTempDbPath, readContainer, writeContainer } from './container'
import {
  calibrateArgon2id,
  decryptField,
  deriveKey,
  encryptField,
  generateSalt,
  hashForVerify,
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
  verify_hash: string
  recovery_encrypted_master_key: string
  recovery_nonce: string
}

// ─── Module state ────────────────────────────────────────────────────────────

let db: sqlite3.Database | null = null
let masterKey: Buffer | null = null
let currentVaultPath: string | null = null
let currentSidecar: VaultSidecar | null = null
let tempDbPath: string | null = null

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
  const { ciphertext, nonce } = encryptField(Buffer.from(masterKeyBuf).toString('hex'), wrapKey)
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
  const hex = decryptField(
    new Uint8Array(Buffer.from(ciphertextHex, 'hex')),
    new Uint8Array(Buffer.from(nonceHex, 'hex')),
    wrapKey
  )
  return new Uint8Array(Buffer.from(hex, 'hex'))
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

  if (vaultExistsAt(filePath)) {
    throw new Error('A vault already exists at this location.')
  }

  // Calibrate Argon2id to ~1.5s on this hardware (only runs at vault creation).
  // The result is stored in the sidecar so future unlocks use the same params.
  const params = calibrateArgon2id(1500)
  const salt = generateSalt()
  const rawKey = deriveKey(password, salt, params)
  const verifyHash = hashForVerify(rawKey)

  // Build the DB in a temp file
  const tmp = makeTempDbPath()
  const database = await openDatabase(tmp)
  await applyKey(database, rawKey)
  await runMigrations(database)

  await dbRun(
    database,
    `
    INSERT INTO vault_meta (id, version, argon2_salt, argon2_params, verify_hash, recovery_verify_hash, created_at)
    VALUES (1, 1, ?, ?, ?, '', ?)`,
    [Buffer.from(salt), JSON.stringify(params), verifyHash, Date.now()]
  )

  const mnemonic = generateMnemonic()
  const recoveryKey = mnemonicToMasterKey(mnemonic)
  const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(rawKey, recoveryKey)
  memzero(recoveryKey)

  // Close DB to flush all pages to the temp file, then pack the .nvx container
  await closeDatabase(database)
  const dbBytes = readFileSync(tmp)

  const sidecar: VaultSidecar = {
    version: 1,
    argon2_salt: Buffer.from(salt).toString('hex'),
    argon2_params: params,
    verify_hash: verifyHash,
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

export async function openVault(filePath: string, password: string): Promise<boolean> {
  await initSodium()

  if (!vaultExistsAt(filePath)) throw new Error('Vault not found at the specified location.')

  const { sidecarJson, dbBytes } = readContainer(filePath)
  const sidecar = JSON.parse(sidecarJson) as VaultSidecar
  const salt = new Uint8Array(Buffer.from(sidecar.argon2_salt, 'hex'))
  const rawKey = deriveKey(password, salt, sidecar.argon2_params)

  if (hashForVerify(rawKey) !== sidecar.verify_hash) {
    memzero(rawKey)
    return false
  }

  const tmp = makeTempDbPath()
  writeFileSync(tmp, dbBytes)

  const database = await openDatabase(tmp)
  await applyKey(database, rawKey)

  const meta = await dbGet<{ id: number }>(database, 'SELECT id FROM vault_meta WHERE id = 1')
  if (!meta) {
    await closeDatabase(database)
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    memzero(rawKey)
    throw new Error('Vault database could not be read. It may be corrupted.')
  }

  db = database
  masterKey = storeKey(rawKey)
  currentVaultPath = filePath
  currentSidecar = sidecar
  tempDbPath = tmp
  return true
}

export async function openVaultWithRecovery(filePath: string, mnemonic: string): Promise<boolean> {
  await initSodium()

  if (!vaultExistsAt(filePath)) throw new Error('Vault not found at the specified location.')
  if (!validateMnemonic(mnemonic)) return false

  const { sidecarJson, dbBytes } = readContainer(filePath)
  const sidecar = JSON.parse(sidecarJson) as VaultSidecar
  const recoveryKey = mnemonicToMasterKey(mnemonic)

  let rawKey: Uint8Array
  try {
    rawKey = decryptMasterKey(
      sidecar.recovery_encrypted_master_key,
      sidecar.recovery_nonce,
      recoveryKey
    )
  } catch {
    memzero(recoveryKey)
    return false
  } finally {
    memzero(recoveryKey)
  }

  const tmp = makeTempDbPath()
  writeFileSync(tmp, dbBytes)

  const database = await openDatabase(tmp)
  await applyKey(database, rawKey)

  const meta = await dbGet<{ id: number }>(database, 'SELECT id FROM vault_meta WHERE id = 1')
  if (!meta) {
    await closeDatabase(database)
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    rawKey.fill(0)
    return false
  }

  db = database
  masterKey = storeKey(rawKey)
  currentVaultPath = filePath
  currentSidecar = sidecar
  tempDbPath = tmp
  return true
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ mnemonic: string }> {
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  // Step 1 — verify current password
  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const testKey = deriveKey(currentPassword, salt, currentSidecar.argon2_params)
  if (hashForVerify(testKey) !== currentSidecar.verify_hash) {
    memzero(testKey)
    throw new Error('Current password is incorrect')
  }
  memzero(testKey)

  // Step 2 — derive new key with a fresh salt
  const newSalt = generateSalt()
  const newRawKey = deriveKey(newPassword, newSalt, currentSidecar.argon2_params)
  const newVerifyHash = hashForVerify(newRawKey)

  // Capture old key hex for rollback if steps after rekey fail
  const oldKeyHex = masterKey.toString('hex')

  // Step 3 — re-key SQLCipher in-place
  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    // Steps 4-6 inside a single transaction so all data changes are atomic.
    // If anything fails the DB rolls back to pre-transaction state; we then
    // restore the SQLCipher key via a second PRAGMA rekey.
    await dbRun(db, 'BEGIN TRANSACTION')

    try {
      // Step 4 — update vault_meta with new salt and verify hash
      await dbRun(db, `UPDATE vault_meta SET argon2_salt = ?, verify_hash = ? WHERE id = 1`, [
        Buffer.from(newSalt),
        newVerifyHash
      ])

      // Step 5 — re-encrypt all note ciphertexts with the new key.
      // PRAGMA rekey re-encrypted the SQLCipher pages, but title/content are
      // application-level XChaCha20 ciphertexts that still use the old masterKey.
      // They must be decrypted with the old key and re-encrypted with the new one.
      interface RawNote {
        id: string
        title: Buffer
        title_iv: Buffer
        content: Buffer
        content_iv: Buffer
      }
      const notes = await dbAll<RawNote>(
        db,
        'SELECT id, title, title_iv, content, content_iv FROM notes',
        []
      )

      for (const note of notes) {
        const titlePlain = decryptField(
          new Uint8Array(note.title),
          new Uint8Array(note.title_iv),
          masterKey
        )
        const contentPlain = decryptField(
          new Uint8Array(note.content),
          new Uint8Array(note.content_iv),
          masterKey
        )

        const { ciphertext: newTitle, nonce: newTitleIv } = encryptField(titlePlain, newRawKey)
        const { ciphertext: newContent, nonce: newContentIv } = encryptField(
          contentPlain,
          newRawKey
        )

        await dbRun(
          db,
          `UPDATE notes SET title = ?, title_iv = ?, content = ?, content_iv = ? WHERE id = ?`,
          [
            Buffer.from(newTitle),
            Buffer.from(newTitleIv),
            Buffer.from(newContent),
            Buffer.from(newContentIv),
            note.id
          ]
        )
      }

      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    // Step 6 — checkpoint WAL so readFileSync gets all committed data
    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    // Step 7 — generate new recovery mnemonic, wrap new key
    const mnemonic = generateMnemonic()
    const recoveryKey = mnemonicToMasterKey(mnemonic)
    const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(newRawKey, recoveryKey)
    memzero(recoveryKey)

    // Step 8 — repack container atomically
    const newSidecar: VaultSidecar = {
      ...currentSidecar,
      argon2_salt: Buffer.from(newSalt).toString('hex'),
      verify_hash: newVerifyHash,
      recovery_encrypted_master_key: recCipher,
      recovery_nonce: recNonce
    }
    const dbBytes = readFileSync(tempDbPath)
    writeContainer(currentVaultPath, JSON.stringify(newSidecar), dbBytes)

    // Step 9 — swap masterKey in memory
    const newSecureKey = storeKey(newRawKey) // zeros newRawKey
    freeSecure(masterKey)
    masterKey = newSecureKey
    currentSidecar = newSidecar

    return { mnemonic }
  } catch (err) {
    // Data changes rolled back by ROLLBACK above (if inside transaction).
    // Restore the SQLCipher key so the on-disk container (still old key) remains openable.
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

  const newSalt = generateSalt()
  const newRawKey = deriveKey(newPassword, newSalt, currentSidecar.argon2_params)
  const newVerifyHash = hashForVerify(newRawKey)

  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')

    try {
      await dbRun(db, `UPDATE vault_meta SET argon2_salt = ?, verify_hash = ? WHERE id = 1`, [
        Buffer.from(newSalt),
        newVerifyHash
      ])

      interface RawNote {
        id: string
        title: Buffer
        title_iv: Buffer
        content: Buffer
        content_iv: Buffer
      }
      const notes = await dbAll<RawNote>(
        db,
        'SELECT id, title, title_iv, content, content_iv FROM notes',
        []
      )

      for (const note of notes) {
        const titlePlain = decryptField(
          new Uint8Array(note.title),
          new Uint8Array(note.title_iv),
          masterKey
        )
        const contentPlain = decryptField(
          new Uint8Array(note.content),
          new Uint8Array(note.content_iv),
          masterKey
        )

        const { ciphertext: newTitle, nonce: newTitleIv } = encryptField(titlePlain, newRawKey)
        const { ciphertext: newContent, nonce: newContentIv } = encryptField(
          contentPlain,
          newRawKey
        )

        await dbRun(
          db,
          `UPDATE notes SET title = ?, title_iv = ?, content = ?, content_iv = ? WHERE id = ?`,
          [
            Buffer.from(newTitle),
            Buffer.from(newTitleIv),
            Buffer.from(newContent),
            Buffer.from(newContentIv),
            note.id
          ]
        )
      }

      await dbRun(db, 'COMMIT')
    } catch (txErr) {
      await dbRun(db, 'ROLLBACK').catch(() => {})
      throw txErr
    }

    await dbRun(db, 'PRAGMA wal_checkpoint(FULL)')

    const mnemonic = generateMnemonic()
    const recoveryKey = mnemonicToMasterKey(mnemonic)
    const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(newRawKey, recoveryKey)
    memzero(recoveryKey)

    const newSidecar: VaultSidecar = {
      ...currentSidecar,
      argon2_salt: Buffer.from(newSalt).toString('hex'),
      verify_hash: newVerifyHash,
      recovery_encrypted_master_key: recCipher,
      recovery_nonce: recNonce
    }
    const dbBytes = readFileSync(tempDbPath)
    writeContainer(currentVaultPath, JSON.stringify(newSidecar), dbBytes)

    const newSecureKey = storeKey(newRawKey)
    freeSecure(masterKey)
    masterKey = newSecureKey
    currentSidecar = newSidecar

    return { mnemonic }
  } catch (err) {
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
  if (masterKey) {
    freeSecure(masterKey)
    masterKey = null
  }
  if (db) {
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
}
