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

// Hardcoded to avoid reading sodium constants before sodium.ready
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memory: 268435456, // sodium.crypto_pwhash_MEMLIMIT_MODERATE (256 MB)
  iterations: 3, // sodium.crypto_pwhash_OPSLIMIT_MODERATE
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
  const hash = sodium.crypto_generichash(32, masterKey, new Uint8Array(0))
  return sodium.to_hex(hash)
}

export function memzero(buf: Uint8Array): void {
  if (sodiumReady) {
    sodium.memzero(buf)
  } else {
    buf.fill(0)
  }
}

/**
 * Measures how long Argon2id takes for a given parameter set on this machine.
 * Returns the highest-security tier that finishes within targetMs.
 * Only called once at vault creation — result is stored in the sidecar.
 */
export function calibrateArgon2id(targetMs = 1500): Argon2Params {
  assertReady()
  const testPassword = 'calibration-benchmark'
  const testSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)
  const ALG = sodium.crypto_pwhash_ALG_ARGON2ID13

  // Ordered from highest to lowest security — first one that fits wins.
  const tiers: Argon2Params[] = [
    { memory: 536870912, iterations: 4, parallelism: 1 }, // 512 MB / 4 passes
    { memory: 536870912, iterations: 3, parallelism: 1 }, // 512 MB / 3 passes
    { memory: 268435456, iterations: 4, parallelism: 1 }, // 256 MB / 4 passes
    { memory: 268435456, iterations: 3, parallelism: 1 }, // 256 MB / 3 passes  ← current default
    { memory: 268435456, iterations: 2, parallelism: 1 }, // 256 MB / 2 passes
    { memory: 134217728, iterations: 3, parallelism: 1 }, // 128 MB / 3 passes
    { memory: 134217728, iterations: 2, parallelism: 1 }, // 128 MB / 2 passes
    { memory: 67108864, iterations: 3, parallelism: 1 }, //  64 MB / 3 passes
    { memory: 67108864, iterations: 2, parallelism: 1 }, //  64 MB / 2 passes  ← minimum
  ]

  for (const tier of tiers) {
    const t0 = performance.now()
    sodium.crypto_pwhash(32, testPassword, testSalt, tier.iterations, tier.memory, ALG)
    if (performance.now() - t0 <= targetMs) {
      return tier
    }
  }

  return tiers[tiers.length - 1]
}
