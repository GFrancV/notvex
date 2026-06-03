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

// Hardcoded to avoid reading sodium constants before sodium.ready
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memory: 268435456, // sodium.crypto_pwhash_MEMLIMIT_MODERATE (256 MB)
  iterations: 3,     // sodium.crypto_pwhash_OPSLIMIT_MODERATE
  parallelism: 1,
}

export function generateSalt(): Uint8Array {
  assertReady()
  return sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
}

export function deriveKey(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Uint8Array {
  assertReady()
  return sodium.crypto_pwhash(
    32,
    password,
    salt,
    params.iterations,
    params.memory,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
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
    masterKey,
  )
  return { ciphertext, nonce }
}

export function decryptField(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  masterKey: Uint8Array,
): string {
  assertReady()
  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    masterKey,
  )
  return sodium.to_string(plaintext)
}

export function hashForVerify(masterKey: Uint8Array): string {
  assertReady()
  const hash = sodium.crypto_generichash(32, masterKey)
  return sodium.to_hex(hash)
}

export function memzero(buf: Uint8Array): void {
  if (sodiumReady) {
    sodium.memzero(buf)
  } else {
    buf.fill(0)
  }
}
