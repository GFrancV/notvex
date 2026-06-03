/**
 * vault.ts — SQLCipher vault lifecycle
 *
 * Bootstrap data lives in a sidecar `notvex.json` alongside `notvex.db`:
 * - argon2_salt + params: needed to re-derive the master key from the password
 * - verify_hash: BLAKE2b(masterKey) — lets us validate the password quickly
 * - recovery_encrypted_master_key / recovery_nonce: masterKey encrypted with
 *   the recovery-derived key, so the mnemonic can recover access
 *
 * The SQLCipher PRAGMA key is always the password-derived master key.
 * Recovery decrypts that same master key from the sidecar, not a separate key.
 */
import sqlcipher from '@journeyapps/sqlcipher'
import type sqlite3 from '@journeyapps/sqlcipher'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import {
  initSodium,
  generateSalt,
  deriveKey,
  hashForVerify,
  encryptField,
  decryptField,
  memzero,
  DEFAULT_ARGON2_PARAMS,
  type Argon2Params,
} from './crypto'
import { generateMnemonic, mnemonicToMasterKey, validateMnemonic } from './recovery'
import { runMigrations } from '../db/migrations'
import { dbRun, dbGet } from '../db/queries'

// ─── Sidecar schema ──────────────────────────────────────────────────────────

interface VaultSidecar {
  version: number
  argon2_salt: string        // hex
  argon2_params: Argon2Params
  verify_hash: string        // hex: BLAKE2b(masterKey)
  recovery_encrypted_master_key: string  // hex
  recovery_nonce: string     // hex
  yubikey_challenge?: string // hex (set if YubiKey is configured)
  yubikey_encrypted_master_key?: string
  yubikey_nonce?: string
}

// ─── Module state ────────────────────────────────────────────────────────────

let db: sqlite3.Database | null = null
let masterKey: Uint8Array | null = null
let currentVaultDir: string | null = null

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sidecarPath(dir: string): string {
  return join(dir, 'notvex.json')
}

function dbFilePath(dir: string): string {
  return join(dir, 'notvex.db')
}

function readSidecar(dir: string): VaultSidecar {
  const raw = readFileSync(sidecarPath(dir), 'utf8')
  return JSON.parse(raw) as VaultSidecar
}

function writeSidecar(dir: string, data: VaultSidecar): void {
  writeFileSync(sidecarPath(dir), JSON.stringify(data, null, 2))
}

