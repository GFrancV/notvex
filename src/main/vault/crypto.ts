import { performance } from 'perf_hooks'

import sodium from 'libsodium-wrappers-sumo'

let sodiumReady = false

export async function initSodium(): Promise<void> {
  if (sodiumReady) return
  await sodium.ready
  sodiumReady = true
}

function assertReady(): void {
  if (!sodiumReady) throw new Error('Sodium not initialized — call initSodium() first')
}

export interface Argon2Params {
  memory: number
  iterations: number
  parallelism: number
}

// Ordered highest → lowest security. Stored as an opaque byte in the NVX header —
// the tier number is the only thing written to disk; the params stay private here.
const KDF_TIERS: Readonly<Record<number, Argon2Params>> = {
  1: { memory: 512 * 1024 * 1024, iterations: 4, parallelism: 1 }, // 512 MB / 4 passes
  2: { memory: 512 * 1024 * 1024, iterations: 3, parallelism: 1 }, // 512 MB / 3 passes
  3: { memory: 256 * 1024 * 1024, iterations: 4, parallelism: 1 }, // 256 MB / 4 passes
  4: { memory: 256 * 1024 * 1024, iterations: 3, parallelism: 1 }, // 256 MB / 3 passes  ← current default
  5: { memory: 128 * 1024 * 1024, iterations: 3, parallelism: 1 }, // 128 MB / 3 passes
  6: { memory: 128 * 1024 * 1024, iterations: 2, parallelism: 1 }, // 128 MB / 2 passes
  7: { memory: 64 * 1024 * 1024, iterations: 3, parallelism: 1 }, // 64 MB / 3 passes
  8: { memory: 64 * 1024 * 1024, iterations: 2, parallelism: 1 }, //  64 MB / 2 passes
  9: { memory: 32 * 1024 * 1024, iterations: 3, parallelism: 1 }, // 32 MB / 3 passes
  10: { memory: 32 * 1024 * 1024, iterations: 2, parallelism: 1 } // 64 MB / 2 passes
}

export function isValidKdfTier(tier: number): boolean {
  return Object.prototype.hasOwnProperty.call(KDF_TIERS, tier)
}

export interface KdfInputV1 {
  readonly version: 1
  readonly salt: Buffer
  readonly kdfTier: number
}

export type KdfInput = KdfInputV1

export function getArgon2Params(kdfInput: KdfInput): { salt: Buffer; params: Argon2Params } {
  switch (kdfInput.version) {
    case 1: {
      const params = KDF_TIERS[kdfInput.kdfTier]
      if (!params) throw new Error(`Unknown KDF tier: ${kdfInput.kdfTier}`)
      return { salt: kdfInput.salt, params }
    }
  }
}

export function generateSalt(): Uint8Array {
  assertReady()
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
}

export const KEY_FILE_MAX_BYTES = 1024 * 1024 // 1 MB

export function readKeyFileContents(rawContents: Uint8Array): Uint8Array {
  if (rawContents.byteLength === 0) throw new Error('KEY_FILE_EMPTY')
  if (rawContents.byteLength > KEY_FILE_MAX_BYTES) return rawContents.slice(0, KEY_FILE_MAX_BYTES)
  return rawContents
}

export function hashKeyFile(contents: Buffer): string {
  assertReady()
  const hash = sodium.crypto_generichash(32, contents, new Uint8Array(0))
  return Buffer.from(hash).toString('hex')
}

export function deriveRecoveryWrapKey(
  mnemonicKey: Uint8Array,
  keyFileContents?: Uint8Array
): Uint8Array {
  assertReady()
  if (!keyFileContents) {
    const copy = new Uint8Array(mnemonicKey.length)
    copy.set(mnemonicKey)
    return copy
  }
  // wrapKey = BLAKE2b( mnemonicKey || BLAKE2b(keyFileContents) )
  const kfHash = sodium.crypto_generichash(32, keyFileContents, new Uint8Array(0))
  const combined = new Uint8Array(mnemonicKey.length + kfHash.length)
  combined.set(mnemonicKey)
  combined.set(kfHash, mnemonicKey.length)
  const wrapKey = sodium.crypto_generichash(32, combined, new Uint8Array(0))
  sodium.memzero(kfHash)
  sodium.memzero(combined)
  return wrapKey
}

export function deriveKey(
  password: string,
  salt: Uint8Array,
  params: Argon2Params,
  keyFileHash?: string
): Uint8Array {
  assertReady()
  const input = keyFileHash ? password + keyFileHash : password
  return sodium.crypto_pwhash(
    32,
    input,
    salt,
    params.iterations,
    params.memory,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  )
}

export interface EncryptedField {
  ciphertext: Uint8Array
  nonce: Uint8Array
}

export function encryptField(plaintext: string, masterKey: Uint8Array): EncryptedField {
  assertReady()
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    masterKey
  )
  return { ciphertext, nonce }
}

export function decryptField(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  masterKey: Uint8Array
): string {
  assertReady()
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    masterKey
  )
  return sodium.to_string(plaintext)
}

// Binary-safe encrypt/decrypt for key material. Identical cipher to encryptField
// (XChaCha20-Poly1305 IETF) but operates on raw bytes rather than UTF-8 strings.
export function encryptBytes(plaintext: Uint8Array, key: Uint8Array): EncryptedField {
  assertReady()
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    key
  )
  return { ciphertext, nonce }
}

export function decryptBytes(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array
): Uint8Array {
  assertReady()
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, key)
}

export function memzero(buf: Uint8Array): void {
  if (sodiumReady) {
    sodium.memzero(buf)
  } else {
    buf.fill(0)
  }
}

// Returns BLAKE2b-256(headerBytes, key=BLAKE2b-256(masterKey, key=context)).
// The domain-separated subkey ensures the header HMAC key is distinct from the SQLCipher key.
export function computeHeaderHmac(headerBytes: Buffer, masterKey: Buffer): Buffer {
  assertReady()
  const context = Buffer.from('notvex-header-hmac-v1')
  const hmacKey = sodium.crypto_generichash(32, masterKey, context)
  const hmac = sodium.crypto_generichash(32, headerBytes, hmacKey)
  sodium.memzero(hmacKey)
  return Buffer.from(hmac)
}

// Measures how long Argon2id takes on this machine, returns the highest-security
// tier that finishes within targetMs. Only called once at vault creation.
export function calibrateArgon2id(targetMs = 1500): { tier: number } {
  assertReady()
  const testPassword = 'calibration-benchmark'
  const testSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  const ALG = sodium.crypto_pwhash_ALG_ARGON2ID13

  for (const [key, params] of Object.entries(KDF_TIERS)) {
    const t0 = performance.now()
    sodium.crypto_pwhash(32, testPassword, testSalt, params.iterations, params.memory, ALG)
    if (performance.now() - t0 <= targetMs) {
      return { tier: Number(key) }
    }
  }

  return { tier: 10 }
}
