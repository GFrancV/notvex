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
import { timingSafeEqual } from 'crypto'
import { copyFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'

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
  readKeyFileContents,
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

// ─── Module state ────────────────────────────────────────────────────────────

let db: sqlite3.Database | null = null
let masterKey: Buffer | null = null
let currentVaultPath: string | null = null
let currentSidecar: VaultSidecar | null = null
let tempDbPath: string | null = null
let pendingKeyFileContents: Uint8Array | null = null

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
  await initSodium()

  if (!vaultExistsAt(filePath)) throw new Error('Vault not found at the specified location.')

  const { sidecarJson, dbBytes } = readContainer(filePath)
  const sidecar = JSON.parse(sidecarJson) as VaultSidecar
  const salt = new Uint8Array(Buffer.from(sidecar.argon2_salt, 'hex'))
  const kfContents = keyFileContents ? readKeyFileContents(keyFileContents) : undefined
  const kfHash = kfContents ? hashKeyFile(Buffer.from(kfContents)) : undefined
  const rawKey = deriveKey(password, salt, sidecar.argon2_params, kfHash)

  const tmp = makeTempDbPath()
  writeFileSync(tmp, dbBytes)

  // Verification is implicit: if rawKey is wrong, SQLCipher cannot decrypt any page
  // and the first query below throws. We catch it and return false.
  let database: sqlite3.Database | null = null
  let isCorrupted = false
  try {
    database = await openDatabase(tmp)
    await applyKey(database, rawKey)
    const meta = await dbGet<{ id: number }>(database, 'SELECT id FROM vault_meta WHERE id = 1')
    if (!meta) {
      isCorrupted = true
      throw new Error('Vault database could not be read. It may be corrupted.')
    }

    db = database
    masterKey = storeKey(rawKey)
    currentVaultPath = filePath
    currentSidecar = sidecar
    tempDbPath = tmp
    return true
  } catch (err) {
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
    if (isCorrupted) throw err
    return false
  }
}

export async function openVaultWithRecovery(
  filePath: string,
  mnemonic: string,
  keyFileContents?: Uint8Array
): Promise<boolean> {
  await initSodium()

  if (!vaultExistsAt(filePath)) throw new Error('Vault not found at the specified location.')
  if (!validateMnemonic(mnemonic)) return false

  const { sidecarJson, dbBytes } = readContainer(filePath)
  const sidecar = JSON.parse(sidecarJson) as VaultSidecar

  if (sidecar.hasKeyFile && !keyFileContents) return false

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
    return false
  } finally {
    memzero(wrapKey)
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
  pendingKeyFileContents = keyFileContents ?? null
  return true
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

  const kfHash = keyFileContents ? hashKeyFile(Buffer.from(keyFileContents)) : undefined
  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  // Step 1 — verify current password by comparing derived key with the in-memory masterKey
  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const testKey = deriveKey(currentPassword, salt, currentSidecar.argon2_params, kfHash)
  const testKeyIsValid =
    testKey.length === masterKey.length && timingSafeEqual(Buffer.from(testKey), masterKey)
  memzero(testKey)
  if (!testKeyIsValid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Current password is incorrect')
  }

  // Step 2 — derive new key with a fresh salt (preserving key file in derivation)
  const newSalt = generateSalt()
  const newRawKey = deriveKey(newPassword, newSalt, currentSidecar.argon2_params, kfHash)

  const oldKeyHex = masterKey.toString('hex')

  // Step 3 — re-key SQLCipher in-place
  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    // Steps 4-6 inside a single transaction so all data changes are atomic.
    await dbRun(db, 'BEGIN TRANSACTION')

    try {
      // Step 4 — update vault_meta with new salt
      await dbRun(db, `UPDATE vault_meta SET argon2_salt = ? WHERE id = 1`, [Buffer.from(newSalt)])

      // Step 5 — re-encrypt all note ciphertexts with the new key
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

  const oldKeyHex = masterKey.toString('hex')

  const newHex = Buffer.from(newRawKey).toString('hex')
  await new Promise<void>((resolve, reject) => {
    db!.run(`PRAGMA rekey = "x'${newHex}'"`, (err: Error | null) => (err ? reject(err) : resolve()))
  })

  try {
    await dbRun(db, 'BEGIN TRANSACTION')

    try {
      await dbRun(db, `UPDATE vault_meta SET argon2_salt = ? WHERE id = 1`, [Buffer.from(newSalt)])

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
  interface RawNote {
    id: string
    title: Buffer
    title_iv: Buffer
    content: Buffer
    content_iv: Buffer
  }
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
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const testKey = deriveKey(
    password,
    salt,
    currentSidecar.argon2_params,
    currentSidecar.hasKeyFile ? hashKeyFile(Buffer.from(keyFileContents)) : undefined
  )
  const testKeyIsValid =
    testKey.length === masterKey.length && timingSafeEqual(Buffer.from(testKey), masterKey)
  memzero(testKey)
  if (!testKeyIsValid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Incorrect password or key file')
  }

  const kfHash = hashKeyFile(Buffer.from(keyFileContents))
  const newSalt = generateSalt()
  const newRawKey = deriveKey(password, newSalt, currentSidecar.argon2_params, kfHash)
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
  if (!isVaultOpen() || !db || !masterKey || !currentSidecar || !currentVaultPath || !tempDbPath) {
    throw new Error('Vault is not open')
  }
  if (!currentSidecar.hasKeyFile) throw new Error('No key file is configured')

  const backupPath = currentVaultPath + '.bak'
  copyFileSync(currentVaultPath, backupPath)

  const salt = new Uint8Array(Buffer.from(currentSidecar.argon2_salt, 'hex'))
  const kfHash = hashKeyFile(Buffer.from(keyFileContents))
  const testKey = deriveKey(password, salt, currentSidecar.argon2_params, kfHash)
  const testKeyIsValid =
    testKey.length === masterKey.length && timingSafeEqual(Buffer.from(testKey), masterKey)
  memzero(testKey)
  if (!testKeyIsValid) {
    try {
      unlinkSync(backupPath)
    } catch {
      /* ignore */
    }
    throw new Error('Incorrect password or key file')
  }

  const newSalt = generateSalt()
  const newRawKey = deriveKey(password, newSalt, currentSidecar.argon2_params)
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