function openDatabase(path: string): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const database = new (sqlcipher as unknown as typeof sqlite3).Database(path, (err) => {
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
  const hex = Buffer.from(key).toString('hex')
  await new Promise<void>((resolve, reject) => {
    database.serialize(() => {
      database.run(`PRAGMA key = "x'${hex}'"`, (err: Error | null) =>
        err ? reject(err) : resolve(),
      )
    })
  })
}

function encryptMasterKey(
  masterKeyBuf: Uint8Array,
  wrapKey: Uint8Array,
): { ciphertext: string; nonce: string } {
  const { ciphertext, nonce } = encryptField(
    Buffer.from(masterKeyBuf).toString('hex'),
    wrapKey,
  )
  return {
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    nonce: Buffer.from(nonce).toString('hex'),
  }
}

function decryptMasterKey(
  ciphertextHex: string,
  nonceHex: string,
  wrapKey: Uint8Array,
): Uint8Array {
  const hex = decryptField(
    new Uint8Array(Buffer.from(ciphertextHex, 'hex')),
    new Uint8Array(Buffer.from(nonceHex, 'hex')),
    wrapKey,
  )
  return new Uint8Array(Buffer.from(hex, 'hex'))
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

export function getVaultDir(): string | null {
  return currentVaultDir
}

export function vaultExistsAt(dir: string): boolean {
  return existsSync(dbFilePath(dir)) && existsSync(sidecarPath(dir))
}

export interface CreateVaultResult {
  mnemonic: string
}

export async function createVault(dir: string, password: string): Promise<CreateVaultResult> {
  await initSodium()

  if (vaultExistsAt(dir)) {
    throw new Error('A vault already exists at this location.')
  }

  // Derive master key from password
  const salt = generateSalt()
  const params = DEFAULT_ARGON2_PARAMS
  const key = deriveKey(password, salt, params)

  // Create and key the SQLCipher database
  const database = await openDatabase(dbFilePath(dir))
  await applyKey(database, key)
  await runMigrations(database)

  // Insert vault_meta row for version tracking
  await dbRun(database, `
    INSERT INTO vault_meta (id, version, argon2_salt, argon2_params, verify_hash, recovery_verify_hash, yubikey_slot, created_at)
    VALUES (1, 1, ?, ?, ?, '', NULL, ?)`,
    [Buffer.from(salt), JSON.stringify(params), hashForVerify(key), Date.now()],
  )

  // Generate recovery mnemonic and wrap the master key with it
  const mnemonic = generateMnemonic()
  const recoveryKey = mnemonicToMasterKey(mnemonic)
  const { ciphertext: recCipher, nonce: recNonce } = encryptMasterKey(key, recoveryKey)
  memzero(recoveryKey)

  // Write sidecar (bootstrap data — not sensitive, salt is public by design)
  const sidecar: VaultSidecar = {
    version: 1,
    argon2_salt: Buffer.from(salt).toString('hex'),
    argon2_params: params,
    verify_hash: hashForVerify(key),
    recovery_encrypted_master_key: recCipher,
    recovery_nonce: recNonce,
  }
  writeSidecar(dir, sidecar)

  db = database
  masterKey = key
  currentVaultDir = dir

  return { mnemonic }
}

export async function openVault(dir: string, password: string): Promise<boolean> {
  await initSodium()

  if (!vaultExistsAt(dir)) throw new Error('Vault not found at the specified location.')

  const sidecar = readSidecar(dir)
  const salt = new Uint8Array(Buffer.from(sidecar.argon2_salt, 'hex'))
  const key = deriveKey(password, salt, sidecar.argon2_params)

  if (hashForVerify(key) !== sidecar.verify_hash) {
    memzero(key)
    return false
  }

  const database = await openDatabase(dbFilePath(dir))
  await applyKey(database, key)

  // Sanity check: make sure the DB is readable with this key
  const meta = await dbGet<{ id: number }>(database, 'SELECT id FROM vault_meta WHERE id = 1')
  if (!meta) {
    await closeDatabase(database)
    memzero(key)
    throw new Error('Vault database could not be read. It may be corrupted.')
  }

  db = database
  masterKey = key
  currentVaultDir = dir
  return true
}

export async function openVaultWithRecovery(dir: string, mnemonic: string): Promise<boolean> {
  await initSodium()

  if (!vaultExistsAt(dir)) throw new Error('Vault not found at the specified location.')
  if (!validateMnemonic(mnemonic)) return false

  const sidecar = readSidecar(dir)
  const recoveryKey = mnemonicToMasterKey(mnemonic)

  let key: Uint8Array
  try {
    key = decryptMasterKey(
      sidecar.recovery_encrypted_master_key,
      sidecar.recovery_nonce,
      recoveryKey,
    )
  } catch {
    memzero(recoveryKey)
    return false
  } finally {
    memzero(recoveryKey)
  }

  const database = await openDatabase(dbFilePath(dir))
  await applyKey(database, key)

  const meta = await dbGet<{ id: number }>(database, 'SELECT id FROM vault_meta WHERE id = 1')
  if (!meta) {
    await closeDatabase(database)
    memzero(key)
    return false
  }

  db = database
  masterKey = key
  currentVaultDir = dir
  return true
}

export async function closeVault(): Promise<void> {
  if (masterKey) { memzero(masterKey); masterKey = null }
  if (db) {
    try { await closeDatabase(db) } catch { /* ignore */ }
    db = null
  }
  currentVaultDir = null
}
